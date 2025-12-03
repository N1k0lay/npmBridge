import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { getDb } from './db';

// Интерфейс конфигурации
export interface AppConfig {
  readonly verdaccioHome: string;
  readonly storageDir: string;
  readonly frozenDir: string;
  readonly diffArchivesDir: string;
  readonly scriptsDir: string;
  readonly dataDir: string;
  readonly logsDir: string;
  readonly pnpmCmd: string;
  parallelJobs: number;
  modifiedMinutes: number;
}

// Конфигурация из переменных окружения
export const config: AppConfig = {
  verdaccioHome: process.env.VERDACCIO_HOME || '/home/npm/verdaccio',
  storageDir: process.env.STORAGE_DIR || '/home/npm/verdaccio/storage',
  frozenDir: process.env.FROZEN_DIR || '/home/npm/verdaccio/frozen',
  diffArchivesDir: process.env.DIFF_ARCHIVES_DIR || '/home/npm/verdaccio/diff_archives',
  scriptsDir: process.env.SCRIPTS_DIR || '/home/npm/verdaccio/scripts',
  dataDir: process.env.DATA_DIR || '/home/npm/verdaccio/data',
  logsDir: process.env.LOGS_DIR || '/home/npm/verdaccio/logs',
  pnpmCmd: process.env.PNPM_CMD || 'pnpm',
  parallelJobs: parseInt(process.env.PARALLEL_JOBS || '40', 10),
  modifiedMinutes: parseInt(process.env.MODIFIED_MINUTES || '2880', 10),
};

// Хранилище активных процессов
const activeProcesses: Map<string, ChildProcess> = new Map();

export interface TaskResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface TaskProgress {
  current: number;
  total: number;
  percent: number;
  currentPackage?: string;
  currentFile?: string;
  success?: number;
  failed?: number;
  broken?: number;
  phase?: string;
  updatedAt: string;
}

export interface TaskStatus {
  status: 'running' | 'completed' | 'failed' | 'completed_with_errors' | 'completed_with_issues';
  message: string;
  updatedAt: string;
}

/**
 * Запуск Python скрипта с переменными окружения
 * Python скрипты по-прежнему пишут в JSON файлы для прогресса/статуса,
 * но мы их читаем и можем также кешировать в SQLite
 */
export async function runScript(
  scriptName: string,
  taskId: string,
  extraEnv: Record<string, string> = {}
): Promise<TaskResult> {
  const scriptPath = path.join(config.scriptsDir, scriptName);
  
  // Создаём директории для логов если их нет
  await fs.mkdir(config.logsDir, { recursive: true });
  await fs.mkdir(config.dataDir, { recursive: true });
  
  const logFile = path.join(config.logsDir, `${taskId}.log`);
  const progressFile = path.join(config.dataDir, `${taskId}_progress.json`);
  const statusFile = path.join(config.dataDir, `${taskId}_status.json`);
  
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VERDACCIO_HOME: config.verdaccioHome,
    STORAGE_DIR: config.storageDir,
    FROZEN_DIR: config.frozenDir,
    DIFF_ARCHIVES_DIR: config.diffArchivesDir,
    PNPM_CMD: config.pnpmCmd,
    PARALLEL_JOBS: config.parallelJobs.toString(),
    MODIFIED_MINUTES: config.modifiedMinutes.toString(),
    PROGRESS_FILE: progressFile,
    STATUS_FILE: statusFile,
    LOG_FILE: logFile,
    ...extraEnv,
  };
  
  return new Promise((resolve) => {
    const proc = spawn('python3', [scriptPath], {
      env,
      cwd: config.verdaccioHome,
    });
    
    activeProcesses.set(taskId, proc);
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code: number | null) => {
      activeProcesses.delete(taskId);
      
      // Очищаем временные данные прогресса из SQLite
      cleanupTaskData(taskId);
      
      resolve({
        success: code === 0,
        output: stdout,
        error: stderr || undefined,
      });
    });
    
    proc.on('error', (err: Error) => {
      activeProcesses.delete(taskId);
      cleanupTaskData(taskId);
      resolve({
        success: false,
        output: stdout,
        error: err.message,
      });
    });
  });
}

/**
 * Очистка временных данных задачи
 */
