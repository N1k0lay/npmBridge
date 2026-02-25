/**
 * store.ts — хранение всех данных в файловой системе.
 * Заменяет db.ts и history.ts.
 *
 * Структура файлов:
 *   diff_archives/{id}.json          — метаданные каждого diff
 *   data/networks.json               — список корпоративных сетей
 *   data/updates/{id}.json           — один запуск обновления
 *   data/checks/{id}.json            — одна проверка broken-архивов
 *
 * Атомарные записи: пишем во .tmp, затем переименовываем.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { config } from './scripts';

// ─────────────────────────────────────────────
// Константы
// ─────────────────────────────────────────────

const EXCLUDE_FILES = new Set(['.sinopia-db.json', '.verdaccio-db.json', '.DS_Store']);

// ─────────────────────────────────────────────
// Интерфейсы
// ─────────────────────────────────────────────

export interface DiffNetworkTransfer {
  networkId: string;
  transferredAt: string;
}

export interface DiffRecord {
  id: string;
  createdAt: string;
  /** createdAt предыдущего diff, или null если первый */
  sinceTime: string | null;
  status: 'pending' | 'transferred' | 'outdated' | 'partial';
  transfers: DiffNetworkTransfer[];
  archivePath: string;
  archiveSize: number;
  archiveSizeHuman: string;
  filesCount: number;
  storageSnapshotTime: string;
}

export interface UpdateRecord {
  id: string;
  type: 'full' | 'recent';
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'completed' | 'failed' | 'completed_with_errors';
  packagesTotal: number;
  packagesSuccess: number;
  packagesFailed: number;
  logFile: string;
  brokenCheckId?: string;
}

export interface BrokenCheckRecord {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'completed' | 'failed' | 'completed_with_issues';
  totalArchives: number;
  brokenArchives: number;
  brokenFiles: string[];
  fixed: boolean;
  fixedCount: number;
  triggeredByUpdate?: string;
}

export interface LastBrokenCheck {
  checkId: string;
  checkedAt: string;
  totalArchives: number;
  brokenArchives: number;
  fixed: boolean;
  fixedCount: number;
}

// Интерфейс совместимости с history.ts
export interface HistoryData {
  diffs: DiffRecord[];
  updates: UpdateRecord[];
  brokenChecks: BrokenCheckRecord[];
  lastStorageModified: string | null;
  lastBrokenCheck: LastBrokenCheck | null;
}

// ─────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────

