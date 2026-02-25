import { NextResponse } from 'next/server';
import { getIndexingStatus, indexPackages, refreshStorageStats } from '@/lib/storage';
import { getSchedulerInfo } from '@/lib/scheduler';

/**
 * GET /api/indexing - Получение статуса индексации и планировщика
 */
export async function GET() {
  try {
    const status = getIndexingStatus();
    const scheduler = getSchedulerInfo();
    
    return NextResponse.json({
      ...status,
      scheduler,
    });
  } catch (error) {
    console.error('Error getting indexing status:', error);
    return NextResponse.json(
      { error: 'Failed to get indexing status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/indexing - Запуск индексации
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { refreshStats = false } = body;
    
    // Проверяем, не идёт ли уже индексация
    const currentStatus = getIndexingStatus();
    if (currentStatus.isIndexing) {
      return NextResponse.json(
        { error: 'Indexing already in progress', status: currentStatus },
        { status: 409 }
      );
    }
    
    // Запускаем индексацию в фоне
    (async () => {
      try {
        await indexPackages();
        
        // Опционально обновляем статистику
        if (refreshStats) {
          await refreshStorageStats();
        }
      } catch (error) {
        console.error('Indexing error:', error);
      }
    })();
    
    return NextResponse.json({
      message: 'Indexing started',
      status: getIndexingStatus(),
    });
  } catch (error) {
    console.error('Error starting indexing:', error);
    return NextResponse.json(
      { error: 'Failed to start indexing' },
      { status: 500 }
    );
  }
}
