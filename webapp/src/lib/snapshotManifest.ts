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
async function walkStorage(dirPath: string, visit: (filePath: string) => Promise<boolean>): Promise<boolean> {
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

    const found = await visit(fullPath);
    if (found) return true;
  }
  return false;
}

export async function hasStorageChangesSinceSnapshot(manifestPath: string): Promise<boolean> {
  const manifest = await readSnapshotManifest(manifestPath);
  if (!manifest) {
    return true;
  }

  return walkStorage(config.storageDir, async (filePath) => {
    const relPath = path.relative(config.storageDir, filePath).replaceAll(path.sep, '/');
    return !Object.prototype.hasOwnProperty.call(manifest.files || {}, relPath);
  });
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