export async function register() {
  // Запускаем планировщик только на сервере
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Очищаем зависшие задачи после перезапуска сервера
    const { cleanupStaleRunningTasks } = await import('./lib/history');
    await cleanupStaleRunningTasks();
    
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
