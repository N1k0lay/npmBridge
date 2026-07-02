import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
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
} from '@/lib/store';

type SavedSmartPlan = {
  createdAt?: string;
  sourceTaskId?: string;
  scannedPackages?: number;
  skippedVersions?: number;
  planningFailed?: number;
  targets?: Array<{ package: string; version: string; reason?: string }>;
};

const latestSmartPlanPath = () => path.join(config.dataDir, 'update_smart_latest_plan.json');

async function getLatestSmartPlan() {
  try {
    const raw = await fs.readFile(latestSmartPlanPath(), 'utf-8');
    const plan = JSON.parse(raw) as SavedSmartPlan;
    const targetCount = Array.isArray(plan.targets) ? plan.targets.length : 0;
    return {
      available: true,
      path: latestSmartPlanPath(),
      createdAt: plan.createdAt ?? null,
      sourceTaskId: plan.sourceTaskId ?? null,
      targetCount,
      scannedPackages: plan.scannedPackages ?? 0,
      skippedVersions: plan.skippedVersions ?? 0,
      planningFailed: plan.planningFailed ?? 0,
    };
  } catch {
    return {
      available: false,
      path: latestSmartPlanPath(),
      createdAt: null,
      sourceTaskId: null,
      targetCount: 0,
      scannedPackages: 0,
      skippedVersions: 0,
      planningFailed: 0,
    };
  }
}

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
    const running = isTaskRunning(taskId);

    if (!running && status?.status === 'running') {
      await updateUpdateRecord(taskId, {
        finishedAt: new Date().toISOString(),
        status: 'failed',
      });

      return NextResponse.json({
        taskId,
        running: false,
        progress,
        status: {
          status: 'failed',
          message: 'Задача прервана: процесс обновления не найден',
        },
      });
    }
    
    return NextResponse.json({
      taskId,
      running,
      progress,
      status,
    });
  }
  
  // Получить историю обновлений и текущее состояние
  const [updates, rawRunningUpdate] = await Promise.all([
    getUpdates(),
    getRunningUpdate(),
  ]);
  const latestPlan = await getLatestSmartPlan();

  let runningUpdate = rawRunningUpdate;
  if (runningUpdate && !isTaskRunning(runningUpdate.id)) {
    await updateUpdateRecord(runningUpdate.id, {
      finishedAt: new Date().toISOString(),
      status: 'failed',
    });
    runningUpdate = null;
  }
  
  // В историю попадают только завершённые обновления
  const completedUpdates = (runningUpdate
    ? updates
    : updates.map(u => rawRunningUpdate && u.id === rawRunningUpdate.id
      ? { ...u, status: 'failed' as const, finishedAt: new Date().toISOString() }
      : u
    )
  ).filter(u => u.status !== 'running');
  
  return NextResponse.json({
    updates: completedUpdates.slice(0, 50), // Последние 50 завершённых
    runningUpdate,
    latestPlan,
    config: {
      parallelJobs: config.parallelJobs,
      modifiedMinutes: config.modifiedMinutes,
    },
  });
}

// POST - запустить обновление
export async function POST(request: Request) {
  let body;
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }
  
  const { type = 'full', parallelJobs, modifiedMinutes, packageName, version } = body;
  
  // Для обновления/установки одного пакета не проверяем другие задачи
  if (type === 'single' && packageName) {
    const taskId = `update_single_${Date.now()}`;
    const versionStr = version ? `@${version}` : '@latest';
    
    // Создаём запись в истории
    await addUpdate({
      id: taskId,
      type: 'single',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      packagesTotal: 1,
      packagesSuccess: 0,
      packagesFailed: 0,
      logFile: `${taskId}.log`,
    });
    
    // Аргументы скрипта: package_name [version]
    const scriptArgs = version ? [packageName, version] : [packageName];
    
    // Запускаем скрипт
    runScript('update_single.py', taskId, {}, scriptArgs).then(async (result) => {
      await updateUpdateRecord(taskId, {
        finishedAt: new Date().toISOString(),
        status: result.success ? 'completed' : 'failed',
        packagesTotal: 1,
        packagesSuccess: result.success ? 1 : 0,
        packagesFailed: result.success ? 0 : 1,
      });
    });
    
    return NextResponse.json({
      taskId,
      message: `Установка пакета ${packageName}${versionStr} запущена`,
    });
  }
  
  // Проверяем, что нет запущенных обновлений
  const runningUpdate = await getRunningUpdate();
  if (runningUpdate) {
    // Если процесс реально завершился, но БД не обновилась — авто-очистка
    if (!isTaskRunning(runningUpdate.id)) {
      await updateUpdateRecord(runningUpdate.id, {
        finishedAt: new Date().toISOString(),
        status: 'failed',
      });
    } else {
      return NextResponse.json(
        { error: 'Уже выполняется обновление', taskId: runningUpdate.id },
        { status: 409 }
      );
    }
  }
  
  const taskId = `update_${type}_${Date.now()}`;
  const scriptName = type === 'recent'
    ? 'update_recent.py'
    : type === 'legacy_full'
      ? 'update_all.py'
      : 'update_smart.py';
  
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
  if (type === 'smart_plan') {
    extraEnv.SMART_UPDATE_PLAN_ONLY = '1';
    extraEnv.SMART_UPDATE_PLAN_FILE = latestSmartPlanPath();
  }
  if (type === 'smart_apply_plan') {
    const latestPlan = await getLatestSmartPlan();
    if (!latestPlan.available) {
      await updateUpdateRecord(taskId, {
        finishedAt: new Date().toISOString(),
        status: 'failed',
      });

      return NextResponse.json(
        { error: 'Сначала построьте план обновления' },
        { status: 400 }
      );
    }
    extraEnv.SMART_UPDATE_APPLY_PLAN = '1';
    extraEnv.SMART_UPDATE_PLAN_FILE = latestSmartPlanPath();
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
