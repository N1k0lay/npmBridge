import { getDb } from './db';
import { config } from './scripts';
import fs from 'fs';

/**
 * Конфигурация корпоративной сети
 */
export interface NetworkConfig {
  id: string;
  name: string;
  description: string;
  color: string;
}

/**
 * Состояние сети - информация о текущем состоянии пакетной базы
 */
export interface NetworkState {
  networkId: string;
  lastSyncAt: string | null;
  lastDiffId: string | null;
  packagesCount: number;
  totalSize: number;
}

/**
 * Получение пути к общей frozen директории
 * (После смены концепции frozen одна общая, без разделения по сетям)
 */
export function getNetworkFrozenDir(_networkId: string): string {
  return config.frozenDir;
}

/**
 * Получение пути к общей diff_archives директории
 * (После смены концепции diff_archives одна общая, без разделения по сетям)
 */
export function getNetworkDiffArchivesDir(_networkId: string): string {
  return config.diffArchivesDir;
}

/**
 * Загрузка списка сетей
 */
export async function loadNetworks(): Promise<NetworkConfig[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, description, color FROM networks ORDER BY id
  `).all() as Array<{ id: string; name: string; description: string; color: string }>;
  
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    color: row.color || '#3B82F6',
  }));
}

/**
 * Сохранение списка сетей (полная замена)
 */
export async function saveNetworks(networks: NetworkConfig[]): Promise<void> {
  const db = getDb();
  
  db.transaction(() => {
    db.prepare('DELETE FROM networks').run();
    
    const insert = db.prepare(`
      INSERT INTO networks (id, name, description, color) VALUES (?, ?, ?, ?)
    `);
    
    for (const network of networks) {
      insert.run(network.id, network.name, network.description || '', network.color || '#3B82F6');
    }
  })();
}

/**
 * Добавление новой сети
 * Сети - это просто метки для отслеживания переносов.
 * Папки frozen и diff_archives общие для всех сетей.
 */
export async function addNetwork(network: Omit<NetworkConfig, 'id'>): Promise<NetworkConfig> {
  const db = getDb();
  
  // Генерируем уникальный ID
  const id = `network_${Date.now()}`;
  
  db.prepare(`
    INSERT INTO networks (id, name, description, color) VALUES (?, ?, ?, ?)
  `).run(id, network.name, network.description || '', network.color || '#3B82F6');
  
  return { ...network, id };
}

/**
 * Обновление сети
 */
export async function updateNetwork(id: string, updates: Partial<NetworkConfig>): Promise<boolean> {
  const db = getDb();
  
  const setClauses: string[] = [];
  const values: (string | undefined)[] = [];
  
  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    values.push(updates.description);
  }
  if (updates.color !== undefined) {
    setClauses.push('color = ?');
    values.push(updates.color);
  }
  
  if (setClauses.length === 0) {
    return false;
  }
  
  values.push(id);
  const result = db.prepare(`
    UPDATE networks SET ${setClauses.join(', ')} WHERE id = ?
  `).run(...values);
  
  return result.changes > 0;
}

/**
 * Удаление сети
 */
export async function deleteNetwork(id: string): Promise<boolean> {
  if (id === 'default') {
    return false; // Нельзя удалить дефолтную сеть
  }
  
  const db = getDb();
  const result = db.prepare('DELETE FROM networks WHERE id = ?').run(id);
  
  return result.changes > 0;
}

/**
 * Получение сети по ID
 */
export async function getNetwork(id: string): Promise<NetworkConfig | null> {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, name, description, color FROM networks WHERE id = ?
  `).get(id) as { id: string; name: string; description: string; color: string } | undefined;
  
  if (!row) return null;
  
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    color: row.color || '#3B82F6',
  };
}

// ==================== Network States ====================

/**
 * Загрузка состояний сетей
 */
export async function loadNetworkStates(): Promise<Record<string, NetworkState>> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT network_id, last_sync_at, last_diff_id, packages_count, total_size 
    FROM network_states
  `).all() as Array<{
    network_id: string;
    last_sync_at: string | null;
    last_diff_id: string | null;
    packages_count: number;
    total_size: number;
  }>;
  
  const states: Record<string, NetworkState> = {};
  for (const row of rows) {
    states[row.network_id] = {
      networkId: row.network_id,
      lastSyncAt: row.last_sync_at,
      lastDiffId: row.last_diff_id,
      packagesCount: row.packages_count,
      totalSize: row.total_size,
    };
  }
  return states;
}

/**
 * Получение состояния конкретной сети
 */
export async function getNetworkState(networkId: string): Promise<NetworkState> {
  const db = getDb();
  const row = db.prepare(`
    SELECT network_id, last_sync_at, last_diff_id, packages_count, total_size 
    FROM network_states WHERE network_id = ?
  `).get(networkId) as {
    network_id: string;
    last_sync_at: string | null;
    last_diff_id: string | null;
    packages_count: number;
    total_size: number;
  } | undefined;
  
  if (!row) {
    return {
      networkId,
      lastSyncAt: null,
      lastDiffId: null,
      packagesCount: 0,
      totalSize: 0,
    };
  }
  
  return {
    networkId: row.network_id,
    lastSyncAt: row.last_sync_at,
    lastDiffId: row.last_diff_id,
    packagesCount: row.packages_count,
    totalSize: row.total_size,
  };
}

/**
 * Обновление состояния сети после синхронизации
 */
export async function updateNetworkState(
  networkId: string,
  diffId: string,
  packagesCount: number,
  totalSize: number
): Promise<void> {
  const db = getDb();
  
  db.prepare(`
    INSERT OR REPLACE INTO network_states (network_id, last_sync_at, last_diff_id, packages_count, total_size)
    VALUES (?, datetime('now'), ?, ?, ?)
  `).run(networkId, diffId, packagesCount, totalSize);
}

/**
 * Инициализация директорий для всех сетей
 */
export async function initializeNetworkDirectories(): Promise<void> {
  const networks = await loadNetworks();
  
  for (const network of networks) {
    fs.mkdirSync(getNetworkFrozenDir(network.id), { recursive: true });
    fs.mkdirSync(getNetworkDiffArchivesDir(network.id), { recursive: true });
  }
}
