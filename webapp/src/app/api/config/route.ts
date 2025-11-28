import { NextResponse } from 'next/server';
import { config } from '@/lib/scripts';

export async function GET() {
  return NextResponse.json({
    verdaccioHome: config.verdaccioHome,
    storageDir: config.storageDir,
    frozenDir: config.frozenDir,
    diffArchivesDir: config.diffArchivesDir,
    parallelJobs: config.parallelJobs,
    modifiedMinutes: config.modifiedMinutes,
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  
  // Обновляем конфигурацию в runtime
  // Примечание: это изменит только runtime значения, не .env файл
  if (body.parallelJobs !== undefined) {
    (config as any).parallelJobs = parseInt(body.parallelJobs, 10);
  }
  if (body.modifiedMinutes !== undefined) {
    (config as any).modifiedMinutes = parseInt(body.modifiedMinutes, 10);
  }
  
  return NextResponse.json({
    message: 'Конфигурация обновлена',
    config: {
      parallelJobs: config.parallelJobs,
      modifiedMinutes: config.modifiedMinutes,
    },
  });
}
