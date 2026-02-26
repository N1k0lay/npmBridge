'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
  availablePackages: string[];   // пакеты, найденные в storage
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
// Статические мета-данные пакетов (для UI, не для бизнес-логики)
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
    return p === pkgId ||
      p.startsWith(pkgId) ||
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
  const color =
    s === 'failed'               ? 'text-red-400' :
    s === 'completed'            ? 'text-green-400' :
    s === 'completed_with_errors'? 'text-yellow-400' :
    'text-blue-400';

  return (
    <div className="space-y-1.5">
      <div className={`text-xs font-medium ${color} flex items-center gap-1`}>
        {task.running && <span className="animate-pulse">●</span>}
        <span>{task.status?.message ?? 'Обработка...'}</span>
      </div>
      {task.progress && (
        <>
          <div className="flex justify-between text-xs text-zinc-500">
            <span className="truncate max-w-[70%]">{task.progress.currentPackage}</span>
            <span>{task.progress.percent}%</span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1">
            <div
              className={`h-1 rounded-full transition-all duration-300 ${
                s === 'failed' ? 'bg-red-500' :
                s === 'completed' ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${task.progress.percent}%` }}
            />
          </div>
          {(task.progress.failed ?? 0) > 0 && (
            <div className="text-xs text-red-400">
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
  if (!nodes.length) return <span className="text-zinc-500 text-xs">(пусто)</span>;
  return (
    <ul className="space-y-0.5">
      {nodes.map(n => (
        <li key={n.name} style={{ paddingLeft: depth * 14 }}>
          {n.type === 'dir' ? (
            <>
              <button
                onClick={() => setOpen(o => ({ ...o, [n.name]: !o[n.name] }))}
                className="flex items-center gap-1 text-xs text-zinc-300 hover:text-white"
              >
                <span className="w-3">{open[n.name] ? '▾' : '▸'}</span>
                <span>📁 {n.name}</span>
                {n.size !== undefined && (
                  <span className="text-zinc-600 ml-1">{fmt(n.size)}</span>
                )}
              </button>
              {open[n.name] && n.children && (
                <TreeView nodes={n.children} depth={depth + 1} />
              )}
            </>
          ) : (
            <div className="flex items-center gap-1 text-xs text-zinc-500 pl-3">
              <span>📄 {n.name}</span>
              {n.size !== undefined && <span className="text-zinc-700">{fmt(n.size)}</span>}
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

  return (
    <div className="border-b border-zinc-800 last:border-0">
      {/* Основная строка */}
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/40">
        {/* Иконка + название */}
        <div className="w-6 text-center text-base shrink-0">{pkgMeta.icon}</div>
        <div className="w-28 shrink-0">
          <span className="text-sm font-medium text-zinc-200">{pkgMeta.label}</span>
          {pkgMeta.description && (
            <div className="text-xs text-zinc-500 truncate">{pkgMeta.description}</div>
          )}
        </div>

        {/* Размер и дата */}
        <div className="flex-1 min-w-0">
          {sizeBytes > 0 ? (
            <span className="text-xs text-green-400">✓ {fmt(sizeBytes)}</span>
          ) : (
            <span className="text-xs text-zinc-600">Не загружено</span>
          )}
          {lastMeta?.downloadedAt && (
            <span className="text-xs text-zinc-600 ml-2">{fmtDate(lastMeta.downloadedAt)}</span>
          )}
          {lastMeta?.packageVersion && (
            <span className="text-xs text-zinc-700 ml-2">v{lastMeta.packageVersion}</span>
          )}
        </div>

        {/* Прогресс-бар (компактный) */}
        {hasTask && (
          <div className="w-32 shrink-0">
            <div className="flex justify-between text-xs text-zinc-500 mb-0.5">
              <span className={
                task?.status?.status === 'completed' ? 'text-green-400' :
                task?.status?.status === 'failed' ? 'text-red-400' :
                task?.status?.status === 'completed_with_errors' ? 'text-yellow-400' : 'text-blue-400'
              }>
                {taskRunning && <span className="animate-pulse mr-1">●</span>}
                {task?.status?.status === 'completed' ? 'Готово' :
                 task?.status?.status === 'failed' ? 'Ошибка' :
                 task?.status?.status === 'completed_with_errors' ? 'С ошибками' :
                 task?.progress ? `${task.progress.percent}%` : 'Запуск...'}
              </span>
            </div>
            <div className="w-full bg-zinc-700 rounded-full h-1">
              <div
                className={`h-1 rounded-full transition-all duration-300 ${
                  task?.status?.status === 'failed' ? 'bg-red-500' :
                  task?.status?.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'
                }`}
                style={{ width: `${task?.progress?.percent ?? (taskRunning ? 5 : 0)}%` }}
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
            className="px-2.5 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white rounded"
          >
            ⬇
          </button>
          <button
            onClick={() => onStart(pkgId, true)}
            disabled={taskRunning || allRunning}
            title="Обновить npm-пакет до последней версии, затем скачать бинарники"
            className="px-2 py-1 text-xs bg-indigo-800 hover:bg-indigo-700 disabled:opacity-40 text-white rounded"
          >
            🔄
          </button>
          {hasTask && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
              title="Лог"
            >
              {expanded ? '▲' : '▼'}
            </button>
          )}
        </div>
      </div>

      {/* Развёрнутый лог */}
      {expanded && hasTask && task && (
        <div className="px-4 pb-3 space-y-2">
          {task.progress && <ProgressBar task={task} />}
          {task.logs && (
            <pre className="text-xs text-zinc-500 bg-zinc-950 rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
              {task.logs.split('\n').slice(-30).join('\n')}
            </pre>
          )}
          {pkgMeta.envVarHint && sizeBytes > 0 && (
            <div className="text-xs text-zinc-600 font-mono break-all">
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
  const [data, setData]   = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode]   = useState<'cdn-mirror' | 'local-extract'>('cdn-mirror');
  const [tasks, setTasks] = useState<Record<string, TaskState>>({});
  const [treeOpen, setTreeOpen] = useState(false);

  // ── ref для polling (избегаем stale closure в setInterval) ──────────────
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/binaries');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // pollTasks читает из ref — не создаёт stale closure
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

    if (anyJustFinished) loadData();
  }, [loadData]);

  // Запускаем интервал один раз, управляем в зависимости от наличия активных задач
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

  // Чистим при размонтировании
  useEffect(() => () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
  }, []);

  // ── Запуск задачи ────────────────────────────────────────────────────────
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

  const anyRunning = Object.values(tasks).some(t => t.running);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-500 gap-2">
        <span className="animate-spin">⟳</span> Загрузка...
      </div>
    );
  }

  const tree     = data?.tree ?? [];
  const meta     = data?.metadata ?? {};
  const packages = data?.availablePackages ?? [];

  return (
    <div className="space-y-4">
      {/* ── Шапка ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-white">Бинарники</h2>
          <p className="text-sm text-zinc-400">
            Загрузите бинарники для использования в закрытых сетях.
            {data && data.totalSize > 0 && (
              <span className="ml-2 text-zinc-500">{fmt(data.totalSize)}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={mode}
            onChange={e => setMode(e.target.value as typeof mode)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm rounded px-2 py-1.5"
          >
            <option value="cdn-mirror">cdn-mirror (HTTP-зеркало)</option>
            <option value="local-extract">local-extract (папка)</option>
          </select>
          <button
            onClick={loadData}
            className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700"
          >
            ↻
          </button>
          <button
            onClick={() => startTask('all', false)}
            disabled={anyRunning || packages.length === 0}
            className="px-3 py-1.5 text-sm bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded"
          >
            ⬇ Скачать всё
          </button>
        </div>
      </div>

      {/* ── Список пакетов ─────────────────────────────────────────────── */}
      {packages.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500 text-sm">
          <p>Пакеты с бинарными зависимостями не найдены в storage.</p>
          <p className="text-xs mt-1 text-zinc-600">
            Добавьте playwright-core, electron или puppeteer-core через раздел «Обновление».
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {/* Заголовок таблицы */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 text-xs text-zinc-600 uppercase tracking-wide">
            <div className="w-6" />
            <div className="w-28">Пакет</div>
            <div className="flex-1">Размер / дата</div>
            <div className="text-right pr-1">Действия</div>
          </div>

          {/* Строки пакетов */}
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
                  message: '(входит в "Скачать всё")',
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
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-400 font-medium mb-2">Задача: все пакеты</p>
          <ProgressBar task={tasks['all']} />
          {tasks['all'].logs && (
            <pre className="text-xs text-zinc-500 bg-zinc-950 rounded p-2 mt-2 max-h-32 overflow-y-auto font-mono">
              {tasks['all'].logs.split('\n').slice(-15).join('\n')}
            </pre>
          )}
        </div>
      )}

      {/* ── Файловое дерево ────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setTreeOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-400 hover:bg-zinc-800"
        >
          <span>📁 Файловое дерево бинарников</span>
          <span className="text-zinc-600 text-xs">{treeOpen ? '▲' : '▼'}</span>
        </button>
        {treeOpen && (
          <div className="px-4 pb-4 border-t border-zinc-800">
            {tree.length === 0 ? (
              <p className="text-xs text-zinc-600 mt-3">Директория пуста</p>
            ) : (
              <div className="mt-3"><TreeView nodes={tree} /></div>
            )}
          </div>
        )}
      </div>

      {/* ── Инструкция ────────────────────────────────────────────────── */}
      <details className="bg-zinc-900 border border-zinc-800 rounded-xl">
        <summary className="px-4 py-3 text-sm text-zinc-500 cursor-pointer hover:text-zinc-300 select-none">
          💡 Как использовать в закрытой сети
        </summary>
        <div className="px-4 pb-4 text-xs text-zinc-400 space-y-3">
          <div>
            <p className="font-semibold text-zinc-300 mb-1">cdn-mirror — HTTP-зеркало</p>
            <pre className="bg-zinc-950 rounded p-2 text-zinc-300 overflow-x-auto">{`PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn
ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron/
ELECTRON_CUSTOM_DIR={{ version }}
PUPPETEER_DOWNLOAD_BASE_URL=http://repo.dmn.zbr:8013/binaries/puppeteer-cdn`}</pre>
          </div>
          <div>
            <p className="font-semibold text-zinc-300 mb-1">local-extract — папка</p>
            <pre className="bg-zinc-950 rounded p-2 text-zinc-300 overflow-x-auto">{`PLAYWRIGHT_BROWSERS_PATH=/path/to/playwright-browsers
PUPPETEER_CACHE_DIR=/path/to/puppeteer-cache`}</pre>
          </div>
        </div>
      </details>
    </div>
  );
}
