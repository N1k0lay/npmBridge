'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileSearch, Play, Square, RefreshCw, Clock, Settings, AlertTriangle } from 'lucide-react';
import { useTaskPolling, TaskProgress, TaskStatus } from '@/hooks/useTaskPolling';
import { ProgressBar } from './ProgressBar';

interface UpdatePanelProps {
  onUpdate?: () => void;
}

type UpdateType = 'full' | 'smart_plan' | 'smart_apply_plan' | 'legacy_full' | 'recent';

interface LatestPlan {
  available: boolean;
  createdAt: string | null;
  sourceTaskId: string | null;
  targetCount: number;
  scannedPackages: number;
  planningFailed: number;
}

const updateLabels: Record<UpdateType, string> = {
  full: 'Обновить актуальные',
  smart_plan: 'План',
  smart_apply_plan: 'Обновить по плану',
  legacy_full: 'Полное старое',
  recent: 'Недавние',
};

const startingMessages: Record<UpdateType, string> = {
  full: 'Запуск умного обновления: строим план актуальных версий...',
  smart_plan: 'Запуск планирования: проверяем metadata пакетов...',
  smart_apply_plan: 'Запуск установки по сохранённому плану...',
  legacy_full: 'Запуск старого полного обновления...',
  recent: 'Запуск обновления недавних пакетов...',
};

function getUpdateStage(type: UpdateType | null, status: TaskStatus | null, isStarting: boolean, isRunning: boolean) {
  if (status?.status === 'failed') return 'Ошибка';
  if (status?.status?.startsWith('completed')) return 'Завершено';
  if (isStarting) return 'Запуск';

  const message = status?.message ?? '';
  if (message.includes('Планирование')) return 'Планирование';
  if (message.includes('Установка') || message.includes('Обновление')) return 'Установка';
  if (message.includes('Получение списка') || isRunning) {
    return type === 'recent' ? 'Поиск изменений' : 'Сканирование';
  }

  return 'Ожидание';
}

