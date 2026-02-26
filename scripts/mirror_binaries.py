#!/usr/bin/env python3
"""
Загрузка бинарников npm-пакетов для использования в закрытых сетях.

Пакеты playwright, electron, puppeteer скачивают бинари в postinstall-скриптах
напрямую с CDN (минуя verdaccio). Этот скрипт загружает их заранее.

──────────────────────────────────────────────────────────────────────────────
РЕЖИМ 1: local-extract  (передача папки в закрытую сеть)
──────────────────────────────────────────────────────────────────────────────
Скрипт скачивает архивы и распаковывает их в структуру, которую инструменты
ожидают найти на локальной файловой системе.

  Результат:  binaries/
                playwright-browsers/   ← PLAYWRIGHT_BROWSERS_PATH
                  chromium-{rev}/
                  chromium-headless-shell-{rev}/
                  firefox-{rev}/
                  webkit-{rev}/
                electron-zips/         ← для ручной установки (см. ниже)
                  v{ver}/electron-v{ver}-linux-x64.zip
                puppeteer-cache/       ← PUPPETEER_CACHE_DIR
                  chrome/linux64-{ver}/chrome-linux64/

  Клиент в закрытой сети копирует папку binaries/ и выставляет переменные:

    playwright:
      PLAYWRIGHT_BROWSERS_PATH=/path/to/binaries/playwright-browsers
      npx playwright install --dry-run  # убедиться, что браузеры найдены

    puppeteer:
      PUPPETEER_CACHE_DIR=/path/to/binaries/puppeteer-cache

    electron:  ограничение — postinstall всегда скачивает по сети.
      Варианты:
        а) Поднять минимальный HTTP-сервер: python3 -m http.server --directory binaries/
           npm install electron  (с ELECTRON_MIRROR=http://localhost:8000/electron/)
        б) Вручную распаковать zip в ~/.cache/electron/

──────────────────────────────────────────────────────────────────────────────
РЕЖИМ 2: cdn-mirror  (HTTP-зеркало CDN для закрытой сети с HTTP-доступом)
──────────────────────────────────────────────────────────────────────────────
Скрипт сохраняет архивы в структуре путей CDN. Nginx раздаёт их.
Пакеты скачивают как обычно, только с нашего сервера.

  Клиент выставляет:
    PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn
    ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron/
    ELECTRON_CUSTOM_DIR={{ version }}
    PUPPETEER_DOWNLOAD_BASE_URL=http://repo.dmn.zbr:8013/binaries/puppeteer-cdn

──────────────────────────────────────────────────────────────────────────────
Использование:
  python3 mirror_binaries.py                               # все, cdn-mirror
  python3 mirror_binaries.py --mode local-extract          # все, local-extract
  python3 mirror_binaries.py --package playwright          # только playwright
  python3 mirror_binaries.py --package playwright --mode local-extract
  python3 mirror_binaries.py --version 1.58.2 --package playwright
  python3 mirror_binaries.py --status
  python3 mirror_binaries.py --list
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import urllib.error
import zipfile
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# Конфигурация
# ─────────────────────────────────────────────────────────────────────────────

BINARIES_DIR   = Path(os.environ.get('BINARIES_DIR',   '/app/binaries'))
STORAGE_DIR    = Path(os.environ.get('STORAGE_DIR',    '/app/storage'))
PNPM_CMD       = os.environ.get('PNPM_CMD',       'pnpm')
REGISTRY_URL   = os.environ.get('REGISTRY_URL',   'http://verdaccio:4873/')
PNPM_STORE_DIR = os.environ.get('PNPM_STORE_DIR', '')

# Официальные CDN (нужен интернет на сервере при первом запуске)
PLAYWRIGHT_CDN = 'https://cdn.playwright.dev'
ELECTRON_CDN   = 'https://github.com/electron/electron/releases/download'
PUPPETEER_CDN  = 'https://storage.googleapis.com/chrome-for-testing-public'

# Платформы для playwright / puppeteer
# Для ARM добавьте 'ubuntu22.04-arm64'
PLAYWRIGHT_PLATFORMS = [
    'ubuntu22.04-x64',
    'ubuntu24.04-x64',
    'debian12-x64',
]

# Браузеры playwright
PLAYWRIGHT_BROWSERS = [
    'chromium',
    'chromium-headless-shell',
    'firefox',
    'webkit',
]

# Платформы для electron (platform, arch)
ELECTRON_PLATFORMS = [
    ('linux', 'x64'),
]

# Платформы для puppeteer (chrome-for-testing)
PUPPETEER_PLATFORMS = ['linux64']

# ─────────────────────────────────────────────────────────────────────────────
# Утилиты
# ─────────────────────────────────────────────────────────────────────────────

def log(level: str, msg: str):
    ts = datetime.datetime.now().isoformat(timespec='seconds')
    print(f'[{ts}] [{level}] {msg}', flush=True)


def download_file(url: str, dest: Path, label: str = '') -> bool:
    """Скачивает файл по URL в dest. Пропускает если уже есть. True = успех."""
    if dest.exists():
        log('INFO', f'  ↷ уже есть: {dest.name}  ({dest.stat().st_size // 1048576} MB)')
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + '.tmp')
    try:
        log('INFO', f'  ↓ {label or url}')
        req = urllib.request.Request(url, headers={'User-Agent': 'npmBridge/1.0'})
        with urllib.request.urlopen(req, timeout=300) as resp, open(tmp, 'wb') as f:
            total = int(resp.headers.get('Content-Length', 0))
            downloaded = 0
            while chunk := resp.read(65536):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 // total
                    print(f'\r    {pct:3d}%  {downloaded // 1048576} / {total // 1048576} MB', end='', flush=True)
            print()
        tmp.rename(dest)
        log('INFO', f'  ✓ {dest.name}  ({dest.stat().st_size // 1048576} MB)')
        return True
    except urllib.error.HTTPError as e:
        log('WARNING', f'  HTTP {e.code}: {url}')
    except Exception as e:
        log('WARNING', f'  Ошибка {type(e).__name__}: {e}')
    if tmp.exists():
        tmp.unlink()
    return False


def extract_zip(zip_path: Path, dest_dir: Path, label: str = '') -> bool:
    """Распаковывает zip-архив в dest_dir."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    try:
        log('INFO', f'  📦 Распаковка {label or zip_path.name} → {dest_dir}')
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest_dir)
        # Сделать бинари исполняемыми
        for p in dest_dir.rglob('*'):
            if p.is_file() and not p.suffix:
                p.chmod(p.stat().st_mode | 0o111)
        return True
    except Exception as e:
        log('WARNING', f'  Ошибка распаковки: {e}')
        return False


