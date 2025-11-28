#!/bin/bash

# ============================================================
# Скрипт создания diff между storage и frozen
# Создаёт архив с новыми/изменёнными файлами для переноса
# ============================================================

set -o pipefail

# Конфигурация
STORAGE_DIR="${STORAGE_DIR:-./storage}"
FROZEN_DIR="${FROZEN_DIR:-./frozen}"
DIFF_OUTPUT_DIR="${DIFF_OUTPUT_DIR:-./diff_output}"
DIFF_ARCHIVES_DIR="${DIFF_ARCHIVES_DIR:-./diff_archives}"
DIFF_ID="${DIFF_ID:-diff_$(date +%Y%m%d_%H%M%S)}"

# Файлы для отслеживания прогресса
PROGRESS_FILE="${PROGRESS_FILE:-/tmp/diff_progress.json}"
STATUS_FILE="${STATUS_FILE:-/tmp/diff_status.json}"
LOG_FILE="${LOG_FILE:-/tmp/diff.log}"

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

# Функция обновления прогресса
update_progress() {
    local phase="$1"
    local current="$2"
    local total="$3"
    local timestamp=$(date -Iseconds)
    
    local percent=0
    if [ "$total" -gt 0 ]; then
        percent=$(echo "scale=2; $current * 100 / $total" | bc)
    fi
    
    cat > "$PROGRESS_FILE" << EOF
{
  "phase": "$phase",
  "current": $current,
  "total": $total,
  "percent": $percent,
  "updatedAt": "$timestamp"
}
EOF
}

# Основная функция
main() {
    log "INFO" "Starting diff creation: $DIFF_ID"
    update_status "running" "Initializing..."
    
    # Проверка директорий
    if [ ! -d "$STORAGE_DIR" ]; then
        log "ERROR" "Storage directory not found: $STORAGE_DIR"
        update_status "failed" "Storage directory not found"
        exit 1
    fi
    
    # Создаём frozen если не существует
    if [ ! -d "$FROZEN_DIR" ]; then
        log "INFO" "Creating frozen directory: $FROZEN_DIR"
        mkdir -p "$FROZEN_DIR"
    fi
    
    # Создаём директории для вывода
    mkdir -p "$DIFF_OUTPUT_DIR"
    mkdir -p "$DIFF_ARCHIVES_DIR"
    
    # Очищаем временную директорию diff_output
    rm -rf "${DIFF_OUTPUT_DIR:?}/"*
    
    log "INFO" "Comparing storage with frozen..."
    update_status "running" "Analyzing differences..."
    update_progress "analyzing" 0 0
    
    # Получаем список файлов для сравнения
    # Используем rsync в режиме dry-run для получения списка изменений
    DIFF_LIST_FILE=$(mktemp)
    
    rsync -av --dry-run --out-format='%n' \
        --exclude='.sinopia-db.json' \
        --exclude='.verdaccio-db.json' \
        "$STORAGE_DIR/" "$FROZEN_DIR/" 2>/dev/null | \
        grep -v '/$' > "$DIFF_LIST_FILE"
    
    TOTAL_FILES=$(wc -l < "$DIFF_LIST_FILE" | tr -d ' ')
    
    if [ "$TOTAL_FILES" -eq 0 ]; then
        log "INFO" "No differences found between storage and frozen"
        update_status "completed" "No differences found"
        update_progress "completed" 0 0
        rm -f "$DIFF_LIST_FILE"
        
        # Возвращаем результат
        cat << EOF
{
  "diffId": "$DIFF_ID",
  "filesCount": 0,
  "archivePath": null,
  "archiveSize": 0
}
EOF
        exit 0
    fi
    
    log "INFO" "Found $TOTAL_FILES files to include in diff"
    update_status "running" "Copying $TOTAL_FILES files..."
    update_progress "copying" 0 "$TOTAL_FILES"
    
    # Копируем файлы в diff_output
    current=0
    while IFS= read -r rel_path; do
        [ -z "$rel_path" ] && continue
        
        current=$((current + 1))
        
        src_file="$STORAGE_DIR/$rel_path"
        dst_file="$DIFF_OUTPUT_DIR/$rel_path"
        
        # Создаём директорию назначения
        mkdir -p "$(dirname "$dst_file")"
        
        # Копируем файл
        if [ -f "$src_file" ]; then
            cp "$src_file" "$dst_file"
        fi
        
        # Обновляем прогресс каждые 100 файлов
        if [ $((current % 100)) -eq 0 ] || [ "$current" -eq "$TOTAL_FILES" ]; then
            update_progress "copying" "$current" "$TOTAL_FILES"
        fi
        
    done < "$DIFF_LIST_FILE"
    
    rm -f "$DIFF_LIST_FILE"
    
    # Создаём архив
    log "INFO" "Creating archive..."
    update_status "running" "Creating archive..."
    update_progress "archiving" 0 1
    
    ARCHIVE_PATH="$DIFF_ARCHIVES_DIR/${DIFF_ID}.tar.gz"
    
    if tar -czvf "$ARCHIVE_PATH" -C "$DIFF_OUTPUT_DIR" . > /dev/null 2>&1; then
        ARCHIVE_SIZE=$(stat -c%s "$ARCHIVE_PATH")
        ARCHIVE_SIZE_HUMAN=$(numfmt --to=iec-i --suffix=B "$ARCHIVE_SIZE" 2>/dev/null || echo "$ARCHIVE_SIZE bytes")
        
        log "INFO" "Archive created: $ARCHIVE_PATH ($ARCHIVE_SIZE_HUMAN)"
        update_progress "archiving" 1 1
    else
        log "ERROR" "Failed to create archive"
        update_status "failed" "Failed to create archive"
        exit 1
    fi
    
    # Сохраняем список файлов в diff
    FILES_LIST="$DIFF_ARCHIVES_DIR/${DIFF_ID}_files.txt"
    find "$DIFF_OUTPUT_DIR" -type f | sed "s|$DIFF_OUTPUT_DIR/||" > "$FILES_LIST"
    
    # Очищаем временную директорию
    rm -rf "${DIFF_OUTPUT_DIR:?}/"*
    
    # Финальный статус
    update_status "completed" "Diff created: $TOTAL_FILES files, $ARCHIVE_SIZE_HUMAN"
    
    # Возвращаем результат в JSON
    cat << EOF
{
  "diffId": "$DIFF_ID",
  "filesCount": $TOTAL_FILES,
  "archivePath": "$ARCHIVE_PATH",
  "archiveSize": $ARCHIVE_SIZE,
  "archiveSizeHuman": "$ARCHIVE_SIZE_HUMAN",
  "filesListPath": "$FILES_LIST",
  "storageSnapshotTime": "$(date -Iseconds)"
}
EOF
    
    log "INFO" "Diff creation completed successfully"
}

# Запуск
main "$@"
