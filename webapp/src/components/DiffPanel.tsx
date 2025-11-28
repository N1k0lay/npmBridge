'use client';

import { useState, useEffect } from 'react';
import { Package, Download, Check, AlertTriangle, Clock, Archive, RefreshCw, Network, CheckCircle2 } from 'lucide-react';

interface NetworkConfig {
  id: string;
  name: string;
  description: string;
  color: string;
}

interface DiffTransfer {
  networkId: string;
  transferredAt: string;
}

interface Diff {
  id: string;
  createdAt: string;
  status: 'pending' | 'transferred' | 'outdated' | 'partial';
  transfers: DiffTransfer[];
  archiveSize: number;
  archiveSizeHuman: string;
  filesCount: number;
}

interface DiffPanelProps {
  onRefresh?: () => void;
}

export function DiffPanel({ onRefresh }: DiffPanelProps) {
  const [diffs, setDiffs] = useState<Diff[]>([]);
  const [pendingDiff, setPendingDiff] = useState<Diff | null>(null);
  const [networks, setNetworks] = useState<NetworkConfig[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [confirmingNetwork, setConfirmingNetwork] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadNetworks = async () => {
    try {
      const res = await fetch('/api/networks');
      const data = await res.json();
      setNetworks(data.networks || []);
    } catch (error) {
      console.error('Error loading networks:', error);
    }
  };

  const loadDiffs = async () => {
    try {
      const res = await fetch('/api/diff');
      const data = await res.json();
      setDiffs(data.diffs || []);
      setPendingDiff(data.pendingDiff);
    } catch (error) {
      console.error('Error loading diffs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([loadNetworks(), loadDiffs()]);
  }, []);

  const createDiff = async () => {
    setIsCreating(true);
    try {
      const res = await fetch('/api/diff', {
        method: 'POST',
      });
      const data = await res.json();
      
      if (res.ok) {
        if (data.diff) {
          setPendingDiff(data.diff);
          await loadDiffs();
        } else {
          alert(data.message || 'Различий не найдено');
        }
      } else {
        alert(data.error || 'Ошибка создания diff');
      }
    } catch (error) {
      alert('Ошибка сети');
    } finally {
      setIsCreating(false);
    }
  };

  const confirmTransfer = async (diffId: string, networkId: string) => {
    const network = networks.find(n => n.id === networkId);
    if (!confirm(`Вы уверены, что перенесли diff в сеть "${network?.name || networkId}"?`)) {
      return;
    }
    
    setConfirmingNetwork(networkId);
    try {
      const res = await fetch('/api/diff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diffId,
          action: 'confirm_transfer',
          networkId,
        }),
      });
      
      if (res.ok) {
        const data = await res.json();
        // Обновляем pendingDiff если он вернулся
        if (data.diff) {
          if (data.diff.status === 'transferred') {
            setPendingDiff(null);
          } else {
            setPendingDiff(data.diff);
          }
        }
        await loadDiffs();
        onRefresh?.();
      } else {
        const data = await res.json();
        alert(data.error || 'Ошибка подтверждения');
      }
    } catch (error) {
      alert('Ошибка сети');
    } finally {
      setConfirmingNetwork(null);
    }
  };

  const downloadDiff = (diffId: string) => {
    window.open(`/api/diff/${diffId}/download`, '_blank');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('ru-RU');
  };

  const getNetworkById = (networkId: string): NetworkConfig | undefined => {
    return networks.find(n => n.id === networkId);
  };

  const isTransferredToNetwork = (diff: Diff, networkId: string): boolean => {
    return (diff.transfers || []).some(t => t.networkId === networkId);
  };

  const getStatusBadge = (status: Diff['status']) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">
            <Clock className="w-3 h-3" />
            Ожидает переноса
          </span>
        );
      case 'partial':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
            <Network className="w-3 h-3" />
            Частично перенесён
          </span>
        );
      case 'transferred':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">
            <Check className="w-3 h-3" />
            Перенесён
          </span>
        );
      case 'outdated':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600">
            <AlertTriangle className="w-3 h-3" />
            Устарел
          </span>
        );
    }
  };

  const renderNetworkTransferButtons = (diff: Diff) => {
    // Все сети доступны для отметки переноса
    if (networks.length === 0) {
      return null;
    }

    return (
      <div className="space-y-2">
        <div className="text-sm text-gray-600 font-medium">Подтвердить перенос в сеть:</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {networks.map(network => {
            const transferred = isTransferredToNetwork(diff, network.id);
            const transfer = (diff.transfers || []).find(t => t.networkId === network.id);
            
            return (
              <button
                key={network.id}
                onClick={() => !transferred && confirmTransfer(diff.id, network.id)}
                disabled={transferred || confirmingNetwork === network.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-colors ${
                  transferred 
                    ? 'bg-green-50 border-green-300 text-green-700 cursor-default'
                    : 'border-gray-200 hover:border-green-400 hover:bg-green-50'
                }`}
                style={{ 
                  borderLeftColor: network.color, 
                  borderLeftWidth: '4px' 
                }}
                title={transferred ? `Перенесён ${formatDate(transfer!.transferredAt)}` : `Подтвердить перенос в ${network.name}`}
              >
                {transferred ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : confirmingNetwork === network.id ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Network className="w-4 h-4" />
                )}
                <span className="flex-1 text-left text-sm">{network.name}</span>
                {transferred && (
                  <span className="text-xs text-green-600">✓</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Package className="w-5 h-5" />
          Diff для переноса
        </h2>
        <button
          onClick={() => { loadNetworks(); loadDiffs(); }}
          className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Pending Diff */}
      {pendingDiff ? (
        <div className="mb-6 p-4 border-2 border-yellow-400 bg-yellow-50 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-medium text-lg">Активный diff</h3>
              <p className="text-sm text-gray-600">
                Создан: {formatDate(pendingDiff.createdAt)}
              </p>
            </div>
            {getStatusBadge(pendingDiff.status)}
          </div>
          
          <div className="flex items-center gap-4 mb-4 text-sm text-gray-600">
            <span className="flex items-center gap-1">
              <Archive className="w-4 h-4" />
              {pendingDiff.archiveSizeHuman}
            </span>
            <span>{pendingDiff.filesCount} файлов</span>
          </div>

          {/* Кнопка скачивания */}
          <div className="mb-4">
            <button
              onClick={() => downloadDiff(pendingDiff.id)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              Скачать архив
            </button>
          </div>

          {/* Кнопки подтверждения для каждой сети */}
          {renderNetworkTransferButtons(pendingDiff)}
        </div>
      ) : (
        <div className="mb-6">
          <button
            onClick={createDiff}
            disabled={isCreating}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isCreating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Создание diff...
              </>
            ) : (
              <>
                <Package className="w-4 h-4" />
                Создать новый diff
              </>
            )}
          </button>
        </div>
      )}

      {/* History */}
      <div>
        <h3 className="font-medium mb-3">История</h3>
        
        {isLoading ? (
          <div className="text-center py-4 text-gray-500">Загрузка...</div>
        ) : diffs.length === 0 ? (
          <div className="text-center py-4 text-gray-500">История пуста</div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {diffs.slice(0, 10).map((diff) => (
              <div
                key={diff.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">
                      {formatDate(diff.createdAt)}
                    </span>
                    {getStatusBadge(diff.status)}
                  </div>
                  <div className="text-xs text-gray-500 mb-1">
                    {diff.filesCount} файлов • {diff.archiveSizeHuman}
                  </div>
                  {/* Показываем в какие сети перенесён */}
                  {diff.transfers && diff.transfers.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {diff.transfers.map(t => {
                        const network = getNetworkById(t.networkId);
                        return (
                          <span 
                            key={t.networkId}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded"
                            style={{ backgroundColor: `${network?.color}20`, color: network?.color }}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {network?.name || t.networkId}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                
                {diff.status !== 'outdated' && (
                  <button
                    onClick={() => downloadDiff(diff.id)}
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg"
                    title="Скачать"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
