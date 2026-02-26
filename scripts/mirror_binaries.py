#!/usr/bin/env python3
"""
Загрузка бинарников npm-пакетов для использования в закрытых сетях.

Пакеты playwright, electron, puppeteer скачивают бинари в postinstall-скриптах
напрямую с CDN (минуя verdaccio). Этот скрипт загружает их заранее.

РЕЖИМ cdn-mirror: zip-архивы в CDN-структуре путей — для HTTP-зеркала.
  Клиент: PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn
          ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron/
          ELECTRON_CUSTOM_DIR={{ version }}
          PUPPETEER_DOWNLOAD_BASE_URL=http://repo.dmn.zbr:8013/binaries/puppeteer-cdn

РЕЖИМ local-extract: распакованные бинари — для передачи папки в закрытую сеть.
  Клиент: PLAYWRIGHT_BROWSERS_PATH=/path/to/playwright-browsers
          PUPPETEER_CACHE_DIR=/path/to/puppeteer-cache

Использование:
  python3 mirror_binaries.py                               # все, cdn-mirror
  python3 mirror_binaries.py --mode local-extract          # все, local-extract
  python3 mirror_binaries.py --package playwright          # только playwright
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

# Файлы прогресса/статуса — устанавливаются webapp при запуске как задача
PROGRESS_FILE = os.environ.get('PROGRESS_FILE', '')
STATUS_FILE   = os.environ.get('STATUS_FILE', '')
LOG_FILE_PATH = os.environ.get('LOG_FILE', '')

METADATA_FILE = BINARIES_DIR / 'metadata.json'

# Официальные CDN
PLAYWRIGHT_CDN = 'https://cdn.playwright.dev'
ELECTRON_CDN   = 'https://github.com/electron/electron/releases/download'
PUPPETEER_CDN  = 'https://storage.googleapis.com/chrome-for-testing-public'

# Платформы (для ARM добавьте 'ubuntu22.04-arm64')
PLAYWRIGHT_PLATFORMS = ['ubuntu22.04-x64', 'ubuntu24.04-x64', 'debian12-x64']
PLAYWRIGHT_BROWSERS  = ['chromium', 'chromium-headless-shell', 'firefox', 'webkit']
ELECTRON_PLATFORMS   = [('linux', 'x64')]
PUPPETEER_PLATFORMS  = ['linux64']

# Описания для UI
BINARY_PURPOSES: dict[str, str] = {
    'chromium':                'Браузер Chromium для Playwright (тесты, автоматизация)',
    'chromium-headless-shell': 'Chromium Headless Shell для Playwright (headless-режим)',
    'firefox':                 'Браузер Firefox для Playwright',
    'webkit':                  'Браузер WebKit/Safari для Playwright',
    'electron':                'Electron runtime для десктопных приложений на Node.js',
    'puppeteer':               'Chrome for Testing для Puppeteer (тесты, скрейпинг)',
}

# ─────────────────────────────────────────────────────────────────────────────
# Прогресс / статус / лог
# ─────────────────────────────────────────────────────────────────────────────

def log(level: str, msg: str):
    ts = datetime.datetime.now().isoformat(timespec='seconds')
    line = f'[{ts}] [{level}] {msg}'
    print(line, flush=True)
    if LOG_FILE_PATH:
        try:
            with open(LOG_FILE_PATH, 'a') as f:
                f.write(line + '\n')
        except Exception:
            pass


def write_status(status: str, message: str):
    if not STATUS_FILE:
        return
    try:
        with open(STATUS_FILE, 'w') as f:
            json.dump({'status': status, 'message': message,
                       'updatedAt': datetime.datetime.now().isoformat()}, f)
    except Exception:
        pass


def write_progress(current: int, total: int, current_item: str,
                   success: int, failed: int):
    if not PROGRESS_FILE:
        return
    pct = round(current * 100 / total, 1) if total > 0 else 100
    try:
        with open(PROGRESS_FILE, 'w') as f:
            json.dump({
                'current': current, 'total': total, 'percent': pct,
                'currentPackage': current_item,
                'success': success, 'failed': failed,
                'updatedAt': datetime.datetime.now().isoformat(),
            }, f)
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# Метаданные
# ─────────────────────────────────────────────────────────────────────────────

def load_metadata() -> dict:
    if METADATA_FILE.exists():
        try:
            return json.loads(METADATA_FILE.read_text('utf-8'))
        except Exception:
            pass
    return {}


def save_metadata(meta: dict):
    BINARIES_DIR.mkdir(parents=True, exist_ok=True)
    METADATA_FILE.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), 'utf-8'
    )


def record_meta(dest: Path, info: dict):
    """Записывает метаданные о файле/директории в metadata.json."""
    try:
        rel = str(dest.relative_to(BINARIES_DIR))
    except ValueError:
        rel = dest.name
    meta = load_metadata()
    meta[rel] = {**info, 'downloadedAt': datetime.datetime.now().isoformat(timespec='seconds')}
    save_metadata(meta)


# ─────────────────────────────────────────────────────────────────────────────
# Утилиты
# ─────────────────────────────────────────────────────────────────────────────

def download_file(url: str, dest: Path, label: str = '') -> bool:
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
                    print(f'\r    {pct:3d}%  {downloaded // 1048576} / {total // 1048576} MB',
                          end='', flush=True)
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
    dest_dir.mkdir(parents=True, exist_ok=True)
    try:
        log('INFO', f'  📦 Распаковка {label or zip_path.name} → {dest_dir}')
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest_dir)
        for p in dest_dir.rglob('*'):
            if p.is_file() and not p.suffix:
                p.chmod(p.stat().st_mode | 0o111)
        return True
    except Exception as e:
        log('WARNING', f'  Ошибка распаковки: {e}')
        return False


def get_latest_tgz(package_name: str) -> Path | None:
    pkg_dir = STORAGE_DIR / package_name
    if not pkg_dir.exists():
        return None
    tgzs = sorted(pkg_dir.glob('*.tgz'))
    return tgzs[-1] if tgzs else None


def install_pkg_get_path(package_spec: str) -> Path | None:
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
    arm = '-arm64' if arch == 'arm64' else ''
    mapping = {
        'chromium':                f'chromium-linux{arm}.zip',
        'chromium-headless-shell': f'chromium-headless-shell-linux{arm}.zip',
        'firefox':                 f'firefox-ubuntu-22.04{arm}.zip',
        'webkit':                  f'webkit-ubuntu-22.04{arm}.zip',
    }
    return mapping.get(browser)


def _playwright_revisions(ver: str) -> dict[str, str | None]:
    temp_dir = install_pkg_get_path(f'playwright-core@{ver}')
    if not temp_dir:
        return {}
    try:
        index_js = (temp_dir / 'node_modules' / 'playwright-core' /
                    'lib' / 'server' / 'registry' / 'index.js')
        if not index_js.exists():
            log('WARNING', f'  index.js не найден в playwright-core@{ver}')
            return {}
        content = index_js.read_text('utf-8', errors='replace')
        revisions: dict[str, str | None] = {}
        for browser in PLAYWRIGHT_BROWSERS:
            m = re.search(
                rf'name:\s*["\']({re.escape(browser)})["\'].*?revision:\s*["\'](\d+)["\']',
                content, re.DOTALL)
            revisions[browser] = m.group(2) if m else None
        return revisions
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _detect_playwright_version() -> str | None:
    tgz = get_latest_tgz('playwright-core') or get_latest_tgz('playwright')
    return tgz.stem.rsplit('-', 1)[-1] if tgz else None


# ─────────────────────────────────────────────────────────────────────────────
# Playwright — cdn-mirror
# ─────────────────────────────────────────────────────────────────────────────

def playwright_cdn_mirror(versions: list[str] | None = None):
    dest_root = BINARIES_DIR / 'playwright-cdn'
    versions = versions or [_detect_playwright_version()]
    if not versions or not versions[0]:
        log('ERROR', 'playwright/playwright-core не найден в storage'); return False

    # Считаем общее кол-во файлов для прогресса
    total_items = len(versions) * len(PLAYWRIGHT_BROWSERS) * len(PLAYWRIGHT_PLATFORMS)
    done = ok = fail = 0
    write_status('running', 'Скачивание браузеров Playwright (cdn-mirror)...')

    for ver in versions:
        log('INFO', f'\n  playwright-core@{ver} — cdn-mirror')
        revisions = _playwright_revisions(ver)
        log('INFO', f'  Ревизии: {revisions}')

        for browser in PLAYWRIGHT_BROWSERS:
            revision = revisions.get(browser)
            if not revision:
                log('WARNING', f'  {browser}: ревизия не найдена')
                done += len(PLAYWRIGHT_PLATFORMS); continue

            for platform in PLAYWRIGHT_PLATFORMS:
                arch = 'arm64' if 'arm64' in platform else ''
                filename = _playwright_browser_filename(browser, arch)
                if not filename:
                    done += 1; continue
                cdn_path = f'builds/{browser}/{revision}/{filename}'
                file_dest = dest_root / cdn_path
                write_progress(done, total_items, f'{browser} [{platform}]', ok, fail)
                r = download_file(f'{PLAYWRIGHT_CDN}/{cdn_path}', file_dest,
                                  f'{browser} rev={revision} [{platform}]')
                done += 1
                if r:
                    ok += 1
                    record_meta(file_dest, {
                        'package': 'playwright-core', 'packageVersion': ver,
                        'browser': browser, 'browserRevision': revision,
                        'purpose': BINARY_PURPOSES.get(browser, ''),
                        'mode': 'cdn-mirror', 'platform': platform,
                    })
                else:
                    fail += 1

    write_progress(total_items, total_items, '', ok, fail)
    log('INFO', f'\nPlaywright cdn-mirror: ok={ok}, fail={fail}')
    log('INFO', f'  PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn')
    return fail == 0


# ─────────────────────────────────────────────────────────────────────────────
# Playwright — local-extract
# ─────────────────────────────────────────────────────────────────────────────

def playwright_local_extract(versions: list[str] | None = None):
    dest_root = BINARIES_DIR / 'playwright-browsers'
    zip_cache = BINARIES_DIR / 'playwright-cdn'
    versions = versions or [_detect_playwright_version()]
    if not versions or not versions[0]:
        log('ERROR', 'playwright/playwright-core не найден в storage'); return False

    total_items = len(versions) * len(PLAYWRIGHT_BROWSERS)
    done = ok = skip = fail = 0
    write_status('running', 'Извлечение браузеров Playwright (local-extract)...')

    for ver in versions:
        log('INFO', f'\n  playwright-core@{ver} — local-extract')
        revisions = _playwright_revisions(ver)

        for browser in PLAYWRIGHT_BROWSERS:
            revision = revisions.get(browser)
            write_progress(done, total_items, f'{browser}', ok, fail)
            if not revision:
                log('WARNING', f'  {browser}: ревизия не найдена')
                done += 1; continue

            browser_dir = dest_root / f'{browser}-{revision}'
            if browser_dir.exists() and any(browser_dir.iterdir()):
                log('INFO', f'  {browser}-{revision}/: уже распакован')
                done += 1; skip += 1; continue

            arch = ''
            filename = _playwright_browser_filename(browser, arch)
            if not filename:
                done += 1; continue
            cdn_path = f'builds/{browser}/{revision}/{filename}'
            zip_dest = zip_cache / cdn_path
            downloaded = download_file(f'{PLAYWRIGHT_CDN}/{cdn_path}', zip_dest,
                                       f'{browser} rev={revision} linux-x64')
            if not downloaded:
                done += 1; fail += 1; continue

            if extract_zip(zip_dest, browser_dir, f'{browser}-{revision}'):
                ok += 1
                record_meta(browser_dir, {
                    'package': 'playwright-core', 'packageVersion': ver,
                    'browser': browser, 'browserRevision': revision,
                    'purpose': BINARY_PURPOSES.get(browser, ''),
                    'mode': 'local-extract',
                    'envVar': f'PLAYWRIGHT_BROWSERS_PATH=<binaries>/playwright-browsers',
                })
            else:
                fail += 1
            done += 1

    write_progress(total_items, total_items, '', ok, fail)
    log('INFO', f'\nPlaywright local-extract: ok={ok}, skip={skip}, fail={fail}')
    log('INFO', f'  PLAYWRIGHT_BROWSERS_PATH=/path/to/playwright-browsers')
    return fail == 0


# ─────────────────────────────────────────────────────────────────────────────
# Electron
# ─────────────────────────────────────────────────────────────────────────────

def _detect_electron_version() -> str | None:
    tgz = get_latest_tgz('electron')
    return tgz.stem.replace('electron-', '') if tgz else None


def electron_cdn_mirror(versions: list[str] | None = None):
    dest_root = BINARIES_DIR / 'electron'
    versions = versions or [_detect_electron_version()]
    if not versions or not versions[0]:
        log('WARNING', 'electron не найден в storage — пропускаем'); return False

    total_items = len(versions) * len(ELECTRON_PLATFORMS)
    done = ok = fail = 0
    write_status('running', 'Скачивание Electron (cdn-mirror)...')

    for ver in versions:
        for platform, arch in ELECTRON_PLATFORMS:
            filename = f'electron-v{ver}-{platform}-{arch}.zip'
            file_dest = dest_root / f'v{ver}' / filename
            write_progress(done, total_items, f'electron v{ver}', ok, fail)
            r = download_file(f'{ELECTRON_CDN}/v{ver}/{filename}', file_dest,
                              f'electron v{ver} {platform}-{arch}')
            done += 1
            if r:
                ok += 1
                record_meta(file_dest, {
                    'package': 'electron', 'packageVersion': ver,
                    'purpose': BINARY_PURPOSES.get('electron', ''),
                    'mode': 'cdn-mirror', 'platform': f'{platform}-{arch}',
                    'envVar': 'ELECTRON_MIRROR=<binaries>/electron/ + ELECTRON_CUSTOM_DIR={{ version }}',
                })
            else:
                fail += 1

    write_progress(total_items, total_items, '', ok, fail)
    log('INFO', f'\nElectron cdn-mirror: ok={ok}, fail={fail}')
    return fail == 0


def electron_local_extract(versions: list[str] | None = None):
    dest_root = BINARIES_DIR / 'electron-zips'
    versions = versions or [_detect_electron_version()]
    if not versions or not versions[0]:
        log('WARNING', 'electron не найден в storage — пропускаем'); return False

    log('INFO', '⚠ Electron: postinstall не поддерживает прямой путь к бинарю.')
    log('INFO', '  Zip-архивы будут скачаны для ручной установки.')

    total_items = len(versions) * len(ELECTRON_PLATFORMS)
    done = ok = fail = 0
    write_status('running', 'Скачивание Electron zip-архивов...')

    for ver in versions:
        for platform, arch in ELECTRON_PLATFORMS:
            filename = f'electron-v{ver}-{platform}-{arch}.zip'
            file_dest = dest_root / f'v{ver}' / filename
            write_progress(done, total_items, f'electron v{ver}', ok, fail)
            r = download_file(f'{ELECTRON_CDN}/v{ver}/{filename}', file_dest,
                              f'electron v{ver} {platform}-{arch}')
            done += 1
            if r:
                ok += 1
                record_meta(file_dest, {
                    'package': 'electron', 'packageVersion': ver,
                    'purpose': BINARY_PURPOSES.get('electron', ''),
                    'mode': 'local-extract', 'platform': f'{platform}-{arch}',
                    'note': 'Скопируйте zip в ~/.cache/electron/ или используйте локальный HTTP-сервер',
                })
            else:
                fail += 1

    write_progress(total_items, total_items, '', ok, fail)
    log('INFO', f'\nElectron local: ok={ok}, fail={fail}')
    log('INFO', f'  cp electron-zips/v<ver>/electron-v<ver>-linux-x64.zip ~/.cache/electron/')
    return fail == 0


# ─────────────────────────────────────────────────────────────────────────────
# Puppeteer
# ─────────────────────────────────────────────────────────────────────────────

def _detect_puppeteer_version() -> str | None:
    tgz = get_latest_tgz('puppeteer') or get_latest_tgz('puppeteer-core')
    return tgz.stem.rsplit('-', 1)[-1] if tgz else None


def _detect_chrome_version_for_puppeteer(puppeteer_ver: str) -> str | None:
    temp_dir = install_pkg_get_path(f'puppeteer-core@{puppeteer_ver}')
    if not temp_dir:
        return None
    try:
        pkg_root = temp_dir / 'node_modules' / 'puppeteer-core'
        candidates = [
            pkg_root / 'lib' / 'cjs' / 'puppeteer' / 'revisions.js',
            *pkg_root.rglob('versions.js'),
            *pkg_root.rglob('*version*.json'),
        ]
        for f in candidates:
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


def puppeteer_cdn_mirror(versions: list[str] | None = None):
    dest_root = BINARIES_DIR / 'puppeteer-cdn'
    versions = versions or [_detect_puppeteer_version()]
    if not versions or not versions[0]:
        log('WARNING', 'puppeteer не найден в storage — пропускаем'); return False

    total_items = len(versions) * len(PUPPETEER_PLATFORMS)
    done = ok = fail = 0
    write_status('running', 'Скачивание Chrome for Testing для Puppeteer (cdn-mirror)...')

    for pkg_ver in versions:
        chrome_ver = _detect_chrome_version_for_puppeteer(pkg_ver)
        if not chrome_ver:
            log('WARNING', f'  puppeteer@{pkg_ver}: не удалось определить версию Chrome')
            done += len(PUPPETEER_PLATFORMS); continue
        log('INFO', f'  puppeteer@{pkg_ver} → Chrome {chrome_ver}')

        for platform in PUPPETEER_PLATFORMS:
            filename = f'chrome-{platform}.zip'
            file_dest = dest_root / chrome_ver / platform / filename
            write_progress(done, total_items, f'Chrome {chrome_ver} [{platform}]', ok, fail)
            r = download_file(f'{PUPPETEER_CDN}/{chrome_ver}/{platform}/{filename}',
                              file_dest, f'Chrome {chrome_ver} [{platform}]')
            done += 1
            if r:
                ok += 1
                record_meta(file_dest, {
                    'package': 'puppeteer-core', 'packageVersion': pkg_ver,
                    'chromeVersion': chrome_ver,
                    'purpose': BINARY_PURPOSES.get('puppeteer', ''),
                    'mode': 'cdn-mirror', 'platform': platform,
                    'envVar': 'PUPPETEER_DOWNLOAD_BASE_URL=<binaries>/puppeteer-cdn',
                })
            else:
                fail += 1

    write_progress(total_items, total_items, '', ok, fail)
    log('INFO', f'\nPuppeteer cdn-mirror: ok={ok}, fail={fail}')
    return fail == 0


def puppeteer_local_extract(versions: list[str] | None = None):
    dest_root = BINARIES_DIR / 'puppeteer-cache'
    zip_cache = BINARIES_DIR / 'puppeteer-cdn'
    versions = versions or [_detect_puppeteer_version()]
    if not versions or not versions[0]:
        log('WARNING', 'puppeteer не найден в storage — пропускаем'); return False

    total_items = len(versions) * len(PUPPETEER_PLATFORMS)
    done = ok = skip = fail = 0
    write_status('running', 'Извлечение Chrome for Testing для Puppeteer...')

    for pkg_ver in versions:
        chrome_ver = _detect_chrome_version_for_puppeteer(pkg_ver)
        if not chrome_ver:
            log('WARNING', f'  puppeteer@{pkg_ver}: версия Chrome не найдена')
            done += len(PUPPETEER_PLATFORMS); continue
        log('INFO', f'  puppeteer@{pkg_ver} → Chrome {chrome_ver}')

        for platform in PUPPETEER_PLATFORMS:
            cache_dir = dest_root / 'chrome' / f'{platform}-{chrome_ver}'
            write_progress(done, total_items, f'Chrome {chrome_ver} [{platform}]', ok, fail)
            if cache_dir.exists() and any(cache_dir.iterdir()):
                log('INFO', f'  Chrome {chrome_ver} [{platform}]: уже распакован')
                done += 1; skip += 1; continue

            filename = f'chrome-{platform}.zip'
            zip_dest = zip_cache / chrome_ver / platform / filename
            downloaded = download_file(f'{PUPPETEER_CDN}/{chrome_ver}/{platform}/{filename}',
                                       zip_dest, f'Chrome {chrome_ver} [{platform}]')
            if not downloaded:
                done += 1; fail += 1; continue

            if extract_zip(zip_dest, cache_dir, f'Chrome {chrome_ver} {platform}'):
                ok += 1
                record_meta(cache_dir, {
                    'package': 'puppeteer-core', 'packageVersion': pkg_ver,
                    'chromeVersion': chrome_ver,
                    'purpose': BINARY_PURPOSES.get('puppeteer', ''),
                    'mode': 'local-extract', 'platform': platform,
                    'envVar': 'PUPPETEER_CACHE_DIR=<binaries>/puppeteer-cache',
                })
            else:
                fail += 1
            done += 1

    write_progress(total_items, total_items, '', ok, fail)
    log('INFO', f'\nPuppeteer local-extract: ok={ok}, skip={skip}, fail={fail}')
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
        for f in sorted(all_files)[:4]:
            log('INFO', f'    {f.relative_to(subdir)}  ({f.stat().st_size // 1048576} MB)')
        if len(all_files) > 4:
            log('INFO', f'    ... и ещё {len(all_files) - 4}')
    log('INFO', f'\n  Итого: {total_bytes // 1048576} MB')


# ─────────────────────────────────────────────────────────────────────────────
# Точка входа
# ─────────────────────────────────────────────────────────────────────────────

HANDLERS = {
    'playwright': {'cdn-mirror': playwright_cdn_mirror, 'local-extract': playwright_local_extract},
    'electron':   {'cdn-mirror': electron_cdn_mirror,   'local-extract': electron_local_extract},
    'puppeteer':  {'cdn-mirror': puppeteer_cdn_mirror,  'local-extract': puppeteer_local_extract},
}


def main():
    parser = argparse.ArgumentParser(
        description='Загрузка бинарников npm-пакетов для закрытых сетей')
    parser.add_argument('--package', choices=list(HANDLERS.keys()))
    parser.add_argument('--mode', choices=['cdn-mirror', 'local-extract'], default='cdn-mirror')
    parser.add_argument('--version', action='append', dest='versions')
    parser.add_argument('--status', action='store_true')
    parser.add_argument('--list',   action='store_true')
    args = parser.parse_args()

    if args.list:
        for name, modes in HANDLERS.items():
            print(f'  {name}:  {", ".join(modes)}')
        return

    if args.status:
        show_status(); return

    targets = [args.package] if args.package else list(HANDLERS.keys())
    write_status('running', f'Запуск: {", ".join(targets)} [{args.mode}]')
    log('INFO', f'Режим: {args.mode}  Пакеты: {", ".join(targets)}  Директория: {BINARIES_DIR}')

    all_ok = True
    for pkg in targets:
        try:
            write_status('running', f'Обработка {pkg}...')
            r = HANDLERS[pkg][args.mode](args.versions)
            if not r:
                all_ok = False
        except Exception as e:
            log('ERROR', f'{pkg}: {e}')
            import traceback; traceback.print_exc()
            all_ok = False

    write_status(
        'completed' if all_ok else 'completed_with_errors',
        'Готово' if all_ok else 'Завершено с ошибками'
    )


if __name__ == '__main__':
    main()
