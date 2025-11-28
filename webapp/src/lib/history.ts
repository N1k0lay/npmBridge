import fs from 'fs/promises';
import path from 'path';
import { config } from './scripts';
import { getNetworkDiffArchivesDir } from './networks';

/**
 * Информация о переносе diff в сеть
 */
export interface DiffNetworkTransfer {
  networkId: string;
  transferredAt: string;
}

export interface DiffRecord {
  id: string;
  createdAt: string;
  status: 'pending' | 'transferred' | 'outdated' | 'partial';
  // В какие сети уже перенесён
  transfers: DiffNetworkTransfer[];
  archivePath: string;
  archiveSize: number;
  archiveSizeHuman: string;
  filesCount: number;
  files: string[];
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
  // Связанная проверка архивов
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
  // Был ли запущен автоматически после обновления
  triggeredByUpdate?: string;
}

/**
 * Информация о последней проверке архивов
 */
export interface LastBrokenCheck {
  checkId: string;
  checkedAt: string;
  totalArchives: number;
  brokenArchives: number;
  fixed: boolean;
  fixedCount: number;
}

export interface HistoryData {
  diffs: DiffRecord[];
  updates: UpdateRecord[];
  brokenChecks: BrokenCheckRecord[];
  lastStorageModified: string | null;
  lastBrokenCheck: LastBrokenCheck | null;
}

const HISTORY_FILE = 'history.json';

async function getHistoryPath(): Promise<string> {
  await fs.mkdir(config.dataDir, { recursive: true });
  return path.join(config.dataDir, HISTORY_FILE);
}

export async function loadHistory(): Promise<HistoryData> {
  try {
    const historyPath = await getHistoryPath();
    const data = await fs.readFile(historyPath, 'utf-8');
    const parsed = JSON.parse(data);
    // Миграция старых данных
    return {
      diffs: parsed.diffs || [],
      updates: parsed.updates || [],
      brokenChecks: parsed.brokenChecks || [],
      lastStorageModified: parsed.lastStorageModified || null,
      lastBrokenCheck: parsed.lastBrokenCheck || null,
    };
  } catch {
    return {
      diffs: [],
      updates: [],
      brokenChecks: [],
      lastStorageModified: null,
      lastBrokenCheck: null,
    };
  }
}

export async function saveHistory(history: HistoryData): Promise<void> {
  const historyPath = await getHistoryPath();
  await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
}

// ==================== DIFF ====================

/**
 * Удаляет файл архива diff если он существует
 */
async function deleteArchiveFile(archivePath: string): Promise<void> {
  try {
    await fs.unlink(archivePath);
  } catch {
    // Файл уже удалён или не существует — игнорируем
  }
  
  // Также удаляем файл списка файлов
  const filesListPath = archivePath.replace('.tar.gz', '_files.txt');
  try {
    await fs.unlink(filesListPath);
  } catch {
    // Игнорируем
  }
}

export async function addDiff(diff: DiffRecord): Promise<void> {
  const history = await loadHistory();
  
  // Удаляем архивы всех pending diff и помечаем их как outdated
  for (const d of history.diffs) {
    if (d.status === 'pending') {
      // Удаляем старый архив
      await deleteArchiveFile(d.archivePath);
      d.status = 'outdated';
    }
  }
  
  history.diffs.unshift(diff);
  await saveHistory(history);
}

export async function getDiffs(): Promise<DiffRecord[]> {
  const history = await loadHistory();
  return history.diffs;
}

export async function getDiff(id: string): Promise<DiffRecord | null> {
  const history = await loadHistory();
  return history.diffs.find(d => d.id === id) || null;
}

export async function getPendingDiff(): Promise<DiffRecord | null> {
  const history = await loadHistory();
  return history.diffs.find(d => d.status === 'pending' || d.status === 'partial') || null;
}

/**
 * Получение pending diff для конкретной сети
 * С новой концепцией: возвращает любой pending/partial diff, в который ещё не перенесён для этой сети
 */
export async function getPendingDiffForNetwork(networkId: string): Promise<DiffRecord | null> {
  const history = await loadHistory();
  return history.diffs.find(d => 
    (d.status === 'pending' || d.status === 'partial') && 
    !d.transfers?.some(t => t.networkId === networkId)
  ) || null;
}

/**
 * Отметить diff как перенесённый в конкретную сеть
 */
export async function markDiffTransferredToNetwork(
  diffId: string, 
  networkId: string
): Promise<boolean> {
  const { loadNetworks } = await import('./networks');
  
  const history = await loadHistory();
  const diff = history.diffs.find(d => d.id === diffId);
  
  if (!diff || diff.status === 'outdated') {
    return false;
  }
  
  // Инициализируем transfers если не существует
  if (!diff.transfers) {
    diff.transfers = [];
  }
  
  // Проверяем, не был ли уже перенесён
  if (diff.transfers.some(t => t.networkId === networkId)) {
    return false;
  }
  
  // Добавляем запись о переносе
  diff.transfers.push({
    networkId,
    transferredAt: new Date().toISOString(),
  });
  
  // Проверяем, перенесён ли во ВСЕ существующие сети
  const allNetworks = await loadNetworks();
  const allNetworkIds = new Set(allNetworks.map(n => n.id));
  const transferredNetworkIds = new Set(diff.transfers.map(t => t.networkId));
  
  // Все сети отмечены?
  const allTransferred = allNetworks.length > 0 && 
    allNetworks.every(n => transferredNetworkIds.has(n.id));
  
  if (allTransferred) {
    diff.status = 'transferred';
  } else if (diff.transfers.length > 0) {
    diff.status = 'partial';
  }
  
  await saveHistory(history);
  return true;
}

