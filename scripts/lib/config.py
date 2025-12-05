"""
Конфигурация для скриптов обновления пакетов.

Все настройки читаются из переменных окружения с разумными значениями по умолчанию.
"""

import os

# Пути к директориям
VERDACCIO_HOME = os.environ.get('VERDACCIO_HOME', '/home/npm/verdaccio')
STORAGE_DIR = os.environ.get('STORAGE_DIR', f'{VERDACCIO_HOME}/storage')
PNPM_STORE_DIR = os.environ.get('PNPM_STORE_DIR', '')

# Команды и параметры
PNPM_CMD = os.environ.get('PNPM_CMD', 'pnpm')
REGISTRY_URL = os.environ.get('REGISTRY_URL', 'http://localhost:8013/')

# Параллелизм и таймауты
PARALLEL_JOBS = int(os.environ.get('PARALLEL_JOBS', '40'))
MODIFIED_MINUTES = int(os.environ.get('MODIFIED_MINUTES', '2880'))  # 2 дня по умолчанию
PACKAGE_TIMEOUT = int(os.environ.get('PACKAGE_TIMEOUT', '300'))  # 5 минут на пакет

# Файлы для отслеживания прогресса (устанавливаются динамически для каждой задачи)
PROGRESS_FILE = os.environ.get('PROGRESS_FILE', '/tmp/update_progress.json')
STATUS_FILE = os.environ.get('STATUS_FILE', '/tmp/update_status.json')
LOG_FILE = os.environ.get('LOG_FILE', '/tmp/update.log')

# Очищаем proxy-переменные для предотвращения проблем с локальным registry
for var in ['HTTPS_PROXY', 'HTTP_PROXY', 'http_proxy', 'https_proxy']:
    os.environ.pop(var, None)
