"""
Модуль для работы с пакетами npm/pnpm.

Содержит функции для установки пакетов и сканирования storage.
"""

import subprocess
import tempfile
import shutil
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

from .config import (
    STORAGE_DIR,
    PNPM_CMD,
    PNPM_STORE_DIR,
    REGISTRY_URL,
    PACKAGE_TIMEOUT,
    MODIFIED_MINUTES
)
from .logging import log
from .progress import ProgressTracker


def run_typesync(temp_dir: str) -> bool:
    """
    Запускает typesync для добавления @types пакетов в package.json.
    
    typesync анализирует зависимости и добавляет соответствующие
    @types/* пакеты в devDependencies файла package.json.
    
    Args:
        temp_dir: Временная директория с package.json
    
    Returns:
        True если package.json был изменён (добавлены типы), False иначе
    """
    package_json_path = Path(temp_dir) / 'package.json'
    
    # Запоминаем хэш package.json до typesync
    original_hash = None
    if package_json_path.exists():
        with open(package_json_path, 'rb') as f:
            import hashlib
            original_hash = hashlib.md5(f.read()).hexdigest()
    
    try:
        # Запускаем typesync (без --dry, чтобы он модифицировал package.json)
        result = subprocess.run(
            ['typesync'],
            cwd=temp_dir,
            capture_output=True,
            timeout=60
        )
        
        if result.returncode == 0:
            output = result.stdout.decode('utf-8', errors='replace')
            log('DEBUG', f'typesync output: {output[:200]}')
        else:
            error_output = result.stderr.decode('utf-8', errors='replace')
            log('WARNING', f'typesync завершился с ошибкой: {error_output[:200]}')
            return False
        
        # Проверяем, изменился ли package.json
        if package_json_path.exists():
            with open(package_json_path, 'rb') as f:
                import hashlib
                new_hash = hashlib.md5(f.read()).hexdigest()
            
            if original_hash != new_hash:
                # Читаем добавленные типы для логирования
                with open(package_json_path, 'r') as f:
                    pkg_data = json.load(f)
                dev_deps = pkg_data.get('devDependencies', {})
                types_added = [k for k in dev_deps.keys() if k.startswith('@types/')]
                if types_added:
                    log('INFO', f'typesync добавил типы: {", ".join(types_added)}')
                return True
        
        return False
    
    except subprocess.TimeoutExpired:
        log('WARNING', 'typesync: timeout')
    except FileNotFoundError:
        log('WARNING', 'typesync не установлен')
    except Exception as e:
        log('WARNING', f'typesync ошибка: {str(e)}')
    
    return False


def install_types_from_package_json(temp_dir: str) -> tuple[int, int]:
    """
    Устанавливает зависимости из package.json (включая добавленные typesync типы).
    
    Args:
        temp_dir: Временная директория с package.json
    
    Returns:
        Кортеж (успешно: 1/0, ошибка: 1/0)
    """
    try:
        cmd = [
            PNPM_CMD, 'install',
            '--force',
            f'--registry={REGISTRY_URL}'
        ]
        
        if PNPM_STORE_DIR:
            cmd.append(f'--store-dir={PNPM_STORE_DIR}')
        
        result = subprocess.run(
            cmd,
            cwd=temp_dir,
            capture_output=True,
            timeout=PACKAGE_TIMEOUT
        )
        
        if result.returncode == 0:
            log('INFO', '✓ Типы установлены через pnpm install')
            return 1, 0
        else:
            error_msg = result.stderr.decode('utf-8', errors='replace')[:200]
            log('WARNING', f'✗ Ошибка установки типов: {error_msg}')
            return 0, 1
    
    except subprocess.TimeoutExpired:
        log('WARNING', 'pnpm install (types): timeout')
        return 0, 1
    except Exception as e:
        log('WARNING', f'pnpm install (types) ошибка: {str(e)}')
        return 0, 1


