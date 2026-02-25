#!/usr/bin/env python3
"""
Скрипт обновления недавно изменённых пакетов в репозитории Verdaccio.

Сканирует storage на наличие пакетов, изменённых за указанный период,
и обновляет их до последних версий. Использует многопоточность.

Использование:
    python3 update_recent.py [minutes]

Примеры:
    python3 update_recent.py         # За последние 2880 минут (2 дня)
    python3 update_recent.py 60      # За последний час
    python3 update_recent.py 1440    # За последние сутки

Переменные окружения:
    STORAGE_DIR       - путь к storage Verdaccio
    REGISTRY_URL      - URL registry для скачивания пакетов
    PNPM_STORE_DIR    - путь к кешу pnpm (опционально)
    PARALLEL_JOBS     - количество параллельных потоков (по умолчанию 40)
    MODIFIED_MINUTES  - период поиска в минутах (по умолчанию 2880)
    PROGRESS_FILE     - файл для записи прогресса
    STATUS_FILE       - файл для записи статуса
    LOG_FILE          - файл для записи логов
"""

import sys
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Добавляем путь к lib для импорта
sys.path.insert(0, str(Path(__file__).parent))

from lib.config import VERDACCIO_HOME, PARALLEL_JOBS, MODIFIED_MINUTES
from lib.logging import log, update_status
from lib.progress import ProgressTracker
from lib.packages import install_package, get_modified_packages


def main() -> None:
    """Точка входа скрипта."""
    # Определяем период поиска
    minutes = MODIFIED_MINUTES
    if len(sys.argv) > 1:
        try:
            minutes = int(sys.argv[1])
        except ValueError:
            print(f"Ошибка: '{sys.argv[1]}' не является числом", file=sys.stderr)
            sys.exit(1)
    
    hours = minutes // 60
    hours_text = f"{hours} ч." if hours > 0 else f"{minutes} мин."
    
    log('INFO', f'Запуск обновления пакетов, изменённых за последние {hours_text} ({minutes} минут)')
    update_status('running', 'Поиск изменённых пакетов...')
    
    # Проверяем доступность директории
    if not Path(VERDACCIO_HOME).exists():
        log('ERROR', f'VERDACCIO_HOME не найден: {VERDACCIO_HOME}')
        update_status('failed', f'Директория не найдена: {VERDACCIO_HOME}')
        sys.exit(1)
    
    # Получаем список изменённых пакетов
    packages = get_modified_packages(minutes)
    total = len(packages)
    
    if total == 0:
        log('INFO', f'Не найдено изменённых пакетов за последние {hours_text}')
        update_status('completed', f'Нет изменённых пакетов за последние {hours_text}')
        print(json.dumps({"totalPackages": 0, "success": 0, "failed": 0}))
        sys.exit(0)
    
    log('INFO', f'Найдено {total} изменённых пакетов для обновления')
    update_status('running', f'Обновление {total} изменённых пакетов...')
    
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
