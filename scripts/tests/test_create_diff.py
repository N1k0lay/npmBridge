import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT_DIR / 'scripts' / 'create_diff.py'


def package_entry(content: str) -> dict[str, str | int]:
    return {
        'kind': 'package.json',
        'size': len(content.encode('utf-8')),
        'mtime': '2025-11-28T08:00:00.000Z',
        'sha256': sha256(content.encode('utf-8')).hexdigest(),
    }


def tgz_entry(payload: bytes) -> dict[str, str | int]:
    return {
        'kind': 'tgz',
        'size': len(payload),
        'mtime': '2025-11-28T08:00:00.000Z',
    }


class CreateDiffTests(unittest.TestCase):
    def test_bootstraps_snapshot_manifest_from_transferred_full_diff_archive(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            storage_dir = tmp_path / 'storage'
            frozen_dir = tmp_path / 'frozen'
            diff_archives_dir = tmp_path / 'diff_archives'
            data_dir = tmp_path / 'data'
            logs_dir = tmp_path / 'logs'

            storage_dir.mkdir()
            frozen_dir.mkdir()
            diff_archives_dir.mkdir()
            data_dir.mkdir()
            logs_dir.mkdir()

            package_dir = storage_dir / 'types-registry'
            package_dir.mkdir()

            package_json_text = '{"name":"types-registry","version":"0.1.747"}'
            tgz_payload = b'test-package'

            package_json = package_dir / 'package.json'
            package_json.write_text(package_json_text, encoding='utf-8')
            tgz_file = package_dir / 'types-registry-0.1.747.tgz'
            tgz_file.write_bytes(tgz_payload)

            old_timestamp = 1764316800
            os.utime(package_json, (old_timestamp, old_timestamp))
            os.utime(tgz_file, (old_timestamp, old_timestamp))

            diff_id = 'diff_2026-04-30T07-02-24-616Z'
            with tarfile.open(diff_archives_dir / f'{diff_id}.tar.gz', 'w:gz') as tar_obj:
                tar_obj.add(tgz_file, arcname='types-registry/types-registry-0.1.747.tgz')

            with tarfile.open(diff_archives_dir / f'{diff_id}_package_json.tar.gz', 'w:gz') as tar_obj:
                tar_obj.add(package_json, arcname='types-registry/package.json')

            (diff_archives_dir / f'{diff_id}.json').write_text(
                json.dumps(
                    {
                        'id': diff_id,
                        'createdAt': '2026-04-30T07:39:57.926Z',
                        'sinceTime': None,
                        'status': 'transferred',
                        'archivePath': f'/app/diff_archives/{diff_id}.tar.gz',
                        'archiveSize': 123,
                        'archiveSizeHuman': '123 B',
                        'filesCount': 1,
                        'storageSnapshotTime': '2026-04-30T07:02:28.239000+00:00',
                        'transfers': {'default': '2026-05-04T08:56:15.737Z'},
                    }
                ),
                encoding='utf-8',
            )

            (diff_archives_dir / f'{diff_id}_package_json_report.json').write_text(
                json.dumps(
                    {
                        'diffId': diff_id,
                        'createdAt': '2026-04-30T07:39:57.926Z',
                        'archive': str(diff_archives_dir / f'{diff_id}_package_json.tar.gz'),
                    }
                ),
                encoding='utf-8',
            )

            snapshot_manifest_path = data_dir / 'snapshot-manifest.json'

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH)],
                capture_output=True,
                text=True,
                check=False,
                env={
                    **os.environ,
                    'STORAGE_DIR': str(storage_dir),
                    'FROZEN_DIR': str(frozen_dir),
                    'DATA_DIR': str(data_dir),
                    'DIFF_ARCHIVES_DIR': str(diff_archives_dir),
                    'SNAPSHOT_MANIFEST_FILE': str(snapshot_manifest_path),
                    'DIFF_ID': 'diff_test',
                    'PROGRESS_FILE': str(logs_dir / 'progress.json'),
                    'STATUS_FILE': str(logs_dir / 'status.json'),
                    'LOG_FILE': str(logs_dir / 'diff.log'),
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout.strip().splitlines()[-1])
            self.assertEqual(payload['filesCount'], 0)
            self.assertTrue(snapshot_manifest_path.exists())

    def test_bootstraps_snapshot_manifest_from_existing_frozen(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            storage_dir = tmp_path / 'storage'
            frozen_dir = tmp_path / 'frozen'
            diff_archives_dir = tmp_path / 'diff_archives'
            data_dir = tmp_path / 'data'
            logs_dir = tmp_path / 'logs'

            storage_dir.mkdir()
            frozen_dir.mkdir()
            diff_archives_dir.mkdir()
            data_dir.mkdir()
            logs_dir.mkdir()

            storage_package_dir = storage_dir / 'types-registry'
            storage_package_dir.mkdir()
            frozen_package_dir = frozen_dir / 'types-registry'
            frozen_package_dir.mkdir()

            package_json_text = '{"name":"types-registry","version":"0.1.747"}'
            tgz_payload = b'test-package'

            (storage_package_dir / 'package.json').write_text(package_json_text, encoding='utf-8')
            (storage_package_dir / 'types-registry-0.1.747.tgz').write_bytes(tgz_payload)
            (frozen_package_dir / 'package.json').write_text(package_json_text, encoding='utf-8')
            (frozen_package_dir / 'types-registry-0.1.747.tgz').write_bytes(tgz_payload)

            snapshot_manifest_path = data_dir / 'snapshot-manifest.json'

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH)],
                capture_output=True,
                text=True,
                check=False,
                env={
                    **os.environ,
                    'STORAGE_DIR': str(storage_dir),
                    'FROZEN_DIR': str(frozen_dir),
                    'DATA_DIR': str(data_dir),
                    'DIFF_ARCHIVES_DIR': str(diff_archives_dir),
                    'SNAPSHOT_MANIFEST_FILE': str(snapshot_manifest_path),
                    'DIFF_ID': 'diff_test',
                    'PROGRESS_FILE': str(logs_dir / 'progress.json'),
                    'STATUS_FILE': str(logs_dir / 'status.json'),
                    'LOG_FILE': str(logs_dir / 'diff.log'),
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout.strip().splitlines()[-1])
            self.assertEqual(payload['filesCount'], 0)
            self.assertTrue(snapshot_manifest_path.exists())

    def test_uses_snapshot_manifest_instead_of_frozen_for_missing_files(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            storage_dir = tmp_path / 'storage'
            frozen_dir = tmp_path / 'frozen'
            diff_archives_dir = tmp_path / 'diff_archives'
            data_dir = tmp_path / 'data'
            logs_dir = tmp_path / 'logs'

            storage_dir.mkdir()
            frozen_dir.mkdir()
            diff_archives_dir.mkdir()
            data_dir.mkdir()
            logs_dir.mkdir()

            package_dir = storage_dir / 'types-registry'
            package_dir.mkdir()
            frozen_package_dir = frozen_dir / 'types-registry'
            frozen_package_dir.mkdir()

            package_json_text = '{"name":"types-registry","version":"0.1.747"}'
            tgz_payload = b'test-package'

            package_json = package_dir / 'package.json'
            package_json.write_text(package_json_text, encoding='utf-8')
            tgz_file = package_dir / 'types-registry-0.1.747.tgz'
            tgz_file.write_bytes(tgz_payload)

            (frozen_package_dir / 'package.json').write_text(package_json_text, encoding='utf-8')
            (frozen_package_dir / 'types-registry-0.1.747.tgz').write_bytes(tgz_payload)

            old_timestamp = 1764316800
            os.utime(package_json, (old_timestamp, old_timestamp))
            os.utime(tgz_file, (old_timestamp, old_timestamp))

            snapshot_manifest_path = data_dir / 'snapshot-manifest.json'
            snapshot_manifest_path.write_text(
                json.dumps(
                    {
                        'version': 1,
                        'snapshotId': 'baseline_1',
                        'createdAt': '2026-04-30T07:39:57.926Z',
                        'syncedAt': '2026-04-30T07:39:57.926Z',
                        'sourceDiffId': 'diff_prev',
                        'files': {},
                    }
                ),
                encoding='utf-8',
            )

            (diff_archives_dir / 'diff_2026-04-30T07-02-24-616Z_package_json_report.json').write_text(
                json.dumps({'createdAt': '2026-04-30T07:39:57.926Z'}),
                encoding='utf-8',
            )

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH)],
                capture_output=True,
                text=True,
                check=False,
                env={
                    **os.environ,
                    'STORAGE_DIR': str(storage_dir),
                    'FROZEN_DIR': str(frozen_dir),
                    'DATA_DIR': str(data_dir),
                    'DIFF_ARCHIVES_DIR': str(diff_archives_dir),
                    'SNAPSHOT_MANIFEST_FILE': str(snapshot_manifest_path),
                    'DIFF_ID': 'diff_test',
                    'PROGRESS_FILE': str(logs_dir / 'progress.json'),
                    'STATUS_FILE': str(logs_dir / 'status.json'),
                    'LOG_FILE': str(logs_dir / 'diff.log'),
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout.strip().splitlines()[-1])
            self.assertEqual(payload['filesCount'], 2)
            self.assertIsNotNone(payload['archivePath'])
            self.assertTrue(Path(payload['archivePath']).exists())

    def test_skips_files_already_present_in_snapshot_manifest_even_if_frozen_is_empty(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            storage_dir = tmp_path / 'storage'
            frozen_dir = tmp_path / 'frozen'
            diff_archives_dir = tmp_path / 'diff_archives'
            data_dir = tmp_path / 'data'
            logs_dir = tmp_path / 'logs'

            storage_dir.mkdir()
            frozen_dir.mkdir()
            diff_archives_dir.mkdir()
            data_dir.mkdir()
            logs_dir.mkdir()

            package_dir = storage_dir / 'types-registry'
            package_dir.mkdir()

            package_json_text = '{"name":"types-registry","version":"0.1.747"}'
            tgz_payload = b'test-package'

            package_json = package_dir / 'package.json'
            package_json.write_text(package_json_text, encoding='utf-8')
            tgz_file = package_dir / 'types-registry-0.1.747.tgz'
            tgz_file.write_bytes(tgz_payload)

            old_timestamp = 1764316800
            os.utime(package_json, (old_timestamp, old_timestamp))
            os.utime(tgz_file, (old_timestamp, old_timestamp))

            snapshot_manifest_path = data_dir / 'snapshot-manifest.json'
            snapshot_manifest_path.write_text(
                json.dumps(
                    {
                        'version': 1,
                        'snapshotId': 'baseline_1',
                        'createdAt': '2026-04-30T07:39:57.926Z',
                        'syncedAt': '2026-04-30T07:39:57.926Z',
                        'sourceDiffId': 'diff_prev',
                        'files': {
                            'types-registry/package.json': package_entry(package_json_text),
                            'types-registry/types-registry-0.1.747.tgz': tgz_entry(tgz_payload),
                        },
                    }
                ),
                encoding='utf-8',
            )

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH)],
                capture_output=True,
                text=True,
                check=False,
                env={
                    **os.environ,
                    'STORAGE_DIR': str(storage_dir),
                    'FROZEN_DIR': str(frozen_dir),
                    'DATA_DIR': str(data_dir),
                    'DIFF_ARCHIVES_DIR': str(diff_archives_dir),
                    'SNAPSHOT_MANIFEST_FILE': str(snapshot_manifest_path),
                    'DIFF_ID': 'diff_test',
                    'PROGRESS_FILE': str(logs_dir / 'progress.json'),
                    'STATUS_FILE': str(logs_dir / 'status.json'),
                    'LOG_FILE': str(logs_dir / 'diff.log'),
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout.strip().splitlines()[-1])
            self.assertEqual(payload['filesCount'], 0)
            self.assertIsNone(payload['archivePath'])


if __name__ == '__main__':
    unittest.main()