def install_package(
    package: str,
    version: Optional[str] = None,
    tracker: Optional[ProgressTracker] = None,
    sync_types: bool = True
) -> tuple[bool, str]:
    """
    Устанавливает пакет через pnpm.
    
    Создаёт временную директорию, устанавливает пакет,
    затем удаляет директорию. Verdaccio автоматически
    кэширует скачанные пакеты.
    
    После установки основного пакета запускает typesync для
    поиска и установки соответствующих @types пакетов.
    
    Args:
        package: Имя пакета (например, "lodash" или "@types/node")
        version: Конкретная версия для установки (например, "4.17.21").
                 Если None — устанавливается latest.
        tracker: Опциональный трекер прогресса для обновления статистики
        sync_types: Запускать ли typesync для поиска @types (по умолчанию True)
    
    Returns:
        Кортеж (success: bool, error_message: str)
    """
    temp_dir = tempfile.mkdtemp()
    success = False
    error_msg = ""
    
    # Определяем версию для установки
    version_spec = version if version else 'latest'
    package_spec = f'{package}@{version_spec}'
    
    # Пропускаем typesync для @types пакетов
    is_types_package = package.startswith('@types/')
    
    try:
        # Формируем команду pnpm install
        cmd = [
            PNPM_CMD, 'install',
            package_spec,
            '--force',
            f'--registry={REGISTRY_URL}'
        ]
        
        # Добавляем путь к кешу pnpm если задан
        if PNPM_STORE_DIR:
            cmd.append(f'--store-dir={PNPM_STORE_DIR}')
        
        result = subprocess.run(
            cmd,
            cwd=temp_dir,
            capture_output=True,
            timeout=PACKAGE_TIMEOUT
        )
        
        success = result.returncode == 0
        
        if success:
            log('INFO', f'✓ {package_spec}')
            
            # Запускаем typesync для добавления @types пакетов в package.json
            # (только для не-@types пакетов)
            if sync_types and not is_types_package:
                # typesync модифицирует package.json, добавляя @types
                types_added = run_typesync(temp_dir)
                if types_added:
                    # Если package.json был изменён, запускаем pnpm install повторно
                    types_success, types_errors = install_types_from_package_json(temp_dir)
                    if types_errors > 0:
                        log('WARNING', 'Не удалось установить некоторые типы')
        else:
            # Извлекаем сообщение об ошибке
            error_msg = (
                result.stderr.decode('utf-8', errors='replace')[:500] or
                result.stdout.decode('utf-8', errors='replace')[:500]
            )
            log('ERROR', f'✗ {package}: {error_msg[:200]}')
    
    except subprocess.TimeoutExpired:
        error_msg = f"timeout ({PACKAGE_TIMEOUT}s)"
        log('ERROR', f'✗ {package}: timeout')
    
    except Exception as e:
        error_msg = str(e)
        log('ERROR', f'✗ {package}: {error_msg}')
    
    finally:
        # Очищаем временную директорию
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        # Обновляем трекер прогресса если передан
        if tracker is not None:
            tracker.increment(package, success, error_msg)
    
    return success, error_msg


def get_all_packages() -> list[str]:
    """
    Получает список всех пакетов из storage Verdaccio.
    
    Сканирует директорию storage и возвращает имена всех пакетов,
    включая scoped-пакеты (@org/package).
    
    Returns:
        Список имён пакетов
    """
    packages = []
    storage_path = Path(STORAGE_DIR)
    
    if not storage_path.exists():
        return packages
    
    for item in storage_path.iterdir():
        # Пропускаем скрытые файлы и служебные директории
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


def get_modified_packages(minutes: Optional[int] = None) -> list[str]:
    """
    Получает список пакетов, изменённых за указанный период.
    
    Сканирует storage на наличие файлов package.json,
    изменённых за последние N минут.
    
    Args:
        minutes: Количество минут для поиска (по умолчанию из MODIFIED_MINUTES)
    
    Returns:
        Список имён изменённых пакетов
    """
    if minutes is None:
        minutes = MODIFIED_MINUTES
    
    packages = set()
    storage_path = Path(STORAGE_DIR)
    cutoff_time = datetime.now() - timedelta(minutes=minutes)
    
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