function cleanupTaskData(taskId: string): void {
  try {
    const db = getDb();
    db.prepare('DELETE FROM task_progress WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM task_status WHERE task_id = ?').run(taskId);
  } catch {
    // Игнорируем ошибки очистки
  }
}

/**
 * Остановка задачи
 */
export function stopTask(taskId: string): boolean {
  const proc = activeProcesses.get(taskId);
  if (proc) {
    proc.kill('SIGTERM');
    activeProcesses.delete(taskId);
    cleanupTaskData(taskId);
    return true;
  }
  return false;
}

/**
 * Проверка, запущена ли задача
 */
export function isTaskRunning(taskId: string): boolean {
  return activeProcesses.has(taskId);
}

/**
 * Получение прогресса задачи
 * Сначала пробуем прочитать из JSON файла (Python туда пишет),
 * если не получилось — из SQLite кеша
 */
export async function getTaskProgress(taskId: string): Promise<TaskProgress | null> {
  const progressFile = path.join(config.dataDir, `${taskId}_progress.json`);
  
  try {
    const data = await fs.readFile(progressFile, 'utf-8');
    const progress = JSON.parse(data) as TaskProgress;
    
    // Кешируем в SQLite для надёжности
    cacheTaskProgress(taskId, progress);
    
    return progress;
  } catch {
    // Пробуем из SQLite кеша
    return getTaskProgressFromDb(taskId);
  }
}

/**
 * Кеширование прогресса в SQLite
 */
function cacheTaskProgress(taskId: string, progress: TaskProgress): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO task_progress 
      (task_id, current_val, total, percent, current_package, current_file, success, failed, broken, phase, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      progress.current || 0,
      progress.total || 0,
      progress.percent || 0,
      progress.currentPackage || null,
      progress.currentFile || null,
      progress.success || 0,
      progress.failed || 0,
      progress.broken || 0,
      progress.phase || null,
      progress.updatedAt
    );
  } catch {
    // Игнорируем ошибки кеширования
  }
}

/**
 * Получение прогресса из SQLite
 */
function getTaskProgressFromDb(taskId: string): TaskProgress | null {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT current_val, total, percent, current_package, current_file, success, failed, broken, phase, updated_at
      FROM task_progress WHERE task_id = ?
    `).get(taskId) as {
      current_val: number;
      total: number;
      percent: number;
      current_package: string | null;
      current_file: string | null;
      success: number;
      failed: number;
      broken: number;
      phase: string | null;
      updated_at: string;
    } | undefined;
    
    if (!row) return null;
    
    return {
      current: row.current_val,
      total: row.total,
      percent: row.percent,
      currentPackage: row.current_package || undefined,
      currentFile: row.current_file || undefined,
      success: row.success || undefined,
      failed: row.failed || undefined,
      broken: row.broken || undefined,
      phase: row.phase || undefined,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

/**
 * Получение статуса задачи
 */
export async function getTaskStatus(taskId: string): Promise<TaskStatus | null> {
  const statusFile = path.join(config.dataDir, `${taskId}_status.json`);
  
  try {
    const data = await fs.readFile(statusFile, 'utf-8');
    const status = JSON.parse(data) as TaskStatus;
    
    // Кешируем в SQLite
    cacheTaskStatus(taskId, status);
    
    return status;
  } catch {
    return getTaskStatusFromDb(taskId);
  }
}

/**
 * Кеширование статуса в SQLite
 */
function cacheTaskStatus(taskId: string, status: TaskStatus): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO task_status (task_id, status, message, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(taskId, status.status, status.message || '', status.updatedAt);
  } catch {
    // Игнорируем
  }
}

/**
 * Получение статуса из SQLite
 */
function getTaskStatusFromDb(taskId: string): TaskStatus | null {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT status, message, updated_at FROM task_status WHERE task_id = ?
    `).get(taskId) as { status: string; message: string; updated_at: string } | undefined;
    
    if (!row) return null;
    
    return {
      status: row.status as TaskStatus['status'],
      message: row.message,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

/**
 * Получение логов задачи
 */
export async function getTaskLogs(taskId: string, tail?: number): Promise<string> {
  const logFile = path.join(config.logsDir, `${taskId}.log`);
  try {
    const content = await fs.readFile(logFile, 'utf-8');
    if (tail) {
      const lines = content.split('\n');
      return lines.slice(-tail).join('\n');
    }
    return content;
  } catch {
    return '';
  }
}
