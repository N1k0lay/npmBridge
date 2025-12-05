#!/usr/bin/env python3
"""
Скрипт обновления одного пакета в репозитории Verdaccio.

Использование:
    python3 update_single.py <package_name>

Примеры:
    python3 update_single.py lodash
    python3 update_single.py @types/node

Переменные окружения:
    STORAGE_DIR      - путь к storage Verdaccio
    REGISTRY_URL     - URL registry для скачивания пакетов
    PNPM_STORE_DIR   - путь к кешу pnpm (опционально)
    PROGRESS_FILE    - файл для записи прогресса
    STATUS_FILE      - файл для записи статуса
    LOG_FILE         - файл для записи логов
"""

import sys
from pathlib import Path

# Добавляем путь к lib для импорта
sys.path.insert(0, str(Path(__file__).parent))

from lib.config import STORAGE_DIR
from lib.logging import log, update_status, update_progress
from lib.packages import install_package


def main() -> None:
    """Точка входа скрипта."""
    if len(sys.argv) < 2:
        print("Использование: update_single.py <package_name>", file=sys.stderr)
        print("Пример: update_single.py lodash", file=sys.stderr)
        sys.exit(1)
    
    package = sys.argv[1]
    
    log('INFO', f'Запуск обновления пакета: {package}')
    update_status('running', f'Обновление пакета {package}...')
    update_progress(0, 1, package, 0, 0, [])
    
    # Проверяем доступность storage
    if not Path(STORAGE_DIR).exists():
        log('ERROR', f'STORAGE_DIR не найден: {STORAGE_DIR}')
        update_status('failed', f'Директория не найдена: {STORAGE_DIR}')
        sys.exit(1)
    
    # Обновляем пакет
    success, error_msg = install_package(package)
    
    if success:
        update_progress(1, 1, package, 1, 0, [])
        update_status('completed', f'Пакет {package} успешно обновлён')
        log('INFO', f'Пакет {package} успешно обновлён')
    else:
        update_progress(1, 1, package, 0, 1, [{"package": package, "error": error_msg}])
        update_status('failed', f'Ошибка обновления {package}: {error_msg[:100]}')
        log('ERROR', f'Не удалось обновить пакет {package}')
        sys.exit(1)


if __name__ == '__main__':
    main()
