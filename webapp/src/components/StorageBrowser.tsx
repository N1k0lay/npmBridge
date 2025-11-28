'use client';

import { useState, useEffect } from 'react';
import { Database, Search, Folder, Package, ChevronRight, ExternalLink } from 'lucide-react';

interface PackageVersion {
  version: string;
  filename: string;
  size: number;
  mtime: string;
}

interface PackageInfo {
  name: string;
  scope?: string;
  versions: PackageVersion[];
  latestVersion?: string;
}

interface StorageStats {
  totalPackages: number;
  totalVersions: number;
  totalSize: number;
  totalSizeHuman: string;
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU');
}

export function StorageBrowser() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [packages, setPackages] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [packageInfo, setPackageInfo] = useState<PackageInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Загрузка статистики и списка scopes
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [statsRes, scopesRes] = await Promise.all([
          fetch('/api/storage?action=stats'),
          fetch('/api/storage?action=scopes'),
        ]);
        
        const statsData = await statsRes.json();
        const scopesData = await scopesRes.json();
        
        setStats(statsData);
        setScopes(scopesData.scopes || []);
      } catch (error) {
        console.error('Error loading initial data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadInitialData();
  }, []);

  // Загрузка списка пакетов
  useEffect(() => {
    const loadPackages = async () => {
      try {
        const url = selectedScope 
          ? `/api/storage?action=list&scope=${encodeURIComponent(selectedScope)}`
          : '/api/storage?action=list';
        
        const res = await fetch(url);
        const data = await res.json();
        setPackages(data.packages || []);
      } catch (error) {
        console.error('Error loading packages:', error);
      }
    };
    
    loadPackages();
  }, [selectedScope]);

  // Загрузка информации о пакете
  useEffect(() => {
    if (!selectedPackage) {
      setPackageInfo(null);
      return;
    }
    
    const loadPackageInfo = async () => {
      try {
        const res = await fetch(`/api/storage?action=package&package=${encodeURIComponent(selectedPackage)}`);
        const data = await res.json();
        setPackageInfo(data);
      } catch (error) {
        console.error('Error loading package info:', error);
      }
    };
    
    loadPackageInfo();
  }, [selectedPackage]);

  // Поиск пакетов
  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      return;
    }
    
    try {
      const res = await fetch(`/api/storage?action=search&q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setPackages(data.packages || []);
      setSelectedScope(null);
    } catch (error) {
      console.error('Error searching packages:', error);
    }
  };

  const filteredPackages = searchQuery 
    ? packages.filter(pkg => pkg.toLowerCase().includes(searchQuery.toLowerCase()))
    : packages;

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
        <Database className="w-5 h-5" />
        Обзор Storage
      </h2>

      {/* Статистика */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-blue-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.totalPackages}</div>
            <div className="text-sm text-gray-600">Пакетов</div>
          </div>
          <div className="p-4 bg-green-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-green-600">{stats.totalVersions}</div>
            <div className="text-sm text-gray-600">Версий</div>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-purple-600">{stats.totalSizeHuman}</div>
            <div className="text-sm text-gray-600">Размер</div>
          </div>
        </div>
      )}

      {/* Поиск */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Поиск пакетов..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Найти
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Левая панель - список пакетов */}
        <div className="border rounded-lg">
          {/* Scopes */}
          <div className="p-2 border-b bg-gray-50">
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => {
                  setSelectedScope(null);
                  setSelectedPackage(null);
                }}
                className={`px-2 py-1 text-xs rounded ${
                  !selectedScope ? 'bg-blue-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
                }`}
              >
                Все
              </button>
              {scopes.map((scope) => (
                <button
                  key={scope}
                  onClick={() => {
                    setSelectedScope(scope);
                    setSelectedPackage(null);
                  }}
                  className={`px-2 py-1 text-xs rounded ${
                    selectedScope === scope ? 'bg-blue-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
                  }`}
                >
                  {scope}
                </button>
              ))}
            </div>
          </div>

          {/* Список пакетов */}
          <div className="h-64 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-gray-500">Загрузка...</div>
            ) : filteredPackages.length === 0 ? (
              <div className="p-4 text-center text-gray-500">Пакеты не найдены</div>
            ) : (
              filteredPackages.slice(0, 100).map((pkg) => (
                <button
                  key={pkg}
                  onClick={() => setSelectedPackage(pkg)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 ${
                    selectedPackage === pkg ? 'bg-blue-50' : ''
                  }`}
                >
                  <Package className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="truncate text-sm">{pkg}</span>
                  <ChevronRight className="w-4 h-4 text-gray-400 ml-auto flex-shrink-0" />
                </button>
              ))
            )}
            {filteredPackages.length > 100 && (
              <div className="p-2 text-center text-sm text-gray-500">
                Показано 100 из {filteredPackages.length}
              </div>
            )}
          </div>
        </div>

        {/* Правая панель - детали пакета */}
        <div className="border rounded-lg p-4">
          {packageInfo ? (
            <div>
              <h3 className="font-medium mb-2 flex items-center gap-2">
                <Package className="w-4 h-4" />
                {packageInfo.scope ? `${packageInfo.scope}/` : ''}{packageInfo.name}
              </h3>
              
              {packageInfo.latestVersion && (
                <div className="text-sm text-gray-600 mb-3">
                  Latest: <span className="font-mono">{packageInfo.latestVersion}</span>
                </div>
              )}

              <h4 className="text-sm font-medium mb-2">
                Версии ({packageInfo.versions.length})
              </h4>
              
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {packageInfo.versions.map((version) => (
                  <div
                    key={version.filename}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm"
                  >
                    <div>
                      <span className="font-mono">{version.version}</span>
                      <span className="text-gray-500 ml-2">{formatSize(version.size)}</span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {formatDate(version.mtime)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              Выберите пакет для просмотра
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
