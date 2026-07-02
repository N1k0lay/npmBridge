"""
Planning helpers for smart package updates.

The smart updater keeps offline storage current by explicitly installing the
latest patch for version lines already present locally, plus selected dist-tags.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .config import REGISTRY_URL, STORAGE_DIR

SEMVER_RE = re.compile(
    r'^(?P<major>0|[1-9]\d*)\.'
    r'(?P<minor>0|[1-9]\d*)\.'
    r'(?P<patch>0|[1-9]\d*)'
    r'(?P<suffix>(?:-[0-9A-Za-z.-]+)?)$'
)
PRERELEASE_RE = re.compile(r'^\d+\.\d+\.\d+-')
METADATA_CACHE_DIR = Path(os.environ.get('SMART_UPDATE_METADATA_CACHE_DIR', '/tmp/npmbridge-smart-metadata-cache'))
METADATA_CACHE_TTL = int(os.environ.get('SMART_UPDATE_METADATA_CACHE_TTL', '600'))
FULL_VERSION_PACKAGES = {'@types/node'}


@dataclass(frozen=True)
class VersionTarget:
    version: str
    reason: str


@dataclass(frozen=True)
class PackagePlan:
    package: str
    targets: list[VersionTarget]
    skipped: list[str]


def is_prerelease(version: str) -> bool:
    match = SEMVER_RE.match(version)
    if not match:
        return False
    suffix = match.group('suffix')
    if not suffix:
        return False
    return PRERELEASE_RE.match(version) is not None and _is_semver_prerelease_suffix(suffix)


def _is_semver_prerelease_suffix(suffix: str) -> bool:
    parts = suffix[1:].split('-')
    if not parts:
        return False
    first = parts[0]
    return first and not first.isalpha() or first in {'alpha', 'beta', 'rc', 'next', 'canary'}


def semver_sort_key(version: str) -> tuple[int, int, int, str]:
    match = SEMVER_RE.match(version)
    if not match:
        return (-1, -1, -1, version)
    return (
        int(match.group('major')),
        int(match.group('minor')),
        int(match.group('patch')),
        match.group('suffix'),
    )


def version_line(version: str) -> str | None:
    match = SEMVER_RE.match(version)
    if not match:
        return None
    return f"{match.group('major')}.{match.group('minor')}"


def build_package_plan(
    package: str,
    local_versions: Iterable[str],
    metadata_versions: Iterable[str],
    dist_tags: dict[str, str],
) -> PackagePlan:
    local = set(local_versions)
    metadata = {version for version in metadata_versions if not is_prerelease(version)}
    local_lines = {line for version in local if (line := version_line(version))}

    desired: dict[str, str] = {}

    if package in FULL_VERSION_PACKAGES:
        for version in metadata:
            desired[version] = 'all versions'
    else:
        latest = dist_tags.get('latest')
        if latest and latest in metadata:
            desired[latest] = 'latest'

        for line in sorted(local_lines):
            candidates = [version for version in metadata if version_line(version) == line]
            if not candidates:
                continue
            newest = max(candidates, key=semver_sort_key)
            desired.setdefault(newest, f'line {line}.x')

    targets = [
        VersionTarget(version=version, reason=reason)
        for version, reason in sorted(desired.items(), key=lambda item: semver_sort_key(item[0]))
        if version not in local
    ]

    skipped = sorted(local.difference({target.version for target in targets}), key=semver_sort_key)
    return PackagePlan(package=package, targets=targets, skipped=skipped)


def extract_tarball_version(filename: str, package: str) -> str:
    tarball_name = filename[:-4] if filename.endswith('.tgz') else filename
    base_name = package.split('/')[-1]
    prefix = f'{base_name}-'
    if tarball_name.startswith(prefix):
        return tarball_name[len(prefix):] or 'unknown'
    match = re.search(r'(\d+\.\d+\.\d+(?:-[^/]+)?)\.tgz$', filename)
    return match.group(1) if match else 'unknown'


def local_package_versions(package_dir: Path, package: str) -> set[str]:
    versions: set[str] = set()
    if not package_dir.exists():
        return versions
    for item in package_dir.iterdir():
        if item.is_file() and item.name.endswith('.tgz'):
            version = extract_tarball_version(item.name, package)
            if version != 'unknown':
                versions.add(version)
    return versions


def load_local_metadata(package_dir: Path) -> dict:
    package_json = package_dir / 'package.json'
    if not package_json.exists():
        return {}
    try:
        return json.loads(package_json.read_text(encoding='utf-8'))
    except Exception:
        return {}


def fetch_package_metadata(package: str, timeout: int = 60) -> dict:
    base_url = REGISTRY_URL.rstrip('/') + '/'
    encoded_package = urllib.parse.quote(package, safe='@')
    url = urllib.parse.urljoin(base_url, encoded_package)
    request = urllib.request.Request(url, headers={'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def metadata_cache_path(package: str) -> Path:
    safe_name = urllib.parse.quote(package, safe='')
    return METADATA_CACHE_DIR / f'{safe_name}.json'


def load_cached_metadata(package: str, ttl_seconds: int = METADATA_CACHE_TTL) -> dict | None:
    if ttl_seconds <= 0:
        return None
    path = metadata_cache_path(package)
    try:
        stat = path.stat()
        if time.time() - stat.st_mtime > ttl_seconds:
            return None
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return None


def save_cached_metadata(package: str, metadata: dict) -> None:
    try:
        METADATA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path = metadata_cache_path(package)
        tmp_path = path.with_suffix('.json.tmp')
        tmp_path.write_text(json.dumps(metadata), encoding='utf-8')
        tmp_path.replace(path)
    except Exception:
        pass


def fetch_package_metadata_cached(package: str, timeout: int = 60, use_cache: bool = True) -> dict:
    if use_cache:
        cached = load_cached_metadata(package)
        if cached is not None:
            return cached

    metadata = fetch_package_metadata(package, timeout=timeout)
    save_cached_metadata(package, metadata)
    return metadata


def package_dir(package: str) -> Path:
    return Path(STORAGE_DIR) / package


def plan_package(package: str, timeout: int = 60, use_cache: bool = True) -> PackagePlan:
    directory = package_dir(package)
    local_versions = local_package_versions(directory, package)
    local_metadata = load_local_metadata(directory)

    try:
        metadata = fetch_package_metadata_cached(package, timeout=timeout, use_cache=use_cache)
    except Exception:
        metadata = local_metadata

    metadata_versions = (metadata.get('versions') or {}).keys()
    dist_tags = metadata.get('dist-tags') or {}

    return build_package_plan(
        package=package,
        local_versions=local_versions,
        metadata_versions=metadata_versions,
        dist_tags=dist_tags,
    )
