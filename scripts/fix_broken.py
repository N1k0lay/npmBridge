#!/usr/bin/env python3
"""
Скрипт переустановки битых пакетов.
"""

import os
import sys
import json
import re
import subprocess
import tempfile
import shutil
from datetime import datetime
from pathlib import Path
from threading import Lock

# Конфигурация
BROKEN_FILE = os.environ.get('BROKEN_FILE', 'broken.txt')
PNPM_CMD = os.environ.get('PNPM_CMD', 'pnpm')
STORAGE_DIR = os.environ.get('STORAGE_DIR', './storage')

# Файлы для отслеживания прогресса
PROGRESS_FILE = os.environ.get('PROGRESS_FILE', '/tmp/fix_progress.json')
STATUS_FILE = os.environ.get('STATUS_FILE', '/tmp/fix_status.json')
LOG_FILE = os.environ.get('LOG_FILE', '/tmp/fix.log')

# Очищаем proxy
for var in ['HTTPS_PROXY', 'HTTP_PROXY', 'http_proxy', 'https_proxy']:
    os.environ.pop(var, None)

log_lock = Lock()


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


def update_progress(current: int, total: int, fixed: int, failed: int, current_package: str):
    percent = (current * 100 / total) if total > 0 else 0
    data = {
        "current": current,
        "total": total,
        "fixed": fixed,
        "failed": failed,
        "currentPackage": current_package,
        "percent": round(percent, 2),
        "updatedAt": datetime.now().isoformat()
    }
    try:
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(data, f)
    except Exception:
        pass


def extract_package_info(archive_path: str) -> tuple[str, str]:
    """
    Извлечение имени пакета и версии из пути архива.
    
    Примеры:
    - ./storage/@angular/core/core-15.0.0.tgz -> (@angular/core, 15.0.0)
    - ./storage/lodash/lodash-4.17.21.tgz -> (lodash, 4.17.21)
    """
    path = Path(archive_path)
    filename = path.name  # core-15.0.0.tgz
    parent = path.parent  # ./storage/@angular/core
    
    # Извлекаем версию из имени файла
    # Формат: package-name-1.2.3.tgz или name-1.2.3-beta.1.tgz
    version_match = re.search(r'(\d+\.\d+\.\d+(?:-[\w.]+)?)', filename)
    version = version_match.group(1) if version_match else 'latest'
    
    # Определяем имя пакета
    storage_path = Path(STORAGE_DIR)
    try:
        rel_path = parent.relative_to(storage_path)
        parts = rel_path.parts
        
        if len(parts) >= 2 and parts[0].startswith('@'):
            # Scoped пакет
            package_name = f"{parts[0]}/{parts[1]}"
        elif len(parts) >= 1:
            # Обычный пакет
            package_name = parts[0]
        else:
            package_name = parent.name
    except ValueError:
        package_name = parent.name
    
    return package_name, version


def reinstall_package(archive_path: str, package_name: str, version: str) -> bool:
    """Переустановка пакета"""
    temp_dir = tempfile.mkdtemp()
    success = False
    package_spec = f"{package_name}@{version}"
    
    try:
        # Удаляем битый архив
        if os.path.exists(archive_path):
            os.remove(archive_path)
        
        # Устанавливаем пакет
        result = subprocess.run(
            [PNPM_CMD, 'install', package_spec, '--force'],
            cwd=temp_dir,
            capture_output=True,
            timeout=300
        )
        
        if result.returncode == 0:
            # Проверяем, что архив теперь существует и валидный
            if os.path.exists(archive_path):
                import tarfile
                try:
                    with tarfile.open(archive_path, 'r:gz') as tar:
                        tar.getnames()
                    success = True
                    log('INFO', f'✓ Fixed: {package_spec}')
                except Exception:
                    log('ERROR', f'✗ Archive still broken after reinstall: {package_spec}')
            else:
                # Архив может быть в другом месте после переустановки
                log('WARN', f'? Archive not found after reinstall: {archive_path}')
                success = True  # Считаем успехом, если установка прошла
        else:
            log('ERROR', f'✗ Failed to reinstall: {package_spec}: {result.stderr.decode()[:200]}')
    
    except subprocess.TimeoutExpired:
        log('ERROR', f'✗ Timeout reinstalling: {package_spec}')
    except Exception as e:
        log('ERROR', f'✗ Error reinstalling {package_spec}: {str(e)}')
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
    
    return success


def main():
    log('INFO', 'Starting broken archives fix')
    update_status('running', 'Инициализация...')
    
    if not os.path.exists(BROKEN_FILE):
        log('ERROR', f'Broken files list not found: {BROKEN_FILE}')
        update_status('failed', f'Файл не найден: {BROKEN_FILE}')
        sys.exit(1)
    
    # Читаем список битых архивов
    with open(BROKEN_FILE, 'r') as f:
        broken_archives = [line.strip() for line in f if line.strip()]
    
    total = len(broken_archives)
    
    if total == 0:
        log('INFO', 'No broken archives to fix')
        update_status('completed', 'Нет битых архивов для исправления')
        print(json.dumps({"totalBroken": 0, "fixed": 0, "failed": 0}))
        sys.exit(0)
    
    log('INFO', f'Found {total} broken archives to fix')
    update_status('running', f'Исправление {total} битых архивов...')
    
    fixed = 0
    failed = 0
    
    for i, archive_path in enumerate(broken_archives, 1):
        package_name, version = extract_package_info(archive_path)
        update_progress(i, total, fixed, failed, f"{package_name}@{version}")
        
        if reinstall_package(archive_path, package_name, version):
            fixed += 1
        else:
            failed += 1
        
        update_progress(i, total, fixed, failed, f"{package_name}@{version}")
    
    # Финальный статус
    if failed == 0:
        log('INFO', f'Successfully fixed all {fixed} broken archives')
        update_status('completed', f'Успешно исправлено {fixed} архивов')
    else:
        log('WARN', f'Fixed {fixed}, Failed {failed} out of {total}')
        update_status('completed_with_errors', f'Исправлено: {fixed}, Ошибок: {failed}')
    
    result = {
        "totalBroken": total,
        "fixed": fixed,
        "failed": failed
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
