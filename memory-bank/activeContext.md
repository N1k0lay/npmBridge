# Active Context

## Текущий фокус

**TASK003 ЗАВЕРШЁН** — зеркалирование CDN-бинарников с full UI-управлением.

Коммит `43dd7c2` задеплоен на прод.

### Что сделано в финальной итерации (2026-02-26)

1. **`scripts/mirror_binaries.py`** — полный рефактор:
   - `PROGRESS_FILE / STATUS_FILE / LOG_FILE` из env vars (→ передаются webapp)
   - `write_progress() / write_status()` — хелперы по образцу `lib/logging.py`
   - `record_meta()` — пишет `metadata.json` после каждого успешного скачивания
   - Вся логика скачивания playwright/electron/puppeteer инкапсулирована корректно

2. **`webapp/src/app/api/binaries/route.ts`** — расширен:
   - **GET** — возвращает `{path, tree, totalSize, metadata}`
   - **GET `?taskId=...`** — polling режим: `{taskId, running, progress, status, logs}`
   - **POST** — принимает `{package, mode, updateFirst}`, запускает задачу через `runScript()`,
     при `updateFirst=true` сначала `update_single.py`, затем `mirror_binaries.py`

3. **`webapp/src/components/BinariesPanel.tsx`** — полный редизайн:
   - Три карточки: Playwright 🎭 / Electron ⚡ / Puppeteer 🤖
   - Кнопка «⬇ Скачать» → POST без обновления npm
   - Кнопка «🔄 Обновить пакет + скачать» → POST с `updateFirst: true`
   - Прогресс-бар + статус с автополлингом (интервал 2 сек)
   - Размер загруженного, дата последней загрузки, версия пакета из metadata
   - Кнопка «⬇ Скачать всё» в шапке
   - Переключатель режима `cdn-mirror / local-extract`
   - Сворачиваемое файловое дерево
   - Инструкция по env-переменным в `<details>`

> Предыдущие задачи TASK001 и TASK002 завершены и задеплоены на прод.

## Текущее состояние системы на проде

- **Сервер**: `npm@repo.dmn.zbr`, проект `/opt/npmBridge`
- **Все 4 контейнера работают**: nginx(8013), webapp(3000), verdaccio(4873), storage-init
- **Данные**: `/mnt/repo/npmBridge/{storage,data,logs,diff_archives,frozen,pnpm_cache,binaries}`
- **HTTP-доступ**: `http://repo.dmn.zbr:8013/`

## Завершённые задачи (историческая справка)

### TASK001: SQLite → файловая система
- Убрана SQLite-зависимость, состояние в JSON-файлах в FS
- Проведена миграция данных, задеплоено на прод

### TASK002: Постдеплой-фиксы
- nginx был в состоянии "Created" — теперь Makefile запускает все сервисы через `docker compose up -d`
- Добавлен `--ignore-scripts` в `scripts/lib/packages.py` — устранены таймауты playwright/xo/next-i18next/vite-plugin-vue-tracer/city-near-me

## TASK003: Зеркалирование CDN-бинарников

### Проблема
Пакеты (playwright, electron, puppeteer) скачивают бинари в postinstall напрямую с CDN,
минуя verdaccio. В закрытой сети этот CDN недоступен.

### Решение
Скрипт `scripts/mirror_binaries.py`:
1. Определяет версии пакетов из storage verdaccio
2. Скачивает zip-архивы с официальных CDN
3. Сохраняет с **зеркальной структурой путей**
4. nginx раздаёт через `http://repo.dmn.zbr:8013/binaries/`

### CDN-структуры (что зеркалируем)

| Пакет | Исходный CDN | Путь |
|-------|-------------|------|
| playwright | cdn.playwright.dev | `/builds/{browser}/{rev}/{file}.zip` |
| electron | github.com/electron/releases | `/v{ver}/electron-v{ver}-linux-x64.zip` |
| puppeteer | storage.googleapis.com/chrome-for-testing-public | `/{ver}/{platform}/chrome-linux64.zip` |

### Переменные для клиентов в закрытой сети

```bash
PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn
ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron/
ELECTRON_CUSTOM_DIR={{ version }}
PUPPETEER_DOWNLOAD_BASE_URL=http://repo.dmn.zbr:8013/binaries/puppeteer-cdn
```

### Следующие шаги

```bash
# Подключиться к проду
ssh npm@repo.dmn.zbr

# Запустить скрипт (нужен интернет на сервере — скачает архивы с CDN)
cd /opt/npmBridge
docker compose exec webapp python3 /app/scripts/mirror_binaries.py

# Проверить статус
docker compose exec webapp python3 /app/scripts/mirror_binaries.py --status

# Проверить HTTP-доступ
curl http://repo.dmn.zbr:8013/binaries/playwright-cdn/builds/chromium/
```

## Инфраструктура бинарников (nginx)

В `nginx/nginx.conf` уже настроен:
```nginx
location /binaries/ {
    alias /binaries/;
    autoindex on;
    autoindex_format json;
}
```
Docker том: `${BINARIES_DIR:-/mnt/repo/npmBridge/binaries}:/binaries:ro`

## Технические соображения

- **scripts/** монтируется в webapp как bind-mount — изменения применяются без rebuild
- **binary CDN mirror**: платформы по умолчанию — ubuntu22.04, ubuntu24.04, debian12 (x64)
- **Playwright revision**: читается из `playwright-core/lib/server/registry/index.js`
- **Ревизия != NPM-версия**: например playwright 1.58.2 → chromium revision 1148
