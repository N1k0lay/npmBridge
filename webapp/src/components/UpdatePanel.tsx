'use client';

import { useState, useEffect, useCallback } from 'react';
import { Play, Square, RefreshCw, Clock, Settings } from 'lucide-react';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import { ProgressBar } from './ProgressBar';

interface RunningUpdate {
  id: string;
  type: 'full' | 'recent';
  startedAt: string;
}

interface UpdatePanelProps {
  onUpdate?: () => void;
}

export function UpdatePanel({ onUpdate }: UpdatePanelProps) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [parallelJobs, setParallelJobs] = useState(40);
  const [modifiedHours, setModifiedHours] = useState(48);
  const [showSettings, setShowSettings] = useState(false);

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
    onComplete: () => {
      setTaskId(null);
      onUpdate?.();
    },
  });

  const startUpdate = async (type: 'full' | 'recent') => {
    setIsStarting(true);
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
      } else {
        alert(data.error || 'Ошибка запуска обновления');
      }
    } catch (error) {
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
    } catch (error) {
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Период для "недавних" (часов)
            </label>
            <input
              type="number"
              value={modifiedHours}
              onChange={(e) => setModifiedHours(parseInt(e.target.value) || 1)}
              min={1}
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
        
        <button
          onClick={() => startUpdate('recent')}
          disabled={isRunning || isStarting}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Clock className="w-4 h-4" />
          Обновить недавние
        </button>

        {isRunning && (
          <button
            onClick={stopUpdate}
            className="px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <Square className="w-4 h-4" />
          </button>
        )}
      </div>

      <ProgressBar progress={progress} status={status} isRunning={isRunning} />
    </div>
  );
}
