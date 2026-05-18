#!/usr/bin/env python3
"""Создание diff-архива по изменениям в storage с безопасной отменой."""

import json
import os
import signal
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

STORAGE_DIR = os.environ.get('STORAGE_DIR', './storage')
FROZEN_DIR = os.environ.get('FROZEN_DIR', './frozen')
DIFF_ARCHIVES_DIR = os.environ.get('DIFF_ARCHIVES_DIR', './diff_archives')
DIFF_ID = os.environ.get('DIFF_ID', f"diff_{datetime.now().strftime('%Y%m%d_%H%M%S')}")

PROGRESS_FILE = os.environ.get('PROGRESS_FILE', '/tmp/diff_progress.json')
STATUS_FILE = os.environ.get('STATUS_FILE', '/tmp/diff_status.json')
LOG_FILE = os.environ.get('LOG_FILE', '/tmp/diff.log')

log_lock = Lock()
current_archive_tmp: Path | None = None
cancel_requested = False


def log(level: str, message: str):
    timestamp = datetime.now().isoformat()
    log_line = f"[{timestamp}] [{level}] {message}"
    print(log_line, file=sys.stderr)
    with log_lock:
        try:
            with open(LOG_FILE, 'a', encoding='utf-8') as file_obj:
                file_obj.write(log_line + '\n')
        except Exception:
            pass


def update_status(status: str, message: str):
    data = {
        'status': status,
        'message': message,
        'updatedAt': datetime.now().isoformat(),
    }
    try:
        with open(STATUS_FILE, 'w', encoding='utf-8') as file_obj:
            json.dump(data, file_obj)
    except Exception:
        pass


def update_progress(
    phase: str,
    current: int,
    total: int,
    current_file: str | None = None,
    processed_bytes: int | None = None,
    total_bytes: int | None = None,
):
    if total_bytes and processed_bytes is not None:
        percent = (processed_bytes * 100 / total_bytes) if total_bytes > 0 else 0
    else:
        percent = (current * 100 / total) if total > 0 else 0

    data = {
        'phase': phase,
        'current': current,
        'total': total,
        'percent': round(percent, 2),
        'updatedAt': datetime.now().isoformat(),
    }
    if current_file:
        data['currentFile'] = current_file
    if processed_bytes is not None:
        data['processedBytes'] = processed_bytes
    if total_bytes is not None:
        data['totalBytes'] = total_bytes
    try:
        with open(PROGRESS_FILE, 'w', encoding='utf-8') as file_obj:
            json.dump(data, file_obj)
    except Exception:
        pass


def cleanup_partial_archive():
    global current_archive_tmp

    if current_archive_tmp and current_archive_tmp.exists():
        try:
            current_archive_tmp.unlink()
            log('INFO', f'Removed partial archive: {current_archive_tmp}')
        except Exception as error:
            log('WARNING', f'Failed to remove partial archive {current_archive_tmp}: {error}')
    current_archive_tmp = None


def handle_termination(signum, _frame):
    global cancel_requested

    cancel_requested = True
    log('WARNING', f'Received signal {signum}, cancelling diff creation')
    update_status('failed', 'Создание diff остановлено, временный архив удаляется...')
    cleanup_partial_archive()
    raise SystemExit(143)


def get_last_diff_time() -> str | None:
    archives_path = Path(DIFF_ARCHIVES_DIR)
    if not archives_path.exists():
        return None

    json_files = sorted(archives_path.glob('diff_*.json'))
    for json_file in reversed(json_files):
        try:
            with open(json_file, encoding='utf-8') as file_obj:
                data = json.load(file_obj)
            created_at = data.get('createdAt')
            if created_at:
                return created_at
        except Exception:
            continue
    return None


def iter_storage_files(storage_path: Path) -> list[tuple[str, Path]]:
    exclude_names = {'.sinopia-db.json', '.verdaccio-db.json', '.DS_Store'}
    include_patterns = ('*.tgz', 'package.json')

    diff_files = []
    for pattern in include_patterns:
        for src_file in storage_path.rglob(pattern):
            if src_file.name in exclude_names:
                continue
            diff_files.append((str(src_file.relative_to(storage_path)), src_file))
    diff_files.sort(key=lambda item: item[0])
    return diff_files


