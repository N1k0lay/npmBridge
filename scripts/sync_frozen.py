#!/usr/bin/env python3
"""
Скрипт синхронизации frozen с storage после подтверждения переноса diff.
"""

import os
import sys
import json
import shutil
from datetime import datetime
from pathlib import Path
from threading import Lock

# Конфигурация
STORAGE_DIR = os.environ.get('STORAGE_DIR', './storage')
FROZEN_DIR = os.environ.get('FROZEN_DIR', './frozen')
DIFF_ARCHIVES_DIR = os.environ.get('DIFF_ARCHIVES_DIR', './diff_archives')
DIFF_ID = os.environ.get('DIFF_ID', '')

# Файлы для отслеживания прогресса
STATUS_FILE = os.environ.get('STATUS_FILE', '/tmp/sync_status.json')
LOG_FILE = os.environ.get('LOG_FILE', '/tmp/sync.log')

log_lock = Lock()


def log(level: str, message: str):
    timestamp = datetime.now().isoformat()
    log_line = f"[{timestamp}] [{level}] {message}"
    print(log_line, file=sys.stderr)
    with log_lock:
        try:
            with open(LOG_FILE, 'a') as f:
                f.write(log_line + '\n')
        except Exception:
            pass


def update_status(status: str, message: str):
    data = {
        "status": status,
        "message": message,
        "updatedAt": datetime.now().isoformat()
    }
    try:
        with open(STATUS_FILE, 'w') as f:
            json.dump(data, f)
    except Exception:
        pass


def main():
    if not DIFF_ID:
        log('ERROR', 'DIFF_ID is required')
        update_status('failed', 'DIFF_ID не указан')
        sys.exit(1)
    
    log('INFO', f'Starting frozen sync for diff: {DIFF_ID}')
    update_status('running', 'Синхронизация frozen...')
    
    storage_path = Path(STORAGE_DIR)
    frozen_path = Path(FROZEN_DIR)
    archives_path = Path(DIFF_ARCHIVES_DIR)
    
    # Проверяем наличие списка файлов diff
    files_list_path = archives_path / f"{DIFF_ID}_files.json"
    
    if not files_list_path.exists():
        log('ERROR', f'Files list not found: {files_list_path}')
        update_status('failed', 'Список файлов не найден')
        sys.exit(1)
    
    # Читаем список файлов
    with open(files_list_path, 'r') as f:
        files_info = json.load(f)
    
    # Создаём frozen если не существует
    frozen_path.mkdir(parents=True, exist_ok=True)
    
    copied = 0
    failed = 0
    
    for file_info in files_info:
        rel_path = file_info['path']
        src_file = storage_path / rel_path
        dst_file = frozen_path / rel_path
        
        if src_file.exists():
            try:
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_file, dst_file)
                copied += 1
            except Exception as e:
                failed += 1
                log('ERROR', f'Failed to copy: {rel_path}: {str(e)}')
        else:
            log('WARN', f'Source file not found: {src_file}')
    
    log('INFO', f'Sync completed. Copied: {copied}, Failed: {failed}')
    
    if failed == 0:
        update_status('completed', f'Успешно синхронизировано {copied} файлов')
    else:
        update_status('completed_with_errors', f'Скопировано: {copied}, Ошибок: {failed}')
    
    result = {
        "diffId": DIFF_ID,
        "copiedFiles": copied,
        "failedFiles": failed
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