def get_latest_tgz(package_name: str) -> Path | None:
    """Находит самый свежий .tgz пакета в storage verdaccio."""
    pkg_dir = STORAGE_DIR / package_name
    if not pkg_dir.exists():
        return None
    tgzs = sorted(pkg_dir.glob('*.tgz'))
    return tgzs[-1] if tgzs else None


def install_pkg_get_path(package_spec: str) -> Path | None:
    """Устанавливает пакет (--ignore-scripts) во временную директорию."""
    temp = tempfile.mkdtemp(prefix='mirror_binaries_')
    cmd = [PNPM_CMD, 'install', package_spec, '--ignore-scripts',
           '--shamefully-hoist', f'--registry={REGISTRY_URL}']
    if PNPM_STORE_DIR:
        cmd.append(f'--store-dir={PNPM_STORE_DIR}')
    try:
        r = subprocess.run(cmd, cwd=temp, capture_output=True, timeout=120)
        if r.returncode != 0:
            log('WARNING', f'  pnpm install {package_spec} failed:\n{r.stderr.decode()[:500]}')
            shutil.rmtree(temp, ignore_errors=True)
            return None
        return Path(temp)
    except Exception as e:
        log('WARNING', f'  install_pkg_get_path: {e}')
        shutil.rmtree(temp, ignore_errors=True)
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Playwright — общая логика
# ─────────────────────────────────────────────────────────────────────────────

def _playwright_browser_filename(browser: str, arch: str) -> str | None:
    """Имя zip-архива для скачивания с CDN."""
    arm = '-arm64' if arch == 'arm64' else ''
    mapping = {
        'chromium':                f'chromium-linux{arm}.zip',
        'chromium-headless-shell': f'chromium-headless-shell-linux{arm}.zip',
        'firefox':                 f'firefox-ubuntu-22.04{arm}.zip',
        'webkit':                  f'webkit-ubuntu-22.04{arm}.zip',
    }
    return mapping.get(browser)


