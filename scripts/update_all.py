#!/usr/bin/env python3
"""
Скрипт полного обновления всех пакетов в репозитории Verdaccio.

Сканирует storage и обновляет все найденные пакеты до последних версий.
Использует многопоточность для ускорения процесса.

Использование:
    python3 update_all.py

Переменные окружения:
    STORAGE_DIR      - путь к storage Verdaccio
    REGISTRY_URL     - URL registry для скачивания пакетов
    PNPM_STORE_DIR   - путь к кешу pnpm (опционально)
    PARALLEL_JOBS    - количество параллельных потоков (по умолчанию 40)
    PROGRESS_FILE    - файл для записи прогресса
    STATUS_FILE      - файл для записи статуса
    LOG_FILE         - файл для записи логов
"""

import sys
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Добавляем путь к lib для импорта
sys.path.insert(0, str(Path(__file__).parent))

from lib.config import VERDACCIO_HOME, STORAGE_DIR, PARALLEL_JOBS
from lib.logging import log, update_status
from lib.progress import ProgressTracker
from lib.packages import install_package, get_all_packages


def main() -> None:
    """Точка входа скрипта."""
    log('INFO', 'Запуск полного обновления репозитория')
    log('INFO', f'VERDACCIO_HOME: {VERDACCIO_HOME}')
    log('INFO', f'STORAGE_DIR: {STORAGE_DIR}')
    log('INFO', f'PARALLEL_JOBS: {PARALLEL_JOBS}')
    
    update_status('running', 'Получение списка пакетов...')
    
    # Проверяем доступность директории
    if not Path(VERDACCIO_HOME).exists():
        log('ERROR', f'VERDACCIO_HOME не найден: {VERDACCIO_HOME}')
        update_status('failed', f'Директория не найдена: {VERDACCIO_HOME}')
        sys.exit(1)
    
    # Получаем список всех пакетов
    packages = get_all_packages()
    total = len(packages)
    
    if total == 0:
        log('INFO', 'Пакеты не найдены')
        update_status('completed', 'Пакеты не найдены')
        print(json.dumps({"totalPackages": 0, "success": 0, "failed": 0}))
        sys.exit(0)
    
    log('INFO', f'Найдено {total} пакетов для обновления')
    update_status('running', f'Обновление {total} пакетов...')
    
    # Инициализируем трекер прогресса
    tracker = ProgressTracker(total)
    tracker.force_update()
    
    # Параллельная обработка пакетов
    with ThreadPoolExecutor(max_workers=PARALLEL_JOBS) as executor:
        futures = {
            executor.submit(install_package, pkg, None, tracker): pkg
            for pkg in packages
        }
        
        # Ждём завершения всех задач
        for future in as_completed(futures):
            pass  # Результаты уже обработаны в install_package
    
    # Формируем финальный статус
    if tracker.failed == 0:
        log('INFO', f'Обновление завершено успешно. Обработано {tracker.success} пакетов.')
        update_status('completed', f'Успешно обновлено {tracker.success} пакетов')
    else:
        log('WARN', f'Обновление завершено с ошибками. Успешно: {tracker.success}, Ошибок: {tracker.failed}')
        update_status('completed_with_errors', f'Обновлено: {tracker.success}, Ошибок: {tracker.failed}')
    
    # Выводим результат в JSON
    result = {
        "totalPackages": total,
        "success": tracker.success,
        "failed": tracker.failed,
        "errors": tracker.errors
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
