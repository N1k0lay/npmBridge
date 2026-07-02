#!/usr/bin/env python3
"""
Smart update for Verdaccio storage.

Instead of reinstalling every package as @latest, this script:
1. Refreshes package metadata through Verdaccio.
2. Keeps the latest patch for version lines already present locally.
3. Keeps the latest dist-tag version.
4. Installs only missing concrete versions.
"""

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from lib.config import PARALLEL_JOBS, STORAGE_DIR, VERDACCIO_HOME
from lib.logging import log, update_progress, update_status
from lib.packages import get_all_packages, install_package
from lib.progress import ProgressTracker
from lib.smart_update import PackagePlan, VersionTarget, plan_package


def plan_file_path() -> Path | None:
    path = os.environ.get('SMART_UPDATE_PLAN_FILE')
    return Path(path) if path else None


def target_label(package: str, target: VersionTarget) -> str:
    return f'{package}@{target.version}'


def serialize_targets(targets: list[tuple[str, VersionTarget]]) -> list[dict[str, str]]:
    return [
        {
            'package': package,
            'version': target.version,
            'reason': target.reason,
        }
        for package, target in targets
    ]


def save_plan(
    path: Path,
    targets: list[tuple[str, VersionTarget]],
    scanned_packages: int,
    skipped_versions: int,
    failed_plans: int,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + '.tmp')
    data = {
        'createdAt': datetime.now().isoformat(),
        'sourceTaskId': os.environ.get('TASK_ID', ''),
        'scannedPackages': scanned_packages,
        'skippedVersions': skipped_versions,
        'planningFailed': failed_plans,
        'targets': serialize_targets(targets),
    }
    tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp_path.replace(path)


def load_plan(path: Path) -> tuple[list[tuple[str, VersionTarget]], dict]:
    data = json.loads(path.read_text(encoding='utf-8'))
    targets = []
    for item in data.get('targets') or []:
        package = item.get('package')
        version = item.get('version')
        if not package or not version:
            continue
        targets.append((package, VersionTarget(version=version, reason=item.get('reason') or 'saved plan')))
    return targets, data


def plan_all_packages(packages: list[str]) -> tuple[list[tuple[str, VersionTarget]], int, int]:
    targets: list[tuple[str, VersionTarget]] = []
    skipped_versions = 0
    failed_plans = 0
    planned = 0

    def build_one(package: str) -> tuple[str, PackagePlan | None, str]:
        try:
            return package, plan_package(package), ''
        except Exception as exc:
            return package, None, str(exc)

    with ThreadPoolExecutor(max_workers=PARALLEL_JOBS) as executor:
        futures = {executor.submit(build_one, package): package for package in packages}

        for future in as_completed(futures):
            package, plan, error_msg = future.result()
            planned += 1

            if planned == 1 or planned % 100 == 0 or planned == len(packages):
                update_status('running', f'Планирование обновлений: {planned}/{len(packages)}')

            if plan is None:
                failed_plans += 1
                log('WARNING', f'✗ {package}: не удалось построить план: {error_msg[:200]}')
                update_progress(
                    current=planned,
                    total=len(packages),
                    package=package,
                    success=planned - failed_plans,
                    failed=failed_plans,
                    errors=[],
                    phase='Планирование',
                )
                continue

            skipped_versions += len(plan.skipped)
            for target in plan.targets:
                targets.append((package, target))

            if planned == 1 or planned % 25 == 0 or planned == len(packages):
                update_progress(
                    current=planned,
                    total=len(packages),
                    package=package,
                    success=planned - failed_plans,
                    failed=failed_plans,
                    errors=[],
                    phase='Планирование',
                )

    return targets, skipped_versions, failed_plans


