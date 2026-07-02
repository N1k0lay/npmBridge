import { NextResponse } from 'next/server';
import { createReadStream, existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { getDiff, getDiffs } from '@/lib/store';
import { getNetwork } from '@/lib/networks';
import { config } from '@/lib/scripts';
import type { SnapshotFileEntry, SnapshotManifest } from '@/lib/snapshotManifest';

export const runtime = 'nodejs';

type AlignmentBuildState = {
  state: 'building' | 'ready' | 'failed';
  updatedAt: string;
  phase?: 'preparing' | 'collecting_files' | 'packaging';
  message?: string;
  progress?: {
    current: number;
    total: number;
    percent: number;
    processedBytes: number;
    totalBytes: number;
    currentFile?: string;
  };
  error?: string;
};

const alignmentBuildTasks = new Map<string, Promise<void>>();

function getAlignmentCachePath(networkId: string, targetDiffId: string): string {
  return path.join(config.diffArchivesDir, `alignment_${networkId}_${targetDiffId}.tar.gz`);
}

function getAlignmentStatePath(networkId: string, targetDiffId: string): string {
  return path.join(config.dataDir, `alignment_${networkId}_${targetDiffId}.status.json`);
}

function getAlignmentBuildKey(networkId: string, targetDiffId: string): string {
  return `${networkId}:${targetDiffId}`;
}

async function readAlignmentBuildState(statePath: string): Promise<AlignmentBuildState | null> {
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(raw) as AlignmentBuildState;
  } catch {
    return null;
  }
}

async function writeAlignmentBuildState(statePath: string, state: AlignmentBuildState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

async function updateAlignmentBuildState(
  statePath: string,
  patch: Partial<AlignmentBuildState>
): Promise<void> {
  const previous = await readAlignmentBuildState(statePath);
  const next: AlignmentBuildState = {
    state: patch.state ?? previous?.state ?? 'building',
    updatedAt: new Date().toISOString(),
    ...(previous?.phase ? { phase: previous.phase } : {}),
    ...(previous?.message ? { message: previous.message } : {}),
    ...(previous?.progress ? { progress: previous.progress } : {}),
    ...(previous?.error ? { error: previous.error } : {}),
    ...patch,
  };
  await writeAlignmentBuildState(statePath, next);
}

function toIsoMtime(ms: number): string {
  return new Date(ms).toISOString();
}

function shouldIncludeFile(fileName: string): boolean {
  if (fileName === '.sinopia-db.json' || fileName === '.verdaccio-db.json' || fileName === '.DS_Store') {
    return false;
  }
  return fileName === 'package.json' || fileName.endsWith('.tgz');
}

async function hashFileSha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function readSnapshotManifest(manifestPath: string): Promise<SnapshotManifest | null> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as SnapshotManifest;
  } catch {
    return null;
  }
}

async function collectAlignmentFiles(
  rootDir: string,
  baselineFiles: Record<string, SnapshotFileEntry> | null
): Promise<string[]> {
  const result: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!shouldIncludeFile(entry.name)) {
        continue;
      }

      const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');
      if (!baselineFiles) {
        result.push(relPath);
        continue;
      }

      const stat = await fs.stat(fullPath);
      const currentKind: SnapshotFileEntry['kind'] = entry.name === 'package.json' ? 'package.json' : 'tgz';
      const currentEntry: SnapshotFileEntry = {
        kind: currentKind,
        size: stat.size,
        mtime: toIsoMtime(stat.mtimeMs),
      };
      if (currentKind === 'package.json') {
        currentEntry.sha256 = await hashFileSha256(fullPath);
      }

      const baselineEntry = baselineFiles[relPath];
      const changed =
        !baselineEntry ||
        baselineEntry.kind !== currentEntry.kind ||
        baselineEntry.size !== currentEntry.size ||
        (currentKind === 'package.json'
          ? baselineEntry.sha256 !== currentEntry.sha256
          : baselineEntry.mtime !== currentEntry.mtime);

      if (changed) {
        result.push(relPath);
      }
    }
  }

  await walk(rootDir);
  result.sort((a, b) => a.localeCompare(b));
  return result;
}

