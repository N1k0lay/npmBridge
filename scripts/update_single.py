#!/usr/bin/env python3
"""
Скрипт обновления одного пакета в репозитории Verdaccio.
"""

import os
import sys
import json
import subprocess
import tempfile
import shutil
from datetime import datetime
from pathlib import Path

# Конфигурация из переменных окружения
VERDACCIO_HOME = os.environ.get('VERDACCIO_HOME', '/home/npm/verdaccio')
STORAGE_DIR = os.environ.get('STORAGE_DIR', f'{VERDACCIO_HOME}/storage')
PNPM_STORE_DIR = os.environ.get('PNPM_STORE_DIR', '')
PNPM_CMD = os.environ.get('PNPM_CMD', 'pnpm')
REGISTRY_URL = os.environ.get('REGISTRY_URL', 'http://localhost:8013/')

# Файлы для отслеживания прогресса
PROGRESS_FILE = os.environ.get('PROGRESS_FILE', '/tmp/update_progress.json')
STATUS_FILE = os.environ.get('STATUS_FILE', '/tmp/update_status.json')
LOG_FILE = os.environ.get('LOG_FILE', '/tmp/update.log')

# Очищаем proxy
for var in ['HTTPS_PROXY', 'HTTP_PROXY', 'http_proxy', 'https_proxy']:
    os.environ.pop(var, None)


def log(level: str, message: str):
    timestamp = datetime.now().isoformat()
    log_line = f"[{timestamp}] [{level}] {message}"
    print(log_line, flush=True)
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


def update_progress(current: int, total: int, package: str, success: int, failed: int, errors: list):
    percent = (current * 100 / total) if total > 0 else 100
    data = {
        "current": current,
        "total": total,
        "success": success,
        "failed": failed,
        "currentPackage": package,
        "percent": round(percent, 2),
        "errors": errors[-20:],
        "updatedAt": datetime.now().isoformat()
    }
    try:
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(data, f)
    except Exception:
        pass


def install_package(package: str) -> tuple[bool, str]:
    """Установка пакета, возвращает (success, error_message)"""
    temp_dir = tempfile.mkdtemp()
    success = False
    error_msg = ""
    
    try:
        cmd = [PNPM_CMD, 'install', f'{package}@latest', '--force', f'--registry={REGISTRY_URL}']
        if PNPM_STORE_DIR:
            cmd.append(f'--store-dir={PNPM_STORE_DIR}')
        
        result = subprocess.run(
            cmd,
            cwd=temp_dir,
            capture_output=True,
            timeout=300
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
    
    return success, error_msg


def main():
    if len(sys.argv) < 2:
        print("Usage: update_single.py <package_name>", file=sys.stderr)
        sys.exit(1)
    
    package = sys.argv[1]
    log('INFO', f'Starting update of package: {package}')
    update_status('running', f'Обновление пакета {package}...')
    update_progress(0, 1, package, 0, 0, [])
    
    if not Path(STORAGE_DIR).exists():
        log('ERROR', f'STORAGE_DIR not found: {STORAGE_DIR}')
        update_status('failed', f'Директория не найдена: {STORAGE_DIR}')
        sys.exit(1)
    
    success, error_msg = install_package(package)
    
    if success:
        update_progress(1, 1, package, 1, 0, [])
        update_status('completed', f'Пакет {package} успешно обновлён')
        log('INFO', f'Package {package} updated successfully')
    else:
        update_progress(1, 1, package, 0, 1, [{"package": package, "error": error_msg}])
        update_status('failed', f'Ошибка обновления {package}: {error_msg[:100]}')
        log('ERROR', f'Failed to update package {package}')
        sys.exit(1)


if __name__ == '__main__':
    main()
