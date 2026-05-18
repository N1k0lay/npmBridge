import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT_DIR / 'scripts' / 'create_diff.py'


class CreateDiffTests(unittest.TestCase):
    def test_includes_files_missing_from_frozen_even_if_last_diff_is_newer(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            storage_dir = tmp_path / 'storage'
            frozen_dir = tmp_path / 'frozen'
            diff_archives_dir = tmp_path / 'diff_archives'
            logs_dir = tmp_path / 'logs'

            storage_dir.mkdir()
            frozen_dir.mkdir()
            diff_archives_dir.mkdir()
            logs_dir.mkdir()

            package_dir = storage_dir / 'types-registry'
            package_dir.mkdir()

            package_json = package_dir / 'package.json'
            package_json.write_text('{"name":"types-registry","version":"0.1.747"}', encoding='utf-8')
            tgz_file = package_dir / 'types-registry-0.1.747.tgz'
            tgz_file.write_bytes(b'test-package')

            old_timestamp = 1764316800
            os.utime(package_json, (old_timestamp, old_timestamp))
            os.utime(tgz_file, (old_timestamp, old_timestamp))

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
                    'DIFF_ARCHIVES_DIR': str(diff_archives_dir),
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


if __name__ == '__main__':
    unittest.main()