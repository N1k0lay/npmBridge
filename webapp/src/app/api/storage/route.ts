import { NextResponse } from 'next/server';
import { 
  getPackages, 
  getPackageInfo, 
  getScopes, 
  getStorageStats,
  searchPackages,
  getSuggestions,
  getPackageHistory,
  indexPackages,
  refreshStorageStats,
  invalidateStatsCache,
} from '@/lib/storage';

// GET - получить список пакетов, информацию о пакете или статистику
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'list';
  const packageName = searchParams.get('package');
  const scope = searchParams.get('scope');
  const query = searchParams.get('q') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '30', 10);
  const sortBy = searchParams.get('sortBy') as 'name' | 'updated' | 'relevance' || 'relevance';
  
  try {
    switch (action) {
      case 'stats':
        const stats = await getStorageStats();
        return NextResponse.json(stats);
      
      case 'scopes':
        const scopes = await getScopes();
        return NextResponse.json({ scopes });
      
      case 'history':
        const historyResult = await getPackageHistory(page, limit);
        return NextResponse.json(historyResult);
      
      case 'search':
        if (!query) {
          return NextResponse.json({
            items: [],
            total: 0,
            page: 1,
            limit,
            hasMore: false
          });
        }
        const searchResult = await searchPackages({ query, page, limit, sortBy });
        return NextResponse.json(searchResult);
      
      case 'suggest':
        if (!query) {
          return NextResponse.json({ suggestions: [] });
        }
        const suggestions = await getSuggestions(query, 10);
        return NextResponse.json({ suggestions });
      
      case 'package':
        if (!packageName) {
          return NextResponse.json(
            { error: 'Параметр package обязателен' },
            { status: 400 }
          );
        }
        const info = await getPackageInfo(packageName);
        if (!info) {
          return NextResponse.json(
            { error: 'Пакет не найден' },
            { status: 404 }
          );
        }
        return NextResponse.json(info);
      
      case 'list':
      default:
        const packages = await getPackages(scope || undefined);
        return NextResponse.json({ 
          packages,
          total: packages.length,
          scope: scope || null,
        });
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка получения данных', details: String(error) },
      { status: 500 }
    );
  }
}

// POST - операции над storage
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  
  try {
    switch (action) {
      case 'reindex':
        // Запускаем индексацию в фоне
        indexPackages().catch(console.error);
        return NextResponse.json({ status: 'started', message: 'Индексация запущена в фоне' });
      
      case 'refresh-stats':
        // Запускаем пересчёт статистики в фоне
        refreshStorageStats().catch(console.error);
        return NextResponse.json({ status: 'started', message: 'Пересчёт статистики запущен' });
      
      case 'invalidate-cache':
        invalidateStatsCache();
        return NextResponse.json({ status: 'ok', message: 'Кэш инвалидирован' });
      
      default:
        return NextResponse.json(
          { error: 'Неизвестное действие' },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка выполнения операции', details: String(error) },
      { status: 500 }
    );
  }
}
