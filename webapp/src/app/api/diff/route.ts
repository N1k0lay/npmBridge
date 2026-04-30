import { NextResponse } from 'next/server';
import { 
  runScript, 
  getTaskProgress, 
  getTaskStatus, 
  isTaskRunning,
  findRunningTaskId,
  writeTaskStatus,
  getTaskLogs,
  stopTask,
  listTaskHistory,
} from '@/lib/scripts';
import { 
  addDiff, 
  getDiffs, 
  getDiff,
  getPendingDiff,
  markDiffTransferredToNetwork,
  markDiffOutdated,
  checkDiffOutdated,
  DiffRecord,
} from '@/lib/store';
import { getNetwork } from '@/lib/networks';

// GET - получить список diff или конкретный diff
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const diffId = searchParams.get('id');
  const taskId = searchParams.get('taskId');
  const runningTaskId = findRunningTaskId('diff_task_');
  
  // Если запрашивается статус задачи создания diff
  if (taskId) {
    const [progress, status, logs] = await Promise.all([
      getTaskProgress(taskId),
      getTaskStatus(taskId),
      getTaskLogs(taskId, 200),
    ]);
    
    return NextResponse.json({
      taskId,
      running: isTaskRunning(taskId),
      progress,
      status,
      logs,
    });
  }
  
  // Если запрашивается конкретный diff
  if (diffId) {
    const diff = await getDiff(diffId);
    if (!diff) {
      return NextResponse.json(
        { error: 'Diff не найден' },
        { status: 404 }
      );
    }
    
    // Проверяем, не устарел ли diff
    if (diff.status === 'pending') {
      const isOutdated = await checkDiffOutdated(diffId);
      if (isOutdated) {
        await markDiffOutdated(diffId);
        diff.status = 'outdated';
      }
    }
    
    return NextResponse.json(diff);
  }
  
  // Возвращаем список всех diff
  const [diffs, pendingDiff, recentTasks] = await Promise.all([
    getDiffs(),
    getPendingDiff(),
    listTaskHistory('diff_task_', 20),
  ]);
  
  // Проверяем актуальность pending diff
  if (pendingDiff) {
    const isOutdated = await checkDiffOutdated(pendingDiff.id);
    if (isOutdated) {
      await markDiffOutdated(pendingDiff.id);
    }
  }
  
  return NextResponse.json({
    diffs: diffs.slice(0, 50),
    pendingDiff: (pendingDiff?.status === 'pending' || pendingDiff?.status === 'partial') ? pendingDiff : null,
    runningTaskId,
    recentTasks,
  });
}

// POST - создать новый diff
export async function POST(_request: Request) {
  const runningTaskId = findRunningTaskId('diff_task_');
  if (runningTaskId) {
    return NextResponse.json(
      {
        error: 'Создание diff уже выполняется',
        taskId: runningTaskId,
      },
      { status: 409 }
    );
  }

  // Diff создаётся независимо от сетей
  // Сети - это просто метки для отслеживания, куда был перенесён diff
  
  // Проверяем, нет ли уже pending diff
  const existingPending = await getPendingDiff();
  if (existingPending) {
    const isOutdated = await checkDiffOutdated(existingPending.id);
    if (!isOutdated) {
      return NextResponse.json(
        { 
          error: 'Уже существует актуальный diff, ожидающий переноса',
          diff: existingPending 
        },
        { status: 409 }
      );
    }
    // Если устарел, помечаем и продолжаем
    await markDiffOutdated(existingPending.id);
  }
  
  const taskId = `diff_task_${Date.now()}`;
  const diffId = `diff_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  
  void runScript('create_diff.py', taskId, {
    DIFF_ID: diffId,
  }).then(async (result) => {
    if (!result.success) {
      await writeTaskStatus(taskId, 'failed', result.error || 'Ошибка создания diff');
      return;
    }

    try {
      const outputLines = result.output.split('\n').filter(line => line.trim());
      const lastLine = outputLines[outputLines.length - 1];
      const diffResult = JSON.parse(lastLine) as {
        archivePath: string | null;
        archiveSize: number;
        archiveSizeHuman: string;
        filesCount: number;
        sinceTime?: string | null;
        storageSnapshotTime: string;
      };

      if (diffResult.filesCount === 0 || !diffResult.archivePath) {
        await writeTaskStatus(taskId, 'completed', 'Новых пакетов не найдено');
        return;
      }

      const diffRecord: DiffRecord = {
        id: diffId,
        createdAt: new Date().toISOString(),
        status: 'pending',
        transfers: [],
        archivePath: diffResult.archivePath,
        archiveSize: diffResult.archiveSize,
        archiveSizeHuman: diffResult.archiveSizeHuman,
        filesCount: diffResult.filesCount,
        sinceTime: diffResult.sinceTime || null,
        storageSnapshotTime: diffResult.storageSnapshotTime,
      };

      await addDiff(diffRecord);
      await writeTaskStatus(taskId, 'completed', `Diff создан: ${diffRecord.filesCount} файлов, ${diffRecord.archiveSizeHuman}`);
    } catch (error) {
      await writeTaskStatus(taskId, 'failed', `Ошибка обработки результата diff: ${String(error)}`);
    }
  });

  return NextResponse.json({ taskId });
}

// PATCH - подтвердить перенос diff в сеть
export async function PATCH(request: Request) {
  const body = await request.json();
  const { diffId, action, networkId } = body;
  
  if (!diffId) {
    return NextResponse.json(
      { error: 'diffId обязателен' },
      { status: 400 }
    );
  }
  
  if (action === 'confirm_transfer') {
    if (!networkId) {
      return NextResponse.json(
        { error: 'networkId обязателен для подтверждения переноса' },
        { status: 400 }
      );
    }
    
    // Проверяем, что сеть существует
    const network = await getNetwork(networkId);
    if (!network) {
      return NextResponse.json(
        { error: `Сеть "${networkId}" не найдена` },
        { status: 404 }
      );
    }
    
    const diff = await getDiff(diffId);
    if (!diff) {
      return NextResponse.json(
        { error: 'Diff не найден' },
        { status: 404 }
      );
    }
    
    if (diff.status !== 'pending' && diff.status !== 'partial') {
      return NextResponse.json(
        { error: `Diff имеет статус "${diff.status}", подтверждение невозможно` },
        { status: 400 }
      );
    }
    
    // Проверяем, не перенесён ли уже в эту сеть
    if (diff.transfers.some(t => t.networkId === networkId)) {
      return NextResponse.json(
        { error: `Diff уже перенесён в сеть "${network.name}"` },
        { status: 400 }
      );
    }
    
    // Помечаем diff как перенесённый в сеть
    await markDiffTransferredToNetwork(diffId, networkId);
    
    // Получаем обновлённый diff
    const updatedDiff = await getDiff(diffId);
    
    return NextResponse.json({
      message: `Перенос в сеть "${network.name}" подтверждён`,
      diff: updatedDiff,
    });
  }
  
  if (action === 'mark_outdated') {
    await markDiffOutdated(diffId);
    return NextResponse.json({
      message: 'Diff помечен как устаревший',
    });
  }
  
  return NextResponse.json(
    { error: 'Неизвестное действие' },
    { status: 400 }
  );
}

// DELETE - остановить создание diff
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
  if (!stopped) {
    return NextResponse.json(
      { error: 'Задача не найдена или уже завершена' },
      { status: 404 }
    );
  }

  await writeTaskStatus(taskId, 'failed', 'Создание diff остановлено пользователем');

  return NextResponse.json({ message: 'Создание diff остановлено' });
}
