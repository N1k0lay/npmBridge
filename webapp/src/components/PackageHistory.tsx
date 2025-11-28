'use client';

import { useState, useEffect } from 'react';
import { History, Package, Clock, HardDrive, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

interface PackageVersion {
  version: string;
  filename: string;
  size: number;
  addedAt: string;
}

interface PackageHistoryItem {
  name: string;
  scope: string | null;
  latestVersion: string;
  versions: PackageVersion[];
  totalSize: number;
  lastUpdated: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

function formatRelativeDate(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: ru });
  } catch {
    return '';
  }
}

export function PackageHistory() {
  const [packages, setPackages] = useState<PackageHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [expandedPackages, setExpandedPackages] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    fetchPackageHistory();
  }, []);

  const fetchPackageHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/storage?action=history');
      if (!res.ok) throw new Error('Ошибка загрузки');
      const data = await res.json();
      setPackages(data.packages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (packageName: string) => {
    setExpandedPackages(prev => {
      const next = new Set(prev);
      if (next.has(packageName)) {
        next.delete(packageName);
      } else {
        next.add(packageName);
      }
      return next;
    });
  };

  // Фильтрация и сортировка
  const filteredPackages = packages
    .filter(pkg => 
      pkg.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
        case 'name':
          return a.name.localeCompare(b.name);
        case 'size':
          return b.totalSize - a.totalSize;
        default:
          return 0;
      }
    })
    .slice(0, limit);

  // Статистика
  const stats = {
    totalPackages: packages.length,
    totalVersions: packages.reduce((sum, pkg) => sum + pkg.versions.length, 0),
    totalSize: packages.reduce((sum, pkg) => sum + pkg.totalSize, 0),
    recentPackages: packages.filter(pkg => {
      const hourAgo = Date.now() - 24 * 60 * 60 * 1000;
      return new Date(pkg.lastUpdated).getTime() > hourAgo;
    }).length
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/4"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="text-red-500">Ошибка: {error}</div>
        <button 
          onClick={fetchPackageHistory}
          className="mt-2 text-blue-500 hover:underline"
        >
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Package className="w-4 h-4" />
            Всего пакетов
          </div>
          <div className="text-2xl font-bold">{stats.totalPackages}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <History className="w-4 h-4" />
            Всего версий
          </div>
          <div className="text-2xl font-bold">{stats.totalVersions}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <HardDrive className="w-4 h-4" />
            Общий размер
          </div>
          <div className="text-2xl font-bold">{formatBytes(stats.totalSize)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Clock className="w-4 h-4" />
            За 24 часа
          </div>
          <div className="text-2xl font-bold text-green-600">{stats.recentPackages}</div>
        </div>
      </div>

      {/* Фильтры */}
      <div className="bg-white rounded-lg shadow-lg p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Поиск пакетов..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'date' | 'name' | 'size')}
              className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="date">По дате</option>
              <option value="name">По имени</option>
              <option value="size">По размеру</option>
            </select>
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
              className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={500}>500</option>
              <option value={10000}>Все</option>
            </select>
            <button
              onClick={fetchPackageHistory}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Обновить
            </button>
          </div>
        </div>
      </div>

      {/* Список пакетов */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <History className="w-5 h-5" />
            История пакетов
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Показано {filteredPackages.length} из {packages.length} пакетов
          </p>
        </div>

        <div className="divide-y max-h-[600px] overflow-y-auto">
          {filteredPackages.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              {searchTerm ? 'Пакеты не найдены' : 'Нет пакетов в storage'}
            </div>
          ) : (
            filteredPackages.map((pkg) => (
              <div key={pkg.name} className="hover:bg-gray-50">
                <div 
                  className="p-4 cursor-pointer flex items-center justify-between"
                  onClick={() => toggleExpand(pkg.name)}
                >
                  <div className="flex items-center gap-3">
                    <button className="text-gray-400">
                      {expandedPackages.has(pkg.name) ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                    <div>
                      <div className="font-medium">
                        {pkg.scope ? (
                          <span>
                            <span className="text-blue-600">@{pkg.scope}/</span>
                            {pkg.name.replace(`@${pkg.scope}/`, '')}
                          </span>
                        ) : (
                          pkg.name
                        )}
                      </div>
                      <div className="text-sm text-gray-500">
                        {pkg.versions.length} версий • {formatBytes(pkg.totalSize)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-green-600">
                      v{pkg.latestVersion}
                    </div>
                    <div className="text-xs text-gray-500" title={formatDate(pkg.lastUpdated)}>
                      {formatRelativeDate(pkg.lastUpdated)}
                    </div>
                  </div>
                </div>

                {/* Развёрнутый список версий */}
                {expandedPackages.has(pkg.name) && (
                  <div className="bg-gray-50 border-t px-4 py-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 text-left">
                          <th className="py-1 font-medium">Версия</th>
                          <th className="py-1 font-medium">Размер</th>
                          <th className="py-1 font-medium">Добавлен</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pkg.versions
                          .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
                          .map((ver) => (
                            <tr key={ver.version} className="border-t border-gray-200">
                              <td className="py-2 font-mono">{ver.version}</td>
                              <td className="py-2 text-gray-500">{formatBytes(ver.size)}</td>
                              <td className="py-2 text-gray-500" title={formatDate(ver.addedAt)}>
                                {formatDate(ver.addedAt)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
