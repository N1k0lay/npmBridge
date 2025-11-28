#!/bin/bash

# ============================================================
# Скрипт синхронизации frozen с storage после подтверждения переноса diff
# Обновляет frozen до состояния storage на момент создания diff
# ============================================================

set -o pipefail

# Конфигурация
STORAGE_DIR="${STORAGE_DIR:-./storage}"
FROZEN_DIR="${FROZEN_DIR:-./frozen}"
DIFF_ARCHIVES_DIR="${DIFF_ARCHIVES_DIR:-./diff_archives}"
DIFF_ID="${DIFF_ID:-}"

# Файлы для отслеживания прогресса
STATUS_FILE="${STATUS_FILE:-/tmp/sync_status.json}"
LOG_FILE="${LOG_FILE:-/tmp/sync.log}"

# Функция логирования
log() {
    local level="$1"
    local message="$2"
    local timestamp=$(date -Iseconds)
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Функция обновления статуса
update_status() {
    local status="$1"
    local message="$2"
    local timestamp=$(date -Iseconds)
    cat > "$STATUS_FILE" << EOF
{
  "status": "$status",
  "message": "$message",
  "updatedAt": "$timestamp"
}
EOF
}

# Основная функция
main() {
    if [ -z "$DIFF_ID" ]; then
        log "ERROR" "DIFF_ID is required"
        update_status "failed" "DIFF_ID is required"
        exit 1
    fi
    
    log "INFO" "Starting frozen sync for diff: $DIFF_ID"
    update_status "running" "Syncing frozen directory..."
    
    # Проверяем наличие списка файлов diff
    FILES_LIST="$DIFF_ARCHIVES_DIR/${DIFF_ID}_files.txt"
    
    if [ ! -f "$FILES_LIST" ]; then
        log "ERROR" "Files list not found: $FILES_LIST"
        update_status "failed" "Files list not found"
        exit 1
    fi
    
    # Создаём frozen если не существует
    mkdir -p "$FROZEN_DIR"
    
    # Копируем файлы из storage в frozen по списку
    copied=0
    failed=0
    
    while IFS= read -r rel_path; do
        [ -z "$rel_path" ] && continue
        
        src_file="$STORAGE_DIR/$rel_path"
        dst_file="$FROZEN_DIR/$rel_path"
        
        if [ -f "$src_file" ]; then
            mkdir -p "$(dirname "$dst_file")"
            if cp "$src_file" "$dst_file"; then
                copied=$((copied + 1))
            else
                failed=$((failed + 1))
                log "ERROR" "Failed to copy: $rel_path"
            fi
        else
            log "WARN" "Source file not found: $src_file"
        fi
        
    done < "$FILES_LIST"
    
    log "INFO" "Sync completed. Copied: $copied, Failed: $failed"
    
    if [ "$failed" -eq 0 ]; then
        update_status "completed" "Successfully synced $copied files to frozen"
    else
        update_status "completed_with_errors" "Synced $copied files, $failed failed"
    fi
    
    # Возвращаем результат
    cat << EOF
{
  "diffId": "$DIFF_ID",
  "copiedFiles": $copied,
  "failedFiles": $failed
}
EOF
}

# Запуск
main "$@"