def _playwright_revisions(ver: str) -> dict[str, str | None]:
    """Читает ревизии браузеров из установленного playwright-core@{ver}."""
    temp_dir = install_pkg_get_path(f'playwright-core@{ver}')
    if not temp_dir:
        return {}
    try:
        index_js = temp_dir / 'node_modules' / 'playwright-core' / 'lib' / 'server' / 'registry' / 'index.js'
        if not index_js.exists():
            log('WARNING', f'  index.js не найден в playwright-core@{ver}')
            return {}
        content = index_js.read_text('utf-8', errors='replace')
        revisions: dict[str, str | None] = {}
        for browser in PLAYWRIGHT_BROWSERS:
            m = re.search(
                rf'name:\s*["\']({re.escape(browser)})["\'].*?revision:\s*["\'](\d+)["\']',
                content, re.DOTALL
            )
            revisions[browser] = m.group(2) if m else None
        return revisions
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# ─────────────────────────────────────────────────────────────────────────────
# Playwright — cdn-mirror режим
# ─────────────────────────────────────────────────────────────────────────────

def playwright_cdn_mirror(versions: list[str] | None = None):
    """
    Сохраняет архивы с CDN-структурой путей для HTTP-зеркала.

    Структура: playwright-cdn/builds/{browser}/{revision}/{file}.zip
    Клиент:    PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn
    """
    dest_root = BINARIES_DIR / 'playwright-cdn'
    versions = versions or [_detect_playwright_version()]
    if not versions or not versions[0]:
        log('ERROR', 'playwright/playwright-core не найден в storage')
        return False

    ok = skip = fail = 0
    for ver in versions:
        log('INFO', f'\n  playwright-core@{ver} — cdn-mirror')
        revisions = _playwright_revisions(ver)
        log('INFO', f'  Ревизии: {revisions}')

        for browser in PLAYWRIGHT_BROWSERS:
            revision = revisions.get(browser)
            if not revision:
                log('WARNING', f'  {browser}: ревизия не найдена')
                continue
            for platform in PLAYWRIGHT_PLATFORMS:
                arch = 'arm64' if 'arm64' in platform else ''
                filename = _playwright_browser_filename(browser, arch)
                if not filename:
                    continue
                cdn_path = f'builds/{browser}/{revision}/{filename}'
                r = download_file(
                    f'{PLAYWRIGHT_CDN}/{cdn_path}',
                    dest_root / cdn_path,
                    f'{browser} rev={revision} [{platform}]'
                )
                if r: ok += 1
                else: fail += 1

    log('INFO', f'\nPlaywright cdn-mirror: скачано={ok}, пропущено={skip}, ошибок={fail}')
    log('INFO', f'  PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn')
    return fail == 0


# ─────────────────────────────────────────────────────────────────────────────
# Playwright — local-extract режим
# ─────────────────────────────────────────────────────────────────────────────

def playwright_local_extract(versions: list[str] | None = None):
    """
    Скачивает архивы и распаковывает их в структуру PLAYWRIGHT_BROWSERS_PATH.

    Playwright ищет браузеры в: {PLAYWRIGHT_BROWSERS_PATH}/{browser}-{revision}/
    После копирования папки клиент выставляет:
      PLAYWRIGHT_BROWSERS_PATH=/path/to/binaries/playwright-browsers
    """
    dest_root = BINARIES_DIR / 'playwright-browsers'
    zip_cache = BINARIES_DIR / 'playwright-cdn'  # кэшируем zip-ы
    versions = versions or [_detect_playwright_version()]
    if not versions or not versions[0]:
        log('ERROR', 'playwright/playwright-core не найден в storage'); return False

    ok = skip = fail = 0
    for ver in versions:
        log('INFO', f'\n  playwright-core@{ver} — local-extract')
        revisions = _playwright_revisions(ver)
        log('INFO', f'  Ревизии: {revisions}')

        for browser in PLAYWRIGHT_BROWSERS:
            revision = revisions.get(browser)
            if not revision:
                log('WARNING', f'  {browser}: ревизия не найдена'); continue

            browser_dir = dest_root / f'{browser}-{revision}'
            if browser_dir.exists() and any(browser_dir.iterdir()):
                log('INFO', f'  {browser}-{revision}/: уже распакован')
                skip += 1
                continue

            # Скачиваем хотя бы одну платформу (x64 Linux достаточно для папки)
            arch = ''
            filename = _playwright_browser_filename(browser, arch)
            if not filename:
                continue
            cdn_path = f'builds/{browser}/{revision}/{filename}'
            zip_dest  = zip_cache / cdn_path
            downloaded = download_file(
                f'{PLAYWRIGHT_CDN}/{cdn_path}', zip_dest,
                f'{browser} rev={revision} linux-x64'
            )
            if not downloaded:
                fail += 1; continue

            if extract_zip(zip_dest, browser_dir, f'{browser}-{revision}'):
                ok += 1
            else:
                fail += 1

    log('INFO', f'\nPlaywright local-extract: распаковано={ok}, пропущено={skip}, ошибок={fail}')
    log('INFO', f'  Скопируйте папку:  {dest_root}')
    log('INFO', f'  Переменная:        PLAYWRIGHT_BROWSERS_PATH=/path/to/playwright-browsers')
    log('INFO', f'  Проверка:          npx playwright install --dry-run chromium')
    return fail == 0