/** Атомарная запись JSON через временный файл */
function writeJsonSync(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

async function writeJsonAsync(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fsp.rename(tmp, filePath);
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function deleteFileSilent(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* игнорируем */ }
}

// ─────────────────────────────────────────────
// Пути
// ─────────────────────────────────────────────

function diffMetaPath(diffId: string): string {
  return path.join(config.diffArchivesDir, `${diffId}.json`);
}

function updatePath(id: string): string {
  return path.join(config.dataDir, 'updates', `${id}.json`);
}

function checkPath(id: string): string {
  return path.join(config.dataDir, 'checks', `${id}.json`);
}

// ─────────────────────────────────────────────
// Конвертеры: JSON-файл ↔ интерфейс
// ─────────────────────────────────────────────

interface StoredDiff {
  id: string;
  createdAt: string;
  sinceTime: string | null;
  status: string;
  archivePath: string;
  archiveSize: number;
  archiveSizeHuman: string;
  filesCount: number;
  storageSnapshotTime: string;
  /** { networkId: transferredAt } */
  transfers: Record<string, string>;
}

function storedToDiffRecord(d: StoredDiff): DiffRecord {
  return {
    id: d.id,
    createdAt: d.createdAt,
    sinceTime: d.sinceTime ?? null,
    status: d.status as DiffRecord['status'],
    archivePath: d.archivePath,
    archiveSize: d.archiveSize,
    archiveSizeHuman: d.archiveSizeHuman,
    filesCount: d.filesCount,
    storageSnapshotTime: d.storageSnapshotTime,
    transfers: Object.entries(d.transfers || {}).map(([networkId, transferredAt]) => ({
      networkId,
      transferredAt,
    })),
  };
}

function diffRecordToStored(r: DiffRecord, sinceTime: string | null): StoredDiff {
  const transfers: Record<string, string> = {};
  for (const t of r.transfers) {
    transfers[t.networkId] = t.transferredAt;
  }
  return {
    id: r.id,
    createdAt: r.createdAt,
    sinceTime,
    status: r.status,
    archivePath: r.archivePath,
    archiveSize: r.archiveSize,
    archiveSizeHuman: r.archiveSizeHuman,
    filesCount: r.filesCount,
    storageSnapshotTime: r.storageSnapshotTime,
    transfers,
  };
}

// ─────────────────────────────────────────────
// DIFF
// ─────────────────────────────────────────────

/** Читает все diff из diff_archives/*.json, сортирует по createdAt desc */
async function readAllDiffs(): Promise<StoredDiff[]> {
  const dir = config.diffArchivesDir;
  let files: string[];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
  const results: StoredDiff[] = [];

  for (const file of jsonFiles) {
    const data = await readJsonOrNull<StoredDiff>(path.join(dir, file));
    if (data?.id) results.push(data);
  }

  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return results;
}

export async function getDiffs(): Promise<DiffRecord[]> {
  const stored = await readAllDiffs();
  return stored.map(storedToDiffRecord);
}

export async function getDiff(id: string): Promise<DiffRecord | null> {
  const data = await readJsonOrNull<StoredDiff>(diffMetaPath(id));
  if (!data?.id) return null;
  return storedToDiffRecord(data);
}

export async function addDiff(diff: DiffRecord): Promise<void> {
  // Вычисляем sinceTime — createdAt последнего существующего diff
  const allDiffs = await readAllDiffs();
  const sorted = allDiffs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const sinceTime = sorted.length > 0 ? sorted[sorted.length - 1].createdAt : null;

  // Помечаем все pending/partial как outdated (НЕ удаляем архивы!)
  for (const d of allDiffs) {
    if (d.status === 'pending' || d.status === 'partial') {
      await writeJsonAsync(diffMetaPath(d.id), { ...d, status: 'outdated' });
    }
  }

  // Удаляем архивы полностью перенесённых diff
  for (const d of allDiffs) {
    if (d.status === 'transferred') {
      deleteFileSilent(d.archivePath);
      deleteFileSilent(d.archivePath.replace('.tar.gz', '_files.json'));
    }
  }

  // Записываем новый diff
  const stored = diffRecordToStored(diff, sinceTime);
  await writeJsonAsync(diffMetaPath(diff.id), stored);
}

export async function getPendingDiff(): Promise<DiffRecord | null> {
  const diffs = await readAllDiffs();
  const found = diffs.find(d => d.status === 'pending' || d.status === 'partial');
  return found ? storedToDiffRecord(found) : null;
}

export async function getPendingDiffForNetwork(networkId: string): Promise<DiffRecord | null> {
  const diffs = await readAllDiffs();
  const found = diffs.find(d =>
    (d.status === 'pending' || d.status === 'partial') &&
    !Object.prototype.hasOwnProperty.call(d.transfers, networkId)
  );
  return found ? storedToDiffRecord(found) : null;
}

export async function markDiffTransferredToNetwork(
  diffId: string,
  networkId: string
): Promise<boolean> {
  const { loadNetworks } = await import('./networks');

  const raw = await readJsonOrNull<StoredDiff>(diffMetaPath(diffId));
  if (!raw?.id) return false;
  if (raw.status === 'outdated') return false;
  if (Object.prototype.hasOwnProperty.call(raw.transfers, networkId)) return false;

  raw.transfers[networkId] = new Date().toISOString();

  const allNetworks = await loadNetworks();
  const allTransferred =
    allNetworks.length > 0 &&
    allNetworks.every(n => Object.prototype.hasOwnProperty.call(raw.transfers, n.id));

  raw.status = allTransferred ? 'transferred' : 'partial';

  await writeJsonAsync(diffMetaPath(diffId), raw);
  return true;
}

export async function markDiffTransferred(id: string): Promise<boolean> {
  const raw = await readJsonOrNull<StoredDiff>(diffMetaPath(id));
  if (!raw?.id) return false;
  if (raw.status === 'transferred' || raw.status === 'outdated') return false;
  raw.status = 'transferred';
  await writeJsonAsync(diffMetaPath(id), raw);
  return true;
}

export async function markDiffOutdated(id: string): Promise<boolean> {
  const raw = await readJsonOrNull<StoredDiff>(diffMetaPath(id));
  if (!raw?.id) return false;
  raw.status = 'outdated';
  await writeJsonAsync(diffMetaPath(id), raw);
  return true;
}

/**
 * Проверяет устаревание diff: есть ли .tgz в storage с mtime > diff.createdAt?
 * Использует `find -newermt` — выходит при первом совпадении, быстро на 46K файлов.
 */
export async function checkDiffOutdated(diffId: string): Promise<boolean> {
  const raw = await readJsonOrNull<StoredDiff>(diffMetaPath(diffId));
  if (!raw?.id || raw.status !== 'pending') return false;

  // find -newermt принимает datetime в формате "YYYY-MM-DDTHH:MM:SS" на Linux
  const sinceIso = raw.createdAt.replace('Z', '').slice(0, 19);

  try {
    const result = execFileSync(
      'find',
      [config.storageDir, '-name', '*.tgz', '-newermt', sinceIso, '-print', '-quit'],
      { encoding: 'utf8', timeout: 15000 }
    );
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// UPDATES
// ─────────────────────────────────────────────

async function readAllUpdates(): Promise<UpdateRecord[]> {
  const dir = path.join(config.dataDir, 'updates');
  let files: string[];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
  const results: UpdateRecord[] = [];

  for (const file of jsonFiles) {
    const data = await readJsonOrNull<UpdateRecord>(path.join(dir, file));
    if (data?.id) results.push(data);
  }

  results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return results;
}

export async function addUpdate(update: UpdateRecord): Promise<void> {
  await writeJsonAsync(updatePath(update.id), update);
}

export async function updateUpdateRecord(id: string, data: Partial<UpdateRecord>): Promise<void> {
  const raw = await readJsonOrNull<UpdateRecord>(updatePath(id));
  if (!raw) return;
  const updated = { ...raw, ...data };
  await writeJsonAsync(updatePath(id), updated);
}

export async function getUpdates(): Promise<UpdateRecord[]> {
  return readAllUpdates();
}

export async function getRunningUpdate(): Promise<UpdateRecord | null> {
  const updates = await readAllUpdates();
  return updates.find(u => u.status === 'running') ?? null;
}

// ─────────────────────────────────────────────
// BROKEN CHECKS
// ─────────────────────────────────────────────

async function readAllChecks(): Promise<BrokenCheckRecord[]> {
  const dir = path.join(config.dataDir, 'checks');
  let files: string[];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
  const results: BrokenCheckRecord[] = [];

  for (const file of jsonFiles) {
    const data = await readJsonOrNull<BrokenCheckRecord>(path.join(dir, file));
    if (data?.id) results.push(data);
  }

  results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return results;
}

export async function addBrokenCheck(check: BrokenCheckRecord): Promise<void> {
  await writeJsonAsync(checkPath(check.id), check);
}

export async function updateBrokenCheck(id: string, data: Partial<BrokenCheckRecord>): Promise<void> {
  const raw = await readJsonOrNull<BrokenCheckRecord>(checkPath(id));
  if (!raw) return;
  const updated = { ...raw, ...data };
  await writeJsonAsync(checkPath(id), updated);
}

export async function getBrokenChecks(): Promise<BrokenCheckRecord[]> {
  return readAllChecks();
}

export async function getLastBrokenCheck(): Promise<BrokenCheckRecord | null> {
  const checks = await readAllChecks();
  return checks[0] ?? null;
}

export async function getLastBrokenCheckInfo(): Promise<LastBrokenCheck | null> {
  const checks = await readAllChecks();
  const completed = checks.find(
    c => c.status === 'completed' || c.status === 'completed_with_issues'
  );
  if (!completed || !completed.finishedAt) return null;
  return {
    checkId: completed.id,
    checkedAt: completed.finishedAt,
    totalArchives: completed.totalArchives,
    brokenArchives: completed.brokenArchives,
    fixed: completed.fixed,
    fixedCount: completed.fixedCount,
  };
}

export async function getRunningBrokenCheck(): Promise<BrokenCheckRecord | null> {
  const checks = await readAllChecks();
  return checks.find(c => c.status === 'running') ?? null;
}

// ─────────────────────────────────────────────
// Совместимость с history.ts API
// ─────────────────────────────────────────────

export async function loadHistory(): Promise<HistoryData> {
  const [diffs, updates, brokenChecks, lastBrokenCheck] = await Promise.all([
    getDiffs(),
    getUpdates(),
    getBrokenChecks(),
    getLastBrokenCheckInfo(),
  ]);
  return { diffs, updates, brokenChecks, lastStorageModified: null, lastBrokenCheck };
}

// noop — данные сохраняются автоматически при каждой операции
export async function saveHistory(_history: HistoryData): Promise<void> {}