async function collectAlignmentFilesByMtimeRange(
  rootDir: string,
  options: { sinceExclusive?: Date; untilInclusive: Date }
): Promise<string[]> {
  const result: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!shouldIncludeFile(entry.name)) {
        continue;
      }

      const stat = await fs.stat(fullPath);
      const mtime = new Date(stat.mtimeMs);
      if (Number.isNaN(mtime.getTime())) {
        continue;
      }

      if (options.sinceExclusive && mtime <= options.sinceExclusive) {
        continue;
      }

      if (mtime > options.untilInclusive) {
        continue;
      }

      const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');
      result.push(relPath);
    }
  }

  await walk(rootDir);
  result.sort((a, b) => a.localeCompare(b));
  return result;
}

function collectFilesFromManifestDiff(
  targetFiles: Record<string, SnapshotFileEntry>,
  baselineFiles: Record<string, SnapshotFileEntry> | null
): string[] {
  const result: string[] = [];

  for (const [relPath, targetEntry] of Object.entries(targetFiles)) {
    const fileName = path.basename(relPath);
    if (!shouldIncludeFile(fileName)) {
      continue;
    }

    const baselineEntry = baselineFiles?.[relPath];
    const changed =
      !baselineEntry ||
      baselineEntry.kind !== targetEntry.kind ||
      baselineEntry.size !== targetEntry.size ||
      (targetEntry.kind === 'package.json'
        ? baselineEntry.sha256 !== targetEntry.sha256
        : baselineEntry.mtime !== targetEntry.mtime);

    if (changed) {
      result.push(relPath);
    }
  }

  result.sort((a, b) => a.localeCompare(b));
  return result;
}

async function runTarCreate(
  archivePathTmp: string,
  rootDir: string,
  fileListPath: string,
  options?: {
    onProgress?: (relPath: string) => Promise<void> | void;
  }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('tar', ['-czvf', archivePathTmp, '-C', rootDir, '-T', fileListPath]);
    let stderr = '';
    let stdoutBuffer = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const relPath = line.trim();
        if (relPath) {
          void options?.onProgress?.(relPath);
        }
      }
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `tar exited with code ${code}`));
      }
    });
  });
}

