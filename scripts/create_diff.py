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

from lib.snapshot_manifest import (
    build_file_entry,
    build_snapshot_manifest_from_archives,
    build_snapshot_manifest,
    iter_storage_files,
    load_snapshot_manifest,
    manifest_entry_differs,
)

STORAGE_DIR = os.environ.get('STORAGE_DIR', './storage')
FROZEN_DIR = os.environ.get('FROZEN_DIR', './frozen')
DATA_DIR = os.environ.get('DATA_DIR', './data')
DIFF_ARCHIVES_DIR = os.environ.get('DIFF_ARCHIVES_DIR', './diff_archives')
SNAPSHOT_MANIFEST_FILE = os.environ.get(
    'SNAPSHOT_MANIFEST_FILE',
    str(Path(DATA_DIR) / 'snapshot-manifest.json'),
)
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

    json_files = sorted(
        path_obj
        for path_obj in archives_path.glob('diff_*.json')
        if not path_obj.name.endswith('_snapshot.json')
        and not path_obj.name.endswith('_package_json_report.json')
    )
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


def ensure_baseline_manifest(created_at: str, since_time: str | None) -> dict[str, object] | None:
    manifest_path = Path(SNAPSHOT_MANIFEST_FILE)
    baseline_manifest = load_snapshot_manifest(manifest_path)
    if baseline_manifest is not None:
        return baseline_manifest

    frozen_path = Path(FROZEN_DIR)
    if frozen_path.exists():
        has_snapshot_files = any(iter_storage_files(frozen_path))
        if has_snapshot_files:
            baseline_manifest = build_snapshot_manifest(
                frozen_path,
                'migrated_from_frozen',
                None,
                since_time or created_at,
                created_at,
            )
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            with open(manifest_path, 'w', encoding='utf-8') as file_obj:
                json.dump(baseline_manifest, file_obj, ensure_ascii=True, indent=2)

            log('INFO', f'Bootstrapped snapshot manifest from frozen: {manifest_path}')
            return baseline_manifest

    archives_path = Path(DIFF_ARCHIVES_DIR)
    diff_meta_files = sorted(
        path_obj
        for path_obj in archives_path.glob('diff_*.json')
        if not path_obj.name.endswith('_snapshot.json')
        and not path_obj.name.endswith('_package_json_report.json')
    )
    for diff_meta_path in reversed(diff_meta_files):
        try:
            with open(diff_meta_path, encoding='utf-8') as file_obj:
                diff_meta = json.load(file_obj)
        except Exception:
            continue

        if not diff_meta.get('id'):
            continue
        if diff_meta.get('status') != 'transferred':
            continue
        if diff_meta.get('sinceTime') is not None:
            continue

        diff_id = diff_meta['id']
        diff_archive_path = archives_path / f'{diff_id}.tar.gz'
        package_json_archive_path = archives_path / f'{diff_id}_package_json.tar.gz'
        if not diff_archive_path.exists() or not package_json_archive_path.exists():
            continue

        baseline_manifest = build_snapshot_manifest_from_archives(
            diff_archive_path,
            package_json_archive_path,
            f'{diff_id}_baseline',
            diff_id,
            diff_meta.get('createdAt'),
            diff_meta.get('storageSnapshotTime') or created_at,
        )
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(manifest_path, 'w', encoding='utf-8') as file_obj:
            json.dump(baseline_manifest, file_obj, ensure_ascii=True, indent=2)

        log('INFO', f'Bootstrapped snapshot manifest from transferred diff archive: {diff_id}')
        return baseline_manifest

    return None


def get_diff_files(created_at: str) -> tuple[list[tuple[str, Path]], dict[str, object]]:
    storage_path = Path(STORAGE_DIR)
    since_time = get_last_diff_time()
    baseline_manifest = ensure_baseline_manifest(created_at, since_time)
    baseline_files = baseline_manifest.get('files', {}) if baseline_manifest else {}

    diff_files = []
    current_files: dict[str, dict[str, str | int]] = {}

    for rel_path, src_file in iter_storage_files(storage_path):
        current_entry = build_file_entry(src_file)
        current_files[rel_path] = current_entry
        baseline_entry = baseline_files.get(rel_path) if isinstance(baseline_files, dict) else None
        if manifest_entry_differs(current_entry, baseline_entry):
            diff_files.append((rel_path, src_file))

    current_manifest = {
        'version': 1,
        'snapshotId': f'{DIFF_ID}_snapshot',
        'createdAt': created_at,
        'syncedAt': None,
        'sourceDiffId': DIFF_ID,
        'files': current_files,
    }
    return diff_files, current_manifest


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

    log('INFO', f'Analyzing differences against snapshot manifest: {SNAPSHOT_MANIFEST_FILE}')
    update_status('running', 'Анализ новых пакетов...')
    update_progress('analyzing', 0, 0)

    created_at = datetime.now(timezone.utc).isoformat()
    diff_files, current_manifest = get_diff_files(created_at)
    total_files = len(diff_files)

    if total_files == 0:
        log('INFO', 'No new packages found')
        update_status('completed', 'Новых пакетов не найдено')
        print(json.dumps({
            'diffId': DIFF_ID,
            'filesCount': 0,
            'archivePath': None,
            'archiveSize': 0,
            'archiveSizeHuman': '0 B',
            'snapshotManifestPath': None,
            'sinceTime': since_time,
            'storageSnapshotTime': created_at,
        }))
        return

    log('INFO', f'Found {total_files} new packages')
    update_status('running', f'Создание архива с {total_files} пакетами...')
    total_bytes = sum(src_file.stat().st_size for _, src_file in diff_files)

    archive_path = archives_path / f'{DIFF_ID}.tar.gz'
    snapshot_manifest_path = archives_path / f'{DIFF_ID}_snapshot.json'
    current_archive_tmp = archives_path / f'{DIFF_ID}.tar.gz.partial'
    processed_bytes = 0

    try:
        with open(snapshot_manifest_path, 'w', encoding='utf-8') as file_obj:
            json.dump(current_manifest, file_obj, ensure_ascii=True, indent=2)

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
        'snapshotManifestPath': str(snapshot_manifest_path),
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
