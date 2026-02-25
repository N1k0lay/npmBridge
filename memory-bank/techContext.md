# Tech Context

## Продакшен-окружение

| Параметр | Значение |
|---------|---------|
| **Сервер** | `sandbox.dmn.zbr` |
| **SSH** | `npm@repo.dmn.zbr` |
| **Директория проекта** | `/home/npm/npmBridge/` |
| **Данные** | `/mnt/repo/npmBridge/` (отдельный том) |
| **npm Registry URL** | `http://sandbox.dmn.zbr:8013` |
| **Web UI URL** | `http://sandbox.dmn.zbr:8013` |

### Prod-архитектура (отличие от dev)

В продакшене добавлен **nginx** как реверс-прокси — единая точка входа на порту `8013`:
- npm-запросы (`/-/`, `@scope/`, пакеты) → verdaccio:4873 (internal)
- веб-интерфейс (всё остальное) → webapp:3000 (internal)
- `client_max_body_size 500M`, увеличенные таймауты для крупных пакетов

Verdaccio и webapp **не публикуют** порты наружу — только через nginx.

### Контейнеры на сервере

| Контейнер | Образ | Порты |
|-----------|-------|-------|
| `npmBridge-nginx` | nginx:alpine | 0.0.0.0:8013→80 |
| `npmBridge-webapp` | npmbridge-webapp | 3000 (internal) |
| `npmBridge-verdaccio` | verdaccio/verdaccio:latest | 4873 (internal) |

## Технологии

### Frontend / Webapp

| Технология | Версия | Назначение |
|-----------|--------|-----------|
| **Next.js** | ^14.2.0 | Full-stack React framework (App Router) |
| **React** | ^18.3.0 | UI компоненты |
| **TypeScript** | ^5.6.0 | Типизация |
| **Tailwind CSS** | ^3.4.0 | Стилизация |
| **better-sqlite3** | ^11.10.0 | SQLite (синхронный driver для Node.js) |
| **date-fns** | ^4.1.0 | Форматирование дат |
| **lucide-react** | ^0.460.0 | Иконки |
| **pnpm** | (менеджер пакетов) | Управление зависимостями webapp |

### Backend / Infrastructure

| Технология | Назначение |
|-----------|-----------|
| **Verdaccio** (Docker) | NPM registry proxy + cache |
| **Docker Compose** | Оркестрация сервисов |
| **Python 3** | Скрипты обновления / diff / проверки |
| **SQLite** | Хранение всего состояния приложения |

## Структура проекта

```
npm_repo/
├── docker-compose.yml        — Запуск всех сервисов
├── .env / .env.example       — Конфигурация
├── verdaccio/
│   ├── conf/config.yaml      — Конфиг Verdaccio
│   ├── storage/              — Кеш пакетов (runtime)
│   └── frozen/               — Снимок для diff (runtime)
├── webapp/
│   ├── Dockerfile            — Сборка контейнера webapp
│   ├── package.json          — Зависимости
│   ├── next.config.js        — Конфиг Next.js
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx      — Главная страница (SPA-like с tabами)
│   │   │   ├── layout.tsx    — Корневой layout
│   │   │   └── api/          — API Routes
│   │   │       ├── update/   — Управление обновлениями
│   │   │       ├── diff/     — Управление diff
│   │   │       ├── broken/   — Проверка архивов
│   │   │       ├── storage/  — Браузер файлов
│   │   │       ├── networks/ — Управление сетями
│   │   │       ├── logs/     — Чтение логов задач
│   │   │       └── config/   — Конфигурация
│   │   ├── components/       — React компоненты (по одному на вкладку)
│   │   ├── hooks/            — React hooks
│   │   └── lib/
│   │       ├── db.ts         — SQLite layer
│   │       ├── scripts.ts    — Запуск Python, config
│   │       ├── storage.ts    — Файловые операции
│   │       ├── networks.ts   — Бизнес-логика сетей
│   │       └── history.ts    — История пакетов
│   ├── data/                 — SQLite DB (npm-hub.db)
│   ├── logs/                 — Лог-файлы задач
│   └── defaults/
│       └── networks.json     — Дефолтные сети при первом запуске
├── scripts/
│   ├── update_all.py         — Полное обновление пакетов
│   ├── update_recent.py      — Обновление недавних
│   ├── check_broken.py       — Проверка целостности
│   ├── fix_broken.py         — Исправление битых
│   ├── create_diff.py        — Создание diff-архива
│   └── sync_frozen.py        — Синхронизация frozen/
├── diff_archives/            — Архивы diff (runtime)
└── storage/                  — Симлинк / volume для storage
```

## Переменные окружения

| Переменная | По умолчанию | Описание |
|-----------|-------------|---------|
| `VERDACCIO_PORT` | 4873 | Порт Verdaccio |
| `WEBAPP_PORT` | 4013 | Порт веб-интерфейса |
| `STORAGE_DIR` | `./storage` | Путь к хранилищу пакетов |
| `FROZEN_DIR` | `./frozen` | Путь к frozen директории |
| `DIFF_ARCHIVES_DIR` | `./diff_archives` | Путь к архивам diff |
| `SCRIPTS_DIR` | `./scripts` | Путь к Python скриптам |
| `PARALLEL_JOBS` | 40 | Параллельность обновления |
| `MODIFIED_MINUTES` | 2880 | Период "недавних" (48ч по умолчанию) |
| `PNPM_CMD` | `pnpm` | Команда pnpm |

## Требования для запуска

- **Docker** и **Docker Compose**
- **50+ GB** свободного дискового пространства
- Доступ к `registry.npmjs.org` (для скачивания пакетов)

## Разработка (без Docker)

```bash
cd webapp
pnpm install
cp .env.example .env.local   # настроить пути
pnpm dev                      # запуск на порту 4013
```

## API Endpoints

| Endpoint | Методы | Описание |
|---------|--------|---------|
| `/api/update` | GET, POST, DELETE | Управление обновлениями |
| `/api/diff` | GET, POST, PUT | Управление diff |
| `/api/diff/download/[id]` | GET | Скачать архив |
| `/api/broken` | GET, POST | Управление проверкой |
| `/api/storage` | GET | Браузер / статистика / история |
| `/api/networks` | GET, POST, PUT, DELETE | Управление сетями |
| `/api/logs` | GET | Чтение логов задач |
| `/api/config` | GET | Конфигурация приложения |

## Технические ограничения

- **SQLite** — не масштабируется горизонтально (single-writer), но достаточно для данного use case
- **Синхронный better-sqlite3** — используется в Next.js Route Handlers (синхронный код допустим)
- **Один активный diff** — архитектурное ограничение для простоты логики
- **Python scripts** — не имеют встроенного API, коммуникация через файловую систему (JSON-файлы прогресса)
