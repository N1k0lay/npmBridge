import { getDb } from './db';
import fs from 'fs';

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
  type: 'full' | 'recent' | 'single';
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'completed' | 'failed' | 'completed_with_errors';
  packagesTotal: number;
  packagesSuccess: number;
  packagesFailed: number;
  logFile: string;
  brokenCheckId?: string;
  packageName?: string; // Для type='single'
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

// ==================== Helper Functions ====================

function deleteArchiveFile(archivePath: string): void {
  try {
    fs.unlinkSync(archivePath);
  } catch {
    // Файл уже удалён или не существует
  }
  
  const filesListPath = archivePath.replace('.tar.gz', '_files.txt');
  try {
    fs.unlinkSync(filesListPath);
  } catch {
    // Игнорируем
  }
}

// ==================== DIFF ====================

export async function addDiff(diff: DiffRecord): Promise<void> {
  const db = getDb();
  
  db.transaction(() => {
    // Помечаем все pending diff как outdated (но НЕ удаляем их архивы!)
    // Архивы нужны для отстающих сетей, которым ещё нужно получить эти diff
    db.prepare(`UPDATE diffs SET status = 'outdated' WHERE status = 'pending'`).run();
    
    // Удаляем архивы только полностью перенесённых diff (transferred)
    // Они уже не нужны — все сети их получили
    const transferredDiffs = db.prepare(`
      SELECT id, archive_path FROM diffs WHERE status = 'transferred'
    `).all() as Array<{ id: string; archive_path: string }>;
    
    for (const d of transferredDiffs) {
      deleteArchiveFile(d.archive_path);
    }
    
    // Добавляем новый diff
    db.prepare(`
      INSERT INTO diffs (id, created_at, status, archive_path, archive_size, archive_size_human, files_count, files, storage_snapshot_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      diff.id,
      diff.createdAt,
      diff.status,
      diff.archivePath,
      diff.archiveSize,
      diff.archiveSizeHuman,
      diff.filesCount,
      JSON.stringify(diff.files),
      diff.storageSnapshotTime
    );
    
    // Добавляем transfers если есть
    if (diff.transfers && diff.transfers.length > 0) {
      const insertTransfer = db.prepare(`
        INSERT INTO diff_transfers (diff_id, network_id, transferred_at) VALUES (?, ?, ?)
      `);
      for (const t of diff.transfers) {
        insertTransfer.run(diff.id, t.networkId, t.transferredAt);
      }
    }
  })();
}

export async function getDiffs(): Promise<DiffRecord[]> {
  const db = getDb();
  
  const rows = db.prepare(`
    SELECT id, created_at, status, archive_path, archive_size, archive_size_human, files_count, files, storage_snapshot_time
    FROM diffs ORDER BY created_at DESC
  `).all() as Array<{
    id: string;
    created_at: string;
    status: string;
    archive_path: string;
    archive_size: number;
    archive_size_human: string;
    files_count: number;
    files: string;
    storage_snapshot_time: string;
  }>;
  
  return rows.map(row => {
    const transfers = db.prepare(`
      SELECT network_id, transferred_at FROM diff_transfers WHERE diff_id = ?
    `).all(row.id) as Array<{ network_id: string; transferred_at: string }>;
    
    return {
      id: row.id,
      createdAt: row.created_at,
      status: row.status as DiffRecord['status'],
      transfers: transfers.map(t => ({
        networkId: t.network_id,
        transferredAt: t.transferred_at,
      })),
      archivePath: row.archive_path,
      archiveSize: row.archive_size,
      archiveSizeHuman: row.archive_size_human,
      filesCount: row.files_count,
      files: JSON.parse(row.files || '[]'),
      storageSnapshotTime: row.storage_snapshot_time,
    };
  });
}

export async function getDiff(id: string): Promise<DiffRecord | null> {
  const db = getDb();
  
  const row = db.prepare(`
    SELECT id, created_at, status, archive_path, archive_size, archive_size_human, files_count, files, storage_snapshot_time
    FROM diffs WHERE id = ?
  `).get(id) as {
    id: string;
    created_at: string;
    status: string;
    archive_path: string;
    archive_size: number;
    archive_size_human: string;
    files_count: number;
    files: string;
    storage_snapshot_time: string;
  } | undefined;
  
  if (!row) return null;
  
  const transfers = db.prepare(`
    SELECT network_id, transferred_at FROM diff_transfers WHERE diff_id = ?
  `).all(row.id) as Array<{ network_id: string; transferred_at: string }>;
  
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status as DiffRecord['status'],
    transfers: transfers.map(t => ({
      networkId: t.network_id,
      transferredAt: t.transferred_at,
    })),
    archivePath: row.archive_path,
    archiveSize: row.archive_size,
    archiveSizeHuman: row.archive_size_human,
    filesCount: row.files_count,
    files: JSON.parse(row.files || '[]'),
    storageSnapshotTime: row.storage_snapshot_time,
  };
}

export async function getPendingDiff(): Promise<DiffRecord | null> {
  const db = getDb();
  
  const row = db.prepare(`
    SELECT id FROM diffs WHERE status IN ('pending', 'partial') ORDER BY created_at DESC LIMIT 1
  `).get() as { id: string } | undefined;
  
  if (!row) return null;
  return getDiff(row.id);
}

export async function getPendingDiffForNetwork(networkId: string): Promise<DiffRecord | null> {
  const db = getDb();
  
  const row = db.prepare(`
    SELECT d.id FROM diffs d
    WHERE d.status IN ('pending', 'partial')
    AND NOT EXISTS (
      SELECT 1 FROM diff_transfers t WHERE t.diff_id = d.id AND t.network_id = ?
    )
    ORDER BY d.created_at DESC LIMIT 1
  `).get(networkId) as { id: string } | undefined;
  
  if (!row) return null;
  return getDiff(row.id);
}

export async function markDiffTransferredToNetwork(
  diffId: string, 
  networkId: string
): Promise<boolean> {
  const { loadNetworks } = await import('./networks');
  const db = getDb();
  
  const diff = await getDiff(diffId);
  if (!diff || diff.status === 'outdated') {
    return false;
  }
  
  // Проверяем, не был ли уже перенесён
  const exists = db.prepare(`
    SELECT 1 FROM diff_transfers WHERE diff_id = ? AND network_id = ?
  `).get(diffId, networkId);
  
  if (exists) {
    return false;
  }
  
  db.transaction(() => {
    // Добавляем запись о переносе
    db.prepare(`
      INSERT INTO diff_transfers (diff_id, network_id, transferred_at) VALUES (?, ?, ?)
    `).run(diffId, networkId, new Date().toISOString());
  })();
  
  // Проверяем, перенесён ли во ВСЕ сети
  const allNetworks = await loadNetworks();
  const transferCount = db.prepare(`
    SELECT COUNT(*) as count FROM diff_transfers WHERE diff_id = ?
  `).get(diffId) as { count: number };
  
  const allTransferred = allNetworks.length > 0 && transferCount.count >= allNetworks.length;
  
  const newStatus = allTransferred ? 'transferred' : 'partial';
  db.prepare(`UPDATE diffs SET status = ? WHERE id = ?`).run(newStatus, diffId);
  
  return true;
}

export async function markDiffTransferred(id: string): Promise<boolean> {
  const db = getDb();
  
  const result = db.prepare(`
    UPDATE diffs SET status = 'transferred' 
    WHERE id = ? AND status NOT IN ('transferred', 'outdated')
  `).run(id);
  
  return result.changes > 0;
}

export async function markDiffOutdated(id: string): Promise<boolean> {
  const db = getDb();
  
  // НЕ удаляем архив при пометке outdated
  // Архив может понадобиться отстающим сетям
  // Архивы удаляются только при создании нового diff для transferred записей
  
  const result = db.prepare(`UPDATE diffs SET status = 'outdated' WHERE id = ?`).run(id);
  return result.changes > 0;
}

export async function checkDiffOutdated(diffId: string): Promise<boolean> {
  const db = getDb();
  
  const diff = await getDiff(diffId);
  if (!diff || diff.status !== 'pending') {
    return false;
  }
  
  const diffTime = new Date(diff.storageSnapshotTime).toISOString();
  
  const hasNewerUpdate = db.prepare(`
    SELECT 1 FROM updates 
    WHERE finished_at > ? AND status NOT IN ('failed', 'running')
    LIMIT 1
  `).get(diffTime);
  
  return !!hasNewerUpdate;
}

// ==================== UPDATES ====================

export async function addUpdate(update: UpdateRecord): Promise<void> {
  const db = getDb();
  
  db.transaction(() => {
    db.prepare(`
      INSERT INTO updates (id, type, started_at, finished_at, status, packages_total, packages_success, packages_failed, log_file, broken_check_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      update.id,
      update.type,
      update.startedAt,
      update.finishedAt,
      update.status,
      update.packagesTotal,
      update.packagesSuccess,
      update.packagesFailed,
      update.logFile,
      update.brokenCheckId || null
    );
    
    // Помечаем pending diff как outdated если обновление завершено успешно
    if (update.status === 'completed' || update.status === 'completed_with_errors') {
      db.prepare(`UPDATE diffs SET status = 'outdated' WHERE status = 'pending'`).run();
    }
  })();
}

export async function updateUpdateRecord(id: string, data: Partial<UpdateRecord>): Promise<void> {
  const db = getDb();
  
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (data.finishedAt !== undefined) {
    setClauses.push('finished_at = ?');
    values.push(data.finishedAt);
  }
  if (data.status !== undefined) {
    setClauses.push('status = ?');
    values.push(data.status);
  }
  if (data.packagesTotal !== undefined) {
    setClauses.push('packages_total = ?');
    values.push(data.packagesTotal);
  }
  if (data.packagesSuccess !== undefined) {
    setClauses.push('packages_success = ?');
    values.push(data.packagesSuccess);
  }
  if (data.packagesFailed !== undefined) {
    setClauses.push('packages_failed = ?');
    values.push(data.packagesFailed);
  }
  if (data.brokenCheckId !== undefined) {
    setClauses.push('broken_check_id = ?');
    values.push(data.brokenCheckId || null);
  }
  
  if (setClauses.length === 0) return;
  
  values.push(id);
  
  db.transaction(() => {
    db.prepare(`UPDATE updates SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    
    // Помечаем pending diff как outdated если обновление завершено успешно
    if (data.status === 'completed' || data.status === 'completed_with_errors') {
      db.prepare(`UPDATE diffs SET status = 'outdated' WHERE status = 'pending'`).run();
    }
  })();
}

export async function getUpdates(): Promise<UpdateRecord[]> {
  const db = getDb();
  
  const rows = db.prepare(`
    SELECT id, type, started_at, finished_at, status, packages_total, packages_success, packages_failed, log_file, broken_check_id
    FROM updates ORDER BY started_at DESC
  `).all() as Array<{
    id: string;
    type: string;
    started_at: string;
    finished_at: string | null;
    status: string;
    packages_total: number;
    packages_success: number;
    packages_failed: number;
    log_file: string;
    broken_check_id: string | null;
  }>;
  
  return rows.map(row => ({
    id: row.id,
    type: row.type as 'full' | 'recent',
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as UpdateRecord['status'],
    packagesTotal: row.packages_total,
    packagesSuccess: row.packages_success,
    packagesFailed: row.packages_failed,
    logFile: row.log_file,
    brokenCheckId: row.broken_check_id || undefined,
  }));
}

export async function getRunningUpdate(): Promise<UpdateRecord | null> {
  const db = getDb();
  
  const row = db.prepare(`
    SELECT id, type, started_at, finished_at, status, packages_total, packages_success, packages_failed, log_file, broken_check_id
    FROM updates WHERE status = 'running' LIMIT 1
  `).get() as {
    id: string;
    type: string;
    started_at: string;
    finished_at: string | null;
    status: string;
    packages_total: number;
    packages_success: number;
    packages_failed: number;
    log_file: string;
    broken_check_id: string | null;
  } | undefined;
  
  if (!row) return null;
  
  return {
    id: row.id,
    type: row.type as 'full' | 'recent',
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as UpdateRecord['status'],
    packagesTotal: row.packages_total,
    packagesSuccess: row.packages_success,
    packagesFailed: row.packages_failed,
    logFile: row.log_file,
    brokenCheckId: row.broken_check_id || undefined,
  };
}

// ==================== BROKEN CHECKS ====================

export async function addBrokenCheck(check: BrokenCheckRecord): Promise<void> {
  const db = getDb();
  
  db.prepare(`
    INSERT INTO broken_checks (id, started_at, finished_at, status, total_archives, broken_archives, broken_files, fixed, fixed_count, triggered_by_update)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    check.id,
    check.startedAt,
    check.finishedAt,
    check.status,
    check.totalArchives,
    check.brokenArchives,
    JSON.stringify(check.brokenFiles),
    check.fixed ? 1 : 0,
    check.fixedCount,
    check.triggeredByUpdate || null
  );
}

export async function updateBrokenCheck(id: string, data: Partial<BrokenCheckRecord>): Promise<void> {
  const db = getDb();
  
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (data.finishedAt !== undefined) {
    setClauses.push('finished_at = ?');
    values.push(data.finishedAt);
  }
  if (data.status !== undefined) {
    setClauses.push('status = ?');
    values.push(data.status);
  }
  if (data.totalArchives !== undefined) {
    setClauses.push('total_archives = ?');
    values.push(data.totalArchives);
  }
  if (data.brokenArchives !== undefined) {
    setClauses.push('broken_archives = ?');
    values.push(data.brokenArchives);
  }
  if (data.brokenFiles !== undefined) {
    setClauses.push('broken_files = ?');
    values.push(JSON.stringify(data.brokenFiles));
  }
  if (data.fixed !== undefined) {
    setClauses.push('fixed = ?');
    values.push(data.fixed ? 1 : 0);
  }
  if (data.fixedCount !== undefined) {
    setClauses.push('fixed_count = ?');
    values.push(data.fixedCount);
  }
  
  if (setClauses.length === 0) return;
  
  values.push(id);
  db.prepare(`UPDATE broken_checks SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

export async function getBrokenChecks(): Promise<BrokenCheckRecord[]> {
  const db = getDb();
  
  const rows = db.prepare(`
    SELECT id, started_at, finished_at, status, total_archives, broken_archives, broken_files, fixed, fixed_count, triggered_by_update
    FROM broken_checks ORDER BY started_at DESC
  `).all() as Array<{
    id: string;
    started_at: string;
    finished_at: string | null;
    status: string;
    total_archives: number;
    broken_archives: number;
    broken_files: string;
    fixed: number;
    fixed_count: number;
    triggered_by_update: string | null;
  }>;
  
  return rows.map(row => ({
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as BrokenCheckRecord['status'],
    totalArchives: row.total_archives,
    brokenArchives: row.broken_archives,
    brokenFiles: JSON.parse(row.broken_files || '[]'),
    fixed: row.fixed === 1,
    fixedCount: row.fixed_count,
    triggeredByUpdate: row.triggered_by_update || undefined,
  }));
}

export async function getLastBrokenCheck(): Promise<BrokenCheckRecord | null> {
  const checks = await getBrokenChecks();
  return checks[0] || null;
}

export async function getLastBrokenCheckInfo(): Promise<LastBrokenCheck | null> {
  const db = getDb();
  
  const row = db.prepare(`
    SELECT id, finished_at, total_archives, broken_archives, fixed, fixed_count
    FROM broken_checks 
    WHERE status IN ('completed', 'completed_with_issues')
    ORDER BY finished_at DESC LIMIT 1
  `).get() as {
    id: string;
    finished_at: string;
    total_archives: number;
    broken_archives: number;
    fixed: number;
    fixed_count: number;
  } | undefined;
  
  if (!row) return null;
  
  return {
    checkId: row.id,
    checkedAt: row.finished_at,
    totalArchives: row.total_archives,
    brokenArchives: row.broken_archives,
    fixed: row.fixed === 1,
    fixedCount: row.fixed_count,
  };
}

export async function getRunningBrokenCheck(): Promise<BrokenCheckRecord | null> {
  const db = getDb();
  
  const row = db.prepare(`
    SELECT id, started_at, finished_at, status, total_archives, broken_archives, broken_files, fixed, fixed_count, triggered_by_update
    FROM broken_checks WHERE status = 'running' LIMIT 1
  `).get() as {
    id: string;
    started_at: string;
    finished_at: string | null;
    status: string;
    total_archives: number;
    broken_archives: number;
    broken_files: string;
    fixed: number;
    fixed_count: number;
    triggered_by_update: string | null;
  } | undefined;
  
  if (!row) return null;
  
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as BrokenCheckRecord['status'],
    totalArchives: row.total_archives,
    brokenArchives: row.broken_archives,
    brokenFiles: JSON.parse(row.broken_files || '[]'),
    fixed: row.fixed === 1,
    fixedCount: row.fixed_count,
    triggeredByUpdate: row.triggered_by_update || undefined,
  };
}

// ==================== Совместимость со старым API ====================

export interface HistoryData {
  diffs: DiffRecord[];
  updates: UpdateRecord[];
  brokenChecks: BrokenCheckRecord[];
  lastStorageModified: string | null;
  lastBrokenCheck: LastBrokenCheck | null;
}

export async function loadHistory(): Promise<HistoryData> {
  const [diffs, updates, brokenChecks, lastBrokenCheck] = await Promise.all([
    getDiffs(),
    getUpdates(),
    getBrokenChecks(),
    getLastBrokenCheckInfo(),
  ]);
  
  return {
    diffs,
    updates,
    brokenChecks,
    lastStorageModified: null, // deprecated
    lastBrokenCheck,
  };
}

// Заглушка для совместимости — данные сохраняются автоматически
export async function saveHistory(_history: HistoryData): Promise<void> {
  // No-op: SQLite автоматически сохраняет данные
}
