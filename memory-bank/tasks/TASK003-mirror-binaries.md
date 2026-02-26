# [TASK003] - Зеркалирование CDN-бинарников

**Status:** In Progress  
**Added:** 2025-05  
**Updated:** 2025-05

## Original Request

«Каким образом мы можем кешировать бинарники, чтобы мы могли в закрытой сети использовать их?»  
Уточнение: «В закрытой сети у нас нет доступа к /mnt/, у нас есть доступ только к файлам» → нужен HTTP-зеркальный подход.

## Thought Process

### Проблема
Некоторые npm-пакеты (playwright, electron, puppeteer, esbuild, sharp) в postinstall-скриптах
скачивают платформозависимые бинари **напрямую с CDN**, минуя npm registry. Verdaccio кэширует
только `.tgz`-тарболы, но не эти бинари.

В закрытой сети:
- Нет доступа к интернету
- Нет `/mnt/` (только HTTP-доступ к серверу)
- Нужно: HTTP-зеркало, куда указывают env-переменные пакетов

### Первоначальный неверный подход
Filesystem: PLAYWRIGHT_BROWSERS_PATH=/mnt/binaries/playwright — **не работает в закрытой сети** (нет /mnt/).

### Правильный подход — CDN Mirror
Каждый пакет поддерживает env-переменную для замены CDN-хоста.
При `PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn`
playwright строит URL: `{HOST}/builds/chromium/{revision}/chromium-linux.zip`
→ наш сервер должен хранить архив по точно такому же пути.

## Implementation Plan

- [x] Исследовать CDN URL-структуру playwright (index.js из playwright-core)
- [x] Найти env-переменные: PLAYWRIGHT_DOWNLOAD_HOST, ELECTRON_MIRROR, PUPPETEER_DOWNLOAD_BASE_URL
- [x] Настроить nginx `/binaries/` endpoint (autoindex)
- [x] Настроить docker-compose: bind-mount `/mnt/repo/npmBridge/binaries:/binaries`
- [x] Написать `scripts/mirror_binaries.py` с CDN-mirror подходом
- [ ] Протестировать на проде (запустить скрипт, скачает ~1-5 GB)
- [ ] Написать клиентскую документацию (`.npmrc` / env vars)

## Progress Tracking

**Overall Status:** In Progress — 70%

### Subtasks

| ID | Description | Status | Updated | Notes |
|----|-------------|--------|---------|-------|
| 3.1 | Исследовать CDN URL-структуры | Complete | 2025-05 | playwright: `builds/{browser}/{rev}/{file}.zip` |
| 3.2 | Найти env-переменные пакетов | Complete | 2025-05 | PLAYWRIGHT_DOWNLOAD_HOST, ELECTRON_MIRROR, PUPPETEER_DOWNLOAD_BASE_URL |
| 3.3 | nginx /binaries/ endpoint | Complete | 2025-05 | autoindex on, autoindex_format json |
| 3.4 | docker-compose binaries mount | Complete | 2025-05 | `${BINARIES_DIR:-/mnt/repo/npmBridge/binaries}:/binaries:ro` |
| 3.5 | Написать mirror_binaries.py | Complete | 2025-05 | CDN-mirror подход, 3 пакета |
| 3.6 | Тестирование на проде | Not Started | — | Запустить скрипт, проверить HTTP-доступ |
| 3.7 | Клиентская документация | Not Started | — | Env vars + примеры .npmrc |

## Progress Log

### 2025-05
- Исследован playwright-core → `PLAYWRIGHT_DOWNLOAD_HOST` заменяет весь CDN
- URL format: `{HOST}/builds/{browser}/{revision}/{filename}.zip`
- Найдены per-browser vars: `PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST` и т.д.
- Версии electron и puppeteer в storage: playwright (19 версий), electron, puppeteer, esbuild, sharp
- Написан `scripts/mirror_binaries.py`:
  - `mirror_playwright()`: читает revision из playwright-core index.js, скачивает zip
  - `mirror_electron()`: скачивает с GitHub Releases
  - `mirror_puppeteer()`: скачивает chrome-for-testing со storage.googleapis.com
  - Поддержка платформ: ubuntu22.04-x64, ubuntu24.04-x64, debian12-x64
  - Умно пропускает уже скачанные файлы

## Env-переменные для клиентов

```bash
# Playwright (все браузеры)
PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn

# Или только конкретный браузер
PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn
PLAYWRIGHT_FIREFOX_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn
PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn

# Electron
ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron/
ELECTRON_CUSTOM_DIR={{ version }}

# Puppeteer
PUPPETEER_DOWNLOAD_BASE_URL=http://repo.dmn.zbr:8013/binaries/puppeteer-cdn
```

## Команды для проде

```bash
# Скачать все бинари (нужен интернет на сервере)
docker compose exec webapp python3 /app/scripts/mirror_binaries.py

# Только playwright
docker compose exec webapp python3 /app/scripts/mirror_binaries.py --package playwright

# Конкретные версии
docker compose exec webapp python3 /app/scripts/mirror_binaries.py --package playwright --version 1.58.2

# Статус
docker compose exec webapp python3 /app/scripts/mirror_binaries.py --status
```
