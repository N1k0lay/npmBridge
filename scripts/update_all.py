#!/usr/bin/env python3
"""
Скрипт полного обновления всех пакетов в репозитории Verdaccio.
Использует многопоточность для ускорения процесса.
"""

import os
import sys
import json
import subprocess
import tempfile
import shutil
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from typing import Optional

# Конфигурация из переменных окружения
VERDACCIO_HOME = os.environ.get('VERDACCIO_HOME', '/home/npm/verdaccio')
STORAGE_DIR = os.environ.get('STORAGE_DIR', f'{VERDACCIO_HOME}/storage')
PNPM_CMD = os.environ.get('PNPM_CMD', 'pnpm')
PARALLEL_JOBS = int(os.environ.get('PARALLEL_JOBS', '40'))

# Файлы для отслеживания прогресса
PROGRESS_FILE = os.environ.get('PROGRESS_FILE', '/tmp/update_progress.json')
STATUS_FILE = os.environ.get('STATUS_FILE', '/tmp/update_status.json')
LOG_FILE = os.environ.get('LOG_FILE', '/tmp/update.log')

# Очищаем proxy
for var in ['HTTPS_PROXY', 'HTTP_PROXY', 'http_proxy', 'https_proxy']:
    os.environ.pop(var, None)

# Блокировка для потокобезопасной записи
progress_lock = Lock()
log_lock = Lock()

class ProgressTracker:
    def __init__(self, total: int):
        self.current = 0
        self.total = total
        self.current_package = ""
        self.success = 0
        self.failed = 0
        self.errors = []  # Список ошибок: [{"package": ..., "error": ...}, ...]
        self.lock = Lock()
    
    def increment(self, package: str, success: bool, error_msg: str = ""):
        with self.lock:
            self.current += 1
            self.current_package = package
            if success:
                self.success += 1
            else:
                self.failed += 1
                self.errors.append({"package": package, "error": error_msg[:500]})
            
            # Обновляем файл прогресса каждые 10 пакетов или в конце
            if self.current % 10 == 0 or self.current == self.total:
                self._write_progress()
    
    def _write_progress(self):
        percent = (self.current * 100 / self.total) if self.total > 0 else 0
        data = {
            "current": self.current,
            "total": self.total,
            "success": self.success,
            "failed": self.failed,
            "currentPackage": self.current_package,
            "percent": round(percent, 2),
            "errors": self.errors[-20:],  # Последние 20 ошибок
            "updatedAt": datetime.now().isoformat()
        }
        try:
            with open(PROGRESS_FILE, 'w') as f:
                json.dump(data, f)
        except Exception:
            pass


def log(level: str, message: str):
    """Логирование с timestamp"""
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
    """Обновление файла статуса"""
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


def get_package_list() -> list[str]:
    """Получение списка всех пакетов из storage"""
    packages = []
    storage_path = Path(STORAGE_DIR)
    
    if not storage_path.exists():
        return packages
    
    for item in storage_path.iterdir():
        if item.name.startswith('.'):
            continue
        
        if item.name.startswith('@'):
            # Scoped пакеты (@org/package)
            for subitem in item.iterdir():
                if subitem.is_dir() and not subitem.name.startswith('.'):
                    packages.append(f"{item.name}/{subitem.name}")
        elif item.is_dir():
            # Обычные пакеты
            packages.append(item.name)
    
    return packages


def install_package(package: str, tracker: ProgressTracker) -> bool:
    """Установка одного пакета"""
    temp_dir = tempfile.mkdtemp()
    success = False
    error_msg = ""
    
    try:
        result = subprocess.run(
            [PNPM_CMD, 'install', f'{package}@latest', '--force'],
            cwd=temp_dir,
            capture_output=True,
            timeout=300  # 5 минут таймаут на пакет
        )
        success = result.returncode == 0
        
        if success:
            log('INFO', f'✓ {package}')
        else:
            error_msg = result.stderr.decode()[:500] or result.stdout.decode()[:500]
            log('ERROR', f'✗ {package}: {error_msg[:200]}')
    
    except subprocess.TimeoutExpired:
        error_msg = "timeout (300s)"
        log('ERROR', f'✗ {package}: timeout')
    except Exception as e:
        error_msg = str(e)
        log('ERROR', f'✗ {package}: {error_msg}')
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        tracker.increment(package, success, error_msg)
    
    return success


def main():
    log('INFO', f'Starting full repository update')
    log('INFO', f'VERDACCIO_HOME: {VERDACCIO_HOME}')
    log('INFO', f'STORAGE_DIR: {STORAGE_DIR}')
    log('INFO', f'PARALLEL_JOBS: {PARALLEL_JOBS}')
    
    update_status('running', 'Получение списка пакетов...')
    
    # Проверка директории
    if not Path(VERDACCIO_HOME).exists():
        log('ERROR', f'VERDACCIO_HOME not found: {VERDACCIO_HOME}')
        update_status('failed', f'Директория не найдена: {VERDACCIO_HOME}')
        sys.exit(1)
    
    # Получение списка пакетов
    packages = get_package_list()
    total = len(packages)
    
    if total == 0:
        log('INFO', 'No packages found')
        update_status('completed', 'Пакеты не найдены')
        sys.exit(0)
    
    log('INFO', f'Found {total} packages to update')
    update_status('running', f'Обновление {total} пакетов...')
    
    # Инициализация трекера прогресса
    tracker = ProgressTracker(total)
    
    # Параллельная установка пакетов
    with ThreadPoolExecutor(max_workers=PARALLEL_JOBS) as executor:
        futures = {
            executor.submit(install_package, pkg, tracker): pkg 
            for pkg in packages
        }
        
        for future in as_completed(futures):
            # Просто ждём завершения, результат уже обработан в install_package
            pass
    
    # Финальный статус
    if tracker.failed == 0:
        log('INFO', f'Update completed successfully. Processed {tracker.success} packages.')
        update_status('completed', f'Успешно обновлено {tracker.success} пакетов')
    else:
        log('WARN', f'Update completed with errors. Success: {tracker.success}, Failed: {tracker.failed}')
        update_status('completed_with_errors', f'Обновлено: {tracker.success}, Ошибок: {tracker.failed}')
    
    # Вывод результата в JSON
    result = {
        "totalPackages": total,
        "success": tracker.success,
        "failed": tracker.failed,
        "errors": tracker.errors  # Все ошибки
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
