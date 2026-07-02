'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, Download, Check, AlertTriangle, Clock, Archive, RefreshCw, Network, CheckCircle2, Square, XCircle, FileText } from 'lucide-react';
import { useTaskPolling, TaskProgress, TaskStatus } from '@/hooks/useTaskPolling';
import { ProgressBar } from './ProgressBar';
import { TaskHistoryItem } from './TaskHistoryList';

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

type AlignmentStatusState = 'building' | 'ready' | 'failed';

type AlignmentProgress = {
  current: number;
  total: number;
  percent: number;
  processedBytes: number;
  totalBytes: number;
  currentFile?: string;
};

type AlignmentStatusEntry = {
  diffId: string;
  networkId: string;
  status: AlignmentStatusState;
  updatedAt: string;
  message?: string;
  phase?: 'preparing' | 'collecting_files' | 'packaging';
  progress?: AlignmentProgress;
};

const ALIGNMENT_STATUS_STORAGE_KEY = 'npmbridge:alignment-status:v1';

const getAlignmentBuildKey = (diffId: string, networkId: string) => `${diffId}:${networkId}`;

const persistAlignmentStatuses = (next: Record<string, AlignmentStatusEntry>) => {
  if (typeof window === 'undefined') {
    return;
  }

  const freshEntries = Object.fromEntries(
    Object.entries(next).filter(([, entry]) => {
      const updated = new Date(entry.updatedAt).getTime();
      return Number.isFinite(updated) && Date.now() - updated < 7 * 24 * 60 * 60 * 1000;
    })
  );

  window.localStorage.setItem(ALIGNMENT_STATUS_STORAGE_KEY, JSON.stringify(freshEntries));
};

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
  const [alignmentBuildingKey, setAlignmentBuildingKey] = useState<string | null>(null);
  const [alignmentStatusByKey, setAlignmentStatusByKey] = useState<Record<string, AlignmentStatusEntry>>({});
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [loadedLogs, setLoadedLogs] = useState<Record<string, { logs: string; isLoading: boolean; error: string | null }>>({});

  const getTaskTime = (task: TaskHistoryItem) => {
    if (task.updatedAt) return new Date(task.updatedAt).getTime();
    const match = task.taskId.match(/\d+/);
    if (match) return parseInt(match[0], 10);
    return 0;
  };

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

  const getErrorLines = (logs: string): string[] => {
    const lines = logs
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean);

    const errorPattern = /(error|err!|failed|exception|traceback|npm ERR!)/i;
    const matched = lines.filter((line) => errorPattern.test(line));

    return matched.length > 0 ? matched : lines.slice(-40);
  };

  const getStatusIcon = (status: string | undefined) => {
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
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusText = (status: string | undefined) => {
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
  };

  const upsertAlignmentStatus = useCallback((
    diffId: string,
    networkId: string,
    status: AlignmentStatusState,
    details?: Partial<Omit<AlignmentStatusEntry, 'diffId' | 'networkId' | 'status' | 'updatedAt'>>
  ) => {
    const key = getAlignmentBuildKey(diffId, networkId);
    setAlignmentStatusByKey((current) => {
      const next: Record<string, AlignmentStatusEntry> = {
        ...current,
        [key]: {
          diffId,
          networkId,
          status,
          updatedAt: new Date().toISOString(),
          ...details,
        },
      };
      persistAlignmentStatuses(next);
      return next;
    });
  }, []);

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(ALIGNMENT_STATUS_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Record<string, AlignmentStatusEntry>;
      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      setAlignmentStatusByKey(parsed);
    } catch {
      // ignore malformed localStorage payload
    }
  }, []);

  useEffect(() => {
    const buildingEntries = Object.values(alignmentStatusByKey).filter((entry) => entry.status === 'building');
    if (buildingEntries.length === 0) {
      return;
    }

    let cancelled = false;

    const checkStatuses = async () => {
      for (const entry of buildingEntries) {
        try {
          const res = await fetch(
            `/api/diff/${entry.diffId}/download?networkId=${encodeURIComponent(entry.networkId)}&status=1`,
            { cache: 'no-store' }
          );

          if (cancelled) {
            return;
          }

          if (res.status === 200) {
            const payload = await res.json();
            if (payload.status === 'ready') {
              upsertAlignmentStatus(entry.diffId, entry.networkId, 'ready', {
                message: payload.message,
                phase: payload.phase,
                progress: payload.progress,
              });
            }
            continue;
          }

          if (res.status === 202) {
            const payload = await res.json().catch(() => ({}));
            upsertAlignmentStatus(entry.diffId, entry.networkId, 'building', {
              message: payload.message,
              phase: payload.phase,
              progress: payload.progress,
            });
            continue;
          }

          if (res.status === 500) {
            const payload = await res.json().catch(() => ({ error: 'Не удалось сформировать архив' }));
            upsertAlignmentStatus(entry.diffId, entry.networkId, 'failed', {
              message: payload.error || payload.message,
              phase: payload.phase,
              progress: payload.progress,
            });
          }
        } catch {
          if (!cancelled) {
            upsertAlignmentStatus(entry.diffId, entry.networkId, 'failed', {
              message: 'Ошибка сети при проверке статуса',
            });
          }
        }
      }
    };

    checkStatuses();
    const timerId = window.setInterval(checkStatuses, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [alignmentStatusByKey, upsertAlignmentStatus]);

  const createDiff = async (force: boolean = false) => {
    setIsCreating(true);
    setLastProgress(null);
    setLastStatus(null);
    try {
      const url = force ? '/api/diff?force=true' : '/api/diff';
      const res = await fetch(url, {
        method: 'POST',
      });
      const data = await res.json();
      
      if (res.ok) {
        setTaskId(data.taskId);
        await loadDiffs();
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

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const downloadDiff = async (diffId: string, networkId?: string) => {
    if (!networkId) {
      window.open(`/api/diff/${diffId}/download`, '_blank');
      return;
    }

    const buildKey = getAlignmentBuildKey(diffId, networkId);
    const knownStatus = alignmentStatusByKey[buildKey]?.status;

    if (knownStatus === 'ready') {
      window.open(`/api/diff/${diffId}/download?networkId=${encodeURIComponent(networkId)}`, '_blank');
      return;
    }

    setAlignmentBuildingKey(buildKey);
    upsertAlignmentStatus(diffId, networkId, 'building', {
      message: 'Запускаем формирование архива выравнивания.',
      phase: 'preparing',
    });
    try {
      for (let attempt = 0; attempt < 180; attempt += 1) {
        const res = await fetch(
          `/api/diff/${diffId}/download?networkId=${encodeURIComponent(networkId)}&status=1`,
          { cache: 'no-store' }
        );

        if (res.status === 200) {
          const payload = await res.json();
          if (payload.status === 'ready') {
            upsertAlignmentStatus(diffId, networkId, 'ready', {
              message: payload.message,
              phase: payload.phase,
              progress: payload.progress,
            });
            window.open(`/api/diff/${diffId}/download?networkId=${encodeURIComponent(networkId)}`, '_blank');
            return;
          }
        }

        if (res.status === 202) {
          const payload = await res.json().catch(() => ({}));
          upsertAlignmentStatus(diffId, networkId, 'building', {
            message: payload.message,
            phase: payload.phase,
            progress: payload.progress,
          });
        }

        if (res.status === 500) {
          const payload = await res.json().catch(() => ({ error: 'Не удалось сформировать архив' }));
          upsertAlignmentStatus(diffId, networkId, 'failed', {
            message: payload.error || payload.message,
            phase: payload.phase,
            progress: payload.progress,
          });
          alert(payload.error || payload.message || 'Не удалось сформировать архив');
          return;
        }

        await sleep(2000);
      }

      upsertAlignmentStatus(diffId, networkId, 'building', {
        message: 'Архив всё ещё формируется',
      });
      alert('Архив всё ещё формируется. Попробуйте скачать через минуту.');
    } catch {
      upsertAlignmentStatus(diffId, networkId, 'failed', {
        message: 'Ошибка сети',
      });
      alert('Ошибка сети');
    } finally {
      setAlignmentBuildingKey((current) => (current === buildKey ? null : current));
    }
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

  const getAlignmentPhaseLabel = (phase?: AlignmentStatusEntry['phase']) => {
    switch (phase) {
      case 'preparing':
        return 'Подготовка baseline';
      case 'collecting_files':
        return 'Сбор списка файлов';
      case 'packaging':
        return 'Упаковка архива';
      default:
        return 'Формирование архива';
    }
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

  const hasUnconfirmedTransfers = (diff: Diff): boolean => {
    return networks.some(network => !isTransferredToNetwork(diff, network.id));
  };

  const hasNewerTransferredCheckpoint = (diff: Diff): boolean => {
    return diffs.some(candidate => candidate.status === 'transferred' && candidate.createdAt > diff.createdAt);
  };

  const canConfirmTransfers = (diff: Diff): boolean => {
    return hasUnconfirmedTransfers(diff) && !hasNewerTransferredCheckpoint(diff);
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
        <div className="pt-1">
          <div className="text-sm text-gray-600 font-medium mb-2">Скачать архив выравнивания:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {networks
              .filter(network => !isTransferredToNetwork(diff, network.id))
              .map(network => {
                const key = getAlignmentBuildKey(diff.id, network.id);
                const statusEntry = alignmentStatusByKey[key];
                const isBuilding = alignmentBuildingKey === key || statusEntry?.status === 'building';
                const isReady = statusEntry?.status === 'ready';
                const isFailed = statusEntry?.status === 'failed';

                return (
                  <div key={`download-${diff.id}-${network.id}`} className="space-y-1">
                    <button
                      onClick={() => downloadDiff(diff.id, network.id)}
                      disabled={alignmentBuildingKey === key}
                      className={`flex w-full items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors disabled:opacity-60 ${
                        isReady
                          ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                          : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                      }`}
                      title={`Скачать архив выравнивания для сети ${network.name}`}
                    >
                      {isBuilding ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : isReady ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      <span className="text-sm">
                        {isBuilding
                          ? `${network.name}: формируется`
                          : isReady
                            ? `${network.name}: архив готов`
                            : network.name}
                      </span>
                    </button>
                    {isReady && (
                      <p className="text-xs text-green-700">Архив готов, можно скачать в любое время.</p>
                    )}
                    {isBuilding && (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{getAlignmentPhaseLabel(statusEntry?.phase)}</span>
                          <span>{statusEntry?.progress ? `${statusEntry.progress.percent}%` : '...'}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
                          <div
                            className="h-full rounded-full bg-blue-600 transition-all"
                            style={{ width: `${statusEntry?.progress?.percent ?? 8}%` }}
                          />
                        </div>
                        {statusEntry?.message && (
                          <p className="mt-2 text-blue-800">{statusEntry.message}</p>
                        )}
                        {statusEntry?.progress && (
                          <div className="mt-2 space-y-1 text-blue-900">
                            <p>
                              Файлы: {statusEntry.progress.current} / {statusEntry.progress.total}
                            </p>
                            <p>
                              Объём: {formatBytes(statusEntry.progress.processedBytes)} / {formatBytes(statusEntry.progress.totalBytes)}
                            </p>
                            {statusEntry.progress.currentFile && (
                              <p className="truncate" title={statusEntry.progress.currentFile}>
                                Текущий файл: {statusEntry.progress.currentFile}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {isFailed && statusEntry?.message && (
                      <p className="text-xs text-red-600">{statusEntry.message}</p>
                    )}
                  </div>
                );
              })}
          </div>
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

          {/* Предупреждение об устаревании */}
          {pendingDiff.status === 'outdated' && (
            <div className="mb-4 p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900 flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
              <div>
                <p className="font-semibold text-amber-900">Этот diff устарел</p>
                <p className="text-xs text-amber-700 mt-1">
                  В репозитории появились новые изменения, которые отсутствуют в текущем diff. Рекомендуется создать новый diff. Устаревший diff не будет учитываться при генерации нового.
                </p>
              </div>
            </div>
          )}

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
          {canConfirmTransfers(pendingDiff) && renderNetworkTransferButtons(pendingDiff)}

          {/* Кнопки пересоздания diff */}
          <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col gap-2">
            {pendingDiff.status === 'outdated' ? (
              <button
                onClick={() => createDiff(true)}
                disabled={isCreating || isRunning}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors shadow-sm"
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
            ) : (
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    if (confirm('Вы уверены, что хотите принудительно пересоздать diff? Текущий активный diff будет помечен как устаревший.')) {
                      createDiff(true);
                    }
                  }}
                  disabled={isCreating || isRunning}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-800 text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                  title="Принудительно пересоздать diff, игнорируя текущий активный"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Пересоздать diff (принудительно)
                </button>
              </div>
            )}
          </div>
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
            onClick={() => createDiff()}
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

      {/* Объединенная история */}
      <div className="mt-8 border-t border-gray-100 pt-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">История</h3>
        
        {isLoading ? (
          <div className="text-center py-6 text-gray-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
            <span>Загрузка истории...</span>
          </div>
        ) : (() => {
          // Combine diffs and task history
          const combinedHistory = [
            ...diffs.map((d) => ({
              type: 'diff' as const,
              id: d.id,
              time: new Date(d.createdAt).getTime(),
              data: d,
            })),
            ...recentTasks
              // Filter out successful runs that created a diff to avoid duplication.
              // A successful run has status "completed" and message starting with "Diff создан"
              .filter((t) => t.status?.status === 'failed' || (t.status?.status === 'completed' && t.status?.message && !t.status.message.startsWith('Diff создан')))
              .map((t) => ({
                type: 'task' as const,
                id: t.taskId,
                time: getTaskTime(t),
                data: t,
              })),
          ].sort((a, b) => b.time - a.time);

          if (combinedHistory.length === 0) {
            return <div className="text-center py-6 text-gray-400">История пуста</div>;
          }

          return (
            <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
              {combinedHistory.map((item) => {
                if (item.type === 'diff') {
                  const diff = item.data;
                  return (
                    <div
                      key={diff.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-gray-50 hover:bg-gray-100/70 border border-gray-200/60 rounded-lg transition-colors gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-2 mb-1">
                          <span className="text-sm font-semibold text-gray-900">
                            Diff от {formatDate(diff.createdAt)}
                          </span>
                          {getStatusBadge(diff.status)}
                        </div>
                        <div className="text-xs text-gray-500 mb-2">
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
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded font-medium"
                                  style={{ backgroundColor: `${network?.color}20`, color: network?.color }}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {network?.name || t.networkId}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {diff.status === 'outdated' && canConfirmTransfers(diff) && diff.id !== pendingDiff?.id && (
                          <div className="mt-3">
                            {renderNetworkTransferButtons(diff)}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex shrink-0 items-center justify-end">
                        <button
                          onClick={() => downloadDiff(diff.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors shadow-sm"
                          title="Скачать"
                        >
                          <Download className="w-4 h-4" />
                          Скачать
                        </button>
                      </div>
                    </div>
                  );
                } else {
                  const task = item.data;
                  return (
                    <div key={task.taskId} className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1.5">
                            {getStatusIcon(task.status?.status)}
                            <span className="text-sm font-semibold text-gray-900">
                              {task.status?.status === 'failed' ? 'Ошибка создания diff' : 'Проверка обновлений'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mb-1">{formatDate(task.status?.updatedAt || new Date(item.time).toISOString())}</div>
                          {task.status?.message && (
                            <div className="text-xs text-gray-600 break-words">{task.status.message}</div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs font-medium text-gray-500">{getStatusText(task.status?.status)}</span>
                          {task.hasLog && (
                            <button
                              onClick={() => void toggleLogs(task.taskId)}
                              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-red-700 bg-red-50 hover:bg-red-100 hover:text-red-800 transition-colors"
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
                            <div className="text-xs text-gray-500 font-medium">Загрузка лога...</div>
                          ) : loadedLogs[task.taskId]?.error ? (
                            <div className="text-xs text-red-600 font-medium">{loadedLogs[task.taskId]?.error}</div>
                          ) : loadedLogs[task.taskId]?.logs ? (
                            <>
                              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Ключевые строки лога
                              </div>
                              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-red-50/50 p-2.5 text-xs text-red-950 font-mono border border-red-100/50">
                                {getErrorLines(loadedLogs[task.taskId].logs).join('\n')}
                              </pre>
                            </>
                          ) : (
                            <div className="text-xs text-gray-500 font-medium">Лог пустой</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
