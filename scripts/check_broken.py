#!/usr/bin/env python3
"""
Скрипт проверки целостности .tgz архивов в storage.
"""

import os
import sys
import json
import tarfile
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

# Конфигурация
STORAGE_DIR = os.environ.get('STORAGE_DIR', './storage')
BROKEN_FILE = os.environ.get('BROKEN_FILE', 'broken.txt')
PARALLEL_JOBS = int(os.environ.get('PARALLEL_JOBS', '40'))

# Файлы для отслеживания прогресса
PROGRESS_FILE = os.environ.get('PROGRESS_FILE', '/tmp/check_progress.json')
STATUS_FILE = os.environ.get('STATUS_FILE', '/tmp/check_status.json')
LOG_FILE = os.environ.get('LOG_FILE', '/tmp/check.log')

log_lock = Lock()
broken_lock = Lock()


class ProgressTracker:
    def __init__(self, total: int):
        self.current = 0
        self.total = total
        self.broken = 0
        self.current_file = ""
        self.lock = Lock()
    
    def increment(self, archive: str, is_broken: bool):
        with self.lock:
            self.current += 1
            self.current_file = archive
            if is_broken:
                self.broken += 1
            
            if self.current % 50 == 0 or self.current == self.total:
                self._write_progress()
    
    def _write_progress(self):
        percent = (self.current * 100 / self.total) if self.total > 0 else 0
        data = {
            "current": self.current,
            "total": self.total,
            "broken": self.broken,
            "currentFile": self.current_file,
            "percent": round(percent, 2),
            "updatedAt": datetime.now().isoformat()
        }
        try:
            with open(PROGRESS_FILE, 'w') as f:
                json.dump(data, f)
        except Exception:
            pass


def log(level: str, message: str):
    timestamp = datetime.now().isoformat()
    log_line = f"[{timestamp}] [{level}] {message}"
    print(log_line)
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


def check_archive(archive_path: str, tracker: ProgressTracker, broken_files: list) -> bool:
    """Проверка целостности архива"""
    is_broken = False
    
    try:
        with tarfile.open(archive_path, 'r:gz') as tar:
            # Пробуем прочитать список файлов
            tar.getnames()
    except Exception:
        is_broken = True
        with broken_lock:
            broken_files.append(archive_path)
        log('WARN', f'Broken: {archive_path}')
    
    tracker.increment(archive_path, is_broken)
    return is_broken


def main():
    log('INFO', f'Starting archive integrity check in {STORAGE_DIR}')
    update_status('running', 'Инициализация...')
    
    storage_path = Path(STORAGE_DIR)
    if not storage_path.exists():
        log('ERROR', f'Storage directory not found: {STORAGE_DIR}')
        update_status('failed', f'Директория не найдена: {STORAGE_DIR}')
        sys.exit(1)
    
    # Получаем список всех .tgz файлов
    log('INFO', 'Counting archives...')
    update_status('running', 'Подсчёт архивов...')
    
    archives = list(storage_path.rglob('*.tgz'))
    total = len(archives)
    
    if total == 0:
        log('INFO', 'No archives found')
        update_status('completed', 'Архивы не найдены')
        print(json.dumps({"totalArchives": 0, "brokenArchives": 0, "brokenFile": BROKEN_FILE}))
        sys.exit(0)
    
    log('INFO', f'Found {total} archives to check')
    update_status('running', f'Проверка {total} архивов...')
    
    tracker = ProgressTracker(total)
    broken_files: list[str] = []
    
    # Параллельная проверка
    with ThreadPoolExecutor(max_workers=PARALLEL_JOBS) as executor:
        futures = {
            executor.submit(check_archive, str(archive), tracker, broken_files): archive
            for archive in archives
        }
        for future in as_completed(futures):
            pass
    
    # Сохраняем список битых файлов
    with open(BROKEN_FILE, 'w') as f:
        for broken in broken_files:
            f.write(broken + '\n')
    
    # Финальный статус
    if tracker.broken == 0:
        log('INFO', f'All {total} archives are valid')
        update_status('completed', f'Все {total} архивов исправны')
    else:
        log('WARN', f'Found {tracker.broken} broken archives out of {total}')
        update_status('completed_with_issues', f'Найдено {tracker.broken} повреждённых архивов из {total}')
    
    result = {
        "totalArchives": total,
        "brokenArchives": tracker.broken,
        "brokenFile": BROKEN_FILE,
        "brokenFiles": broken_files
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
