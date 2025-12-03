import { NextResponse } from 'next/server';
import { 
  runScript, 
  getTaskProgress, 
  getTaskStatus, 
  isTaskRunning 
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
} from '@/lib/history';
import { getNetwork, getNetworkFrozenDir } from '@/lib/networks';

// GET - получить список diff или конкретный diff
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const diffId = searchParams.get('id');
  const taskId = searchParams.get('taskId');
  
  // Если запрашивается статус задачи создания diff
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
  const diffs = await getDiffs();
  const pendingDiff = await getPendingDiff();
  
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
  });
}

// POST - создать новый diff
export async function POST(_request: Request) {
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
  
  const taskId = `diff_${Date.now()}`;
  const diffId = `diff_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  
  // Запускаем скрипт создания diff
  const result = await runScript('create_diff.py', taskId, {
    DIFF_ID: diffId,
  });
  
  if (!result.success) {
    return NextResponse.json(
      { error: 'Ошибка создания diff', details: result.error },
      { status: 500 }
    );
  }
  
  // Парсим результат
  try {
    const outputLines = result.output.split('\n').filter(line => line.trim());
    const lastLine = outputLines[outputLines.length - 1];
    const diffResult = JSON.parse(lastLine);
    
    if (diffResult.filesCount === 0) {
      return NextResponse.json({
        message: 'Различий не найдено',
        diff: null,
      });
    }
    
    // Создаём запись в истории
    const diffRecord: DiffRecord = {
      id: diffId,
      createdAt: new Date().toISOString(),
      status: 'pending',
      transfers: [],
      archivePath: diffResult.archivePath,
      archiveSize: diffResult.archiveSize,
      archiveSizeHuman: diffResult.archiveSizeHuman,
      filesCount: diffResult.filesCount,
      files: diffResult.files || [],
      storageSnapshotTime: diffResult.storageSnapshotTime,
    };
    
    await addDiff(diffRecord);
    
    return NextResponse.json({
      message: 'Diff создан успешно',
      diff: diffRecord,
    });
    
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка парсинга результата', details: String(error) },
      { status: 500 }
    );
  }
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
    
    // Синхронизируем frozen только при ПЕРВОМ подтверждении (когда diff ещё pending)
    // Это нужно чтобы следующий diff корректно сравнивал storage с frozen
    // Если diff уже partial - frozen уже синхронизирован при первом подтверждении
    if (diff.status === 'pending') {
      const taskId = `sync_${Date.now()}`;
      const frozenDir = getNetworkFrozenDir(networkId);
      const result = await runScript('sync_frozen.py', taskId, {
        DIFF_ID: diffId,
        FROZEN_DIR: frozenDir,
      });
      
      if (!result.success) {
        return NextResponse.json(
          { error: 'Ошибка синхронизации frozen', details: result.error },
          { status: 500 }
        );
      }
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
