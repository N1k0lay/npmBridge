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
// Конфигурация пакетов
// ─────────────────────────────────────────────────────────────────────────────

const PACKAGES = [
  {
    id: 'playwright',
    label: 'Playwright',
    icon: '🎭',
    description: 'Браузеры для тестирования и автоматизации: Chromium, Firefox, WebKit',
    dirPrefixes: ['playwright-cdn', 'playwright-browsers'],
    envVarHint: 'PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn',
  },
  {
    id: 'electron',
    label: 'Electron',
    icon: '⚡',
    description: 'Runtime для десктопных приложений Node.js + Chromium',
    dirPrefixes: ['electron'],
    envVarHint: 'ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron/',
  },
  {
    id: 'puppeteer',
    label: 'Puppeteer',
    icon: '🤖',
    description: 'Chrome for Testing для скрейпинга и headless браузера',
    dirPrefixes: ['puppeteer-cdn', 'puppeteer-cache'],
    envVarHint: 'PUPPETEER_DOWNLOAD_BASE_URL=http://repo.dmn.zbr:8013/binaries/puppeteer-cdn',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
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
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}

function getPackageSize(tree: TreeNode[], prefixes: readonly string[]): number {
  return tree
    .filter(n => n.type === 'dir' && prefixes.some(p => n.name.startsWith(p)))
    .reduce((s, n) => s + (n.size ?? 0), 0);
}

function getPackageMeta(meta: Record<string, MetaEntry>, pkgId: string): MetaEntry | null {
  const entries = Object.values(meta).filter(m => {
    const p = m.package || '';
    return p.startsWith(pkgId) || (pkgId === 'playwright' && p.startsWith('playwright'));
  });
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

function isStatusDone(status: string): boolean {
  return status === 'completed' || status === 'completed_with_errors' || status === 'failed';
}

// ─────────────────────────────────────────────────────────────────────────────
// TreeView компонент
// ─────────────────────────────────────────────────────────────────────────────

function TreeView({ nodes, depth = 0 }: { nodes: TreeNode[]; depth?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!nodes.length) return <span className="text-zinc-500 text-xs">(пусто)</span>;
  return (
    <ul className="space-y-0.5">
      {nodes.map((n) => (
        <li key={n.name} style={{ paddingLeft: depth * 16 }}>
          {n.type === 'dir' ? (
            <>
              <button
                onClick={() => setOpen(o => ({ ...o, [n.name]: !o[n.name] }))}
                className="flex items-center gap-1 text-xs text-zinc-300 hover:text-white"
              >
                <span>{open[n.name] ? '▼' : '▶'}</span>
                <span>📁 {n.name}</span>
                {n.size !== undefined && (
                  <span className="text-zinc-500 ml-1">{fmt(n.size)}</span>
                )}
              </button>
              {open[n.name] && n.children && (
                <TreeView nodes={n.children} depth={depth + 1} />
              )}
            </>
          ) : (
            <div className="flex items-center gap-1 text-xs text-zinc-400">
              <span>📄 {n.name}</span>
              {n.size !== undefined && (
                <span className="text-zinc-600">{fmt(n.size)}</span>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TaskProgress компонент
// ─────────────────────────────────────────────────────────────────────────────

function TaskBlock({ task, showLogs }: { task: TaskState; showLogs?: boolean }) {
  const statusColor =
    task.status?.status === 'failed' ? 'text-red-400' :
    task.status?.status === 'completed' ? 'text-green-400' :
    task.status?.status === 'completed_with_errors' ? 'text-yellow-400' :
    'text-blue-400';

  return (
    <div className="mt-3 space-y-2">
      {task.status && (
        <div className={`text-xs font-medium ${statusColor}`}>
          {task.running && <span className="inline-block animate-pulse mr-1">●</span>}
          {task.status.message}
        </div>
      )}
      {task.progress && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-zinc-400">
            <span>{task.progress.currentPackage || 'Обработка...'}</span>
            <span>{task.progress.percent}%</span>
          </div>
          <div className="w-full bg-zinc-700 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${task.progress.percent}%` }}
            />
          </div>
          <div className="flex gap-3 text-xs text-zinc-500">
            <span>✓ {task.progress.success ?? task.progress.current}</span>
            {(task.progress.failed ?? 0) > 0 && (
              <span className="text-red-400">✗ {task.progress.failed}</span>
            )}
          </div>
        </div>
      )}
      {showLogs && task.logs && (
        <pre className="text-xs text-zinc-400 bg-zinc-950 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
          {task.logs.split('\n').slice(-20).join('\n')}
        </pre>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Главный компонент
// ─────────────────────────────────────────────────────────────────────────────

export default function BinariesPanel() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'cdn-mirror' | 'local-extract'>('cdn-mirror');
  const [tasks, setTasks] = useState<Record<string, TaskState>>({});
  const [treeOpen, setTreeOpen] = useState(false);
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

  // Polling активных задач
  const pollTasks = useCallback(async () => {
    const allTasks = { ...tasks };
    let anyRunning = false;
    let anyJustFinished = false;

    await Promise.all(
      Object.entries(allTasks).map(async ([pkg, state]) => {
        if (!state.taskId) return;
        // Продолжаем поллить пока running, или пока статус не finalized
        const shouldPoll = state.running || !isStatusDone(state.status?.status ?? '');
        if (!shouldPoll) return;

        const res = await fetch(`/api/binaries?taskId=${state.taskId}`);
        if (!res.ok) return;
        const d = await res.json();
        const wasDone = isStatusDone(state.status?.status ?? '');
        const isDone = isStatusDone(d.status?.status ?? '');
        if (!wasDone && isDone) anyJustFinished = true;
        if (d.running) anyRunning = true;

        setTasks(prev => ({
          ...prev,
          [pkg]: { ...prev[pkg], ...d },
        }));
      })
    );

    if (anyJustFinished) {
      // Обновляем дерево после завершения
      loadData();
    }
  }, [tasks, loadData]);

  // Запускаем/останавливаем polling
  useEffect(() => {
    const hasActive = Object.values(tasks).some(t =>
      t.running || (t.taskId && !isStatusDone(t.status?.status ?? ''))
    );
    if (hasActive) {
      if (!pollingRef.current) {
        pollingRef.current = setInterval(pollTasks, 2000);
      }
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [tasks, pollTasks]);

  const startTask = async (pkg: string, updateFirst: boolean) => {
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
      const { taskId } = await res.json();
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
  };

  const startAll = async () => {
    await startTask('all', false);
  };

  const allRunning = Object.values(tasks).some(t => t.running);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-500">
        <span className="animate-spin mr-2">⟳</span> Загрузка...
      </div>
    );
  }

  const tree = data?.tree ?? [];
  const meta = data?.metadata ?? {};

  return (
    <div className="space-y-6">
      {/* ── Заголовок и глобальные кнопки ──────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-white">Бинарники</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            Загрузите бинарники заранее для использования в закрытых сетях.
            {data && (
              <span className="ml-2 text-zinc-500">
                Всего: {fmt(data.totalSize)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Режим */}
          <select
            value={mode}
            onChange={e => setMode(e.target.value as typeof mode)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm rounded px-2 py-1.5"
          >
            <option value="cdn-mirror">cdn-mirror (HTTP-зеркало)</option>
            <option value="local-extract">local-extract (распакованные файлы)</option>
          </select>
          <button
            onClick={() => loadData()}
            className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-600"
          >
            ↻ Обновить
          </button>
          <button
            onClick={startAll}
            disabled={allRunning}
            className="px-3 py-1.5 text-sm bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded"
          >
            ⬇ Скачать всё
          </button>
        </div>
      </div>

      {/* ── Карточки пакетов ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PACKAGES.map(pkg => {
          const task = tasks[pkg.id];
          const sizeBytes = getPackageSize(tree, pkg.dirPrefixes);
          const lastMeta = getPackageMeta(meta, pkg.id);
          const isRunning = task?.running ?? false;
          const isDone = isStatusDone(task?.status?.status ?? '');

          return (
            <div
              key={pkg.id}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3"
            >
              {/* Заголовок карточки */}
              <div className="flex items-start gap-2">
                <span className="text-2xl leading-none">{pkg.icon}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-white">{pkg.label}</h3>
                  <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                    {pkg.description}
                  </p>
                </div>
              </div>

              {/* Статус загрузки */}
              <div className="flex items-center justify-between">
                <div className="text-xs text-zinc-500">
                  {sizeBytes > 0 ? (
                    <span className="text-green-400">✓ {fmt(sizeBytes)}</span>
                  ) : (
                    <span className="text-zinc-500">Не загружено</span>
                  )}
                </div>
                {lastMeta?.downloadedAt && (
                  <span className="text-xs text-zinc-600">
                    {fmtDate(lastMeta.downloadedAt)}
                  </span>
                )}
              </div>
              {lastMeta?.packageVersion && (
                <div className="text-xs text-zinc-600">
                  версия: {lastMeta.packageVersion}
                  {lastMeta.browserRevision && ` · rev ${lastMeta.browserRevision}`}
                  {lastMeta.chromeVersion && ` · Chrome ${lastMeta.chromeVersion}`}
                </div>
              )}

              {/* Прогресс/статус */}
              {task?.taskId && (
                <TaskBlock task={task} showLogs={false} />
              )}
              {/* Дополнительный блок "all" когда Скачать всё */}
              {tasks['all']?.taskId && !task?.taskId && (
                <div className="text-xs text-zinc-500 italic">
                  (включён в общую задачу)
                </div>
              )}

              {/* Кнопки */}
              <div className="flex gap-2 mt-auto pt-1">
                <button
                  onClick={() => startTask(pkg.id, false)}
                  disabled={isRunning || tasks['all']?.running}
                  className="flex-1 px-2 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white rounded"
                >
                  {isRunning && !isDone ? (
                    <span className="animate-pulse">⟳ Загрузка...</span>
                  ) : (
                    '⬇ Скачать'
                  )}
                </button>
                <button
                  onClick={() => startTask(pkg.id, true)}
                  disabled={isRunning || tasks['all']?.running}
                  title="Обновляет npm-пакет до последней версии в storage, затем скачивает актуальные бинарники"
                  className="flex-1 px-2 py-1.5 text-xs bg-indigo-800 hover:bg-indigo-700 disabled:opacity-40 text-white rounded"
                >
                  🔄 Обновить пакет + скачать
                </button>
              </div>

              {/* env-var подсказка */}
              {sizeBytes > 0 && (
                <div className="mt-1">
                  <p className="text-xs text-zinc-600 break-all font-mono">
                    {pkg.envVarHint}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Глобальная задача "Скачать всё" ───────────────────────────── */}
      {tasks['all']?.taskId && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-2">
            Задача: все пакеты
          </h3>
          <TaskBlock task={tasks['all']} showLogs={true} />
        </div>
      )}

      {/* ── Подробные логи для запущенных пакетов ──────────────────────── */}
      {Object.entries(tasks)
        .filter(([pkg, t]) => pkg !== 'all' && t.running && t.logs)
        .map(([pkg, t]) => (
          <div key={pkg} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-2">
              Лог: {pkg}
            </h3>
            <TaskBlock task={t} showLogs={true} />
          </div>
        ))}

      {/* ── Дерево файлов (сворачиваемое) ─────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setTreeOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          <span>📁 Файловое дерево бинарников</span>
          <span className="text-zinc-500">{treeOpen ? '▲ Скрыть' : '▼ Показать'}</span>
        </button>
        {treeOpen && (
          <div className="px-4 pb-4 border-t border-zinc-800">
            {tree.length === 0 ? (
              <p className="text-xs text-zinc-500 mt-3">Директория пуста</p>
            ) : (
              <div className="mt-3">
                <TreeView nodes={tree} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Инструкция ────────────────────────────────────────────────── */}
      <details className="bg-zinc-900 border border-zinc-800 rounded-xl">
        <summary className="px-4 py-3 text-sm text-zinc-400 cursor-pointer hover:text-zinc-300 select-none">
          💡 Как использовать в закрытой сети
        </summary>
        <div className="px-4 pb-4 text-xs text-zinc-400 space-y-3">
          <div>
            <p className="font-semibold text-zinc-300 mb-1">Режим cdn-mirror (HTTP-зеркало)</p>
            <p>Установите переменные окружения перед <code>npm install</code>:</p>
            <pre className="bg-zinc-950 rounded p-2 mt-1 text-zinc-300 overflow-x-auto">{`PLAYWRIGHT_DOWNLOAD_HOST=http://repo.dmn.zbr:8013/binaries/playwright-cdn
ELECTRON_MIRROR=http://repo.dmn.zbr:8013/binaries/electron/
ELECTRON_CUSTOM_DIR={{ version }}
PUPPETEER_DOWNLOAD_BASE_URL=http://repo.dmn.zbr:8013/binaries/puppeteer-cdn`}</pre>
          </div>
          <div>
            <p className="font-semibold text-zinc-300 mb-1">Режим local-extract (папка)</p>
            <p>Скопируйте папку <code>binaries/playwright-browsers</code> на целевую машину и:</p>
            <pre className="bg-zinc-950 rounded p-2 mt-1 text-zinc-300 overflow-x-auto">{`PLAYWRIGHT_BROWSERS_PATH=/path/to/playwright-browsers
PUPPETEER_CACHE_DIR=/path/to/puppeteer-cache`}</pre>
          </div>
        </div>
      </details>
    </div>
  );
}
