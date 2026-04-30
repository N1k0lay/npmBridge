'use client';

import { useState, useEffect, useCallback } from 'react';
import { History, RefreshCw, Check, XCircle, AlertTriangle, Clock, FileText } from 'lucide-react';

interface UpdateRecord {
  id: string;
  type: 'full' | 'recent' | 'single';
  startedAt: string;
  finishedAt: string | null;
  status: string;
  packagesTotal: number;
  packagesSuccess: number;
  packagesFailed: number;
}

interface LoadedLogState {
  logs: string;
  isLoading: boolean;
  error: string | null;
}

interface HistoryPanelProps {
  refreshTrigger?: number;
}

export function HistoryPanel({ refreshTrigger }: HistoryPanelProps) {
  const [updates, setUpdates] = useState<UpdateRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [loadedLogs, setLoadedLogs] = useState<Record<string, LoadedLogState>>({});

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/update');
      const data = await res.json();
      setUpdates(data.updates || []);
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, refreshTrigger]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('ru-RU');
  };

  const loadTaskLogs = useCallback(async (taskId: string) => {
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
  }, []);

  const toggleTaskLogs = async (taskId: string) => {
    if (expandedTaskId === taskId) {
      setExpandedTaskId(null);
      return;
    }

    setExpandedTaskId(taskId);
    if (!loadedLogs[taskId]) {
      await loadTaskLogs(taskId);
    }
  };

  const getErrorLines = (logs: string) => {
    const lines = logs
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean);

    const errorPattern = /(error|err!|failed|exception|traceback|npm ERR!)/i;
    const matched = lines.filter((line) => errorPattern.test(line));

    return matched.length > 0 ? matched : lines.slice(-40);
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return 'В процессе...';
    
    const duration = new Date(end).getTime() - new Date(start).getTime();
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    
    if (minutes > 0) {
      return `${minutes} мин ${seconds} сек`;
    }
    return `${seconds} сек`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <Check className="w-4 h-4 text-green-500" />;
      case 'completed_with_errors':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'running':
        return 'Выполняется';
      case 'completed':
        return 'Завершено';
      case 'completed_with_errors':
        return 'С ошибками';
      case 'failed':
        return 'Ошибка';
      default:
        return status;
    }
  };

  const getUpdateTitle = (update: UpdateRecord) => {
    switch (update.type) {
      case 'full':
        return 'Полное обновление';
      case 'recent':
        return 'Обновление недавних';
      case 'single':
        return 'Установка одного пакета';
      default:
        return 'Обновление';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <History className="w-5 h-5" />
          История обновлений
        </h2>
        <button
          onClick={loadHistory}
          className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-gray-500">Загрузка...</div>
      ) : updates.length === 0 ? (
        <div className="text-center py-8 text-gray-500">История пуста</div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {updates.map((update) => (
            <div
              key={update.id}
              className="p-4 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getStatusIcon(update.status)}
                  <span className="font-medium">
                    {getUpdateTitle(update)}
                  </span>
                </div>
                <span className="text-sm text-gray-500">
                  {getStatusText(update.status)}
                </span>
              </div>
              
              <div className="text-sm text-gray-600 space-y-1">
                <div className="flex justify-between">
                  <span>Начало:</span>
                  <span>{formatDate(update.startedAt)}</span>
                </div>
                
                {update.finishedAt && (
                  <div className="flex justify-between">
                    <span>Длительность:</span>
                    <span>{formatDuration(update.startedAt, update.finishedAt)}</span>
                  </div>
                )}
                
                {update.packagesTotal > 0 && (
                  <div className="flex justify-between">
                    <span>Пакетов:</span>
                    <span>
                      <span className="text-green-600">{update.packagesSuccess}</span>
                      {update.packagesFailed > 0 && (
                        <span className="text-red-600"> / {update.packagesFailed} ошибок</span>
                      )}
                      <span className="text-gray-400"> из {update.packagesTotal}</span>
                    </span>
                  </div>
                )}
              </div>

              {(update.status === 'failed' || update.status === 'completed_with_errors') && (
                <div className="mt-3 border-t border-gray-200 pt-3">
                  <button
                    onClick={() => void toggleTaskLogs(update.id)}
                    className="inline-flex items-center gap-2 text-sm text-red-700 hover:text-red-800 font-medium"
                  >
                    <FileText className="w-4 h-4" />
                    {expandedTaskId === update.id ? 'Скрыть ошибки' : 'Показать ошибки'}
                  </button>

                  {expandedTaskId === update.id && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-white p-3">
                      {loadedLogs[update.id]?.isLoading ? (
                        <div className="text-sm text-gray-500">Загрузка лога...</div>
                      ) : loadedLogs[update.id]?.error ? (
                        <div className="text-sm text-red-600">{loadedLogs[update.id]?.error}</div>
                      ) : loadedLogs[update.id]?.logs ? (
                        <>
                          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                            Найденные строки с ошибками
                          </div>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-red-50 p-3 text-xs text-red-900">
                            {getErrorLines(loadedLogs[update.id].logs).join('\n')}
                          </pre>
                        </>
                      ) : (
                        <div className="text-sm text-gray-500">Лог пустой</div>
                      )}
                    </div>
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
