'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Check, X, RefreshCw, Globe } from 'lucide-react';

interface NetworkConfig {
  id: string;
  name: string;
  description: string;
  color: string;
}

interface NetworksPanelProps {
  onNetworksChange?: () => void;
}

const COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
];

export function NetworksPanel({ onNetworksChange }: NetworksPanelProps) {
  const [networks, setNetworks] = useState<NetworkConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newNetwork, setNewNetwork] = useState<Omit<NetworkConfig, 'id'>>({
    name: '',
    description: '',
    color: COLORS[0],
  });
  const [editData, setEditData] = useState<NetworkConfig | null>(null);

  const loadNetworks = async () => {
    try {
      const res = await fetch('/api/networks');
      const data = await res.json();
      setNetworks(data.networks || []);
    } catch (error) {
      console.error('Error loading networks:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadNetworks();
  }, []);

  const addNetwork = async () => {
    if (!newNetwork.name.trim()) {
      alert('Введите название сети');
      return;
    }

    try {
      const res = await fetch('/api/networks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newNetwork),
      });

      if (res.ok) {
        setNewNetwork({
          name: '',
          description: '',
          color: COLORS[networks.length % COLORS.length],
        });
        setIsAdding(false);
        await loadNetworks();
        onNetworksChange?.();
      } else {
        const data = await res.json();
        alert(data.error || 'Ошибка добавления сети');
      }
    } catch (error) {
      alert('Ошибка сети');
    }
  };

  const updateNetwork = async () => {
    if (!editData) return;

    try {
      const res = await fetch('/api/networks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editData.id,
          updates: {
            name: editData.name,
            description: editData.description,
            color: editData.color,
          },
        }),
      });

      if (res.ok) {
        setEditingId(null);
        setEditData(null);
        await loadNetworks();
        onNetworksChange?.();
      } else {
        const data = await res.json();
        alert(data.error || 'Ошибка обновления сети');
      }
    } catch (error) {
      alert('Ошибка сети');
    }
  };

  const deleteNetwork = async (id: string) => {
    const network = networks.find(n => n.id === id);
    if (!confirm(`Удалить сеть "${network?.name}"? Это действие необратимо.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/networks?id=${id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await loadNetworks();
        onNetworksChange?.();
      } else {
        const data = await res.json();
        alert(data.error || 'Ошибка удаления сети');
      }
    } catch (error) {
      alert('Ошибка сети');
    }
  };

  const startEditing = (network: NetworkConfig) => {
    setEditingId(network.id);
    setEditData({ ...network });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditData(null);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Globe className="w-5 h-5" />
          Корпоративные сети
        </h2>
        <button
          onClick={loadNetworks}
          className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Сети для отслеживания переносов diff-архивов
      </p>

      {isLoading ? (
        <div className="text-center py-4 text-gray-500">Загрузка...</div>
      ) : (
        <div className="space-y-3">
          {networks.map((network) => (
            <div
              key={network.id}
              className="p-3 rounded-lg border-2 bg-white transition-all"
              style={{ borderLeftColor: network.color, borderLeftWidth: '4px' }}
            >
              {editingId === network.id && editData ? (
                /* Режим редактирования */
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editData.name}
                    onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Название сети"
                  />
                  <input
                    type="text"
                    value={editData.description}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Описание"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Цвет:</span>
                    <div className="flex gap-1">
                      {COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => setEditData({ ...editData, color })}
                          className={`w-6 h-6 rounded-full border-2 ${
                            editData.color === color ? 'border-gray-800' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={cancelEditing}
                      className="px-3 py-1 text-gray-600 hover:bg-gray-100 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      onClick={updateNetwork}
                      className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                /* Режим просмотра */
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: network.color }}
                      />
                      <span className="font-medium">{network.name}</span>
                    </div>
                    {network.description && (
                      <p className="text-sm text-gray-500 mt-1">{network.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEditing(network)}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteNetwork(network.id)}
                      className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Форма добавления новой сети */}
          {isAdding ? (
            <div className="p-3 border-2 border-dashed border-gray-300 rounded-lg space-y-3">
              <input
                type="text"
                value={newNetwork.name}
                onChange={(e) => setNewNetwork({ ...newNetwork, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Название сети"
                autoFocus
              />
              <input
                type="text"
                value={newNetwork.description}
                onChange={(e) => setNewNetwork({ ...newNetwork, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Описание (опционально)"
              />
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Цвет:</span>
                <div className="flex gap-1">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewNetwork({ ...newNetwork, color })}
                      className={`w-6 h-6 rounded-full border-2 ${
                        newNetwork.color === color ? 'border-gray-800' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsAdding(false)}
                  className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded"
                >
                  Отмена
                </button>
                <button
                  onClick={addNetwork}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Добавить
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Добавить сеть
            </button>
          )}
        </div>
      )}

      {networks.length > 0 && (
        <div className="mt-4 pt-4 border-t text-sm text-gray-500">
          Всего сетей: <span className="font-medium">{networks.length}</span>
        </div>
      )}
    </div>
  );
}
