'use client';

import { useState } from 'react';
import { UpdatePanel } from '@/components/UpdatePanel';
import { DiffPanel } from '@/components/DiffPanel';
import { BrokenPanel } from '@/components/BrokenPanel';
import { StorageBrowser } from '@/components/StorageBrowser';
import { HistoryPanel } from '@/components/HistoryPanel';
import { PackageHistory } from '@/components/PackageHistory';
import { NetworksPanel } from '@/components/NetworksPanel';
import { 
  RefreshCw, 
  Package, 
  AlertTriangle, 
  Database, 
  History,
  Clock,
  Globe
} from 'lucide-react';

type Tab = 'update' | 'diff' | 'broken' | 'storage' | 'packages' | 'networks';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>('update');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'update', label: 'Обновление', icon: <RefreshCw className="w-4 h-4" /> },
    { id: 'diff', label: 'Diff', icon: <Package className="w-4 h-4" /> },
    { id: 'broken', label: 'Проверка', icon: <AlertTriangle className="w-4 h-4" /> },
    { id: 'storage', label: 'Storage', icon: <Database className="w-4 h-4" /> },
    { id: 'packages', label: 'История пакетов', icon: <Clock className="w-4 h-4" /> },
    { id: 'networks', label: 'Сети', icon: <Globe className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <Package className="w-8 h-8 text-green-600" />
              npmBridge
            </h1>
            <div className="text-sm text-gray-500">
              Управление NPM репозиторием
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex space-x-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 flex-1 w-full">
        <div key={refreshKey} className="space-y-6">
          {activeTab === 'update' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <UpdatePanel onUpdate={handleRefresh} />
              <HistoryPanel />
            </div>
          )}

          {activeTab === 'diff' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <DiffPanel onRefresh={handleRefresh} />
              </div>
              <div>
                <NetworksPanel onNetworksChange={handleRefresh} />
              </div>
            </div>
          )}

          {activeTab === 'broken' && (
            <BrokenPanel onRefresh={handleRefresh} />
          )}

          {activeTab === 'storage' && (
            <StorageBrowser />
          )}

          {activeTab === 'packages' && (
            <PackageHistory />
          )}

          {activeTab === 'networks' && (
            <div className="max-w-2xl">
              <NetworksPanel onNetworksChange={handleRefresh} />
            </div>
          )}
        </div>
      </main>

      {/* Footer - sticky к низу */}
      <footer className="bg-white border-t mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
          npmBridge
        </div>
      </footer>
    </div>
  );
}
