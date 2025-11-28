import { NextResponse } from 'next/server';
import { 
  runScript, 
  getTaskProgress, 
  getTaskStatus, 
  isTaskRunning,
  config 
} from '@/lib/scripts';
import { 
  addBrokenCheck, 
  updateBrokenCheck, 
  getBrokenChecks,
  getLastBrokenCheck 
} from '@/lib/history';

// GET - получить статус проверки или историю
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');
  
  if (taskId) {
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
  
  const [checks, lastCheck] = await Promise.all([
    getBrokenChecks(),
    getLastBrokenCheck(),
  ]);
  
  return NextResponse.json({
    checks: checks.slice(0, 20),
    lastCheck,
  });
}

// POST - запустить проверку или исправление
export async function POST(request: Request) {
  const body = await request.json();
  const { action = 'check' } = body;
  
  const taskId = `broken_${action}_${Date.now()}`;
  
  if (action === 'check') {
    // Создаём запись в истории
    await addBrokenCheck({
      id: taskId,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      totalArchives: 0,
      brokenArchives: 0,
      brokenFiles: [],
      fixed: false,
      fixedCount: 0,
    });
    
    // Запускаем проверку асинхронно
    runScript('check_broken.py', taskId).then(async (result) => {
      let totalArchives = 0;
      let brokenArchives = 0;
      let brokenFiles: string[] = [];
      
      try {
        const outputLines = result.output.split('\n').filter(line => line.trim());
        const lastLine = outputLines[outputLines.length - 1];
        if (lastLine) {
          const jsonResult = JSON.parse(lastLine);
          totalArchives = jsonResult.totalArchives || 0;
          brokenArchives = jsonResult.brokenArchives || 0;
          brokenFiles = jsonResult.brokenFiles || [];
        }
      } catch {
        // Игнорируем
      }
      
      await updateBrokenCheck(taskId, {
        finishedAt: new Date().toISOString(),
        status: result.success 
          ? (brokenArchives > 0 ? 'completed_with_issues' : 'completed')
          : 'failed',
        totalArchives,
        brokenArchives,
        brokenFiles,
      });
    });
    
    return NextResponse.json({
      taskId,
      message: 'Проверка архивов запущена',
    });
  }
  
  if (action === 'fix') {
    // Получаем последнюю проверку
    const lastCheck = await getLastBrokenCheck();
    
    if (!lastCheck || lastCheck.brokenArchives === 0) {
      return NextResponse.json(
        { error: 'Нет битых архивов для исправления' },
        { status: 400 }
      );
    }
    
    // Запускаем исправление
    runScript('fix_broken.py', taskId).then(async (result) => {
      let fixed = 0;
      let failed = 0;
      
      try {
        const outputLines = result.output.split('\n').filter(line => line.trim());
        const lastLine = outputLines[outputLines.length - 1];
        if (lastLine) {
          const jsonResult = JSON.parse(lastLine);
          fixed = jsonResult.fixed || 0;
          failed = jsonResult.failed || 0;
        }
      } catch {
        // Игнорируем
      }
      
      // Обновляем последнюю проверку
      if (lastCheck) {
        await updateBrokenCheck(lastCheck.id, {
          fixed: failed === 0,
        });
      }
    });
    
    return NextResponse.json({
      taskId,
      message: 'Исправление битых архивов запущено',
    });
  }
  
  return NextResponse.json(
    { error: 'Неизвестное действие' },
    { status: 400 }
  );
}
