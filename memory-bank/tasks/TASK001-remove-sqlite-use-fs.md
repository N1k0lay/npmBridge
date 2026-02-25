# TASK001 - Убрать SQLite, хранить состояние в файловой системе

**Status:** In Progress  
**Added:** 2026-02-25  
**Updated:** 2026-02-26

## Original Request

База данных SQLite на проде разрослась до 6GB + 474MB WAL и получила ошибку `SQLITE_CORRUPT`. Причина — фича индексации storage копирует содержимое 46K `.tgz` файлов в БД. Нужно убрать SQLite полностью и хранить состояние в файловой системе, используя mtime файлов в storage как источник истины.

---

## Thought Process

### Ключевое наблюдение

npm-пакеты **иммутабельны**: `react-18.0.0.tgz` никогда не меняется после появления. Следовательно:
- Verdaccio уже хранит всё что нужно в `storage/*/package.json` (версии, timestamp'ы)
- **mtime файла .tgz = момент скачивания из npmjs** — надёжен, не изменяется
- Diff = все `.tgz` файлы с mtime > момент создания предыдущего diff

### Почему не нужен frozen/

`frozen/` был нужен чтобы знать "что уже перенесено" — т.е. базовую линию для следующего diff. Эту роль берёт поле `createdAt` в метаданных diff-архива: следующий diff ищет файлы с `mtime > lastDiff.createdAt`.

### Почему не нужен manifest.txt

`manifest.txt` был бы нужен если mtime ненадёжен. Проверено на проде: mtime = реальное время скачивания Verdaccio, диапазон 2024-02-26 … 2025-12-08. Надёжен.

### Почему цепочка диапазонов, а не один `lastSyncAt`

Если сеть "отстаёт" — ей нужно последовательно применить несколько diff. Для этого нужен каждый diff как отдельная сущность со своим диапазоном `[sinceTime, createdAt]`. Один `lastSyncAt` не даст возможности понять, какой конкретный архив нужен отстающей сети.

---

## Новая архитектура данных

### Файловая структура

```
diff_archives/
├── diff_2025-12-08T08-56-23.tar.gz       ← сам архив
├── diff_2025-12-08T08-56-23.json         ← sidecar метаданные (рядом с архивом)
├── diff_2026-02-25T10-00-00.tar.gz
└── diff_2026-02-25T10-00-00.json

data/
├── networks.json                         ← список корпоративных сетей
├── updates/
│   ├── update_full_1765169596646.json    ← одна запись = один запуск
│   └── ...
└── checks/
    ├── broken_check_1765169596646.json   ← одна запись = одна проверка
    └── ...
```

**`frozen/` — удалить. SQLite — удалить.**

### Формат diff sidecar JSON

```json
{
  "id": "diff_2025-12-08T08-56-23-199Z",
  "createdAt": "2025-12-08T08:56:23.199Z",
  "sinceTime": null,
  "filesCount": 46121,
  "archivePath": "/app/diff_archives/diff_2025-12-08T08-56-23-199Z.tar.gz",
  "archiveSize": 37000000000,
  "archiveSizeHuman": "37.0 GB",
  "status": "partial",
  "transfers": {
    "network_default": "2025-12-08T12:00:00.000Z"
  }
}
```

- `sinceTime: null` — первый diff, включает ВСЕ файлы в storage
- `sinceTime: "2025-12-08T08:56:23Z"` — файлы с mtime > этого времени
- `transfers` — объект `{network_id: ISO_datetime}`, а не массив
- `status` — `pending | partial | transferred | outdated`

### Формат networks.json

```json
{
  "networks": [
    {
      "id": "network_default",
      "name": "Основная корп. сеть",
      "description": "Главная корпоративная сеть",
      "color": "#3B82F6"
    }
  ]
}
```

### Формат update JSON

```json
{
  "id": "update_full_1765169596646",
  "type": "full",
  "startedAt": "2025-12-08T09:30:00Z",
  "finishedAt": "2025-12-08T11:37:20Z",
  "status": "completed",
  "packagesTotal": 7510,
  "packagesSuccess": 7490,
  "packagesFailed": 20,
  "logFile": "/app/logs/update_full_1765169596646.log"
}
```

### Формат check JSON

```json
{
  "id": "broken_check_1765169596646",
  "startedAt": "2025-12-08T12:00:00Z",
  "finishedAt": "2025-12-08T12:30:00Z",
  "status": "completed_with_issues",
  "totalArchives": 46121,
  "brokenArchives": 3,
  "brokenFiles": ["react/react-18.0.0.tgz"],
  "fixed": true,
  "fixedCount": 3
}
```

---

## Логика операций

### Создание diff (create_diff.py)

```
1. Читаем все *.json из diff_archives/ → находим последний по createdAt
2. sinceTime = lastDiff.createdAt (или null если нет ни одного diff)
3. Если sinceTime != null:
     new_files = find storage/ -name "*.tgz" -newer <timestamp_file>
   Если sinceTime == null:
     new_files = find storage/ -name "*.tgz"
4. Если new_files пустой → выводим filesCount=0, выходим
5. Создаём tar.gz архив
6. Записываем sidecar diff_{id}.json со status="pending", sinceTime, transfers={}
7. Выводим JSON в stdout (для Node.js)
```

**Замечание:** `find -newer` принимает файл, а не timestamp. Нужно создать временный файл с нужным mtime или использовать `find -newermt <ISO_date>`.

### Подтверждение переноса (API PATCH /diff → confirm_transfer)

```
1. Читаем diff_{id}.json
2. Если status == 'outdated' → ошибка
3. Если transfers[networkId] уже есть → ошибка
4. Устанавливаем transfers[networkId] = now
5. Считаем: все ли сети из networks.json уже в transfers?
     Если да → status = 'transferred'
     Если нет → status = 'partial'
6. Сохраняем diff_{id}.json
7. НЕ запускаем sync_frozen.py (frozen больше не нужен)
```

**ВАЖНО:** Для "первого подтверждения" больше НЕ нужно запускать `sync_frozen.py`. Эта логика полностью убирается.

### Проверка устаревания diff (checkDiffOutdated)

```
1. Берём diff.createdAt
2. Проверяем: есть ли хоть один .tgz в storage/ с mtime > diff.createdAt?
     find storage/ -name "*.tgz" -newermt <diff.createdAt> -print -quit
3. Если есть → diff устарел
```

### Статусы diff при создании нового

При создании нового diff:
- Все `pending` diff → `outdated` 
- Архивы `outdated` diff **НЕ удаляем** (нужны отстающим сетям)
- Архивы `transferred` diff **удаляем** (все сети получили)

### История пакетов (Package History)

Вместо SQLite-индекса — читаем `storage/*/package.json` напрямую:

```typescript
// Verdaccio хранит: package.json → { versions: {}, time: {"1.0.0": "2024-02-26..."} }
// Итерируемся по всем пакетам, читаем time → получаем хронологию появления
```

---

## Что меняется в коде

### Удалить
- `webapp/src/lib/db.ts` — полностью
- `webapp/scripts/sync_frozen.py` — полностью
- `webapp/src/app/api/indexing/` — полностью (источник проблемы на проде)
- Вызов `sync_frozen.py` из `api/diff/route.ts` (PATCH confirm_transfer)

### Переписать
- `webapp/src/lib/history.ts` → `webapp/src/lib/store.ts`
  - **diffs**: читать/писать `diff_archives/*.json`
  - **updates**: читать/писать `data/updates/*.json`
  - **checks**: читать/писать `data/checks/*.json`
- `webapp/src/lib/networks.ts`
  - читать/писать `data/networks.json`
  - убрать всё что связано с `frozen/`
  - убрать `initializeNetworkDirectories()`, `getNetworkFrozenDir()`
- `scripts/create_diff.py`
  - убрать логику сравнения с `frozen/`
  - добавить логику чтения последнего `*.json` из `diff_archives/`
  - использовать `find -newermt` вместо сравнения с frozen

### Адаптировать без изменений логики
- `webapp/src/app/api/diff/route.ts` — убрать вызов sync_frozen, остальное то же
- `webapp/src/app/api/update/route.ts` — только заменить импорты из history → store
- `webapp/src/app/api/broken/route.ts` — только заменить импорты
- `webapp/src/app/api/networks/route.ts` — убрать `initializeNetworkDirectories`, `loadNetworkStates`
- `webapp/src/lib/storage.ts` — без изменений (уже читает FS напрямую)
- Все компоненты UI — без изменений (API контракт не меняется)

### Миграция на проде
Скрипт `scripts/migrate_db_to_fs.py`:
```
1. Читаем sqlite db
2. Пишем data/networks.json из таблицы networks
3. Для каждой строки в diffs → пишем diff_archives/{id}.json
4. Для каждой строки в updates → пишем data/updates/{id}.json
5. Для каждой строки в broken_checks → пишем data/checks/{id}.json
6. Проверяем что все файлы записаны
7. Останавливаем webapp → запускаем с новым кодом
```

---

## Implementation Plan

- [ ] 1.1 Написать скрипт миграции `scripts/migrate_db_to_fs.py`
- [ ] 1.2 Написать `webapp/src/lib/store.ts` (замена db.ts + history.ts)
- [ ] 1.3 Переписать `webapp/src/lib/networks.ts` (без frozen, без SQLite)
- [ ] 1.4 Переписать `scripts/create_diff.py` (sinceTime из *.json, find -newermt)
- [ ] 1.5 Обновить `webapp/src/app/api/diff/route.ts` (убрать sync_frozen)
- [ ] 1.6 Обновить `webapp/src/app/api/update/route.ts` (новые импорты)
- [ ] 1.7 Обновить `webapp/src/app/api/broken/route.ts` (новые импорты)
- [ ] 1.8 Обновить `webapp/src/app/api/networks/route.ts` (убрать frozen-логику)
- [ ] 1.9 Удалить `lib/db.ts`, `scripts/sync_frozen.py`, `api/indexing/`
- [ ] 1.10 Проверить локально (pnpm dev)
- [ ] 1.11 Запустить миграцию на проде
- [ ] 1.12 Задеплоить на прод, проверить работу

---

## Progress Tracking

**Overall Status:** In Progress - 85%

### Subtasks

| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 1.1 | Скрипт миграции migrate_db_to_fs.py | Complete | 2026-02-26 | Готов |
| 1.2 | lib/store.ts — всё хранение в FS | Complete | 2026-02-26 | Заменяет db.ts + history.ts |
| 1.3 | lib/networks.ts — без SQLite/frozen | Complete | 2026-02-26 | JSON файл |
| 1.4 | create_diff.py — sinceTime из *.json | Complete | 2026-02-26 | find -newermt |
| 1.5 | api/diff/route.ts — убрать sync_frozen | Complete | 2026-02-26 | |
| 1.6 | api/update/route.ts — новые импорты | Complete | 2026-02-26 | |
| 1.7 | api/broken/route.ts — новые импорты | Complete | 2026-02-26 | |
| 1.8 | api/networks/route.ts — убрать frozen | Complete | 2026-02-26 | |
| 1.9 | Удалить db.ts, sync_frozen.py, indexing | Complete | 2026-02-26 | also scripts.ts cleaned |
| 1.10 | Сборка pnpm build | Complete | 2026-02-26 | ✅ Successful |
| 1.11 | Миграция на проде | Not Started | 2026-02-26 | Webapp должен быть остановлен |
| 1.12 | Деплой и проверка на проде | Not Started | 2026-02-26 | |

## Progress Log

### 2026-02-25
- Диагностирован `SQLITE_CORRUPT` на проде: WAL 474MB не сброшен, БД 6GB
- Выявлена причина: фича `indexing` копировала storage в SQLite
- Изучена структура storage: 7510 пакетов, 46K tgz, 53GB, mtime надёжен
- Принято решение: убрать SQLite полностью, хранить состояние в FS
- Принята архитектура: sidecar `.json` рядом с архивом, цепочка `sinceTime`
- Создана таска

### 2026-02-26
- Создан `scripts/migrate_db_to_fs.py` — читает SQLite, пишет JSON файлы
- Создан `webapp/src/lib/store.ts` — полная замена db.ts + history.ts (~320 строк)
- Переписан `webapp/src/lib/networks.ts` — JSON файл, без frozen, без SQLite
- Переписан `scripts/create_diff.py` — sinceTime из последнего diff JSON, find -newermt
- Обновлён `webapp/src/app/api/diff/route.ts` — убраны sync_frozen и getNetworkFrozenDir
- Обновлены imports в update/route.ts, broken/route.ts (history → store)  
- Убрана `initializeNetworkDirectories` из networks/route.ts
- Исправлен `webapp/src/app/api/diff/[id]/download/route.ts` — history → store
- Очищен `webapp/src/lib/scripts.ts` — убраны все SQLite-зависимости
- Удалены: `lib/db.ts`, `lib/history.ts`, `scripts/sync_frozen.py`
- **pnpm build: ✅ все 10 маршрутов собраны без ошибок**
- Осталось: миграция + деплой на прод
