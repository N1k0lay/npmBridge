import { NextResponse } from 'next/server';
import { 
  getPackages, 
  getPackageInfo, 
  getScopes, 
  getStorageStats,
  searchPackages,
  getPackageHistory
} from '@/lib/storage';

// GET - получить список пакетов, информацию о пакете или статистику
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'list';
  const packageName = searchParams.get('package');
  const scope = searchParams.get('scope');
  const query = searchParams.get('q');
  
  try {
    switch (action) {
      case 'stats':
        const stats = await getStorageStats();
        return NextResponse.json(stats);
      
      case 'scopes':
        const scopes = await getScopes();
        return NextResponse.json({ scopes });
      
      case 'history':
        const history = await getPackageHistory();
        return NextResponse.json({ packages: history });
      
      case 'search':
        if (!query) {
          return NextResponse.json(
            { error: 'Параметр q обязателен для поиска' },
            { status: 400 }
          );
        }
        const results = await searchPackages(query);
        return NextResponse.json({ packages: results });
      
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
