import { NextResponse } from 'next/server';
import { readdir, stat, readFile } from 'fs/promises';
import { join } from 'path';
import {
  runScript,
  isTaskRunning,
  getTaskProgress,
  getTaskStatus,
  getTaskLogs,
} from '@/lib/scripts';

const BINARIES_DIR = process.env.BINARIES_DIR || '/app/binaries';
const STORAGE_DIR   = process.env.STORAGE_DIR   || '/app/storage';

// Известные пакеты, которые скачивают бинари в postinstall
// key = id пакета (то что шлём в mirror_binaries.py --package)
// npmNames = имена папок в verdaccio storage
const KNOWN_BINARY_PACKAGES: Record<string, { npmNames: string[] }> = {
  playwright: { npmNames: ['playwright-core', 'playwright'] },
  electron:   { npmNames: ['electron'] },
  puppeteer:  { npmNames: ['puppeteer-core', 'puppeteer'] },
};

// Название npm-пакета для команды обновления
const UPDATE_PACKAGE_MAP: Record<string, string> = {
  playwright: 'playwright-core',
  electron: 'electron',
  puppeteer: 'puppeteer-core',
};

export interface TreeNode {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  children?: TreeNode[];
}

async function buildTree(dir: string, depth = 0, maxDepth = 6): Promise<TreeNode[]> {
  if (depth > maxDepth) return [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  entries.sort();
  const nodes: TreeNode[] = [];
  for (const name of entries) {
    if (name === 'metadata.json') continue;
    const full = join(dir, name);
    let info;
    try { info = await stat(full); } catch { continue; }
    if (info.isDirectory()) {
      nodes.push({
        name,
        type: 'dir',
        children: await buildTree(full, depth + 1, maxDepth),
      });
    } else {
      nodes.push({ name, type: 'file', size: info.size });
    }
  }
  return nodes;
}

function calcDirSize(nodes: TreeNode[]): number {
  let total = 0;
  for (const n of nodes) {
    if (n.type === 'file') total += n.size ?? 0;
    else if (n.children) total += calcDirSize(n.children);
  }
  return total;
}

function annotate(nodes: TreeNode[]): TreeNode[] {
  return nodes.map(n => {
    if (n.type === 'dir' && n.children) {
      const children = annotate(n.children);
      return { ...n, size: calcDirSize(children), children };
    }
    return n;
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');

  // ── Polling режим ──────────────────────────────────────────────────────────
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

  // ── Обычный GET: дерево + метаданные + список доступных пакетов ──────────
  try {
    const tree = await buildTree(BINARIES_DIR);
    const annotatedTree = annotate(tree);

    let metadata: Record<string, unknown> = {};
    try {
      const raw = await readFile(join(BINARIES_DIR, 'metadata.json'), 'utf-8');
      metadata = JSON.parse(raw);
    } catch { /* нет метаданных */ }

    // Определяем, какие бинарные пакеты есть в storage
    const availablePackages: string[] = [];
    for (const [pkgId, { npmNames }] of Object.entries(KNOWN_BINARY_PACKAGES)) {
      for (const name of npmNames) {
        try {
          await stat(join(STORAGE_DIR, name));
          availablePackages.push(pkgId);
          break; // нашли — переходим к следующему pkgId
        } catch { /* нет в storage */ }
      }
    }

    return NextResponse.json({
      path: BINARIES_DIR,
      tree: annotatedTree,
      totalSize: calcDirSize(tree),
      metadata,
      availablePackages,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      package?: string;
      mode?: string;
      updateFirst?: boolean;
    };

    const pkg = body.package && body.package !== 'all' ? body.package : undefined;
    const mode = body.mode || 'cdn-mirror';
    const updateFirst = body.updateFirst ?? false;

    const stamp = Date.now();
    const taskId = `binaries_${pkg || 'all'}_${stamp}`;

    const extraEnv: Record<string, string> = {
      BINARIES_DIR,
      ...(process.env.STORAGE_DIR ? { STORAGE_DIR: process.env.STORAGE_DIR } : {}),
      ...(process.env.REGISTRY_URL ? { REGISTRY_URL: process.env.REGISTRY_URL } : {}),
      ...(process.env.PNPM_CMD ? { PNPM_CMD: process.env.PNPM_CMD } : {}),
      ...(process.env.PNPM_STORE_DIR ? { PNPM_STORE_DIR: process.env.PNPM_STORE_DIR } : {}),
    };

    const mirrorArgs: string[] = ['--mode', mode];
    if (pkg) mirrorArgs.push('--package', pkg);

    if (updateFirst && pkg) {
      const npmPkg = UPDATE_PACKAGE_MAP[pkg] ?? pkg;
      const updateTaskId = `${taskId}_update`;
      runScript('update_single.py', updateTaskId, extraEnv, [npmPkg]).then(() => {
        runScript('mirror_binaries.py', taskId, extraEnv, mirrorArgs);
      });
    } else {
      runScript('mirror_binaries.py', taskId, extraEnv, mirrorArgs);
    }

    return NextResponse.json({ taskId });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
