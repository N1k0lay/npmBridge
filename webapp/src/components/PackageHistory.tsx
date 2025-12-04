'use client';

import { useState, useEffect, useRef } from 'react';
import { Package, Clock, HardDrive, Download, Calendar, History } from 'lucide-react';

interface RecentDownload {
  name: string;
  version: string;
  filename: string;
  size: number;
  downloadedAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

interface StorageStats {
  totalPackages: number;
  totalVersions: number;
  totalSize: number;
  totalSizeHuman: string;
}

export function PackageHistory() {
  const [recentDownloads, setRecentDownloads] = useState<RecentDownload[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentHours, setRecentHours] = useState(24);
  
  // Ref чтобы избежать дублирования запросов при первой загрузке
  const isInitialMount = useRef(true);

  const fetchStorageStats = async () => {
    try {
      const res = await fetch('/api/storage?action=stats');
      if (res.ok) {
        const data = await res.json();
        setStorageStats(data);
      }
    } catch (err) {
      console.error('Error fetching storage stats:', err);
    }
  };

  const fetchRecentDownloads = async (hours: number) => {
    setRecentLoading(true);
    try {
      const res = await fetch(`/api/storage?action=recent&hours=${hours}&limit=200`);
      if (!res.ok) throw new Error('Ошибка загрузки');
      const data = await res.json();
      setRecentDownloads(data.items || []);
      setRecentTotal(data.total || 0);
    } catch (err) {
      console.error('Error fetching recent downloads:', err);
    } finally {
      setRecentLoading(false);
    }
  };

  // Начальная загрузка - один раз
  useEffect(() => {
    fetchStorageStats();
    fetchRecentDownloads(recentHours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Обновление при смене периода (но не при первой загрузке)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    fetchRecentDownloads(recentHours);
  }, [recentHours]);

  const handleRefresh = () => {
    fetchRecentDownloads(recentHours);
  };

  return (
    <div className="space-y-6">
      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Package className="w-4 h-4" />
            Всего пакетов
          </div>
          <div className="text-2xl font-bold">{storageStats?.totalPackages ?? '—'}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <History className="w-4 h-4" />
            Всего версий
          </div>
          <div className="text-2xl font-bold">{storageStats?.totalVersions ?? '—'}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <HardDrive className="w-4 h-4" />
            Общий размер
          </div>
          <div className="text-2xl font-bold">{storageStats?.totalSizeHuman ?? '—'}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Clock className="w-4 h-4" />
            Недавних загрузок
          </div>
          <div className="text-2xl font-bold text-green-600">
            {recentLoading ? (
              <span className="inline-block w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></span>
            ) : (
              recentTotal
            )}
          </div>
        </div>
      </div>

      {/* Фильтры */}
      <div className="bg-white rounded-lg shadow-lg p-4">
        <div className="flex gap-2 items-center flex-wrap">
          <label className="text-sm text-gray-600">За последние:</label>
          <select
            value={recentHours}
            onChange={(e) => setRecentHours(parseInt(e.target.value))}
            disabled={recentLoading}
            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            <option value={1}>1 час</option>
            <option value={6}>6 часов</option>
            <option value={12}>12 часов</option>
            <option value={24}>24 часа</option>
            <option value={72}>3 дня</option>
            <option value={168}>7 дней</option>
          </select>
          <button
            onClick={handleRefresh}
            disabled={recentLoading}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            Обновить
          </button>
          <span className="text-sm text-gray-500 ml-2">
            {recentLoading ? 'Загрузка...' : `Найдено: ${recentTotal}`}
          </span>
        </div>
      </div>

      {/* Недавние загрузки */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Недавно загруженные версии
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Пакеты, загруженные за последние {recentHours} ч.
          </p>
        </div>

        <div className="divide-y max-h-[600px] overflow-y-auto">
          {recentLoading ? (
            <div className="p-8 text-center text-gray-500">
              <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
              Загрузка...
            </div>
          ) : recentDownloads.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              Нет загрузок за указанный период
            </div>
          ) : (
            recentDownloads.map((item, idx) => (
              <div key={`${item.name}-${item.version}-${idx}`} className="hover:bg-gray-50">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Package className="w-5 h-5 text-blue-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <a 
                        href={`/package/${encodeURIComponent(item.name)}`}
                        className="font-medium text-blue-600 hover:underline block truncate"
                      >
                        {item.name}
                      </a>
                      <div className="text-sm text-gray-500 flex items-center gap-2">
                        <span className="bg-gray-100 px-2 py-0.5 rounded">v{item.version}</span>
                        <span>{formatBytes(item.size)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right text-sm text-gray-500">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {new Date(item.downloadedAt).toLocaleDateString('ru-RU')}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {new Date(item.downloadedAt).toLocaleTimeString('ru-RU')}
                      </div>
                    </div>
                    <a
                      href={`/api/diff/${encodeURIComponent(item.name)}/download?version=${item.version}`}
                      className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                      title="Скачать"
                    >
                      <Download className="w-5 h-5" />
                    </a>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