def _detect_playwright_version() -> str | None:
    tgz = get_latest_tgz('playwright-core') or get_latest_tgz('playwright')
    if not tgz:
        return None
    return tgz.stem.rsplit('-', 1)[-1]


# ─────────────────────────────────────────────────────────────────────────────
# Electron
# ─────────────────────────────────────────────────────────────────────────────

def _detect_electron_version() -> str | None:
    tgz = get_latest_tgz('electron')
    return tgz.stem.replace('electron-', '') if tgz else None


def electron_cdn_mirror(versions: list[str] | None = None):
    """
    Сохраняет zip-архивы electron с GitHub-структурой путей.
    Клиент: ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron/
            ELECTRON_CUSTOM_DIR={{ version }}
    """
    dest_root = BINARIES_DIR / 'electron'
    versions = versions or [_detect_electron_version()]
    if not versions or not versions[0]:
        log('WARNING', 'electron не найден в storage — пропускаем'); return False

    ok = fail = 0
    for ver in versions:
        for platform, arch in ELECTRON_PLATFORMS:
            filename = f'electron-v{ver}-{platform}-{arch}.zip'
            r = download_file(
                f'{ELECTRON_CDN}/v{ver}/{filename}',
                dest_root / f'v{ver}' / filename,
                f'electron v{ver} {platform}-{arch}'
            )
            if r: ok += 1
            else: fail += 1

    log('INFO', f'\nElectron cdn-mirror: скачано={ok}, ошибок={fail}')
    log('INFO', f'  ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron/')
    log('INFO', f'  ELECTRON_CUSTOM_DIR={{{{ version }}}}')
    return fail == 0


def electron_local_extract(versions: list[str] | None = None):
    """
    Сохраняет zip-архивы electron.
    ⚠ Electron postinstall всегда загружает по сети — нет переменной для локального пути.
    Для закрытой сети ВАРИАНТЫ:
      а) Поднять локальный HTTP: python3 -m http.server 8080 --directory binaries/
         npm install electron (с ELECTRON_MIRROR=http://localhost:8080/electron/)
      б) Предзаполнить кэш electron вручную:
         mkdir -p ~/.cache/electron && cp electron-v{ver}-linux-x64.zip ~/.cache/electron/
    """
    dest_root = BINARIES_DIR / 'electron-zips'
    versions = versions or [_detect_electron_version()]
    if not versions or not versions[0]:
        log('WARNING', 'electron не найден в storage — пропускаем'); return False

    log('INFO', '⚠ Electron: postinstall не поддерживает ELECTRON_BROWSERS_PATH.')
    log('INFO', '  Zip-архивы будут скачаны в electron-zips/ для ручной установки.')

    ok = fail = 0
    for ver in versions:
        for platform, arch in ELECTRON_PLATFORMS:
            filename = f'electron-v{ver}-{platform}-{arch}.zip'
            r = download_file(
                f'{ELECTRON_CDN}/v{ver}/{filename}',
                dest_root / f'v{ver}' / filename,
                f'electron v{ver} {platform}-{arch}'
            )
            if r: ok += 1
            else: fail += 1

    log('INFO', f'\nElectron local: скачано={ok}, ошибок={fail}')
    log('INFO', f'  Zip-архивы: {dest_root}')
    log('INFO', f'  Инструкция по ручной установке:')
    log('INFO', f'    mkdir -p ~/.cache/electron')
    log('INFO', f'    cp electron-zips/v{{ver}}/electron-v{{ver}}-linux-x64.zip ~/.cache/electron/')
    log('INFO', f'    # Тогда npm install electron найдёт бинарь в кэше')
    return fail == 0


