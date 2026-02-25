# System Patterns

## Архитектура системы

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Network                           │
│                                                                 │
│  ┌──────────────────────┐      ┌──────────────────────────┐    │
│  │      Verdaccio       │      │       npmBridge           │    │
│  │  (npm-hub-verdaccio) │      │   (npmBridge-webapp)      │    │
│  │    Port: 4873        │      │      Port: 4013           │    │
│  │                      │      │                           │    │
│  │  NPM Registry Proxy  │      │  Next.js App (Node.js)   │    │
│  │  + Package Storage   │      │  + Python Scripts         │    │
│  └──────────────────────┘      └──────────────────────────┘    │
│            ↑                              ↑                     │
│            │ :4873                        │ :4013               │
└────────────┼──────────────────────────────┼─────────────────────┘
             │                              │
             └────── Разработчики (npm) ────┘
                     Администраторы (UI)
```

## Компоненты системы

### 1. Verdaccio (NPM Registry)
- Стандартный образ `verdaccio/verdaccio:latest`
- Работает как прокси к `registry.npmjs.org`
- Кеширует все запрошенные пакеты в `storage/`
- Конфигурация: `verdaccio/conf/config.yaml`

### 2. Webapp (Next.js)
- **Страницы/Routes**: `webapp/src/app/` (App Router)
- **API Routes**: `webapp/src/app/api/` (серверный код)
- **Компоненты**: `webapp/src/components/` (React UI)
- **Бизнес-логика**: `webapp/src/lib/` (TypeScript)

### 3. Python Scripts
- Запускаются из Node.js через `child_process.spawn()`
- Работают с файловой системой напрямую
- Пишут прогресс/статус в JSON-файлы (читаются webapp)
- Располагаются в `scripts/`

## Ключевые технические решения

### Запуск задач (Long-running tasks)

```
Node.js (API Route)
    │
    ├── spawn(python script) → background process
    │       │
    │       └── пишет прогресс в logs/{taskId}_progress.json
    │                                 logs/{taskId}_status.json
    │
    └── хранит ChildProcess в Map<taskId, ChildProcess>
            (для возможности kill)
```

- **Polling** — frontend опрашивает `/api/update?taskId=...` каждые N секунд
- **Нет WebSocket** — простой polling через API routes
- **Убийство задачи** — `process.kill()` по taskId

### База данных (SQLite singleton)

```typescript
// Pattern: Singleton + lazy init
let db: Database | null = null;
export function getDb(): Database {
  if (!db) { db = new Database(path); initSchema(db); }
  return db;
}
```

- Таблицы: `networks`, `network_states`, `diffs`, `diff_transfers`, `updates`, `broken_checks`
- WAL mode для производительности
- Foreign keys ON для целостности
- Дефолтные данные: `webapp/defaults/networks.json` (загружается при пустой БД)

### Состояния Diff

```
pending → partial    (часть сетей подтверждена)
pending → transferred  (все сети подтверждены / одна сеть)
partial → transferred  (оставшиеся сети подтверждены)
pending/partial → outdated  (появились новые пакеты)
```

### Управление файлами diff

- Архивы `outdated` и `partial` **сохраняются** (нужны отстающим сетям)
- Архивы `transferred` (перенесены во ВСЕ сети) можно удалять
- Один активный diff: только один `pending`/`partial` одновременно

## Паттерн API Routes

Каждый feature-endpoint следует паттерну:

```typescript
// GET  → получить данные/статус
// POST → запустить операцию / создать ресурс
// PUT  → обновить состояние
// DELETE → остановить задачу / удалить ресурс
```

## Паттерн монтирования volumes

```yaml
# Webapp видит директории через volumes:
- storage/     → /app/storage  (read-only)
- frozen/      → /app/frozen
- diff_archives/ → /app/diff_archives
- scripts/     → /app/scripts  (read-only)
- webapp/data/ → /app/data
- webapp/logs/ → /app/logs
```

## Структура webapp/src/lib/

| Файл | Назначение |
|------|-----------|
| `db.ts` | SQLite singleton, схема БД, query helpers |
| `scripts.ts` | Запуск Python-скриптов, config из env, управление процессами |
| `storage.ts` | Операции с файловой системой (список пакетов, размеры) |
| `networks.ts` | Бизнес-логика по сетям |
| `history.ts` | История пакетов (mtime файлов) |
