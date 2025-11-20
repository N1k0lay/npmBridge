# План реализации Verdaccio Replication Service

## 1. Общая структура и окружение

1. Создать монорепозиторий со следующими каталогами:
   - `backend/` — FastAPI + SQLite + APScheduler.
   - `backend/jobs/` — Python-обёртки над существующими bash-скриптами.
   - `frontend/` — React (Vite + TypeScript).
   - `compose/` — docker-compose.yml, env-конфиги.
   - `scripts/`, `docs/`, `logs/`, `state/`, `artifacts/`, `snapshots/`.
2. Подготовить Docker Compose: сервисы `verdaccio`, `backend`, `frontend`, опционально `redis` (если позже понадобится очередь).
3. Задать единый `.env`, где описаны пути до Verdaccio (`/home/npm/verdaccio/storage`), каталоги `state/`, `artifacts/`, уровень параллелизма и т. д.

## 2. Backend-основа (FastAPI + SQLite)

1. Настроить FastAPI-приложение с роутерами `/packages`, `/jobs`, `/artifacts`, `/broken-archives`, `/health`.
2. Использовать SQLAlchemy/SQLModel для работы с SQLite (`state/data.sqlite`). Таблицы: `jobs`, `job_logs`, `packages`, `package_versions`, `artifacts`, `snapshots`, `broken_archives`, `storage_stats`.
3. Включить Alembic для миграций.
4. Добавить APScheduler (или Celery+Redis при необходимости) для фоновых задач: `delta_refresh`, `broken_scan`, периодический `metadata_scan`.
5. Реализовать общую систему логирования: структурированные логи + сохранение stdout/stderr задач в `logs/<job-id>.log`.

## 3. Слой выполнения задач

1. Перенести `p_pnpm_repo_update.sh` и `p_pnpm_update_modif_pkg.sh` в Python-обёртки:
   - Запуск через subprocess.
   - Параметры: reuse temp dir, ограничение на параллелизм, возможность dry-run.
   - Потоковый сбор stdout/stderr и запись в лог-файлы.
2. Добавить модель `Job`: статусы (`queued`, `running`, `success`, `failed`), прогресс, ссылки на лог.
3. Эндпоинты `POST /jobs/full-refresh`, `POST /jobs/delta-refresh` создают задачу, планируют её выполнение и возвращают ID.
4. Планировщик периодически создаёт задачи `delta_refresh` (например, каждые 12 часов).

## 4. Сканер хранилища и сбор статистики

1. Импортировать логику обхода `storage` (как в `p_pnpm_repo_update.sh`): рекурсивно читать каталоги, разделять scoped/нескопированные пакеты.
2. Для каждого пакета:
   - Если есть `storage/<pkg>/package.json`, читать метаданные Verdaccio.
   - Иначе распаковывать заголовок `.tgz` (без полного извлечения) для определения версии, размера, sha512.
3. Записывать данные в SQLite (`packages`, `package_versions`, `storage_stats`).
4. Сделать CLI/фоновую задачу `metadata_scan` (например, раз в час) + ручной запуск через API.
5. Кешировать результаты в памяти для ускорения ответов фронтенда.

## 5. Построение снапшотов и diff-артефактов

1. Перенести `trans_npm2.py` в модуль `backend/jobs/diff_builder.py`:
   - Многопроцессная копия изменённых файлов в `diff_work/`.
   - Расчёт sha512 для каждого файла.
   - Создание `manifest.json` с полным списком изменений.
2. После успешного full-refresh создавать snapshot: `snapshots/<timestamp>/manifest.json` (структура каталога + хэши).
3. Diff builder сравнивает текущий `storage` с последним snapshot:
   - Новые/обновлённые файлы → копировать в `diff_work/`.
   - Удалённые файлы фиксировать отдельно в manifest.
