'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, FileText, RefreshCw, XCircle } from 'lucide-react';

export interface TaskHistoryItem {
  taskId: string;
  status: {
    status: string;
    message: string;
    updatedAt: string;
  } | null;
  running: boolean;
  updatedAt: string | null;
  hasLog: boolean;
}

interface LoadedLogState {
  logs: string;
  isLoading: boolean;
  error: string | null;
}

interface TaskHistoryListProps {
  title: string;
  tasks: TaskHistoryItem[];
  emptyText: string;
  getLabel?: (task: TaskHistoryItem) => string;
}

function getErrorLines(logs: string): string[] {
  const lines = logs
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const errorPattern = /(error|err!|failed|exception|traceback|npm ERR!)/i;
  const matched = lines.filter((line) => errorPattern.test(line));

  return matched.length > 0 ? matched : lines.slice(-40);
}

function getStatusIcon(status: string | undefined) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'completed_with_errors':
    case 'completed_with_issues':
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500" />;
    case 'running':
      return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
    default:
      return <Clock3 className="w-4 h-4 text-gray-400" />;
  }
}

function getStatusText(status: string | undefined) {
  switch (status) {
    case 'completed':
      return 'Завершено';
    case 'completed_with_errors':
      return 'С ошибками';
    case 'completed_with_issues':
      return 'Есть проблемы';
    case 'failed':
      return 'Ошибка';
    case 'running':
      return 'Выполняется';
    default:
      return 'Неизвестно';
  }
}

export function TaskHistoryList({ title, tasks, emptyText, getLabel }: TaskHistoryListProps) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [loadedLogs, setLoadedLogs] = useState<Record<string, LoadedLogState>>({});

  const loadTaskLogs = async (taskId: string) => {
    setLoadedLogs((prev) => ({
      ...prev,
      [taskId]: {
        logs: prev[taskId]?.logs ?? '',
        isLoading: true,
        error: null,
      },
    }));

    try {
      const res = await fetch(`/api/logs?taskId=${encodeURIComponent(taskId)}&tail=400`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Не удалось загрузить лог');
      }

      setLoadedLogs((prev) => ({
        ...prev,
        [taskId]: {
          logs: typeof data.logs === 'string' ? data.logs : '',
          isLoading: false,
          error: null,
        },
      }));
    } catch (error) {
      setLoadedLogs((prev) => ({
        ...prev,
        [taskId]: {
          logs: '',
          isLoading: false,
          error: error instanceof Error ? error.message : 'Не удалось загрузить лог',
        },
      }));
    }
  };

  const toggleLogs = async (taskId: string) => {
    if (expandedTaskId === taskId) {
      setExpandedTaskId(null);
      return;
    }

    setExpandedTaskId(taskId);
    if (!loadedLogs[taskId]) {
      await loadTaskLogs(taskId);
    }
  };

  const formatDate = (value: string | null) => {
    if (!value) {
      return 'нет времени';
    }

    return new Date(value).toLocaleString('ru-RU');
  };

  return (
    <div>
      <h3 className="font-medium mb-3">{title}</h3>

      {tasks.length === 0 ? (
        <div className="text-center py-4 text-gray-500">{emptyText}</div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {tasks.map((task) => (
            <div key={task.taskId} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {getStatusIcon(task.status?.status)}
                    <span className="text-sm font-medium text-gray-900">
                      {getLabel?.(task) ?? task.taskId}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">{formatDate(task.updatedAt)}</div>
                  {task.status?.message && (
                    <div className="mt-1 text-sm text-gray-700 break-words">{task.status.message}</div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-gray-500">{getStatusText(task.status?.status)}</span>
                  {task.hasLog && (
                    <button
                      onClick={() => void toggleLogs(task.taskId)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-700 hover:bg-red-50 hover:text-red-800"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {expandedTaskId === task.taskId ? 'Скрыть лог' : 'Показать лог'}
                    </button>
                  )}
                </div>
              </div>

              {expandedTaskId === task.taskId && task.hasLog && (
                <div className="mt-3 rounded-lg border border-red-200 bg-white p-3">
                  {loadedLogs[task.taskId]?.isLoading ? (
                    <div className="text-sm text-gray-500">Загрузка лога...</div>
                  ) : loadedLogs[task.taskId]?.error ? (
                    <div className="text-sm text-red-600">{loadedLogs[task.taskId]?.error}</div>
                  ) : loadedLogs[task.taskId]?.logs ? (
                    <>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                        Ключевые строки
                      </div>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-red-50 p-3 text-xs text-red-900">
                        {getErrorLines(loadedLogs[task.taskId].logs).join('\n')}
                      </pre>
                    </>
                  ) : (
                    <div className="text-sm text-gray-500">Лог пустой</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}