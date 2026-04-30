import { NextResponse } from 'next/server';
import { createReadStream, existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { getDiff } from '@/lib/store';

export const runtime = 'nodejs';

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
  
  const stats = await fs.stat(archivePath);
  const filename = path.basename(archivePath);
  const fileStream = createReadStream(archivePath);
  
  return new NextResponse(Readable.toWeb(fileStream) as ReadableStream, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': stats.size.toString(),
      'Accept-Ranges': 'bytes',
    },
  });
}