# ─────────────────────────────────────────────────────────────────────────────
# Puppeteer (chrome-for-testing)
# ─────────────────────────────────────────────────────────────────────────────

def _detect_chrome_version_for_puppeteer(puppeteer_ver: str) -> str | None:
    temp_dir = install_pkg_get_path(f'puppeteer-core@{puppeteer_ver}')
    if not temp_dir:
        return None
    try:
        pkg_root = temp_dir / 'node_modules' / 'puppeteer-core'
        # Ищем версию Chrome в различных местах пакета
        candidates = [
            pkg_root / 'lib' / 'cjs' / 'puppeteer' / 'revisions.js',
            *pkg_root.rglob('versions.js'),
            *pkg_root.rglob('*version*.json'),
        ]
        for f in candidates:
            if not isinstance(f, Path):
                f = Path(str(f))
            if f.exists():
                text = f.read_text('utf-8', errors='replace')
                m = re.search(r'[\'"](1\d\d\.\d+\.\d+\.\d+)[\'"]', text)
                if m:
                    return m.group(1)
        return None
    except Exception as e:
        log('WARNING', f'  _detect_chrome_version: {e}')
        return None
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _detect_puppeteer_version() -> str | None:
    tgz = get_latest_tgz('puppeteer') or get_latest_tgz('puppeteer-core')
    return tgz.stem.rsplit('-', 1)[-1] if tgz else None


def puppeteer_cdn_mirror(versions: list[str] | None = None):
    """
    CDN-зеркало chrome-for-testing для puppeteer.
    Клиент: PUPPETEER_DOWNLOAD_BASE_URL=http://repo.dmn.zbr:8013/binaries/puppeteer-cdn
    """
    dest_root = BINARIES_DIR / 'puppeteer-cdn'
    versions = versions or [_detect_puppeteer_version()]
    if not versions or not versions[0]:
        log('WARNING', 'puppeteer не найден в storage — пропускаем'); return False

    ok = fail = 0
    for pkg_ver in versions:
        chrome_ver = _detect_chrome_version_for_puppeteer(pkg_ver)
        if not chrome_ver:
            log('WARNING', f'  puppeteer@{pkg_ver}: не удалось определить версию Chrome'); continue
        log('INFO', f'  puppeteer@{pkg_ver} → Chrome {chrome_ver}')
        for platform in PUPPETEER_PLATFORMS:
            filename = f'chrome-{platform}.zip'
            r = download_file(
                f'{PUPPETEER_CDN}/{chrome_ver}/{platform}/{filename}',
                dest_root / chrome_ver / platform / filename,
                f'Chrome {chrome_ver} [{platform}]'
            )
            if r: ok += 1
            else: fail += 1

    log('INFO', f'\nPuppeteer cdn-mirror: скачано={ok}, ошибок={fail}')
    log('INFO', f'  PUPPETEER_DOWNLOAD_BASE_URL=http://repo.dmn.zbr:8013/binaries/puppeteer-cdn')
    return fail == 0


def puppeteer_local_extract(versions: list[str] | None = None):
    """
    Распаковывает Chrome в структуру PUPPETEER_CACHE_DIR.

    Puppeteer ищет браузер в: {PUPPETEER_CACHE_DIR}/chrome/{platform}-{buildId}/
    Клиент: PUPPETEER_CACHE_DIR=/path/to/binaries/puppeteer-cache
    """
    dest_root = BINARIES_DIR / 'puppeteer-cache'
    zip_cache = BINARIES_DIR / 'puppeteer-cdn'
    versions = versions or [_detect_puppeteer_version()]
    if not versions or not versions[0]:
        log('WARNING', 'puppeteer не найден в storage — пропускаем'); return False

    ok = skip = fail = 0
    for pkg_ver in versions:
        chrome_ver = _detect_chrome_version_for_puppeteer(pkg_ver)
        if not chrome_ver:
            log('WARNING', f'  puppeteer@{pkg_ver}: не удалось определить версию Chrome'); continue
        log('INFO', f'  puppeteer@{pkg_ver} → Chrome {chrome_ver}')

        for platform in PUPPETEER_PLATFORMS:
            # puppeteer кэш: chrome/{platform}-{buildId}/chrome-{platform}/
            cache_dir = dest_root / 'chrome' / f'{platform}-{chrome_ver}'
            if cache_dir.exists() and any(cache_dir.iterdir()):
                log('INFO', f'  Chrome {chrome_ver} [{platform}]: уже распакован')
                skip += 1; continue

            filename = f'chrome-{platform}.zip'
            zip_dest = zip_cache / chrome_ver / platform / filename
            downloaded = download_file(
                f'{PUPPETEER_CDN}/{chrome_ver}/{platform}/{filename}',
                zip_dest,
                f'Chrome {chrome_ver} [{platform}]'
            )
            if not downloaded:
                fail += 1; continue

            if extract_zip(zip_dest, cache_dir, f'Chrome {chrome_ver} {platform}'):
                ok += 1
            else:
                fail += 1

    log('INFO', f'\nPuppeteer local-extract: распаковано={ok}, пропущено={skip}, ошибок={fail}')
    log('INFO', f'  Скопируйте папку: {dest_root}')
    log('INFO', f'  Переменная:       PUPPETEER_CACHE_DIR=/path/to/puppeteer-cache')
    return fail == 0


