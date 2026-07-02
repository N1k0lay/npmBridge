import unittest
import tempfile
import time
from pathlib import Path

from scripts.lib import smart_update
from scripts.lib.smart_update import (
    PackagePlan,
    VersionTarget,
    build_package_plan,
    is_prerelease,
)
from scripts.update_smart import load_plan, save_plan


class SmartUpdatePlanningTests(unittest.TestCase):
    def test_prerelease_detection(self):
        self.assertFalse(is_prerelease('1.2.3'))
        self.assertTrue(is_prerelease('1.2.3-alpha.1'))
        self.assertTrue(is_prerelease('1.2.3-rc.0'))
        self.assertFalse(is_prerelease('0.142.5-linux-x64'))

    def test_keeps_latest_patch_for_existing_minor_lines_and_latest(self):
        plan = build_package_plan(
            package='demo',
            local_versions={'1.2.1', '1.2.3', '2.0.0'},
            metadata_versions={'1.2.1', '1.2.4', '1.3.0', '2.0.1', '3.0.0-alpha.1'},
            dist_tags={'latest': '2.0.1'},
        )

        self.assertEqual(
            plan,
            PackagePlan(
                package='demo',
                targets=[
                    VersionTarget(version='1.2.4', reason='line 1.2.x'),
                    VersionTarget(version='2.0.1', reason='latest'),
                ],
                skipped=['1.2.1', '1.2.3', '2.0.0'],
            ),
        )

    def test_skips_targets_already_present_locally(self):
        plan = build_package_plan(
            package='demo',
            local_versions={'1.2.4', '2.0.1'},
            metadata_versions={'1.2.4', '2.0.1'},
            dist_tags={'latest': '2.0.1'},
        )

        self.assertEqual(plan.targets, [])
        self.assertEqual(plan.skipped, ['1.2.4', '2.0.1'])

    def test_keeps_platform_versions_as_exact_lines(self):
        plan = build_package_plan(
            package='@openai/codex',
            local_versions={'0.142.5-linux-x64', '0.142.5'},
            metadata_versions={
                '0.142.5',
                '0.142.5-linux-x64',
                '0.142.6-linux-x64',
                '0.143.0-alpha.1-linux-x64',
            },
            dist_tags={'latest': '0.142.5'},
        )

        self.assertEqual(
            plan.targets,
            [VersionTarget(version='0.142.6-linux-x64', reason='line 0.142.x')],
        )

    def test_types_node_keeps_all_missing_versions(self):
        plan = build_package_plan(
            package='@types/node',
            local_versions={'18.19.1'},
            metadata_versions={'16.18.0', '18.19.1', '18.19.2', '20.10.0', '21.0.0-alpha.1'},
            dist_tags={'latest': '20.10.0'},
        )

        self.assertEqual(
            plan.targets,
            [
                VersionTarget(version='16.18.0', reason='all versions'),
                VersionTarget(version='18.19.2', reason='all versions'),
                VersionTarget(version='20.10.0', reason='all versions'),
            ],
        )

    def test_metadata_cache_handles_scoped_packages_and_ttl(self):
        original_dir = smart_update.METADATA_CACHE_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                smart_update.METADATA_CACHE_DIR = Path(tmp_dir)
                metadata = {'versions': {'1.0.0': {}}, 'dist-tags': {'latest': '1.0.0'}}

                smart_update.save_cached_metadata('@scope/pkg', metadata)

                self.assertEqual(
                    smart_update.load_cached_metadata('@scope/pkg', ttl_seconds=60),
                    metadata,
                )

                cache_path = smart_update.metadata_cache_path('@scope/pkg')
                old_time = time.time() - 120
                cache_path.touch()
                cache_path.chmod(0o600)
                cache_path.write_text(cache_path.read_text(encoding='utf-8'), encoding='utf-8')
                cache_path.touch()
                import os
                os.utime(cache_path, (old_time, old_time))

                self.assertIsNone(smart_update.load_cached_metadata('@scope/pkg', ttl_seconds=1))
        finally:
            smart_update.METADATA_CACHE_DIR = original_dir

    def test_saved_plan_roundtrip_keeps_package_version_pairs(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            plan_path = Path(tmp_dir) / 'plan.json'
            targets = [
                ('@scope/pkg', VersionTarget(version='1.2.3', reason='latest')),
                ('plain', VersionTarget(version='2.0.1', reason='line 2.0.x')),
            ]

            save_plan(plan_path, targets, scanned_packages=10, skipped_versions=3, failed_plans=1)
            loaded_targets, data = load_plan(plan_path)

            self.assertEqual(
                [(package, target.version, target.reason) for package, target in loaded_targets],
                [(package, target.version, target.reason) for package, target in targets],
            )
            self.assertEqual(data['scannedPackages'], 10)
            self.assertEqual(data['skippedVersions'], 3)
            self.assertEqual(data['planningFailed'], 1)


if __name__ == '__main__':
    unittest.main()
