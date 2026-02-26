#!/usr/bin/env python3
"""
Скрипт для предзагрузки бинарников пакетов, которые не попадают в verdaccio.

Такие пакеты скачивают бинари в postinstall-скриптах напрямую с CDN,
минуя npm/verdaccio. Например:
  - playwright  → браузеры (Chromium, Firefox, WebKit) с playwright.azureedge.net
  - electron    → с GitHub Releases
  - puppeteer   → Chromium с Google Storage
  - esbuild     → уже в npm (отдельные пакеты @esbuild/linux-x64 и т.д.) ✓

После запуска бинари будут доступны через nginx:
  http://repo.dmn.zbr:8013/binaries/playwright/
  http://repo.dmn.zbr:8013/binaries/electron/

Клиентам нужно выставить переменные окружения:
  PLAYWRIGHT_BROWSERS_PATH=/path/to/mounted/binaries/playwright
  или
  PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn

Использование:
  python3 download_binaries.py                        # все пакеты
  python3 download_binaries.py --package playwright   # только playwright
  python3 download_binaries.py --package electron
  python3 download_binaries.py --list                 # список поддерживаемых
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

# Директория для хранения бинарников — монтируется в nginx
BINARIES_DIR = Path(os.environ.get('BINARIES_DIR', '/app/binaries'))
STORAGE_DIR = Path(os.environ.get('STORAGE_DIR', '/app/storage'))
PNPM_CMD = os.environ.get('PNPM_CMD', 'pnpm')
REGISTRY_URL = os.environ.get('REGISTRY_URL', 'http://verdaccio:4873/')
PNPM_STORE_DIR = os.environ.get('PNPM_STORE_DIR', '')

# ─────────────────────────────────────────────────────────────────────────────
# Утилиты
# ─────────────────────────────────────────────────────────────────────────────

def log(level: str, msg: str):
    import datetime
    ts = datetime.datetime.now().isoformat()
    print(f'[{ts}] [{level}] {msg}', flush=True)


def run(cmd: list[str], cwd=None, env=None, timeout=600) -> tuple[bool, str]:
    """Запускает команду, возвращает (success, output)."""
    try:
        full_env = os.environ.copy()
        if env:
            full_env.update(env)
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            timeout=timeout,
            env=full_env
        )
        output = (result.stdout + result.stderr).decode('utf-8', errors='replace')
        return result.returncode == 0, output
    except subprocess.TimeoutExpired:
        return False, 'timeout'
    except FileNotFoundError as e:
        return False, str(e)


def get_latest_tgz(package_name: str) -> Path | None:
    """Находит самый свежий тарбол пакета в storage."""
    pkg_dir = STORAGE_DIR / package_name
    if not pkg_dir.exists():
        return None
    tgzs = sorted(pkg_dir.glob('*.tgz'))
    return tgzs[-1] if tgzs else None


def extract_file_from_tgz(tgz_path: Path, member_suffix: str) -> bytes | None:
    """Извлекает файл из тарбола по суффиксу пути."""
    try:
        with tarfile.open(tgz_path) as t:
            for m in t.getmembers():
                if m.name.endswith(member_suffix):
                    f = t.extractfile(m)
                    if f:
                        return f.read()
    except Exception as e:
        log('WARNING', f'Не удалось читать {tgz_path}: {e}')
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Playwright
# ─────────────────────────────────────────────────────────────────────────────

def download_playwright(versions: list[str] | None = None):
    """
    Скачивает браузеры playwright.
    
    Устанавливает playwright в temp-директорию с разрешёнными скриптами
    и PLAYWRIGHT_BROWSERS_PATH, указывающим на BINARIES_DIR/playwright.
    Это заставит playwright загрузить браузеры туда.
    
    В закрытой сети клиенты выставляют:
      PLAYWRIGHT_BROWSERS_PATH=/mounted/binaries/playwright
    """
    dest = BINARIES_DIR / 'playwright'
    dest.mkdir(parents=True, exist_ok=True)

    # Определяем версии для загрузки
    if not versions:
        tgz = get_latest_tgz('playwright')
        if not tgz:
            log('ERROR', 'playwright не найден в storage — запустите обновление сначала')
            return False
        # Берём версию из имени файла: playwright-1.58.2.tgz → 1.58.2
        ver = tgz.stem.replace('playwright-', '')
        versions = [ver]

    log('INFO', f'Playwright: загружаем браузеры для версий {versions}')

    for ver in versions:
        log('INFO', f'  playwright@{ver}')
        temp_dir = tempfile.mkdtemp()
        try:
            # 1. Устанавливаем playwright через pnpm (тарбол уже в verdaccio)
            cmd = [
                PNPM_CMD, 'install', f'playwright@{ver}',
                f'--registry={REGISTRY_URL}',
            ]
            if PNPM_STORE_DIR:
                cmd.append(f'--store-dir={PNPM_STORE_DIR}')

            env = {
                'PLAYWRIGHT_BROWSERS_PATH': str(dest),
                # Разрешаем скрипты для playwright — нужно чтобы браузеры скачались
            }
            ok, out = run(cmd, cwd=temp_dir, env=env, timeout=120)
            if not ok:
                log('WARNING', f'  pnpm install playwright@{ver}: {out[:200]}')
                continue

            # 2. Запускаем playwright install для скачивания браузеров
            playwright_bin = Path(temp_dir) / 'node_modules' / '.bin' / 'playwright'
            if not playwright_bin.exists():
                playwright_bin = Path(temp_dir) / 'node_modules' / 'playwright' / 'cli.js'

            if playwright_bin.exists():
                cmd2 = ['node', str(playwright_bin), 'install', 'chromium', 'firefox', 'webkit']
            else:
                # Fallback: через npx
                cmd2 = ['npx', f'playwright@{ver}', 'install', 'chromium', 'firefox', 'webkit']

            ok2, out2 = run(cmd2, cwd=temp_dir, env=env, timeout=600)
            if ok2:
                log('INFO', f'  ✓ playwright@{ver} браузеры скачаны → {dest}')
            else:
                log('WARNING', f'  playwright install вернул ошибку (частичная загрузка): {out2[:300]}')
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    # Итог
    browsers = list(dest.iterdir()) if dest.exists() else []
    log('INFO', f'Playwright браузеры в {dest}:')
    for b in sorted(browsers):
        size_mb = sum(f.stat().st_size for f in b.rglob('*') if f.is_file()) // (1024*1024)
        log('INFO', f'  {b.name}  ({size_mb} MB)')
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Electron
# ─────────────────────────────────────────────────────────────────────────────

def download_electron(versions: list[str] | None = None):
    """
    Скачивает electron бинари.
    
    Electron качает ~150MB zip с GitHub при постустановке.
    Здесь скачиваем через `electron` npm-пакет с разрешёнными скриптами.
    
    Клиентам нужно:
      ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron-cdn/
      ELECTRON_CUSTOM_DIR={{ version }}
    (или смонтировать ELECTRON_CACHE)
    """
    dest = BINARIES_DIR / 'electron'
    dest.mkdir(parents=True, exist_ok=True)

    if not versions:
        tgz = get_latest_tgz('electron')
        if not tgz:
            log('WARNING', 'electron не найден в storage — пропускаем')
            return False
        ver = tgz.stem.replace('electron-', '')
        versions = [ver]

    log('INFO', f'Electron: загружаем бинари для версий {versions}')

    for ver in versions:
        log('INFO', f'  electron@{ver}')
        temp_dir = tempfile.mkdtemp()
        try:
            cache_dir = str(dest)
            cmd = [
                PNPM_CMD, 'install', f'electron@{ver}',
                f'--registry={REGISTRY_URL}',
            ]
            if PNPM_STORE_DIR:
                cmd.append(f'--store-dir={PNPM_STORE_DIR}')

            env = {'ELECTRON_CACHE': cache_dir}
            ok, out = run(cmd, cwd=temp_dir, env=env, timeout=600)
            if ok:
                log('INFO', f'  ✓ electron@{ver} → {cache_dir}')
            else:
                log('WARNING', f'  electron@{ver}: {out[:300]}')
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    return True


# ─────────────────────────────────────────────────────────────────────────────
# Puppeteer
# ─────────────────────────────────────────────────────────────────────────────

def download_puppeteer(versions: list[str] | None = None):
    """
    Скачивает puppeteer Chromium.
    
    Клиент выставляет:
      PUPPETEER_CACHE_DIR=/mounted/binaries/puppeteer
    """
    dest = BINARIES_DIR / 'puppeteer'
    dest.mkdir(parents=True, exist_ok=True)

    if not versions:
        tgz = get_latest_tgz('puppeteer')
        if not tgz:
            log('WARNING', 'puppeteer не найден в storage — пропускаем')
            return False
        ver = tgz.stem.replace('puppeteer-', '')
        versions = [ver]

    log('INFO', f'Puppeteer: загружаем Chromium для версий {versions}')

    for ver in versions:
        log('INFO', f'  puppeteer@{ver}')
        temp_dir = tempfile.mkdtemp()
        try:
            cmd = [
                PNPM_CMD, 'install', f'puppeteer@{ver}',
                f'--registry={REGISTRY_URL}',
            ]
            if PNPM_STORE_DIR:
                cmd.append(f'--store-dir={PNPM_STORE_DIR}')

            env = {'PUPPETEER_CACHE_DIR': str(dest)}
            ok, out = run(cmd, cwd=temp_dir, env=env, timeout=600)
            if ok:
                log('INFO', f'  ✓ puppeteer@{ver} → {dest}')
            else:
                log('WARNING', f'  puppeteer@{ver}: {out[:300]}')
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    return True


# ─────────────────────────────────────────────────────────────────────────────
# Итоговый README
# ─────────────────────────────────────────────────────────────────────────────

def print_usage_guide():
    host = 'repo.dmn.zbr:8013'
    log('INFO', '')
    log('INFO', '═══════════════════════════════════════════════════════')
    log('INFO', '  Как использовать бинари в закрытой сети')
    log('INFO', '═══════════════════════════════════════════════════════')
    log('INFO', '')
    log('INFO', '  PLAYWRIGHT (браузеры):')
    log('INFO', f'    Смонтируйте {BINARIES_DIR}/playwright на клиентские машины')
    log('INFO', '    или добавьте в .npmrc / docker-compose:')
    log('INFO', f'    PLAYWRIGHT_BROWSERS_PATH=/mnt/binaries/playwright')
    log('INFO', '')
    log('INFO', '  ELECTRON:')
    log('INFO', f'    ELECTRON_CACHE=/mnt/binaries/electron')
    log('INFO', '')
    log('INFO', '  PUPPETEER:')
    log('INFO', f'    PUPPETEER_CACHE_DIR=/mnt/binaries/puppeteer')
    log('INFO', '')
    log('INFO', '  Все бинари также доступны через HTTP:')
    log('INFO', f'    http://{host}/binaries/')
    log('INFO', '═══════════════════════════════════════════════════════')


# ─────────────────────────────────────────────────────────────────────────────
# Точка входа
# ─────────────────────────────────────────────────────────────────────────────

SUPPORTED = {
    'playwright': download_playwright,
    'electron': download_electron,
    'puppeteer': download_puppeteer,
}


def main():
    parser = argparse.ArgumentParser(description='Загрузка бинарников npm-пакетов')
    parser.add_argument('--package', choices=list(SUPPORTED.keys()),
                        help='Конкретный пакет для загрузки')
    parser.add_argument('--version', help='Версия пакета (по умолчанию — последняя в storage)')
    parser.add_argument('--list', action='store_true', help='Список поддерживаемых пакетов')
    args = parser.parse_args()

    if args.list:
        print('Поддерживаемые пакеты:')
        for name in SUPPORTED:
            print(f'  {name}')
        return

    versions = [args.version] if args.version else None
    targets = [args.package] if args.package else list(SUPPORTED.keys())

    log('INFO', f'Начало загрузки бинарников: {", ".join(targets)}')
    log('INFO', f'Директория назначения: {BINARIES_DIR}')

    for pkg in targets:
        try:
            SUPPORTED[pkg](versions)
        except Exception as e:
            log('ERROR', f'{pkg}: {e}')

    print_usage_guide()


if __name__ == '__main__':
    main()
