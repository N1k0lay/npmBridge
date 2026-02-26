import { NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';

const BINARIES_DIR = process.env.BINARIES_DIR || '/app/binaries';

export interface TreeNode {
  name: string;
  type: 'file' | 'dir';
  size?: number;         // байты, только для файлов
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

export async function GET() {
  try {
    const tree = await buildTree(BINARIES_DIR);
    // Добавляем суммарный размер к директориям (удобно для отображения)
    function annotate(nodes: TreeNode[]): TreeNode[] {
      return nodes.map(n => {
        if (n.type === 'dir' && n.children) {
          const children = annotate(n.children);
          return { ...n, size: calcDirSize(children), children };
        }
        return n;
      });
    }
    return NextResponse.json({
      path: BINARIES_DIR,
      tree: annotate(tree),
      totalSize: calcDirSize(tree),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