4. Упаковать diff в `diff-YYYYMMDDHHmm.tar.zst` (используя `tar` + `zstd` или python-zstandard). Добавить README с инструкциями и `manifest.json` внутрь архива.
5. Сохранять информацию об артефакте в таблице `artifacts` (путь, размер, checksum, базовый snapshot).
6. Эндпоинты `GET /artifacts` и `POST /jobs/diff-build` для просмотра и ручного запуска.

## 6. Автоматизация ремонта битых архивов

1. Создать задачу `broken_scan`:
   - Параллельный `tar -tzf` для каждого `.tgz` в `storage`.
   - При ошибке добавлять запись в таблицу `broken_archives` со статусом `detected`.
2. Процедура ремонта:
   - Удалить повреждённый `.tgz`.
   - Определить package/scope/version по пути (например, `storage/@scope/pkg/-/pkg-1.2.3.tgz`).
   - Запустить `pnpm install pkg@version --force` во временной директории, чтобы Verdaccio пересоздал архив.
   - После установки проверить архив ещё раз; при успехе отметить `status = repaired`, при повторной ошибке — `failed` (с количеством попыток).
3. API:
   - `GET /broken-archives` — список текущих записей.
   - `POST /jobs/broken-rescan` — ручной запуск проверки.
4. UI должен отображать список битых архивов, статусы ремонта, ссылки на логи.

## 7. Фронтенд на React

1. Настроить Vite + React + TypeScript. Общение с бэкендом через REST.
2. Разделы:
   - Dashboard: общая статистика (пакеты, версии, размер storage, активные задачи, broken).
   - Packages: таблица с фильтрами, страница пакета с версиями.
   - Jobs: список задач, детальная страница с логом (stream/download).
   - Artifacts: список архивов, детали manifest, ссылка на путь.
   - Broken Archives: таблица статусов, кнопки «пересканировать» и «починить» (если нужно ручное подтверждение).
3. Минимальная стилизация (например, Material UI или простые компоненты). Auth не требуется.

## 8. Офлайн-пайплайн и документация

1. Обновить `docs/` с пошаговой инструкцией для админа офлайн-сети:
   - Где лежат артефакты (`artifacts/`), как проверить checksum (sha512sum + manifest).
   - Как распаковать `tar.zst` в каталог `storage` и перезапустить Verdaccio.
   - Как делать резервную копию `storage` перед применением.
2. В README описать формат `manifest.json`: список файлов с путями, sha512, размером, действием (`add/update/remove`).
3. Добавить чек-лист по откату (восстановление предыдущего snapshot).

## 9. Наблюдаемость, тестирование, эксплуатация

1. Логи:
   - Backend пишет структурированные логи (JSON/текст) с ротацией.
   - Каждая задача имеет отдельный лог-файл.
2. Health-checks:
   - `/health` проверяет доступность SQLite, возможность читать `storage`, состояние планировщика.
3. Тестирование:
   - Unit-тесты для парсинга пакетов, diff builder, broken_scan.
   - Интеграционные тесты с временным каталогом, имитирующим Verdaccio storage.
4. Backup/ops:
   - Скрипт/cron для бэкапа `state/data.sqlite`, `snapshots/`, `artifacts/`.
   - Мониторинг дискового пространства (например, простой cron, который пишет `du -sh storage` в лог).
5. Deployment:
   - Compose-файл для продакшена (маунты к реальным каталогам Verdaccio).
   - Документация по обновлению сервиса без остановки Verdaccio.

## 10. Этапы внедрения

1. **Sprint 1**: монорепо, базовый FastAPI + SQLite, миграции, health-check.
2. **Sprint 2**: обёртки `full-refresh`/`delta-refresh`, запуск задач через API, логирование.
3. **Sprint 3**: metadata collector, таблицы пакетов, первые UI-страницы.
4. **Sprint 4**: diff builder + snapshot, выдача артефактов, инструкции по офлайн-применению.
5. **Sprint 5**: автоматизация broken archives, UI для мониторинга, расширенные API.
6. **Sprint 6**: стабилизация, тесты, документация, подготовка к переносу в офлайн.
