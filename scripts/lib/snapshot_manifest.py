import hashlib
import json
import tarfile
from datetime import datetime, timezone
from pathlib import Path

EXCLUDE_NAMES = {'.sinopia-db.json', '.verdaccio-db.json', '.DS_Store'}
INCLUDE_PATTERNS = ('*.tgz', 'package.json')


def iso_mtime(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def hash_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with open(file_path, 'rb') as file_obj:
        while True:
            chunk = file_obj.read(65536)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def iter_storage_files(storage_path: Path) -> list[tuple[str, Path]]:
    diff_files = []
    for pattern in INCLUDE_PATTERNS:
        for src_file in storage_path.rglob(pattern):
            if src_file.name in EXCLUDE_NAMES:
                continue
            diff_files.append((str(src_file.relative_to(storage_path)), src_file))
    diff_files.sort(key=lambda item: item[0])
    return diff_files


def build_file_entry(src_file: Path) -> dict[str, str | int]:
    stat_result = src_file.stat()
    entry: dict[str, str | int] = {
        'kind': 'package.json' if src_file.name == 'package.json' else 'tgz',
        'size': stat_result.st_size,
        'mtime': iso_mtime(stat_result.st_mtime),
    }
    if src_file.name == 'package.json':
        entry['sha256'] = hash_file(src_file)
    return entry


def build_snapshot_manifest(
    storage_path: Path,
    snapshot_id: str,
    source_diff_id: str | None,
    synced_at: str | None,
    created_at: str,
) -> dict[str, object]:
    files: dict[str, dict[str, str | int]] = {}
    for rel_path, src_file in iter_storage_files(storage_path):
        files[rel_path] = build_file_entry(src_file)
    return {
        'version': 1,
        'snapshotId': snapshot_id,
        'createdAt': created_at,
        'syncedAt': synced_at,
        'sourceDiffId': source_diff_id,
        'files': files,
    }


def load_snapshot_manifest(manifest_path: Path) -> dict[str, object] | None:
    if not manifest_path.exists():
        return None
    try:
        with open(manifest_path, encoding='utf-8') as file_obj:
            return json.load(file_obj)
    except Exception:
        return None


def build_snapshot_manifest_from_archives(
    diff_archive_path: Path,
    package_json_archive_path: Path,
    snapshot_id: str,
    source_diff_id: str | None,
    synced_at: str | None,
    created_at: str,
) -> dict[str, object]:
    files: dict[str, dict[str, str | int]] = {}

    with tarfile.open(diff_archive_path, 'r:gz') as tar_obj:
        for member in tar_obj:
            if not member.isfile():
                continue
            files[member.name] = {
                'kind': 'tgz',
                'size': member.size,
                'mtime': iso_mtime(member.mtime),
            }

    with tarfile.open(package_json_archive_path, 'r:gz') as tar_obj:
        for member in tar_obj:
            if not member.isfile():
                continue
            file_obj = tar_obj.extractfile(member)
            if file_obj is None:
                continue
            payload = file_obj.read()
            files[member.name] = {
                'kind': 'package.json',
                'size': member.size,
                'mtime': iso_mtime(member.mtime),
                'sha256': hashlib.sha256(payload).hexdigest(),
            }

    return {
        'version': 1,
        'snapshotId': snapshot_id,
        'createdAt': created_at,
        'syncedAt': synced_at,
        'sourceDiffId': source_diff_id,
        'files': files,
    }


def manifest_entry_differs(
    current_entry: dict[str, str | int],
    baseline_entry: dict[str, str | int] | None,
) -> bool:
    if baseline_entry is None:
        return True

    if baseline_entry.get('kind') != current_entry.get('kind'):
        return True

    if baseline_entry.get('size') != current_entry.get('size'):
        return True

    kind = current_entry.get('kind')
    if kind == 'package.json':
        return baseline_entry.get('sha256') != current_entry.get('sha256')

    return baseline_entry.get('mtime') != current_entry.get('mtime')