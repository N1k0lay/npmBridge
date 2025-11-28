'use client';

import { useState } from 'react';
import { AlertTriangle, Check, RefreshCw, Wrench } from 'lucide-react';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import { ProgressBar } from './ProgressBar';

interface BrokenPanelProps {
  onRefresh?: () => void;
}

export function BrokenPanel({ onRefresh }: BrokenPanelProps) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [action, setAction] = useState<'check' | 'fix'>('check');
  const [isStarting, setIsStarting] = useState(false);
  const [lastResult, setLastResult] = useState<{
    totalArchives?: number;
    brokenArchives?: number;
    fixed?: number;
    failed?: number;
  } | null>(null);

  const { progress, status, isRunning } = useTaskPolling({
    taskId,
    endpoint: '/api/broken',
    onComplete: async () => {
      // Получаем результат после завершения
      try {
        const res = await fetch('/api/broken');
        const data = await res.json();
        if (data.lastCheck) {
          setLastResult({
            totalArchives: data.lastCheck.totalArchives,
            brokenArchives: data.lastCheck.brokenArchives,
          });
        }
      } catch {
        // Игнорируем
      }
      onRefresh?.();
    },
  });

  const startCheck = async () => {
    setIsStarting(true);
    setAction('check');
    try {
      const res = await fetch('/api/broken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check' }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setTaskId(data.taskId);
        setLastResult(null);
      } else {
        alert(data.error || 'Ошибка запуска проверки');
      }
    } catch (error) {
      alert('Ошибка сети');
    } finally {
      setIsStarting(false);
    }
  };

  const startFix = async () => {
    setIsStarting(true);
    setAction('fix');
    try {
      const res = await fetch('/api/broken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fix' }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setTaskId(data.taskId);
      } else {
        alert(data.error || 'Ошибка запуска исправления');
      }
    } catch (error) {
      alert('Ошибка сети');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
        <AlertTriangle className="w-5 h-5" />
        Проверка архивов
      </h2>

      <div className="flex gap-3 mb-4">
        <button
          onClick={startCheck}
          disabled={isRunning || isStarting}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isStarting && action === 'check' ? 'animate-spin' : ''}`} />
          Проверить архивы
        </button>
        
        <button
          onClick={startFix}
          disabled={isRunning || isStarting || !lastResult?.brokenArchives}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Wrench className={`w-4 h-4 ${isStarting && action === 'fix' ? 'animate-spin' : ''}`} />
          Исправить битые
        </button>
      </div>

      <ProgressBar progress={progress} status={status} isRunning={isRunning} />

      {lastResult && !isRunning && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-medium mb-2">Результат последней проверки</h3>
          <div className="flex gap-4 text-sm">
            <span className="text-gray-600">
              Всего архивов: {lastResult.totalArchives}
            </span>
            {lastResult.brokenArchives !== undefined && (
              <span className={lastResult.brokenArchives > 0 ? 'text-red-600' : 'text-green-600'}>
                {lastResult.brokenArchives > 0 ? (
                  <>
                    <AlertTriangle className="w-4 h-4 inline mr-1" />
                    Битых: {lastResult.brokenArchives}
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 inline mr-1" />
                    Все архивы исправны
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
