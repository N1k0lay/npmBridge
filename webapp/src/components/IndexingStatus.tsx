'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  RefreshCw, 
  Database, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  Loader2
} from 'lucide-react';

interface IndexingStatus {
  isIndexing: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  packagesIndexed: number;
  packagesTotal: number;
  lastError: string | null;
  statsUpdatedAt: string | null;
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return 'никогда';
  
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffSec < 60) return 'только что';
  if (diffMin < 60) return `${diffMin} мин. назад`;
  if (diffHour < 24) return `${diffHour} ч. назад`;
  if (diffDay < 7) return `${diffDay} дн. назад`;
  
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function IndexingStatusIndicator() {
  const [status, setStatus] = useState<IndexingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/indexing');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch indexing status:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    
    // Если идёт индексация, опрашиваем чаще
    const interval = setInterval(fetchStatus, status?.isIndexing ? 2000 : 30000);
    return () => clearInterval(interval);
  }, [fetchStatus, status?.isIndexing]);

  const handleReindex = async () => {
    if (reindexing || status?.isIndexing) return;
    
    setReindexing(true);
    try {
      const res = await fetch('/api/indexing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshStats: true }),
      });
      
      if (res.ok) {
        // Сразу обновляем статус
        await fetchStatus();
      }
    } catch (error) {
      console.error('Failed to start reindexing:', error);
    } finally {
      setReindexing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Загрузка...</span>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  const isInProgress = status.isIndexing;
  const hasError = !!status.lastError;
  const progress = status.packagesTotal > 0 
    ? Math.round((status.packagesIndexed / status.packagesTotal) * 100) 
    : 0;

  return (
    <div className="relative">
      {/* Компактный вид */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
          isInProgress
            ? 'bg-blue-50 text-blue-600 hover:bg-blue-100'
            : hasError
            ? 'bg-red-50 text-red-600 hover:bg-red-100'
            : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
        }`}
      >
        {isInProgress ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Индексация {progress}%</span>
          </>
        ) : hasError ? (
          <>
            <AlertCircle className="w-4 h-4" />
            <span>Ошибка</span>
          </>
        ) : (
          <>
            <Database className="w-4 h-4" />
            <span>{formatTimeAgo(status.statsUpdatedAt || status.finishedAt)}</span>
          </>
        )}
      </button>

      {/* Расширенный вид */}
      {expanded && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-lg border z-50">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-800 flex items-center gap-2">
                <Database className="w-4 h-4" />
                Состояние индекса
              </h3>
              <button
                onClick={handleReindex}
                disabled={isInProgress || reindexing}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isInProgress || reindexing
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-red-500 text-white hover:bg-red-600'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${(isInProgress || reindexing) ? 'animate-spin' : ''}`} />
                Обновить
              </button>
            </div>

            {/* Статус */}
            <div className="space-y-3">
              {/* Прогресс индексации */}
              {isInProgress && (
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="flex items-center justify-between text-sm text-blue-700 mb-2">
                    <span>Индексация...</span>
                    <span>{status.packagesIndexed} / {status.packagesTotal}</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Последнее обновление */}
              <div className="flex items-center gap-2 text-sm">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-gray-500">Последнее обновление:</span>
                <span className="text-gray-700 font-medium">
                  {formatTimeAgo(status.statsUpdatedAt || status.finishedAt)}
                </span>
              </div>

              {/* Успех или ошибка */}
              {!isInProgress && (
                <div className={`flex items-center gap-2 text-sm ${hasError ? 'text-red-600' : 'text-green-600'}`}>
                  {hasError ? (
                    <>
                      <AlertCircle className="w-4 h-4" />
                      <span className="truncate">{status.lastError}</span>
                    </>
                  ) : status.finishedAt ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Проиндексировано {status.packagesIndexed} пакетов</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-yellow-500" />
                      <span className="text-yellow-600">Индексация не запускалась</span>
                    </>
                  )}
                </div>
              )}

              {/* Время начала */}
              {status.startedAt && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>Начато: {formatTimeAgo(status.startedAt)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Overlay для закрытия */}
      {expanded && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setExpanded(false)}
        />
      )}
    </div>
  );
}
