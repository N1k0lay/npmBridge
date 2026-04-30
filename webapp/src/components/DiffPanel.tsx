'use client';

import { useState, useEffect } from 'react';
import { Package, Download, Check, AlertTriangle, Clock, Archive, RefreshCw, Network, CheckCircle2, Square } from 'lucide-react';
import { useTaskPolling, TaskProgress, TaskStatus } from '@/hooks/useTaskPolling';
import { ProgressBar } from './ProgressBar';
import { TaskHistoryItem, TaskHistoryList } from './TaskHistoryList';

interface NetworkConfig {
  id: string;
  name: string;
  description: string;
  color: string;
}

interface DiffTransfer {
  networkId: string;
  transferredAt: string;
}

interface Diff {
  id: string;
  createdAt: string;
  status: 'pending' | 'transferred' | 'outdated' | 'partial';
  transfers: DiffTransfer[];
  archiveSize: number;
  archiveSizeHuman: string;
  filesCount: number;
}

interface DiffPanelProps {
  onRefresh?: () => void;
}

export function DiffPanel({ onRefresh }: DiffPanelProps) {
  const [diffs, setDiffs] = useState<Diff[]>([]);
  const [pendingDiff, setPendingDiff] = useState<Diff | null>(null);
  const [networks, setNetworks] = useState<NetworkConfig[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [confirmingNetwork, setConfirmingNetwork] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastProgress, setLastProgress] = useState<TaskProgress | null>(null);
  const [lastStatus, setLastStatus] = useState<TaskStatus | null>(null);
  const [recentTasks, setRecentTasks] = useState<TaskHistoryItem[]>([]);

  const loadNetworks = async () => {
    try {
      const res = await fetch('/api/networks');
      const data = await res.json();
      setNetworks(data.networks || []);
    } catch (error) {
      console.error('Error loading networks:', error);
    }
  };

  const loadDiffs = async () => {
    try {
      const res = await fetch('/api/diff');
      const data = await res.json();
      setDiffs(data.diffs || []);
      setPendingDiff(data.pendingDiff);
      setRecentTasks(data.recentTasks || []);
      if (data.runningTaskId) {
        setTaskId((current) => current || data.runningTaskId);
      }
    } catch (error) {
      console.error('Error loading diffs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const { progress, status, isRunning, logs } = useTaskPolling({
    taskId,
    endpoint: '/api/diff',
    onComplete: async (finalStatus) => {
      setTaskId(null);
      if (finalStatus) {
        setLastStatus(finalStatus);
      }
      await loadDiffs();
      onRefresh?.();
    },
  });

  useEffect(() => {
    if (progress) {
      setLastProgress(progress);
    }
    if (status) {
      setLastStatus(status);
    }
  }, [progress, status]);

  useEffect(() => {
    Promise.all([loadNetworks(), loadDiffs()]);
  }, []);

  const createDiff = async () => {
    setIsCreating(true);
    setLastProgress(null);
    setLastStatus(null);
    try {
      const res = await fetch('/api/diff', {
        method: 'POST',
      });
      const data = await res.json();
      
      if (res.ok) {
        setTaskId(data.taskId);
      } else if (res.status === 409 && data.taskId) {
        setTaskId(data.taskId);
      } else {
        if (res.status === 409 && data.diff) {
          setPendingDiff(data.diff);
          await loadDiffs();
        }
        alert(data.error || 'Ошибка создания diff');
      }
    } catch {
      alert('Ошибка сети');
    } finally {
      setIsCreating(false);
    }
  };

  const stopCreatingDiff = async () => {
    if (!taskId) {
      return;
    }

    try {
      const res = await fetch(`/api/diff?taskId=${taskId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Ошибка остановки diff');
        return;
      }

      setTaskId(null);
      setLastStatus({
        status: 'failed',
        message: 'Создание diff остановлено пользователем',
      });
    } catch {
      alert('Ошибка сети');
    }
  };

  const confirmTransfer = async (diffId: string, networkId: string) => {
    const network = networks.find(n => n.id === networkId);
    if (!confirm(`Вы уверены, что перенесли diff в сеть "${network?.name || networkId}"?`)) {
      return;
    }
    
    setConfirmingNetwork(networkId);
    try {
      const res = await fetch('/api/diff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diffId,
          action: 'confirm_transfer',
          networkId,
        }),
      });
      
      if (res.ok) {
        const data = await res.json();
        // Обновляем pendingDiff если он вернулся
        if (data.diff) {
          if (data.diff.status === 'transferred') {
            setPendingDiff(null);
          } else {
            setPendingDiff(data.diff);
          }
        }
        await loadDiffs();
        onRefresh?.();
      } else {
        const data = await res.json();
        alert(data.error || 'Ошибка подтверждения');
      }
    } catch {
      alert('Ошибка сети');
    } finally {
      setConfirmingNetwork(null);
    }
  };

  const downloadDiff = (diffId: string) => {
    window.open(`/api/diff/${diffId}/download`, '_blank');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('ru-RU');
  };

  const formatDuration = (ms: number) => {
    if (!Number.isFinite(ms) || ms <= 0) {
      return 'меньше минуты';
    }

    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}ч ${minutes}м`;
    }
    if (minutes > 0) {
      return `${minutes}м ${seconds}с`;
    }
    return `${seconds}с`;
  };

  const formatBytes = (value: number) => {
    let size = value;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }

    return `${size.toFixed(size >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };

  const displayProgress = progress ?? lastProgress;
  const displayStatus = status ?? lastStatus;
  const taskStartedAt = taskId?.startsWith('diff_task_') ? Number(taskId.slice('diff_task_'.length)) : NaN;
  const elapsedMs = Number.isFinite(taskStartedAt) ? Math.max(Date.now() - taskStartedAt, 0) : 0;
  const etaMs = isRunning && displayProgress && displayProgress.phase === 'archiving' && displayProgress.percent > 1
    ? elapsedMs * (100 - displayProgress.percent) / displayProgress.percent
    : null;

  const getNetworkById = (networkId: string): NetworkConfig | undefined => {
    return networks.find(n => n.id === networkId);
  };

  const isTransferredToNetwork = (diff: Diff, networkId: string): boolean => {
    return (diff.transfers || []).some(t => t.networkId === networkId);
  };

  const getStatusBadge = (status: Diff['status']) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">
            <Clock className="w-3 h-3" />
            Ожидает переноса
          </span>
        );
      case 'partial':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
            <Network className="w-3 h-3" />
            Частично перенесён
          </span>
        );
      case 'transferred':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">
            <Check className="w-3 h-3" />
            Перенесён
          </span>
        );
      case 'outdated':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600">
            <AlertTriangle className="w-3 h-3" />
            Устарел
          </span>
        );
    }
  };

  const renderNetworkTransferButtons = (diff: Diff) => {
    // Все сети доступны для отметки переноса
    if (networks.length === 0) {
      return null;
    }

    return (
      <div className="space-y-2">
        <div className="text-sm text-gray-600 font-medium">Подтвердить перенос в сеть:</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {networks.map(network => {
            const transferred = isTransferredToNetwork(diff, network.id);
            const transfer = (diff.transfers || []).find(t => t.networkId === network.id);
            
            return (
              <button
                key={network.id}
                onClick={() => !transferred && confirmTransfer(diff.id, network.id)}
                disabled={transferred || confirmingNetwork === network.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-colors ${
                  transferred 
                    ? 'bg-green-50 border-green-300 text-green-700 cursor-default'
                    : 'border-gray-200 hover:border-green-400 hover:bg-green-50'
                }`}
                style={{ 
                  borderLeftColor: network.color, 
                  borderLeftWidth: '4px' 
                }}
                title={transferred ? `Перенесён ${formatDate(transfer!.transferredAt)}` : `Подтвердить перенос в ${network.name}`}
              >
                {transferred ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : confirmingNetwork === network.id ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Network className="w-4 h-4" />
                )}
                <span className="flex-1 text-left text-sm">{network.name}</span>
                {transferred && (
                  <span className="text-xs text-green-600">✓</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Package className="w-5 h-5" />
          Diff для переноса
        </h2>
        <button
          onClick={() => { loadNetworks(); loadDiffs(); }}
          className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Pending Diff */}
      {pendingDiff ? (
        <div className="mb-6 p-4 border-2 border-yellow-400 bg-yellow-50 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-medium text-lg">Активный diff</h3>
              <p className="text-sm text-gray-600">
                Создан: {formatDate(pendingDiff.createdAt)}
              </p>
            </div>
            {getStatusBadge(pendingDiff.status)}
          </div>
          
          <div className="flex items-center gap-4 mb-4 text-sm text-gray-600">
            <span className="flex items-center gap-1">
              <Archive className="w-4 h-4" />
              {pendingDiff.archiveSizeHuman}
            </span>
            <span>{pendingDiff.filesCount} файлов</span>
          </div>

          {/* Кнопка скачивания */}
          <div className="mb-4">
            <button
              onClick={() => downloadDiff(pendingDiff.id)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              Скачать архив
            </button>
          </div>

          {/* Кнопки подтверждения для каждой сети */}
          {renderNetworkTransferButtons(pendingDiff)}
        </div>
      ) : (
        <div className="mb-6">
          {(displayProgress || displayStatus) && (
            <div className="mb-4 space-y-3">
              <ProgressBar progress={displayProgress} status={displayStatus} isRunning={isRunning} />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-gray-500">Прошло</div>
                  <div className="font-medium text-gray-900">{formatDuration(elapsedMs)}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-gray-500">Осталось</div>
                  <div className="font-medium text-gray-900">
                    {etaMs !== null ? `примерно ${formatDuration(etaMs)}` : 'оценка появится после старта архивации'}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-gray-500">Обработано</div>
                  <div className="font-medium text-gray-900">
                    {displayProgress?.processedBytes !== undefined && displayProgress.totalBytes !== undefined
                      ? `${formatBytes(displayProgress.processedBytes)} / ${formatBytes(displayProgress.totalBytes)}`
                      : displayProgress?.total
                        ? `${displayProgress.current} / ${displayProgress.total} файлов`
                        : 'подготовка списка файлов'}
                  </div>
                </div>
              </div>

              {isRunning && (
                <div className="flex justify-end">
                  <button
                    onClick={stopCreatingDiff}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    <Square className="w-4 h-4" />
                    Остановить создание diff
                  </button>
                </div>
              )}

              {logs && (
                <details className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-gray-700">
                    Логи выполнения
                  </summary>
                  <pre className="mt-3 max-h-48 overflow-y-auto rounded border border-gray-200 bg-white p-3 text-xs text-gray-700 font-mono whitespace-pre-wrap break-all">
                    {logs.split('\n').slice(-30).join('\n')}
                  </pre>
                </details>
              )}
            </div>
          )}

          <button
            onClick={createDiff}
            disabled={isCreating || isRunning}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isCreating || isRunning ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                {isRunning ? 'Diff создаётся...' : 'Запуск создания diff...'}
              </>
            ) : (
              <>
                <Package className="w-4 h-4" />
                Создать новый diff
              </>
            )}
          </button>
        </div>
      )}

      <div className="mt-6">
        <TaskHistoryList
          title="История запусков создания diff"
          tasks={recentTasks}
          emptyText="Запусков создания diff пока не было"
          getLabel={() => 'Создание diff'}
        />
      </div>

      {/* History */}
      <div>
        <h3 className="font-medium mb-3">История</h3>
        
        {isLoading ? (
          <div className="text-center py-4 text-gray-500">Загрузка...</div>
        ) : diffs.length === 0 ? (
          <div className="text-center py-4 text-gray-500">История пуста</div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {diffs.slice(0, 10).map((diff) => (
              <div
                key={diff.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">
                      {formatDate(diff.createdAt)}
                    </span>
                    {getStatusBadge(diff.status)}
                  </div>
                  <div className="text-xs text-gray-500 mb-1">
                    {diff.filesCount} файлов • {diff.archiveSizeHuman}
                  </div>
                  {/* Показываем в какие сети перенесён */}
                  {diff.transfers && diff.transfers.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {diff.transfers.map(t => {
                        const network = getNetworkById(t.networkId);
                        return (
                          <span 
                            key={t.networkId}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded"
                            style={{ backgroundColor: `${network?.color}20`, color: network?.color }}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {network?.name || t.networkId}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                
                {diff.status !== 'outdated' && (
                  <button
                    onClick={() => downloadDiff(diff.id)}
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg"
                    title="Скачать"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
