import test from 'node:test';
import assert from 'node:assert/strict';

import { extractTarballVersion } from './packageVersion.mjs';

test('extracts full platform suffix from scoped package tarball filenames', () => {
  assert.equal(
    extractTarballVersion('codex-0.142.5-linux-x64.tgz', '@openai/codex'),
    '0.142.5-linux-x64'
  );
  assert.equal(
    extractTarballVersion('codex-0.142.5-win32-arm64.tgz', '@openai/codex'),
    '0.142.5-win32-arm64'
  );
});

test('extracts plain semver tarball filenames', () => {
  assert.equal(extractTarballVersion('codex-0.142.5.tgz', '@openai/codex'), '0.142.5');
  assert.equal(extractTarballVersion('recast-0.23.12.tgz', 'recast'), '0.23.12');
});
