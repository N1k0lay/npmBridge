# Скрипты обновления пакетов Verdaccio

Набор Python-скриптов для автоматического обновления пакетов npm в локальном репозитории Verdaccio.

## Структура

```
scripts/
├── lib/                    # Общие модули
│   ├── __init__.py
│   ├── config.py           # Конфигурация и переменные окружения
│   ├── logging.py          # Логирование и отслеживание статуса
│   ├── packages.py         # Работа с пакетами (установка, сканирование)
│   └── progress.py         # Трекер прогресса для многопоточности
├── update_single.py        # Обновление одного пакета
├── update_all.py           # Полное обновление всех пакетов
├── update_recent.py        # Обновление недавно изменённых пакетов
├── check_broken.py         # Проверка битых пакетов
├── fix_broken.py           # Исправление битых пакетов
├── sync_frozen.py          # Синхронизация frozen-пакетов
└── create_diff.py          # Создание diff-архивов
```

## Скрипты обновления

### update_single.py

Обновляет один конкретный пакет до последней версии.

```bash
python3 update_single.py <package_name>

# Примеры:
python3 update_single.py lodash
python3 update_single.py @types/node
python3 update_single.py @babel/core
```

**Как работает:**
1. Создаёт временную директорию
2. Запускает `pnpm install <package>@latest --force`
3. Verdaccio автоматически кэширует скачанный пакет
4. Удаляет временную директорию

### update_all.py

Полное обновление всех пакетов в репозитории.

```bash
python3 update_all.py
```

**Как работает:**
1. Сканирует директорию `storage` Verdaccio
2. Собирает список всех пакетов (включая scoped @org/package)
3. Параллельно (40 потоков по умолчанию) устанавливает каждый пакет
4. Записывает прогресс и статус в JSON-файлы

**Внимание:** При большом количестве пакетов (7000+) может занять несколько часов.

### update_recent.py

Обновляет только недавно изменённые пакеты.

```bash
python3 update_recent.py [minutes]

# Примеры:
python3 update_recent.py         # За последние 2 дня (2880 минут)
python3 update_recent.py 60      # За последний час
python3 update_recent.py 1440    # За последние сутки
python3 update_recent.py 10080   # За последнюю неделю
```

**Как работает:**
1. Сканирует `storage` на наличие файлов `package.json`
2. Фильтрует по времени модификации (mtime)
3. Параллельно обновляет найденные пакеты

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `VERDACCIO_HOME` | Корневая директория Verdaccio | `/home/npm/verdaccio` |
| `STORAGE_DIR` | Путь к storage с пакетами | `$VERDACCIO_HOME/storage` |
| `PNPM_STORE_DIR` | Путь к кешу pnpm | _(не задан)_ |
| `PNPM_CMD` | Команда pnpm | `pnpm` |
| `REGISTRY_URL` | URL registry для скачивания | `http://localhost:8013/` |
| `PARALLEL_JOBS` | Количество параллельных потоков | `40` |
| `MODIFIED_MINUTES` | Период поиска в минутах | `2880` (2 дня) |
| `PACKAGE_TIMEOUT` | Таймаут на пакет в секундах | `300` (5 минут) |
| `PROGRESS_FILE` | Файл прогресса (JSON) | `/tmp/update_progress.json` |
| `STATUS_FILE` | Файл статуса (JSON) | `/tmp/update_status.json` |
| `LOG_FILE` | Файл логов | `/tmp/update.log` |

## Файлы прогресса

### status.json

```json
{
  "status": "running",
  "message": "Обновление 150 пакетов...",
  "updatedAt": "2024-12-04T17:30:00.000000"
}
```

Возможные значения `status`:
- `running` - выполняется
- `completed` - успешно завершено
- `failed` - ошибка
- `completed_with_errors` - завершено с ошибками

### progress.json

```json
{
  "current": 45,
  "total": 150,
  "success": 43,
  "failed": 2,
  "currentPackage": "lodash",
  "percent": 30.0,
  "errors": [
    {"package": "some-broken-pkg", "error": "404 Not Found"}
  ],
  "updatedAt": "2024-12-04T17:30:00.000000"
}
```

## Примеры использования

### Запуск на хостовой машине

```bash
# Загружаем переменные из .env
export $(grep -v '^#' /home/npm/npmBridge/.env | xargs)

# Обновляем один пакет
python3 scripts/update_single.py axios

# Обновляем все пакеты за последний час
python3 scripts/update_recent.py 60
```

### Запуск через веб-интерфейс

Скрипты вызываются автоматически через API веб-приложения.
Переменные окружения настраиваются в `docker-compose.yml`.

## Оптимизация

### Кеш pnpm

Для ускорения повторных обновлений используется общий кеш pnpm:

```yaml
# docker-compose.yml
environment:
  - PNPM_STORE_DIR=/app/pnpm_cache
volumes:
  - ./pnpm_cache:/app/pnpm_cache
```

### Параллельность

По умолчанию используется 40 параллельных потоков.
Можно изменить через переменную `PARALLEL_JOBS`.

```bash
PARALLEL_JOBS=20 python3 update_all.py
```

## Обработка ошибок

- Таймаут 5 минут на каждый пакет
- Ошибки не прерывают общий процесс
- Последние 20 ошибок сохраняются в `progress.json`
- Полный лог записывается в `LOG_FILE`

## Модули lib/

### config.py
Централизованная конфигурация. Все настройки читаются из переменных окружения.

### logging.py
- `log(level, message)` - запись в лог и stdout
- `update_status(status, message)` - обновление файла статуса
- `update_progress(...)` - обновление файла прогресса

### packages.py
- `install_package(package, tracker)` - установка пакета через pnpm
- `get_all_packages()` - список всех пакетов из storage
- `get_modified_packages(minutes)` - список недавно изменённых пакетов

### progress.py
- `ProgressTracker` - потокобезопасный счётчик прогресса
