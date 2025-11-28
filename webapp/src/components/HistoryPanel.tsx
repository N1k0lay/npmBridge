'use client';

import { useState, useEffect } from 'react';
import { History, RefreshCw, Check, XCircle, AlertTriangle, Clock } from 'lucide-react';

interface UpdateRecord {
  id: string;
  type: 'full' | 'recent';
  startedAt: string;
  finishedAt: string | null;
  status: string;
  packagesTotal: number;
  packagesSuccess: number;
  packagesFailed: number;
}

export function HistoryPanel() {
  const [updates, setUpdates] = useState<UpdateRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadHistory = async () => {
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
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('ru-RU');
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
                    {update.type === 'full' ? 'Полное обновление' : 'Обновление недавних'}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