export function UpdatePanel({ onUpdate }: UpdatePanelProps) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [parallelJobs, setParallelJobs] = useState(40);
  const [modifiedHours, setModifiedHours] = useState(48);
  const [showSettings, setShowSettings] = useState(false);
  const [activeType, setActiveType] = useState<UpdateType | null>(null);
  const [optimisticStatus, setOptimisticStatus] = useState<TaskStatus | null>(null);
  const [latestPlan, setLatestPlan] = useState<LatestPlan | null>(null);
  // Сохраняем последний результат чтобы не терять его при завершении задачи
  const [lastProgress, setLastProgress] = useState<TaskProgress | null>(null);
  const [lastStatus, setLastStatus] = useState<TaskStatus | null>(null);

  // Проверяем наличие уже запущенного обновления при загрузке
  const refreshUpdateState = useCallback(async () => {
    try {
      const res = await fetch('/api/update');
      const data = await res.json();
      setLatestPlan(data.latestPlan ?? null);
      if (data.runningUpdate) {
        setTaskId(data.runningUpdate.id);
        setActiveType(data.runningUpdate.type ?? null);
      }
    } catch (error) {
      console.error('Error checking running update:', error);
    }
  }, []);

  useEffect(() => {
    refreshUpdateState();
  }, [refreshUpdateState]);

  const { progress, status, isRunning } = useTaskPolling({
    taskId,
    endpoint: '/api/update',
    onComplete: (finalStatus) => {
      setTaskId(null);
      setOptimisticStatus(null);
      onUpdate?.();
      refreshUpdateState();
      // Сохраняем итоговый статус чтобы показать результат после завершения
      if (finalStatus) setLastStatus(finalStatus);
    },
  });

  // Синхронизируем lastProgress/lastStatus с актуальными данными пока задача идёт
  useEffect(() => {
    if (progress) setLastProgress(progress);
    if (status) setLastStatus(status);
  }, [progress, status]);

  const displayProgress = progress ?? lastProgress;
  const displayStatus = status ?? optimisticStatus ?? lastStatus;
  const currentStage = getUpdateStage(activeType, displayStatus, isStarting, isRunning);
  const currentActionLabel = activeType ? updateLabels[activeType] : null;

  const startUpdate = async (type: UpdateType) => {
    setIsStarting(true);
    setActiveType(type);
    setOptimisticStatus({ status: 'running', message: startingMessages[type] });
    setLastProgress(null);
    setLastStatus(null);
    try {
      const res = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          parallelJobs,
          modifiedMinutes: modifiedHours * 60,
        }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setTaskId(data.taskId);
      } else if (res.status === 409 && data.taskId) {
        // Обновление уже запущено — показываем его прогресс
        setTaskId(data.taskId);
      } else {
        setOptimisticStatus(null);
        alert(data.error || 'Ошибка запуска обновления');
      }
    } catch {
      setOptimisticStatus(null);
      alert('Ошибка сети');
    } finally {
      setIsStarting(false);
    }
  };

  const stopUpdate = async () => {
    if (!taskId) return;
    
    try {
      await fetch(`/api/update?taskId=${taskId}`, {
        method: 'DELETE',
      });
      setTaskId(null);
      setOptimisticStatus(null);
    } catch {
      alert('Ошибка остановки');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <RefreshCw className="w-5 h-5" />
          Обновление пакетов
        </h2>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {showSettings && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Параллельных потоков
            </label>
            <input
              type="number"
              value={parallelJobs}
              onChange={(e) => setParallelJobs(parseInt(e.target.value) || 1)}
              min={1}
              max={100}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      )}

      <div className="mb-4 space-y-3">
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:flex-wrap">
          <button
            onClick={() => startUpdate('smart_plan')}
            disabled={isRunning || isStarting}
            className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg bg-slate-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 md:w-28"
            title="Только построить план: проверить metadata всех пакетов и показать, какие конкретные версии будут установлены. Tarball-и не скачиваются."
          >
            <FileSearch className="h-4 w-4 shrink-0" />
            <span className="truncate">План</span>
          </button>

          <button
            onClick={() => startUpdate('smart_apply_plan')}
            disabled={isRunning || isStarting || !latestPlan?.available || latestPlan.targetCount === 0}
            className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50 md:w-48"
            title={latestPlan?.available
              ? `Установить ${latestPlan.targetCount} версий из последнего сохранённого плана без повторного планирования.`
              : 'Сначала нажмите План и дождитесь завершения.'}
          >
            <Play className="h-4 w-4 shrink-0" />
            <span className="truncate">Обновить по плану</span>
          </button>

          <button
            onClick={() => startUpdate('full')}
            disabled={isRunning || isStarting}
            className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 md:w-52"
            title="Рекомендуемый режим: проверить все пакеты и явно установить только недостающие актуальные версии по latest и используемым major.minor-линиям."
          >
            <Play className="h-4 w-4 shrink-0" />
            <span className="truncate">Обновить актуальные</span>
          </button>

          <div className="grid min-h-11 min-w-0 grid-cols-[1fr_auto] overflow-hidden rounded-lg bg-green-600 text-white md:w-44">
            <button
              onClick={() => startUpdate('recent')}
              disabled={isRunning || isStarting}
              className="inline-flex min-w-0 items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Быстрый режим: обновить только пакеты, чьи package.json менялись за выбранный период."
            >
              <Clock className="h-4 w-4 shrink-0" />
              <span className="truncate">Недавние</span>
            </button>
            <select
              value={modifiedHours}
              onChange={(e) => setModifiedHours(parseInt(e.target.value))}
              disabled={isRunning || isStarting}
              className="h-full w-14 cursor-pointer border-l border-green-500 bg-green-600 px-1 text-center text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Период для режима Недавние"
            >
              <option value={1}>1ч</option>
              <option value={6}>6ч</option>
              <option value={12}>12ч</option>
              <option value={24}>24ч</option>
              <option value={72}>3д</option>
              <option value={168}>7д</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={() => startUpdate('legacy_full')}
            disabled={isRunning || isStarting}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            title="Старый медленный режим: принудительно выполнить pnpm install package@latest для каждого пакета в storage. Использовать только как аварийный fallback."
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">Полное старое</span>
          </button>

          {latestPlan?.available && latestPlan.targetCount > 0 && !(isRunning || isStarting || displayStatus?.status === 'running') && (
            <div className="min-w-0 rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs text-cyan-900 sm:flex-1">
              <span className="font-medium">План готов:</span>{' '}
              <span>{latestPlan.targetCount} версий</span>
              {latestPlan.createdAt && (
                <span className="text-cyan-700"> · {new Date(latestPlan.createdAt).toLocaleString('ru-RU')}</span>
              )}
              {latestPlan.planningFailed > 0 && (
                <span className="text-amber-700"> · ошибок планирования: {latestPlan.planningFailed}</span>
              )}
            </div>
          )}

          {(isRunning || isStarting || displayStatus?.status === 'running') && (
            <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900 sm:flex-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium">
                  {currentActionLabel ? `${currentActionLabel}: ${currentStage}` : currentStage}
                </div>
                <div className="truncate text-xs text-blue-700" title={displayStatus?.message}>
                  {displayStatus?.message ?? 'Ожидание ответа задачи...'}
                </div>
              </div>
              {isRunning && (
                <button
                  onClick={stopUpdate}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-red-600 px-3 text-sm font-medium text-white transition-colors hover:bg-red-700"
                  title="Остановить текущую задачу"
                >
                  <Square className="h-4 w-4 shrink-0" />
                  <span>Стоп</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {(displayProgress || displayStatus) && (
        <div className="relative">
          <ProgressBar progress={displayProgress} status={displayStatus} isRunning={isRunning} />
          {!isRunning && (
            <button
              onClick={() => { setLastProgress(null); setLastStatus(null); }}
              className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-xs px-1"
              title="Скрыть"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