def main() -> None:
    log('INFO', 'Запуск умного обновления репозитория')
    log('INFO', f'VERDACCIO_HOME: {VERDACCIO_HOME}')
    log('INFO', f'STORAGE_DIR: {STORAGE_DIR}')
    log('INFO', f'PARALLEL_JOBS: {PARALLEL_JOBS}')

    update_status('running', 'Получение списка пакетов...')

    if not Path(VERDACCIO_HOME).exists():
        log('ERROR', f'VERDACCIO_HOME не найден: {VERDACCIO_HOME}')
        update_status('failed', f'Директория не найдена: {VERDACCIO_HOME}')
        sys.exit(1)

    if os.environ.get('SMART_UPDATE_APPLY_PLAN') == '1':
        plan_path = plan_file_path()
        if not plan_path or not plan_path.exists():
            update_status('failed', 'Сохранённый план не найден')
            print(json.dumps({
                'totalPackages': 0,
                'success': 0,
                'failed': 1,
                'error': 'saved plan not found',
            }))
            sys.exit(1)

        targets, plan_data = load_plan(plan_path)
        if not targets:
            update_status('completed', 'В сохранённом плане нет версий к установке')
            print(json.dumps({
                'totalPackages': 0,
                'success': 0,
                'failed': 0,
                'scannedPackages': plan_data.get('scannedPackages', 0),
                'skippedVersions': plan_data.get('skippedVersions', 0),
                'planningFailed': plan_data.get('planningFailed', 0),
            }))
            return

        log('INFO', f'Загружен сохранённый план: {len(targets)} версий')
        failed_plans = int(plan_data.get('planningFailed') or 0)
        skipped_versions = int(plan_data.get('skippedVersions') or 0)
        scanned_packages = int(plan_data.get('scannedPackages') or 0)
    else:
        packages = get_all_packages()
        if not packages:
            log('INFO', 'Пакеты не найдены')
            update_status('completed', 'Пакеты не найдены')
            print(json.dumps({
                'totalPackages': 0,
                'success': 0,
                'failed': 0,
                'scannedPackages': 0,
                'skippedVersions': 0,
                'planningFailed': 0,
            }))
            return

        log('INFO', f'Найдено {len(packages)} пакетов для проверки')
        targets, skipped_versions, failed_plans = plan_all_packages(packages)
        scanned_packages = len(packages)

    if os.environ.get('SMART_UPDATE_PLAN_ONLY') == '1':
        plan_path = plan_file_path()
        if plan_path:
            save_plan(plan_path, targets, scanned_packages, skipped_versions, failed_plans)
            log('INFO', f'План сохранён: {plan_path}')
        log('INFO', f'План построен без установки. К установке: {len(targets)} версий')
        update_status('completed', f'План: {len(targets)} версий к установке')
        print(json.dumps({
            'totalPackages': len(targets),
            'success': 0,
            'failed': failed_plans,
            'scannedPackages': scanned_packages,
            'skippedVersions': skipped_versions,
            'planningFailed': failed_plans,
            'plannedTargets': [target_label(package, target) for package, target in targets[:200]],
            'planTruncated': len(targets) > 200,
            'planFile': str(plan_path) if plan_path else '',
        }))
        return

    if not targets:
        status = 'completed_with_errors' if failed_plans else 'completed'
        message = (
            f'Актуальных недостающих версий нет; проверено {scanned_packages} пакетов'
            if not failed_plans
            else f'Недостающих версий нет; ошибок планирования: {failed_plans}'
        )
        update_status(status, message)
        log('INFO', message)
        print(json.dumps({
            'totalPackages': 0,
            'success': 0,
            'failed': failed_plans,
            'scannedPackages': scanned_packages,
            'skippedVersions': skipped_versions,
            'planningFailed': failed_plans,
        }))
        return

    log('INFO', f'К установке выбрано {len(targets)} конкретных версий')
    update_status('running', f'Установка {len(targets)} конкретных версий...')

    tracker = ProgressTracker(len(targets), phase='Установка')
    tracker.force_update()

    with ThreadPoolExecutor(max_workers=PARALLEL_JOBS) as executor:
        futures = {
            executor.submit(install_package, package, target.version, None): (package, target)
            for package, target in targets
        }

        for future in as_completed(futures):
            package, target = futures[future]
            label = target_label(package, target)
            try:
                success, error_msg = future.result()
            except Exception as exc:
                success = False
                error_msg = str(exc)
            if success:
                log('INFO', f'✓ {label} ({target.reason})')
            tracker.increment(label, success, error_msg)

    total_failed = tracker.failed + failed_plans
    if total_failed == 0:
        log('INFO', f'Умное обновление завершено успешно. Установлено {tracker.success} версий.')
        update_status('completed', f'Установлено {tracker.success} версий')
    else:
        log('WARN', f'Умное обновление завершено с ошибками. Успешно: {tracker.success}, Ошибок: {total_failed}')
        update_status('completed_with_errors', f'Установлено: {tracker.success}, Ошибок: {total_failed}')

    print(json.dumps({
        'totalPackages': len(targets),
        'success': tracker.success,
        'failed': total_failed,
        'scannedPackages': scanned_packages,
        'skippedVersions': skipped_versions,
        'planningFailed': failed_plans,
        'errors': tracker.errors,
    }))


if __name__ == '__main__':
    main()
