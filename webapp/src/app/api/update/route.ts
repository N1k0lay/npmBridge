import { NextResponse } from 'next/server';
import { 
  runScript, 
  getTaskProgress, 
  getTaskStatus, 
  isTaskRunning, 
  stopTask,
  config 
} from '@/lib/scripts';
import { 
  addUpdate, 
  updateUpdateRecord, 
  getRunningUpdate,
  getUpdates 
} from '@/lib/history';

// GET - получить статус текущего обновления или историю
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');
  
  if (taskId) {
    // Получить статус конкретной задачи
    const [progress, status] = await Promise.all([
      getTaskProgress(taskId),
      getTaskStatus(taskId),
    ]);
    
    return NextResponse.json({
      taskId,
      running: isTaskRunning(taskId),
      progress,
      status,
    });
  }
  
  // Получить историю обновлений и текущее состояние
  const [updates, runningUpdate] = await Promise.all([
    getUpdates(),
    getRunningUpdate(),
  ]);
  
  // В историю попадают только завершённые обновления
  const completedUpdates = updates.filter(u => u.status !== 'running');
  
  return NextResponse.json({
    updates: completedUpdates.slice(0, 50), // Последние 50 завершённых
    runningUpdate,
    config: {
      parallelJobs: config.parallelJobs,
      modifiedMinutes: config.modifiedMinutes,
    },
  });
}

// POST - запустить обновление
export async function POST(request: Request) {
  const body = await request.json();
  const { type = 'full', parallelJobs, modifiedMinutes } = body;
  
  // Проверяем, что нет запущенных обновлений
  const runningUpdate = await getRunningUpdate();
  if (runningUpdate) {
    return NextResponse.json(
      { error: 'Уже выполняется обновление', taskId: runningUpdate.id },
      { status: 409 }
    );
  }
  
  const taskId = `update_${type}_${Date.now()}`;
  const scriptName = type === 'recent' ? 'update_recent.py' : 'update_all.py';
  
  // Создаём запись в истории
  await addUpdate({
    id: taskId,
    type,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    packagesTotal: 0,
    packagesSuccess: 0,
    packagesFailed: 0,
    logFile: `${taskId}.log`,
  });
  
  // Запускаем скрипт асинхронно
  const extraEnv: Record<string, string> = {};
  if (parallelJobs) {
    extraEnv.PARALLEL_JOBS = parallelJobs.toString();
  }
  if (modifiedMinutes && type === 'recent') {
    extraEnv.MODIFIED_MINUTES = modifiedMinutes.toString();
  }
  
  runScript(scriptName, taskId, extraEnv).then(async (result) => {
    // Парсим результат
    let packagesTotal = 0;
    let packagesSuccess = 0;
    let packagesFailed = 0;
    
    try {
      const outputLines = result.output.split('\n').filter(line => line.trim());
      const lastLine = outputLines[outputLines.length - 1];
      if (lastLine) {
        const jsonResult = JSON.parse(lastLine);
        packagesTotal = jsonResult.totalPackages || 0;
        packagesSuccess = jsonResult.success || 0;
        packagesFailed = jsonResult.failed || 0;
      }
    } catch {
      // Игнорируем ошибки парсинга
    }
    
    await updateUpdateRecord(taskId, {
      finishedAt: new Date().toISOString(),
      status: result.success 
        ? (packagesFailed > 0 ? 'completed_with_errors' : 'completed')
        : 'failed',
      packagesTotal,
      packagesSuccess,
      packagesFailed,
    });
  });
  
  return NextResponse.json({
    taskId,
    message: `Обновление ${type === 'recent' ? 'недавних пакетов' : 'всех пакетов'} запущено`,
  });
}

// DELETE - остановить обновление
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');
  
  if (!taskId) {
    return NextResponse.json(
      { error: 'taskId обязателен' },
      { status: 400 }
    );
  }
  
  const stopped = stopTask(taskId);
  
  if (stopped) {
    await updateUpdateRecord(taskId, {
      finishedAt: new Date().toISOString(),
      status: 'failed',
    });
    
    return NextResponse.json({ message: 'Задача остановлена' });
  }
  
  return NextResponse.json(
    { error: 'Задача не найдена или уже завершена' },
    { status: 404 }
  );
}