# ─────────────────────────────────────────────────────────────────────────────
# Статус
# ─────────────────────────────────────────────────────────────────────────────

def show_status():
    log('INFO', f'Содержимое {BINARIES_DIR}:')
    if not BINARIES_DIR.exists():
        log('INFO', '  (директория не существует)'); return

    total_bytes = 0
    for subdir in sorted(BINARIES_DIR.iterdir()):
        if not subdir.is_dir(): continue
        all_files = [f for f in subdir.rglob('*') if f.is_file()]
        size = sum(f.stat().st_size for f in all_files)
        total_bytes += size
        log('INFO', f'  {subdir.name}/  {len(all_files)} файлов  {size // 1048576} MB')
        # Покажем несколько примеров
        for f in sorted(all_files)[:4]:
            log('INFO', f'    {f.relative_to(subdir)}  ({f.stat().st_size // 1048576} MB)')
        if len(all_files) > 4:
            log('INFO', f'    ... и ещё {len(all_files) - 4}')
    log('INFO', f'\n  Итого: {total_bytes // 1048576} MB')


# ─────────────────────────────────────────────────────────────────────────────
# Точка входа
# ─────────────────────────────────────────────────────────────────────────────

HANDLERS = {
    'playwright': {
        'cdn-mirror':    playwright_cdn_mirror,
        'local-extract': playwright_local_extract,
    },
    'electron': {
        'cdn-mirror':    electron_cdn_mirror,
        'local-extract': electron_local_extract,
    },
    'puppeteer': {
        'cdn-mirror':    puppeteer_cdn_mirror,
        'local-extract': puppeteer_local_extract,
    },
}


def main():
    parser = argparse.ArgumentParser(
        description='Загрузка бинарников npm-пакетов для закрытых сетей',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--package', choices=list(HANDLERS.keys()), help='Конкретный пакет')
    parser.add_argument(
        '--mode', choices=['cdn-mirror', 'local-extract'], default='cdn-mirror',
        help=(
            'cdn-mirror: zip-архивы с CDN-структурой путей (для HTTP-зеркала). '
            'local-extract: распаковать бинари в структуру для прямого использования '
            '(для передачи папки в закрытую сеть).'
        )
    )
    parser.add_argument('--version', action='append', dest='versions',
                        help='Версия пакета (повторяемый: --version 1.57 --version 1.58)')
    parser.add_argument('--status', action='store_true', help='Показать что уже скачано')
    parser.add_argument('--list',   action='store_true', help='Поддерживаемые пакеты')
    args = parser.parse_args()

    if args.list:
        for name, modes in HANDLERS.items():
            print(f'  {name}:  {", ".join(modes)}')
        return

    if args.status:
        show_status(); return

    targets = [args.package] if args.package else list(HANDLERS.keys())
    log('INFO', f'Режим: {args.mode}')
    log('INFO', f'Пакеты: {", ".join(targets)}')
    log('INFO', f'Директория: {BINARIES_DIR}')

    for pkg in targets:
        handler = HANDLERS[pkg][args.mode]
        try:
            handler(args.versions)
        except Exception as e:
            log('ERROR', f'{pkg}: {e}')
            import traceback; traceback.print_exc()


if __name__ == '__main__':
    main()
