import { createHash } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { config } from './scripts';

export interface SnapshotFileEntry {
  kind: 'package.json' | 'tgz';
  size: number;
  mtime: string;
  sha256?: string;
}

export interface SnapshotManifest {
  version: number;
  snapshotId: string;
  createdAt: string;
  syncedAt: string | null;
  sourceDiffId: string | null;
  files: Record<string, SnapshotFileEntry>;
}

const EXCLUDED_NAMES = new Set(['.sinopia-db.json', '.verdaccio-db.json', '.DS_Store']);

async function readSnapshotManifest(manifestPath: string): Promise<SnapshotManifest | null> {
  try {
    const raw = await fsp.readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as SnapshotManifest;
  } catch {
    return null;
  }
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function normalizeMtime(mtimeMs: number): string {
  return new Date(Math.floor(mtimeMs)).toISOString();
}

function parseSnapshotMtime(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function tgzMtimeDiffers(currentMtime: string, baselineMtime?: string): boolean {
  const currentMs = parseSnapshotMtime(currentMtime);
  const baselineMs = parseSnapshotMtime(baselineMtime);

  if (currentMs === null || baselineMs === null) {
    return currentMtime !== baselineMtime;
  }

  return Math.abs(currentMs - baselineMs) > 1;
}

async function buildCurrentEntry(filePath: string, statResult: fs.Stats): Promise<SnapshotFileEntry> {
  const kind: SnapshotFileEntry['kind'] = path.basename(filePath) === 'package.json' ? 'package.json' : 'tgz';
  const entry: SnapshotFileEntry = {
    kind,
    size: statResult.size,
    mtime: normalizeMtime(statResult.mtimeMs),
  };

  if (kind === 'package.json') {
    entry.sha256 = await hashFile(filePath);
  }

  return entry;
}

function entryDiffers(current: SnapshotFileEntry, baseline?: SnapshotFileEntry): boolean {
  if (!baseline) return true;
  if (baseline.kind !== current.kind) return true;
  if (baseline.size !== current.size) return true;
  if (current.kind === 'package.json') {
    return baseline.sha256 !== current.sha256;
  }
  return tgzMtimeDiffers(current.mtime, baseline.mtime);
}

async function walkStorage(dirPath: string, visit: (filePath: string, statResult: fs.Stats) => Promise<boolean>): Promise<boolean> {
  const dirEntries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const dirEntry of dirEntries) {
    const fullPath = path.join(dirPath, dirEntry.name);
    if (dirEntry.isDirectory()) {
      const found = await walkStorage(fullPath, visit);
      if (found) return true;
      continue;
    }

    if (EXCLUDED_NAMES.has(dirEntry.name)) continue;
    if (dirEntry.name !== 'package.json' && !dirEntry.name.endsWith('.tgz')) continue;

    const statResult = await fsp.stat(fullPath);
    const found = await visit(fullPath, statResult);
    if (found) return true;
  }
  return false;
}

export async function hasStorageChangesSinceSnapshot(manifestPath: string): Promise<boolean> {
  const manifest = await readSnapshotManifest(manifestPath);
  if (!manifest) {
    return true;
  }

  const remainingPaths = new Set(Object.keys(manifest.files || {}));
  const foundChange = await walkStorage(config.storageDir, async (filePath, statResult) => {
    const relPath = path.relative(config.storageDir, filePath).replaceAll(path.sep, '/');
    remainingPaths.delete(relPath);
    const currentEntry = await buildCurrentEntry(filePath, statResult);
    return entryDiffers(currentEntry, manifest.files[relPath]);
  });

  return foundChange || remainingPaths.size > 0;
}

export async function promoteSnapshotManifest(snapshotManifestPath: string): Promise<void> {
  const manifest = await readSnapshotManifest(snapshotManifestPath);
  if (!manifest) {
    throw new Error(`Snapshot manifest not found: ${snapshotManifestPath}`);
  }

  const baseline: SnapshotManifest = {
    ...manifest,
    syncedAt: new Date().toISOString(),
  };

  await fsp.mkdir(path.dirname(config.snapshotManifestFile), { recursive: true });
  const tmpPath = `${config.snapshotManifestFile}.tmp`;
  await fsp.writeFile(tmpPath, JSON.stringify(baseline, null, 2), 'utf-8');
  await fsp.rename(tmpPath, config.snapshotManifestFile);
}