#!/bin/bash

# ============================================================
# Скрипт переустановки битых пакетов
# Модифицирован для интеграции с веб-интерфейсом
# ============================================================

set -o pipefail

unset HTTPS_PROXY HTTP_PROXY http_proxy https_proxy

# Конфигурация
BROKEN_FILE="${BROKEN_FILE:-broken.txt}"
NPM_CMD="${NPM_CMD:-npm}"

# Файлы для отслеживания прогресса
PROGRESS_FILE="${PROGRESS_FILE:-/tmp/fix_progress.json}"
STATUS_FILE="${STATUS_FILE:-/tmp/fix_status.json}"
LOG_FILE="${LOG_FILE:-/tmp/fix.log}"

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
    local current="$1"
    local total="$2"
    local fixed="$3"
    local failed="$4"
    local current_package="$5"
    local timestamp=$(date -Iseconds)
    
    local percent=0
    if [ "$total" -gt 0 ]; then
        percent=$(echo "scale=2; $current * 100 / $total" | bc)
    fi
    
    cat > "$PROGRESS_FILE" << EOF
{
  "current": $current,
  "total": $total,
  "fixed": $fixed,
  "failed": $failed,
  "currentPackage": "$current_package",
  "percent": $percent,
  "updatedAt": "$timestamp"
}
EOF
}

# Извлечение имени пакета из пути архива
# Пример: ./storage/@angular/core/core-15.0.0.tgz -> @angular/core
# Пример: ./storage/lodash/lodash-4.17.21.tgz -> lodash
extract_package_info() {
    local archive="$1"
    local filename=$(basename "$archive")
    local dirname=$(dirname "$archive")
    
    # Извлекаем версию из имени файла
    # Формат: package-name-1.2.3.tgz или name-1.2.3-beta.1.tgz
    local version=$(echo "$filename" | grep -oP '\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?' | tail -1)
    
    # Извлекаем scope (@org) если есть
    local scope=$(echo "$dirname" | grep -oP '@[^/]+' | head -1)
    
    # Извлекаем имя пакета из директории
    local pkg_name=$(basename "$dirname")
    
    if [ -n "$scope" ]; then
        echo "$scope/$pkg_name@$version"
    else
        echo "$pkg_name@$version"
    fi
}

# Функция переустановки пакета
reinstall_package() {
    local archive="$1"
    local package_spec="$2"
    local temp_dir=$(mktemp -d)
    local result=0
    
    log "INFO" "Reinstalling: $package_spec (from $archive)"
    
    # Удаляем битый архив
    rm -f "$archive"
    
    # Устанавливаем пакет во временную директорию
    cd "$temp_dir"
    
    if $NPM_CMD install -f "$package_spec" --prefix "$temp_dir" > /dev/null 2>&1; then
        # Проверяем, что архив теперь валидный
        if [ -f "$archive" ] && tar -tzf "$archive" > /dev/null 2>&1; then
            log "INFO" "Successfully fixed: $package_spec"
            result=0
        else
            log "ERROR" "Archive still broken after reinstall: $archive"
            result=1
        fi
    else
        log "ERROR" "Failed to reinstall: $package_spec"
        result=1
    fi
    
    # Очистка
    cd /
    rm -rf "$temp_dir"
    
    return $result
}

# Основная функция
main() {
    log "INFO" "Starting broken archives fix"
    update_status "running" "Initializing..."
    
    # Проверка наличия файла с битыми архивами
    if [ ! -f "$BROKEN_FILE" ]; then
        log "ERROR" "Broken files list not found: $BROKEN_FILE"
        update_status "failed" "Broken files list not found: $BROKEN_FILE"
        exit 1
    fi
    
    # Подсчёт количества битых архивов
    TOTAL_BROKEN=$(wc -l < "$BROKEN_FILE" | tr -d ' ')
    
    if [ "$TOTAL_BROKEN" -eq 0 ]; then
        log "INFO" "No broken archives to fix"
        update_status "completed" "No broken archives to fix"
        update_progress 0 0 0 0 ""
        exit 0
    fi
    
    log "INFO" "Found $TOTAL_BROKEN broken archives to fix"
    update_status "running" "Fixing $TOTAL_BROKEN broken archives..."
    
    # Счётчики
    current=0
    fixed=0
    failed=0
    
    # Обработка каждого битого архива
    while IFS= read -r archive; do
        [ -z "$archive" ] && continue
        
        current=$((current + 1))
        
        # Извлекаем информацию о пакете
        package_spec=$(extract_package_info "$archive")
        
        update_progress "$current" "$TOTAL_BROKEN" "$fixed" "$failed" "$package_spec"
        
        # Переустанавливаем пакет
        if reinstall_package "$archive" "$package_spec"; then
            fixed=$((fixed + 1))
        else
            failed=$((failed + 1))
        fi
        
        update_progress "$current" "$TOTAL_BROKEN" "$fixed" "$failed" "$package_spec"
        
    done < "$BROKEN_FILE"
    
    # Финальный статус
    log "INFO" "Fix completed. Fixed: $fixed, Failed: $failed"
    
    if [ "$failed" -eq 0 ]; then
        update_status "completed" "Successfully fixed all $fixed broken archives"
    else
        update_status "completed_with_errors" "Fixed $fixed, Failed $failed out of $TOTAL_BROKEN"
    fi
    
    # Вывод результата в JSON
    cat << EOF
{
  "totalBroken": $TOTAL_BROKEN,
  "fixed": $fixed,
  "failed": $failed
}
EOF
}

# Запуск
main "$@"