async function buildAlignmentArchive(
  networkId: string,
  targetDiffId: string,
  statePath: string
): Promise<string> {
  const cachePath = getAlignmentCachePath(networkId, targetDiffId);
  if (existsSync(cachePath)) {
    await updateAlignmentBuildState(statePath, {
      state: 'ready',
      message: 'Архив уже был собран ранее.',
      progress: {
        current: 1,
        total: 1,
        percent: 100,
        processedBytes: 1,
        totalBytes: 1,
      },
    });
    return cachePath;
  }

  const targetDiff = await getDiff(targetDiffId);
  if (!targetDiff) {
    throw new Error('Target diff not found');
  }

  const diffs = await getDiffs();
  const orderedDiffs = [...diffs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const targetIndex = orderedDiffs.findIndex((d) => d.id === targetDiff.id);
  const transferredBeforeTarget = (targetIndex > 0 ? orderedDiffs.slice(0, targetIndex) : [])
    .filter((d) => d.transfers.some((t) => t.networkId === networkId));

  const lastTransferredForNetwork = transferredBeforeTarget.length > 0
    ? transferredBeforeTarget[transferredBeforeTarget.length - 1]
    : null;

  await updateAlignmentBuildState(statePath, {
    state: 'building',
    phase: 'preparing',
    message: lastTransferredForNetwork
      ? 'Подготовка выравнивания относительно последнего переноса в эту сеть.'
      : 'Подготовка baseline для первой выгрузки в эту сеть.',
  });

  let baselineFiles: Record<string, SnapshotFileEntry> | null = null;
  if (lastTransferredForNetwork?.snapshotManifestPath) {
    const manifest = await readSnapshotManifest(lastTransferredForNetwork.snapshotManifestPath);
    baselineFiles = manifest?.files || null;
  }

  const baselineSnapshotTime = lastTransferredForNetwork?.storageSnapshotTime
    ? new Date(lastTransferredForNetwork.storageSnapshotTime)
    : null;
  const targetSnapshotTime = targetDiff.storageSnapshotTime
    ? new Date(targetDiff.storageSnapshotTime)
    : null;

  let files: string[];
  await updateAlignmentBuildState(statePath, {
    state: 'building',
    phase: 'collecting_files',
    message: 'Вычисляем список файлов, которых не хватает в целевой сети.',
  });
  if (targetDiff.snapshotManifestPath) {
    const targetManifest = await readSnapshotManifest(targetDiff.snapshotManifestPath);
    if (targetManifest?.files) {
      files = collectFilesFromManifestDiff(targetManifest.files, baselineFiles);
    } else if (targetSnapshotTime && !Number.isNaN(targetSnapshotTime.getTime())) {
      files = await collectAlignmentFilesByMtimeRange(config.storageDir, {
        sinceExclusive:
          baselineSnapshotTime && !Number.isNaN(baselineSnapshotTime.getTime())
            ? baselineSnapshotTime
            : undefined,
        untilInclusive: targetSnapshotTime,
      });
    } else {
      files = await collectAlignmentFiles(config.storageDir, baselineFiles);
    }
  } else if (targetSnapshotTime && !Number.isNaN(targetSnapshotTime.getTime())) {
    files = await collectAlignmentFilesByMtimeRange(config.storageDir, {
      sinceExclusive:
        baselineSnapshotTime && !Number.isNaN(baselineSnapshotTime.getTime())
          ? baselineSnapshotTime
          : undefined,
      untilInclusive: targetSnapshotTime,
    });
  } else {
    files = await collectAlignmentFiles(config.storageDir, baselineFiles);
  }

  const tmpDir = await fs.mkdtemp(path.join(config.dataDir, 'alignment-'));
  const fileListPath = path.join(tmpDir, 'files.txt');
  const archiveTmp = `${cachePath}.partial`;
  try {
    let totalBytes = 0;
    const fileSizes = new Map<string, number>();
    for (const relPath of files) {
      const stat = await fs.stat(path.join(config.storageDir, relPath));
      fileSizes.set(relPath, stat.size);
      totalBytes += stat.size;
    }

    let processedFiles = 0;
    let processedBytes = 0;

    await updateAlignmentBuildState(statePath, {
      state: 'building',
      phase: 'packaging',
      message: files.length === 0
        ? 'Новых файлов для выравнивания нет, создаём пустой архив.'
        : 'Упаковываем файлы в архив выравнивания.',
      progress: {
        current: 0,
        total: files.length,
        percent: files.length === 0 ? 100 : 0,
        processedBytes: 0,
        totalBytes,
      },
    });

    await fs.writeFile(fileListPath, `${files.join('\n')}\n`, 'utf-8');
    await runTarCreate(archiveTmp, config.storageDir, fileListPath, {
      onProgress: async (relPath) => {
        processedFiles += 1;
        processedBytes += fileSizes.get(relPath) ?? 0;
        await updateAlignmentBuildState(statePath, {
          state: 'building',
          phase: 'packaging',
          message: `Упаковано ${processedFiles} из ${files.length} файлов.`,
          progress: {
            current: processedFiles,
            total: files.length,
            percent: files.length === 0 ? 100 : Math.min(100, Math.round((processedFiles / files.length) * 100)),
            processedBytes,
            totalBytes,
            currentFile: relPath,
          },
        });
      },
    });
    await fs.rename(archiveTmp, cachePath);
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    try {
      await fs.rm(archiveTmp, { force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  return cachePath;
}

function ensureAlignmentBuildStarted(networkId: string, targetDiffId: string): void {
  const key = getAlignmentBuildKey(networkId, targetDiffId);
  if (alignmentBuildTasks.has(key)) {
    return;
  }

  const statePath = getAlignmentStatePath(networkId, targetDiffId);
  const task = (async () => {
    await writeAlignmentBuildState(statePath, {
      state: 'building',
      updatedAt: new Date().toISOString(),
      phase: 'preparing',
      message: 'Запускаем формирование архива выравнивания.',
    });

    try {
      await buildAlignmentArchive(networkId, targetDiffId, statePath);
      await writeAlignmentBuildState(statePath, {
        state: 'ready',
        updatedAt: new Date().toISOString(),
        message: 'Архив выравнивания готов к скачиванию.',
        progress: {
          current: 1,
          total: 1,
          percent: 100,
          processedBytes: 1,
          totalBytes: 1,
        },
      });
    } catch (error) {
      await writeAlignmentBuildState(statePath, {
        state: 'failed',
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      alignmentBuildTasks.delete(key);
    }
  })();

  alignmentBuildTasks.set(key, task);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: diffId } = await params;
  const { searchParams } = new URL(request.url);
  const networkId = searchParams.get('networkId');
  const statusOnly = searchParams.get('status') === '1';
  
  // Получаем информацию о diff
  const diff = await getDiff(diffId);
  
  if (!diff) {
    return NextResponse.json(
      { error: 'Diff не найден' },
      { status: 404 }
    );
  }
  
  let archivePath = diff.archivePath;

  if (networkId) {
    const network = await getNetwork(networkId);
    if (!network) {
      return NextResponse.json(
        { error: `Сеть "${networkId}" не найдена` },
        { status: 404 }
      );
    }

    const alignmentCachePath = getAlignmentCachePath(networkId, diffId);
    const statePath = getAlignmentStatePath(networkId, diffId);
    const key = getAlignmentBuildKey(networkId, diffId);
    const cacheExists = existsSync(alignmentCachePath);

    if (!cacheExists) {
      const state = await readAlignmentBuildState(statePath);
      const isTaskRunning = alignmentBuildTasks.has(key);
      const isStale = state?.state === 'building' && !isTaskRunning;

      // Start/restart building under these conditions:
      // 1. No task is currently active.
      // 2. Either no state exists on disk, the state is stale (e.g. from server restart), or this is a fresh download request (!statusOnly).
      const shouldStart = !isTaskRunning && (
        !state ||
        isStale ||
        !statusOnly
      );

      if (shouldStart) {
        ensureAlignmentBuildStarted(networkId, diffId);
      }

      const currentState = await readAlignmentBuildState(statePath);
      if (currentState?.state === 'failed' && !alignmentBuildTasks.has(key)) {
      return NextResponse.json(
        {
          status: 'failed',
          ...currentState,
          message: 'Ошибка формирования архива. Повторите попытку.',
          error: currentState.error,
        },
        { status: 500 }
      );
      }

      return NextResponse.json(
        {
          status: currentState?.state ?? 'building',
          phase: currentState?.phase,
          message: currentState?.message || 'Архив формируется. Повторите скачивание через несколько секунд.',
          progress: currentState?.progress,
          updatedAt: currentState?.updatedAt,
        },
        { status: 202 }
      );
    }

    if (statusOnly) {
      const state = await readAlignmentBuildState(statePath);
      return NextResponse.json({
        status: 'ready',
        phase: state?.phase,
        message: state?.message || 'Архив готов к скачиванию.',
        progress: state?.progress,
        updatedAt: state?.updatedAt,
      });
    }

    archivePath = alignmentCachePath;
  }

  if (statusOnly) {
    return NextResponse.json({ status: existsSync(archivePath) ? 'ready' : 'missing' });
  }
  
  if (!existsSync(archivePath)) {
    return NextResponse.json(
      { error: 'Файл архива не найден' },
      { status: 404 }
    );
  }
  
  const stats = await fs.stat(archivePath);
  const filename = path.basename(archivePath);
  const fileStream = createReadStream(archivePath);
  
  return new NextResponse(Readable.toWeb(fileStream) as ReadableStream, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': stats.size.toString(),
      'Accept-Ranges': 'bytes',
    },
  });
}
