# Active Context

## Текущий фокус

**TASK001** — рефакторинг хранилища завершён на 85%.  
Вся реализация готова, `pnpm build` успешен. Осталось: деплой на прод.

## Проблема на проде (инициировала задачу)

- Сервер: `sandbox.dmn.zbr`, проект `/home/npm/npmBridge/`
- `SQLITE_CORRUPT`: БД 6GB + WAL 474MB (не сброшен)
- `webapp` **остановлен** (`docker compose stop webapp`) — нужно задеплоить новый код

## Что реализовано (готово к деплою)

### Новые файлы
- `scripts/migrate_db_to_fs.py` — миграция SQLite → JSON файлы (запускать один раз)
- `webapp/src/lib/store.ts` — замена db.ts + history.ts, хранение в FS

### Изменённые файлы
- `webapp/src/lib/networks.ts` — перешёл с SQLite на `data/networks.json`
- `webapp/src/lib/scripts.ts` — убраны все SQLite-зависимости
- `scripts/create_diff.py` — использует sinceTime из последнего diff JSON, `find -newermt`
- `webapp/src/app/api/diff/route.ts` — убран вызов sync_frozen.py, импорты → store
- `webapp/src/app/api/diff/[id]/download/route.ts` — импорт → store
- `webapp/src/app/api/update/route.ts` — импорт → store
- `webapp/src/app/api/broken/route.ts` — импорт → store
- `webapp/src/app/api/networks/route.ts` — убрана initializeNetworkDirectories

### Удалённые файлы
- `webapp/src/lib/db.ts`
- `webapp/src/lib/history.ts`
- `scripts/sync_frozen.py`

## Следующие шаги — деплой на прод

```bash
# 1. Подключиться к prodу
ssh npm@repo.dmn.zbr

# 2. Переключиться на данные
cd /home/npm/npmBridge

# 3. Вытащить новый код
git pull

# 4. Запустить миграцию (webapp должен быть остановлен — уже остановлен)
# Нужно: пересобрать образ или скопировать новый код в контейнер
# Затем:
DB_PATH=/mnt/repo/npmBridge/data/npmBridge.db \
DIFF_ARCHIVES_DIR=/mnt/repo/npmBridge/diff_archives \
DATA_DIR=/mnt/repo/npmBridge/data \
python3 scripts/migrate_db_to_fs.py

# 5. Пересобрать и запустить
docker compose build webapp
docker compose up -d webapp

# 6. Проверить логи
docker compose logs webapp --tail=50
```

## Ключевые решения (архитектура)

- **frozen/ — удалён**: заменяется полем `sinceTime` в sidecar `.json` рядом с архивом
- **SQLite — удалён**: всё хранение в JSON-файлах в FS
- **Diff = цепочка**: каждый `diff_{id}.json` содержит `sinceTime` — с какого момента собран
- **mtime надёжен**: npm-пакеты иммутабельны, mtime = момент скачивания


- Исследование возможных улучшений по запросу пользователя
- Добавление новых фич при необходимости

## Технические соображения

- **frozen/** — сейчас часть `verdaccio/frozen/`, но в `.env` настраивается отдельно
- **diff_archives/** — статичная директория вне Docker volumes, доступна для скачивания
- **Python scripts** общаются с webapp через файловую систему (JSON-файлы прогресса) — это текущий паттерн, который может потребовать рефакторинга при масштабировании

## Важные решения

- **Единственный активный diff** — архитектурное решение для упрощения логики статусов
- **frozen/ общий** для всех сетей — синхронизируется при ПЕРВОМ подтверждении переноса в любую сеть
- **SQLite WAL mode** — включён для лучшей производительности при конкурентных чтениях