def files_differ(src_file: Path, frozen_file: Path) -> bool:
    try:
        src_stat = src_file.stat()
        frozen_stat = frozen_file.stat()
    except FileNotFoundError:
        return True

    if src_stat.st_size != frozen_stat.st_size:
        return True

    if src_file.name != 'package.json':
        return False

    try:
        with open(src_file, 'rb') as src_obj, open(frozen_file, 'rb') as frozen_obj:
            while True:
                src_chunk = src_obj.read(65536)
                frozen_chunk = frozen_obj.read(65536)
                if src_chunk != frozen_chunk:
                    return True
                if not src_chunk:
                    return False
    except FileNotFoundError:
        return True


def get_diff_files() -> list[tuple[str, Path]]:
    storage_path = Path(STORAGE_DIR)
    frozen_path = Path(FROZEN_DIR)

    diff_files = []
    for rel_path, src_file in iter_storage_files(storage_path):
        frozen_file = frozen_path / rel_path
        if not frozen_file.exists() or files_differ(src_file, frozen_file):
            diff_files.append((rel_path, src_file))
    return diff_files


def format_size(size_bytes: int) -> str:
    size = float(size_bytes)
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024.0:
            return f'{size:.2f} {unit}'
        size /= 1024.0
    return f'{size:.2f} PB'


def main():
    global current_archive_tmp

    signal.signal(signal.SIGTERM, handle_termination)
    signal.signal(signal.SIGINT, handle_termination)

    log('INFO', f'Starting diff creation: {DIFF_ID}')
    update_status('running', 'Инициализация...')

    storage_path = Path(STORAGE_DIR)
    archives_path = Path(DIFF_ARCHIVES_DIR)

    if not storage_path.exists():
        log('ERROR', f'Storage directory not found: {STORAGE_DIR}')
        update_status('failed', 'Директория storage не найдена')
        sys.exit(1)

    archives_path.mkdir(parents=True, exist_ok=True)

    since_time = get_last_diff_time()
    if since_time:
        log('INFO', f'Incremental diff since: {since_time}')
    else:
        log('INFO', 'Full diff (no previous diffs found)')

    log('INFO', 'Analyzing differences against frozen snapshot...')
    update_status('running', 'Анализ новых пакетов...')
    update_progress('analyzing', 0, 0)

    diff_files = get_diff_files()
    total_files = len(diff_files)
    created_at = datetime.now(timezone.utc).isoformat()

    if total_files == 0:
        log('INFO', 'No new packages found')
        update_status('completed', 'Новых пакетов не найдено')
        print(json.dumps({
            'diffId': DIFF_ID,
            'filesCount': 0,
            'archivePath': None,
            'archiveSize': 0,
            'archiveSizeHuman': '0 B',
            'sinceTime': since_time,
            'storageSnapshotTime': created_at,
        }))
        return

    log('INFO', f'Found {total_files} new packages')
    update_status('running', f'Создание архива с {total_files} пакетами...')
    total_bytes = sum(src_file.stat().st_size for _, src_file in diff_files)

    archive_path = archives_path / f'{DIFF_ID}.tar.gz'
    current_archive_tmp = archives_path / f'{DIFF_ID}.tar.gz.partial'
    processed_bytes = 0

    try:
        with tarfile.open(current_archive_tmp, 'w:gz') as tar_obj:
            for index, (rel_path, src_file) in enumerate(diff_files, 1):
                if cancel_requested:
                    raise SystemExit(143)

                processed_bytes += src_file.stat().st_size
                update_progress(
                    'archiving',
                    index,
                    total_files,
                    rel_path,
                    processed_bytes,
                    total_bytes,
                )
                tar_obj.add(src_file, arcname=rel_path)

        current_archive_tmp.replace(archive_path)
        current_archive_tmp = None
    except SystemExit:
        cleanup_partial_archive()
        raise
    except Exception as error:
        log('ERROR', f'Failed to create archive: {error}')
        update_status('failed', f'Ошибка создания архива: {error}')
        cleanup_partial_archive()
        raise

    archive_size = archive_path.stat().st_size
    archive_size_human = format_size(archive_size)

    log('INFO', f'Archive created: {archive_path} ({archive_size_human})')
    update_status('completed', f'Diff создан: {total_files} пакетов, {archive_size_human}')
    print(json.dumps({
        'diffId': DIFF_ID,
        'filesCount': total_files,
        'archivePath': str(archive_path),
        'archiveSize': archive_size,
        'archiveSizeHuman': archive_size_human,
        'sinceTime': since_time,
        'storageSnapshotTime': created_at,
    }))


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:
        update_status('failed', f'Ошибка создания diff: {error}')
        cleanup_partial_archive()
        raise
