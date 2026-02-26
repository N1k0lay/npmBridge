import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { getDiff } from '@/lib/store';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: diffId } = await params;
  
  // Получаем информацию о diff
  const diff = await getDiff(diffId);
  
  if (!diff) {
    return NextResponse.json(
      { error: 'Diff не найден' },
      { status: 404 }
    );
  }
  
  // Проверяем существование файла
  const archivePath = diff.archivePath;
  
  if (!existsSync(archivePath)) {
    return NextResponse.json(
      { error: 'Файл архива не найден' },
      { status: 404 }
    );
  }
  
  // Читаем файл и отдаём
  const fileBuffer = await fs.readFile(archivePath);
  const filename = path.basename(archivePath);
  
  return new NextResponse(fileBuffer, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': diff.archiveSize.toString(),
    },
  });
}
