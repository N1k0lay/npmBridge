"""
Модуль для работы с пакетами npm/pnpm.

Содержит функции для установки пакетов и сканирования storage.
"""

import subprocess
import tempfile
import shutil
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


def install_package(
    package: str,
    tracker: Optional[ProgressTracker] = None
) -> tuple[bool, str]:
    """
    Устанавливает последнюю версию пакета через pnpm.
    
    Создаёт временную директорию, устанавливает пакет,
    затем удаляет директорию. Verdaccio автоматически
    кэширует скачанные пакеты.
    
    Args:
        package: Имя пакета (например, "lodash" или "@types/node")
        tracker: Опциональный трекер прогресса для обновления статистики
    
    Returns:
        Кортеж (success: bool, error_message: str)
    """
    temp_dir = tempfile.mkdtemp()
    success = False
    error_msg = ""
    
    try:
        # Формируем команду pnpm install
        cmd = [
            PNPM_CMD, 'install',
            f'{package}@latest',
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
            log('INFO', f'✓ {package}')
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
