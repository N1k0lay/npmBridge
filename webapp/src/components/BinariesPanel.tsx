'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { HardDrive, RefreshCw, Download, RotateCcw, ChevronDown, ChevronUp, ChevronRight, Folder, File, Loader2 } from 'lucide-react';
import type { TreeNode } from '@/app/api/binaries/route';

// ─────────────────────────────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────────────────────────────

interface MetaEntry {
  package?: string;
  packageVersion?: string;
  browser?: string;
  browserRevision?: string;
  chromeVersion?: string;
  purpose?: string;
  mode?: string;
  platform?: string;
  downloadedAt?: string;
}

interface ApiData {
  path: string;
  tree: TreeNode[];
  totalSize: number;
  metadata: Record<string, MetaEntry>;
  availablePackages: string[];
}

interface TaskProgress {
  current: number;
  total: number;
  percent: number;
  currentPackage?: string;
  success?: number;
  failed?: number;
  updatedAt: string;
}

interface TaskStatus {
  status: string;
  message: string;
  updatedAt: string;
}

interface TaskState {
  taskId: string;
  running: boolean;
  progress: TaskProgress | null;
  status: TaskStatus | null;
  logs: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Статические мета-данные пакетов
// ─────────────────────────────────────────────────────────────────────────────

const PKG_META: Record<string, {
  label: string;
  icon: string;
  description: string;
  dirPrefixes: string[];
  envVarHint: string;
}> = {
  playwright: {
    label: 'Playwright',
    icon: '🎭',
    description: 'Chromium, Firefox, WebKit',
    dirPrefixes: ['playwright-cdn', 'playwright-browsers'],
    envVarHint: 'PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn',
  },
  electron: {
    label: 'Electron',
    icon: '⚡',
    description: 'Electron runtime',
    dirPrefixes: ['electron'],
    envVarHint: 'ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron/',
  },
  puppeteer: {
    label: 'Puppeteer',
    icon: '🤖',
    description: 'Chrome for Testing',
    dirPrefixes: ['puppeteer-cdn', 'puppeteer-cache'],
    envVarHint: 'PUPPETEER_DOWNLOAD_BASE_URL=http://repo.dmn.zbr:8013/binaries/puppeteer-cdn',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────────────────────────────────────

function fmt(bytes: number): string {
  if (bytes > 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function getDirSize(tree: TreeNode[], prefixes: string[]): number {
  return tree
    .filter(n => n.type === 'dir' && prefixes.some(p => n.name.startsWith(p)))
    .reduce((s, n) => s + (n.size ?? 0), 0);
}

function getLastMeta(meta: Record<string, MetaEntry>, pkgId: string): MetaEntry | null {
  const entries = Object.values(meta).filter(m => {
    const p = m.package || '';
    return p === pkgId || p.startsWith(pkgId) ||
      (pkgId === 'playwright' && p.startsWith('playwright'));
  });
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

function isDone(status: string | undefined): boolean {
  return status === 'completed' || status === 'completed_with_errors' || status === 'failed';
}

// ─────────────────────────────────────────────────────────────────────────────
// ProgressBar
// ─────────────────────────────────────────────────────────────────────────────

function ProgressBar({ task }: { task: TaskState }) {
  const s = task.status?.status;
  const barColor =
    s === 'failed'                ? 'bg-red-500' :
    s === 'completed'             ? 'bg-green-500' :
    s === 'completed_with_errors' ? 'bg-yellow-500' :
    'bg-blue-500';
  const textColor =
    s === 'failed'                ? 'text-red-600' :
    s === 'completed'             ? 'text-green-600' :
    s === 'completed_with_errors' ? 'text-yellow-600' :
    'text-blue-600';

  return (
    <div className="space-y-1.5">
      <div className={`text-sm font-medium ${textColor} flex items-center gap-1.5`}>
        {task.running && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        <span>{task.status?.message ?? 'Обработка...'}</span>
      </div>
      {task.progress && (
        <>
          <div className="flex justify-between text-xs text-gray-500">
            <span className="truncate max-w-[70%]">{task.progress.currentPackage}</span>
            <span>{task.progress.percent}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all duration-300 ${barColor}`}
              style={{ width: `${task.progress.percent}%` }}
            />
          </div>
          {(task.progress.failed ?? 0) > 0 && (
            <div className="text-xs text-red-500">
              ✗ {task.progress.failed} ошибок
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TreeView
// ─────────────────────────────────────────────────────────────────────────────

function TreeView({ nodes, depth = 0 }: { nodes: TreeNode[]; depth?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!nodes.length) return <span className="text-gray-400 text-xs">(пусто)</span>;
  return (
    <ul className="space-y-0.5">
      {nodes.map(n => (
        <li key={n.name} style={{ paddingLeft: depth * 14 }}>
          {n.type === 'dir' ? (
            <>
              <button
                onClick={() => setOpen(o => ({ ...o, [n.name]: !o[n.name] }))}
                className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900"
              >
                <span className="text-gray-400">
                  {open[n.name]
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronRight className="w-3 h-3" />}
                </span>
                <Folder className="w-3 h-3 text-blue-500" />
                <span>{n.name}</span>
                {n.size !== undefined && (
                  <span className="text-gray-400 ml-1">{fmt(n.size)}</span>
                )}
              </button>
              {open[n.name] && n.children && (
                <TreeView nodes={n.children} depth={depth + 1} />
              )}
            </>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-gray-500 pl-4">
              <File className="w-3 h-3 text-gray-400 shrink-0" />
              <span>{n.name}</span>
              {n.size !== undefined && <span className="text-gray-400">{fmt(n.size)}</span>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Строка пакета
// ─────────────────────────────────────────────────────────────────────────────

function PackageRow({
  pkgId,
  tree,
  meta,
  task,
  allRunning,
  mode,
  onStart,
}: {
  pkgId: string;
  tree: TreeNode[];
  meta: Record<string, MetaEntry>;
  task: TaskState | undefined;
  allRunning: boolean;
  mode: string;
  onStart: (pkg: string, updateFirst: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pkgMeta = PKG_META[pkgId] ?? {
    label: pkgId,
    icon: '📦',
    description: '',
    dirPrefixes: [pkgId],
    envVarHint: '',
  };

  const sizeBytes   = getDirSize(tree, pkgMeta.dirPrefixes);
  const lastMeta    = getLastMeta(meta, pkgId);
  const isRunning   = task?.running ?? false;
  const taskDone    = isDone(task?.status?.status);
  const hasTask     = !!task?.taskId;
  const taskRunning = isRunning && !taskDone;

  const statusLabel =
    task?.status?.status === 'completed'             ? 'Готово' :
    task?.status?.status === 'failed'                ? 'Ошибка' :
    task?.status?.status === 'completed_with_errors' ? 'С ошибками' :
    task?.progress ? `${task.progress.percent}%` : 'Запуск...';

  const statusColor =
    task?.status?.status === 'completed'             ? 'text-green-600' :
    task?.status?.status === 'failed'                ? 'text-red-600' :
    task?.status?.status === 'completed_with_errors' ? 'text-yellow-600' :
    'text-blue-600';

  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* Основная строка */}
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
        {/* Иконка + название */}
        <div className="w-6 text-center text-base shrink-0">{pkgMeta.icon}</div>
        <div className="w-32 shrink-0">
          <span className="text-sm font-medium text-gray-800">{pkgMeta.label}</span>
          {pkgMeta.description && (
            <div className="text-xs text-gray-500 truncate">{pkgMeta.description}</div>
          )}
        </div>

        {/* Размер и дата */}
        <div className="flex-1 min-w-0">
          {sizeBytes > 0 ? (
            <span className="text-xs font-medium text-green-600">✓ {fmt(sizeBytes)}</span>
          ) : (
            <span className="text-xs text-gray-400">Не загружено</span>
          )}
          {lastMeta?.downloadedAt && (
            <span className="text-xs text-gray-400 ml-2">{fmtDate(lastMeta.downloadedAt)}</span>
          )}
          {lastMeta?.packageVersion && (
            <span className="text-xs text-gray-400 ml-2">v{lastMeta.packageVersion}</span>
          )}
        </div>

        {/* Мини прогресс */}
        {hasTask && (
          <div className="w-32 shrink-0">
            <div className={`text-xs mb-0.5 flex items-center gap-1 ${statusColor}`}>
              {taskRunning && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
              <span>{statusLabel}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1">
              <div
                className={`h-1 rounded-full transition-all duration-300 ${
                  task?.status?.status === 'failed'                ? 'bg-red-500' :
                  task?.status?.status === 'completed'             ? 'bg-green-500' :
                  task?.status?.status === 'completed_with_errors' ? 'bg-yellow-500' :
                  'bg-blue-500'
                }`}
                style={{ width: `${task?.progress?.percent ?? (taskRunning ? 5 : 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Кнопки */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onStart(pkgId, false)}
            disabled={taskRunning || allRunning}
            title="Скачать бинарники"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 rounded-md transition-colors"
          >
            <Download className="w-3 h-3" />
            Скачать
          </button>
          <button
            onClick={() => onStart(pkgId, true)}
            disabled={taskRunning || allRunning}
            title="Обновить npm-пакет до последней версии, затем скачать бинарники"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-md transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Обновить
          </button>
          {hasTask && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
              title="Лог"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Развёрнутый лог */}
      {expanded && hasTask && task && (
        <div className="px-4 pb-3 space-y-2 bg-gray-50 border-t border-gray-100">
          {task.progress && <ProgressBar task={task} />}
          {task.logs && (
            <pre className="text-xs text-gray-600 bg-white border border-gray-200 rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
              {task.logs.split('\n').slice(-30).join('\n')}
            </pre>
          )}
          {pkgMeta.envVarHint && sizeBytes > 0 && (
            <div className="text-xs text-gray-500 font-mono break-all bg-white border border-gray-200 rounded p-2">
              {pkgMeta.envVarHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Главный компонент
// ─────────────────────────────────────────────────────────────────────────────

export default function BinariesPanel() {
  const [data, setData]               = useState<ApiData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [mode, setMode]               = useState<'cdn-mirror' | 'local-extract'>('cdn-mirror');
  const [tasks, setTasks]             = useState<Record<string, TaskState>>({});
  const [treeOpen, setTreeOpen]       = useState(false);
  const [treeData, setTreeData]       = useState<TreeNode[] | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeSize, setTreeSize]       = useState(0);

  const tasksRef   = useRef(tasks);
  tasksRef.current = tasks;
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Быстрая загрузка — без обхода файловой системы
  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/binaries?skipTree=1');
      if (res.ok) setData(await res.json() as ApiData);
    } finally {
      setLoading(false);
    }
  }, []);

  // Ленивая загрузка дерева — только при открытии секции
  const loadTree = useCallback(async (force = false) => {
    if (treeData !== null && !force) return;
    setTreeLoading(true);
    try {
      const res = await fetch('/api/binaries');
      if (res.ok) {
        const d = await res.json() as ApiData;
        setTreeData(d.tree);
        setTreeSize(d.totalSize);
      }
    } finally {
      setTreeLoading(false);
    }
  }, [treeData]);

  const handleTreeToggle = useCallback(() => {
    setTreeOpen(v => {
      if (!v) loadTree();
      return !v;
    });
  }, [loadTree]);

  useEffect(() => { loadData(); }, [loadData]);

  const pollTasks = useCallback(async () => {
    const snapshot = tasksRef.current;
    const active = Object.entries(snapshot).filter(
      ([, s]) => s.taskId && (s.running || !isDone(s.status?.status))
    );
    if (active.length === 0) return;

    let anyJustFinished = false;
    await Promise.all(active.map(async ([pkg, state]) => {
      const res = await fetch(`/api/binaries?taskId=${state.taskId}`);
      if (!res.ok) return;
      const d = await res.json() as TaskState & { running: boolean };
      if (!isDone(state.status?.status) && isDone(d.status?.status)) {
        anyJustFinished = true;
      }
      setTasks(prev => ({ ...prev, [pkg]: { ...prev[pkg], ...d } }));
    }));

    if (anyJustFinished) {
      loadData();
      setTreeData(null); // инвалидируем кэш дерева
    }
  }, [loadData]);

  useEffect(() => {
    const hasActive = Object.values(tasks).some(
      t => t.running || (t.taskId && !isDone(t.status?.status))
    );
    if (hasActive && !pollingRef.current) {
      pollingRef.current = setInterval(pollTasks, 2000);
    } else if (!hasActive && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, [tasks, pollTasks]);

  useEffect(() => () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
  }, []);

  const startTask = useCallback(async (pkg: string, updateFirst: boolean) => {
    setTasks(prev => ({
      ...prev,
      [pkg]: {
        taskId: '',
        running: true,
        progress: null,
        status: { status: 'running', message: 'Запуск...', updatedAt: new Date().toISOString() },
        logs: '',
      },
    }));
    try {
      const res = await fetch('/api/binaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: pkg, mode, updateFirst }),
      });
      const { taskId } = await res.json() as { taskId: string };
      setTasks(prev => ({
        ...prev,
        [pkg]: { ...prev[pkg], taskId, running: true },
      }));
    } catch (e) {
      setTasks(prev => ({
        ...prev,
        [pkg]: {
          ...prev[pkg],
          running: false,
          status: { status: 'failed', message: String(e), updatedAt: new Date().toISOString() },
        },
      }));
    }
  }, [mode]);

  const anyRunning   = Object.values(tasks).some(t => t.running);
  const displaySize  = treeSize || data?.totalSize || 0;
  const tree         = treeData ?? [];
  const meta         = data?.metadata ?? {};
  const packages     = data?.availablePackages ?? [];

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Загрузка...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Шапка ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1">
            <h2 className="text-xl font-semibold flex items-center gap-2 text-gray-900">
              <HardDrive className="w-5 h-5 text-gray-600" />
              Бинарники
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Загружайте бинарники пакетов (Playwright, Electron, Puppeteer) для работы в закрытых сетях.
              {displaySize > 0 && (
                <span className="ml-2 font-medium text-gray-700">{fmt(displaySize)} всего</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={mode}
              onChange={e => setMode(e.target.value as typeof mode)}
              className="bg-white border border-gray-300 text-gray-700 text-sm rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="cdn-mirror">cdn-mirror</option>
              <option value="local-extract">local-extract</option>
            </select>
            <button
              onClick={loadData}
              className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
              title="Обновить"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => startTask('all', false)}
              disabled={anyRunning || packages.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="w-4 h-4" />
              Скачать всё
            </button>
          </div>
        </div>
      </div>

      {/* ── Список пакетов ─────────────────────────────────────────────── */}
      {packages.length === 0 ? (
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <HardDrive className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">Пакеты с бинарными зависимостями не найдены</p>
          <p className="text-sm text-gray-400 mt-1">
            Добавьте playwright-core, electron или puppeteer-core через раздел «Обновление».
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Заголовок таблицы */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <div className="w-6" />
            <div className="w-32">Пакет</div>
            <div className="flex-1">Статус</div>
            <div className="text-right pr-1">Действия</div>
          </div>

          {packages.map(pkgId => (
            <PackageRow
              key={pkgId}
              pkgId={pkgId}
              tree={tree}
              meta={meta}
              task={tasks[pkgId] ?? (tasks['all']?.taskId ? {
                ...tasks['all'],
                status: tasks['all'].status ? {
                  ...tasks['all'].status,
                  message: '(входит в «Скачать всё»)',
                } : null,
              } : undefined)}
              allRunning={tasks['all']?.running ?? false}
              mode={mode}
              onStart={startTask}
            />
          ))}
        </div>
      )}

      {/* ── Прогресс задачи "Скачать всё" ─────────────────────────────── */}
      {tasks['all']?.taskId && tasks['all'].running && (
        <div className="bg-white rounded-lg shadow-lg p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">Задача: все пакеты</p>
          <ProgressBar task={tasks['all']} />
          {tasks['all'].logs && (
            <pre className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2 mt-3 max-h-32 overflow-y-auto font-mono">
              {tasks['all'].logs.split('\n').slice(-15).join('\n')}
            </pre>
          )}
        </div>
      )}

      {/* ── Файловое дерево (ленивая загрузка) ────────────────────────── */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={handleTreeToggle}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-blue-500" />
            Файловое дерево бинарников
            {treeLoading && (
              <span className="flex items-center gap-1 text-xs text-blue-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                Загрузка...
              </span>
            )}
          </span>
          {treeOpen
            ? <ChevronUp className="w-4 h-4 text-gray-400" />
            : <ChevronDown className="w-4 h-4 text-gray-400" />
          }
        </button>
        {treeOpen && (
          <div className="px-4 pb-4 border-t border-gray-100">
            {treeLoading ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm mt-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                Читаем файловую систему...
              </div>
            ) : tree.length === 0 ? (
              <p className="text-sm text-gray-400 mt-3">Директория пуста или данные ещё не загружены</p>
            ) : (
              <div className="mt-3"><TreeView nodes={tree} /></div>
            )}
          </div>
        )}
      </div>

      {/* ── Инструкция ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <details>
          <summary className="px-4 py-3 text-sm text-gray-600 cursor-pointer hover:bg-gray-50 select-none list-none flex items-center gap-2 transition-colors">
            <span className="text-base">💡</span>
            Как использовать в закрытой сети
          </summary>
          <div className="px-4 pb-4 border-t border-gray-100 text-sm text-gray-700 space-y-4">
            <div className="mt-3">
              <p className="font-semibold text-gray-800 mb-2">cdn-mirror — HTTP-зеркало</p>
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 overflow-x-auto">{`PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn
ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron/
ELECTRON_CUSTOM_DIR={{ version }}
PUPPETEER_DOWNLOAD_BASE_URL=http://repo.dmn.zbr:8013/binaries/puppeteer-cdn`}</pre>
            </div>
            <div>
              <p className="font-semibold text-gray-800 mb-2">local-extract — папка</p>
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 overflow-x-auto">{`PLAYWRIGHT_BROWSERS_PATH=/path/to/playwright-browsers
PUPPETEER_CACHE_DIR=/path/to/puppeteer-cache`}</pre>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
