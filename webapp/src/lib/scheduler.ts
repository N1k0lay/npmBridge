import { refreshStorageStats } from './storage';

let schedulerInterval: NodeJS.Timeout | null = null;
let watcherActive = false;
let lastIndexedAt: number | null = null;

// Интервал переиндексации (по умолчанию 30 минут)
const REINDEX_INTERVAL_MS = parseInt(process.env.REINDEX_INTERVAL_MS || '1800000', 10);

// Минимальный интервал между переиндексациями (5 минут)
const MIN_REINDEX_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Проверка, нужна ли переиндексация
 */
function shouldReindex(): boolean {
  if (!lastIndexedAt) return true;
  return (Date.now() - lastIndexedAt) > MIN_REINDEX_INTERVAL_MS;
}

/**
 * Выполнение переиндексации
 */
async function performReindex(): Promise<void> {
  if (!shouldReindex()) {
    console.log('[Scheduler] Skipping reindex - too soon since last index');
    return;
  }
  
  console.log('[Scheduler] Starting scheduled reindex...');
  
  try {
    const startTime = Date.now();
    
    // Обновляем статистику хранилища
    await refreshStorageStats();
    
    lastIndexedAt = Date.now();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Scheduler] Stats refreshed in ${duration}s`);
  } catch (error) {
    console.error('[Scheduler] Reindex failed:', error);
  }
}

/**
 * Запуск планировщика переиндексации
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    console.log('[Scheduler] Scheduler already running');
    return;
  }
  
  console.log(`[Scheduler] Starting scheduler with interval ${REINDEX_INTERVAL_MS / 1000}s`);
  
  // Запускаем первую индексацию через 10 секунд после старта
  setTimeout(() => {
    performReindex().catch(console.error);
  }, 10000);
  
  // Устанавливаем интервал для периодической переиндексации
  schedulerInterval = setInterval(() => {
    performReindex().catch(console.error);
  }, REINDEX_INTERVAL_MS);
  
  watcherActive = true;
}

/**
 * Остановка планировщика
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    watcherActive = false;
    console.log('[Scheduler] Scheduler stopped');
  }
}

/**
 * Проверка статуса планировщика
 */
export function isSchedulerRunning(): boolean {
  return watcherActive;
}

/**
 * Принудительный запуск переиндексации (для API)
 */
export async function triggerReindex(): Promise<void> {
  console.log('[Scheduler] Manual reindex triggered');
  await performReindex();
}

/**
 * Получение информации о планировщике
 */
export function getSchedulerInfo(): {
  running: boolean;
  intervalMs: number;
  lastIndexedAt: string | null;
  nextIndexAt: string | null;
} {
  const lastAt = lastIndexedAt ? new Date(lastIndexedAt).toISOString() : null;
  let nextIndexAt: string | null = null;
  
  if (lastIndexedAt && watcherActive) {
    const nextTime = lastIndexedAt + REINDEX_INTERVAL_MS;
    nextIndexAt = new Date(nextTime).toISOString();
  }
  
  return {
    running: watcherActive,
    intervalMs: REINDEX_INTERVAL_MS,
    lastIndexedAt: lastAt,
    nextIndexAt,
  };
}
