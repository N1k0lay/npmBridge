#!/usr/bin/env python3
"""
Скрипт обновления недавно изменённых пакетов в репозитории Verdaccio.
"""

import os
import sys
import json
import subprocess
import tempfile
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

# Конфигурация из переменных окружения
VERDACCIO_HOME = os.environ.get('VERDACCIO_HOME', '/home/npm/verdaccio')
STORAGE_DIR = os.environ.get('STORAGE_DIR', f'{VERDACCIO_HOME}/storage')
PNPM_CMD = os.environ.get('PNPM_CMD', 'pnpm')
PARALLEL_JOBS = int(os.environ.get('PARALLEL_JOBS', '40'))
MODIFIED_MINUTES = int(os.environ.get('MODIFIED_MINUTES', '2880'))  # 2 дня по умолчанию

# Файлы для отслеживания прогресса
PROGRESS_FILE = os.environ.get('PROGRESS_FILE', '/tmp/update_progress.json')
STATUS_FILE = os.environ.get('STATUS_FILE', '/tmp/update_status.json')
LOG_FILE = os.environ.get('LOG_FILE', '/tmp/update.log')

# Очищаем proxy
for var in ['HTTPS_PROXY', 'HTTP_PROXY', 'http_proxy', 'https_proxy']:
    os.environ.pop(var, None)

log_lock = Lock()


class ProgressTracker:
    def __init__(self, total: int):
        self.current = 0
        self.total = total
        self.current_package = ""
        self.success = 0
        self.failed = 0
        self.lock = Lock()
    
    def increment(self, package: str, success: bool):
        with self.lock:
            self.current += 1
            self.current_package = package
            if success:
                self.success += 1
            else:
                self.failed += 1
            
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


def get_modified_packages() -> list[str]:
    """Получение списка недавно изменённых пакетов"""
    packages = set()
    storage_path = Path(STORAGE_DIR)
    cutoff_time = datetime.now() - timedelta(minutes=MODIFIED_MINUTES)
    
    if not storage_path.exists():
        return list(packages)
    
    # Ищем package.json файлы, изменённые за последние N минут
    for package_json in storage_path.rglob('package.json'):
        try:
            mtime = datetime.fromtimestamp(package_json.stat().st_mtime)
            if mtime > cutoff_time:
                # Получаем относительный путь пакета
                rel_path = package_json.parent.relative_to(storage_path)
                parts = rel_path.parts
                
                if len(parts) >= 2 and parts[0].startswith('@'):
                    # Scoped пакет: @org/package
                    packages.add(f"{parts[0]}/{parts[1]}")
                elif len(parts) >= 1 and not parts[0].startswith('.'):
                    # Обычный пакет
                    packages.add(parts[0])
        except Exception:
            continue
    
    return list(packages)


def install_package(package: str, tracker: ProgressTracker) -> bool:
    temp_dir = tempfile.mkdtemp()
    success = False
    
    try:
        result = subprocess.run(
            [PNPM_CMD, 'install', f'{package}@latest', '--force'],
            cwd=temp_dir,
            capture_output=True,
            timeout=300
        )
        success = result.returncode == 0
        
        if success:
            log('INFO', f'✓ {package}')
        else:
            log('ERROR', f'✗ {package}: {result.stderr.decode()[:200]}')
    
    except subprocess.TimeoutExpired:
        log('ERROR', f'✗ {package}: timeout')
    except Exception as e:
        log('ERROR', f'✗ {package}: {str(e)}')
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        tracker.increment(package, success)
    
    return success


def main():
    hours = MODIFIED_MINUTES // 60
    log('INFO', f'Starting update of packages modified in last {hours} hours ({MODIFIED_MINUTES} minutes)')
    update_status('running', 'Поиск изменённых пакетов...')
    
    if not Path(VERDACCIO_HOME).exists():
        log('ERROR', f'VERDACCIO_HOME not found: {VERDACCIO_HOME}')
        update_status('failed', f'Директория не найдена: {VERDACCIO_HOME}')
        sys.exit(1)
    
    packages = get_modified_packages()
    total = len(packages)
    
    if total == 0:
        log('INFO', f'No modified packages found in last {hours} hours')
        update_status('completed', f'Нет изменённых пакетов за последние {hours} часов')
        print(json.dumps({"totalPackages": 0, "success": 0, "failed": 0}))
        sys.exit(0)
    
    log('INFO', f'Found {total} modified packages to update')
    update_status('running', f'Обновление {total} изменённых пакетов...')
    
    tracker = ProgressTracker(total)
    
    with ThreadPoolExecutor(max_workers=PARALLEL_JOBS) as executor:
        futures = {
            executor.submit(install_package, pkg, tracker): pkg 
            for pkg in packages
        }
        for future in as_completed(futures):
            pass
    
    if tracker.failed == 0:
        log('INFO', f'Update completed successfully. Processed {tracker.success} packages.')
        update_status('completed', f'Успешно обновлено {tracker.success} пакетов')
    else:
        log('WARN', f'Update completed with errors. Success: {tracker.success}, Failed: {tracker.failed}')
        update_status('completed_with_errors', f'Обновлено: {tracker.success}, Ошибок: {tracker.failed}')
    
    result = {
        "totalPackages": total,
        "success": tracker.success,
        "failed": tracker.failed
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
