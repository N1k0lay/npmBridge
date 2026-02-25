import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

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
  errors?: Array<{ package: string; error: string }>;
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
  extraEnv: Record<string, string> = {},
  args: string[] = []
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
    const proc = spawn('python3', [scriptPath, ...args], {
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
      
      resolve({
        success: code === 0,
        output: stdout,
        error: stderr || undefined,
      });
    });
    
    proc.on('error', (err: Error) => {
      activeProcesses.delete(taskId);
      resolve({
        success: false,
        output: stdout,
        error: err.message,
      });
    });
  });
}

/**
 * Остановка задачи
 */
export function stopTask(taskId: string): boolean {
  const proc = activeProcesses.get(taskId);
  if (proc) {
    proc.kill('SIGTERM');
    activeProcesses.delete(taskId);
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
 * Получение прогресса задачи из JSON файла (Python туда пишет)
 */
export async function getTaskProgress(taskId: string): Promise<TaskProgress | null> {
  const progressFile = path.join(config.dataDir, `${taskId}_progress.json`);
  try {
    const data = await fs.readFile(progressFile, 'utf-8');
    return JSON.parse(data) as TaskProgress;
  } catch {
    return null;
  }
}

/**
 * Получение статуса задачи из JSON файла
 */
export async function getTaskStatus(taskId: string): Promise<TaskStatus | null> {
  const statusFile = path.join(config.dataDir, `${taskId}_status.json`);
  try {
    const data = await fs.readFile(statusFile, 'utf-8');
    return JSON.parse(data) as TaskStatus;
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
