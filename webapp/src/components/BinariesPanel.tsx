'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  HardDrive,
  Folder,
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  Info,
} from 'lucide-react';
import type { TreeNode } from '@/app/api/binaries/route';

const fetcher = (url: string) => fetch(url).then(r => r.json());

function fmtSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

// Описания корневых директорий
const DIR_HINTS: Record<string, string> = {
  'playwright-cdn':      'CDN-зеркало. Клиент: PLAYWRIGHT_DOWNLOAD_HOST=…/binaries/playwright-cdn',
  'playwright-browsers': 'Распакованные браузеры. Клиент: PLAYWRIGHT_BROWSERS_PATH=/path/to/playwright-browsers',
  'electron':            'CDN-зеркало GitHub Releases. Клиент: ELECTRON_MIRROR=…/binaries/electron/ + ELECTRON_CUSTOM_DIR={{ version }}',
  'electron-zips':       'Zip-архивы для ручной установки. Скопируйте нужный zip в ~/.cache/electron/',
  'puppeteer-cdn':       'CDN-зеркало Chrome-for-testing. Клиент: PUPPETEER_DOWNLOAD_BASE_URL=…/binaries/puppeteer-cdn',
  'puppeteer-cache':     'Распакованный Chrome. Клиент: PUPPETEER_CACHE_DIR=/path/to/puppeteer-cache',
};

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  isRoot?: boolean;
}

function TreeRow({ node, depth, isRoot }: TreeRowProps) {
  const [open, setOpen] = useState(isRoot ?? depth < 2);
  const hasChildren = node.type === 'dir' && (node.children?.length ?? 0) > 0;
  const isEmpty    = node.type === 'dir' && (node.children?.length ?? 0) === 0;
  const hint       = isRoot ? DIR_HINTS[node.name] : undefined;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 py-0.5 rounded hover:bg-gray-800/50 cursor-default select-none
          ${depth === 0 ? 'mt-1' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => hasChildren && setOpen(o => !o)}
      >
        {/* Chevron */}
        <span className="w-4 shrink-0 text-gray-500">
          {hasChildren
            ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />)
            : null}
        </span>

        {/* Иконка */}
        {node.type === 'dir'
          ? (open && hasChildren
              ? <FolderOpen className="w-4 h-4 text-yellow-400 shrink-0" />
              : <Folder className={`w-4 h-4 shrink-0 ${isEmpty ? 'text-gray-600' : 'text-yellow-400'}`} />)
          : <File className="w-4 h-4 text-blue-400 shrink-0" />}

        {/* Имя */}
        <span className={`text-sm truncate ${
          depth === 0 ? 'font-semibold text-white' :
          node.type === 'file' ? 'text-gray-300' : 'text-gray-200'
        }`}>
          {node.name}
          {node.type === 'dir' && node.children !== undefined && (
            <span className="ml-1 text-xs text-gray-500 font-normal">
              {node.children.length === 0 ? '(пусто)' : ''}
            </span>
          )}
        </span>

        {/* Размер */}
        {node.size !== undefined && node.size > 0 && (
          <span className="ml-auto pr-2 text-xs text-gray-500 shrink-0">
            {fmtSize(node.size)}
          </span>
        )}
      </div>

      {/* Подсказка для корневой директории */}
      {hint && (
        <div className="flex items-start gap-1.5 ml-10 mb-1 text-xs text-blue-300/80">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="font-mono break-all">{hint}</span>
        </div>
      )}

      {/* Дочерние узлы */}
      {hasChildren && open && node.children!.map(child => (
        <TreeRow key={child.name} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function BinariesPanel() {
  const { data, error, isLoading, mutate } = useSWR('/api/binaries', fetcher, {
    revalidateOnFocus: false,
  });

  const isEmpty = !isLoading && !error && (!data?.tree || data.tree.length === 0);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Бинарники</h1>
            <p className="text-sm text-gray-400">
              Скачанные бинарники для использования в закрытых сетях
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data?.totalSize > 0 && (
            <span className="text-sm text-gray-400">
              Итого: <span className="text-white font-medium">{fmtSize(data.totalSize)}</span>
            </span>
          )}
          <button
            onClick={() => mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Обновить
          </button>
        </div>
      </div>

      {/* Инструкция по запуску */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-4 text-sm space-y-1">
        <p className="text-gray-300 font-medium mb-2">Как добавить бинарники:</p>
        <pre className="text-xs text-green-300/90 bg-black/30 rounded p-3 overflow-x-auto leading-relaxed">{`# Запустить на сервере npmBridge (нужен доступ в интернет):
docker compose exec webapp python3 /app/scripts/mirror_binaries.py --mode local-extract

# Только конкретный пакет:
docker compose exec webapp python3 /app/scripts/mirror_binaries.py --package playwright --mode local-extract
docker compose exec webapp python3 /app/scripts/mirror_binaries.py --package puppeteer --mode local-extract
docker compose exec webapp python3 /app/scripts/mirror_binaries.py --package electron   --mode cdn-mirror`}
        </pre>
      </div>

      {/* Ошибка */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">Ошибка загрузки: {String(error)}</span>
        </div>
      )}

      {/* Загрузка */}
      {isLoading && (
        <div className="flex items-center gap-2 py-8 justify-center text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Загрузка...</span>
        </div>
      )}

      {/* Пусто */}
      {isEmpty && (
        <div className="py-12 text-center space-y-3">
          <HardDrive className="w-12 h-12 mx-auto text-gray-600" />
          <p className="text-gray-400">Бинарники ещё не скачаны</p>
          <p className="text-sm text-gray-500">
            Запустите скрипт <code className="text-blue-300">mirror_binaries.py</code> на сервере
          </p>
        </div>
      )}

      {/* Дерево */}
      {!isLoading && !error && data?.tree?.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 overflow-auto max-h-[60vh]">
          {data.tree.map((node: TreeNode) => (
            <TreeRow key={node.name} node={node} depth={0} isRoot />
          ))}
        </div>
      )}
    </div>
  );
}