/**
 * Отметить diff как полностью перенесённый
 */
export async function markDiffTransferred(id: string): Promise<boolean> {
  const history = await loadHistory();
  const diff = history.diffs.find(d => d.id === id);
  
  if (!diff || diff.status === 'transferred' || diff.status === 'outdated') {
    return false;
  }
  
  diff.status = 'transferred';
  
  await saveHistory(history);
  return true;
}

export async function markDiffOutdated(id: string): Promise<boolean> {
  const history = await loadHistory();
  const diff = history.diffs.find(d => d.id === id);
  
  if (!diff) {
    return false;
  }
  
  // Удаляем архив если diff был pending
  if (diff.status === 'pending') {
    await deleteArchiveFile(diff.archivePath);
  }
  
  diff.status = 'outdated';
  await saveHistory(history);
  return true;
}

/**
 * Проверяет, есть ли новые файлы в storage после создания diff
 */
export async function checkDiffOutdated(diffId: string): Promise<boolean> {
  const history = await loadHistory();
  const diff = history.diffs.find(d => d.id === diffId);
  
  if (!diff || diff.status !== 'pending') {
    return false;
  }
  
  // Проверяем, были ли обновления после создания diff
  const diffTime = new Date(diff.storageSnapshotTime).getTime();
  
  for (const update of history.updates) {
    if (update.finishedAt) {
      const updateTime = new Date(update.finishedAt).getTime();
      if (updateTime > diffTime && update.status !== 'failed') {
        return true;
      }
    }
  }
  
  return false;
}

// ==================== UPDATES ====================

export async function addUpdate(update: UpdateRecord): Promise<void> {
  const history = await loadHistory();
  history.updates.unshift(update);
  
  // Помечаем pending diff как outdated если обновление завершено успешно
  if (update.status === 'completed' || update.status === 'completed_with_errors') {
    history.diffs = history.diffs.map(d => 
      d.status === 'pending' ? { ...d, status: 'outdated' as const } : d
    );
  }
  
  await saveHistory(history);
}

export async function updateUpdateRecord(id: string, data: Partial<UpdateRecord>): Promise<void> {
  const history = await loadHistory();
  const idx = history.updates.findIndex(u => u.id === id);
  
  if (idx !== -1) {
    history.updates[idx] = { ...history.updates[idx], ...data };
    
    // Помечаем pending diff как outdated если обновление завершено успешно
    if (data.status === 'completed' || data.status === 'completed_with_errors') {
      history.diffs = history.diffs.map(d => 
        d.status === 'pending' ? { ...d, status: 'outdated' as const } : d
      );
    }
    
    await saveHistory(history);
  }
}

export async function getUpdates(): Promise<UpdateRecord[]> {
  const history = await loadHistory();
  return history.updates;
}

export async function getRunningUpdate(): Promise<UpdateRecord | null> {
  const history = await loadHistory();
  return history.updates.find(u => u.status === 'running') || null;
}

// ==================== BROKEN CHECKS ====================

export async function addBrokenCheck(check: BrokenCheckRecord): Promise<void> {
  const history = await loadHistory();
  history.brokenChecks.unshift(check);
  await saveHistory(history);
}

export async function updateBrokenCheck(id: string, data: Partial<BrokenCheckRecord>): Promise<void> {
  const history = await loadHistory();
  const idx = history.brokenChecks.findIndex(c => c.id === id);
  
  if (idx !== -1) {
    history.brokenChecks[idx] = { ...history.brokenChecks[idx], ...data };
    
    // Обновляем lastBrokenCheck если проверка завершена
    const check = history.brokenChecks[idx];
    if (check.status === 'completed' || check.status === 'completed_with_issues') {
      history.lastBrokenCheck = {
        checkId: check.id,
        checkedAt: check.finishedAt || new Date().toISOString(),
        totalArchives: check.totalArchives,
        brokenArchives: check.brokenArchives,
        fixed: check.fixed,
        fixedCount: check.fixedCount || 0,
      };
    }
    
    await saveHistory(history);
  }
}

export async function getBrokenChecks(): Promise<BrokenCheckRecord[]> {
  const history = await loadHistory();
  return history.brokenChecks;
}

export async function getLastBrokenCheck(): Promise<BrokenCheckRecord | null> {
  const history = await loadHistory();
  return history.brokenChecks[0] || null;
}

export async function getLastBrokenCheckInfo(): Promise<LastBrokenCheck | null> {
  const history = await loadHistory();
  return history.lastBrokenCheck;
}

export async function getRunningBrokenCheck(): Promise<BrokenCheckRecord | null> {
  const history = await loadHistory();
  return history.brokenChecks.find(c => c.status === 'running') || null;
}
