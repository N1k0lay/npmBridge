'use client';

import { useState, useEffect } from 'react';
import { Play, Square, RefreshCw, Clock, Settings } from 'lucide-react';
import { useTaskPolling, TaskProgress, TaskStatus } from '@/hooks/useTaskPolling';
import { ProgressBar } from './ProgressBar';

interface UpdatePanelProps {
  onUpdate?: () => void;
}

export function UpdatePanel({ onUpdate }: UpdatePanelProps) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [parallelJobs, setParallelJobs] = useState(40);
  const [modifiedHours, setModifiedHours] = useState(48);
  const [showSettings, setShowSettings] = useState(false);
  // Сохраняем последний результат чтобы не терять его при завершении задачи
  const [lastProgress, setLastProgress] = useState<TaskProgress | null>(null);
  const [lastStatus, setLastStatus] = useState<TaskStatus | null>(null);

  // Проверяем наличие уже запущенного обновления при загрузке
  useEffect(() => {
    const checkRunning = async () => {
      try {
        const res = await fetch('/api/update');
        const data = await res.json();
        if (data.runningUpdate) {
          setTaskId(data.runningUpdate.id);
        }
      } catch (error) {
        console.error('Error checking running update:', error);
      }
    };
    checkRunning();
  }, []);

  const { progress, status, isRunning } = useTaskPolling({
    taskId,
    endpoint: '/api/update',
    onComplete: (finalStatus) => {
      setTaskId(null);
      onUpdate?.();
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
  const displayStatus = status ?? lastStatus;

  const startUpdate = async (type: 'full' | 'recent') => {
    setIsStarting(true);
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
        alert(data.error || 'Ошибка запуска обновления');
      }
    } catch {
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

      <div className="flex gap-3 mb-4">
        <button
          onClick={() => startUpdate('full')}
          disabled={isRunning || isStarting}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Play className="w-4 h-4" />
          Обновить все
        </button>
        
        <div className="flex-1 flex gap-1">
          <button
            onClick={() => startUpdate('recent')}
            disabled={isRunning || isStarting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-l-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Clock className="w-4 h-4" />
            Недавние
          </button>
          <select
            value={modifiedHours}
            onChange={(e) => setModifiedHours(parseInt(e.target.value))}
            disabled={isRunning || isStarting}
            className="px-2 py-3 bg-green-600 text-white rounded-r-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-l border-green-500 cursor-pointer"
          >
            <option value={1}>1ч</option>
            <option value={6}>6ч</option>
            <option value={12}>12ч</option>
            <option value={24}>24ч</option>
            <option value={72}>3д</option>
            <option value={168}>7д</option>
          </select>
        </div>

        {isRunning && (
          <button
            onClick={stopUpdate}
            className="px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <Square className="w-4 h-4" />
          </button>
        )}
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
