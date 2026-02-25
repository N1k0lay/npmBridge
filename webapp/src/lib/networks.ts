/**
 * networks.ts — управление корпоративными сетями.
 * Хранение: data/networks.json (без SQLite, без frozen).
 */

import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import { config } from './scripts';

// ─────────────────────────────────────────────
// Интерфейсы
// ─────────────────────────────────────────────

export interface NetworkConfig {
  id: string;
  name: string;
  description: string;
  color: string;
}

/** Оставлено для обратной совместимости API. */
export interface NetworkState {
  networkId: string;
  lastSyncAt: string | null;
  lastDiffId: string | null;
  packagesCount: number;
  totalSize: number;
}

// ─────────────────────────────────────────────
// Пути
// ─────────────────────────────────────────────

function networksFilePath(): string {
  return path.join(config.dataDir, 'networks.json');
}

// ─────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────

function writeJsonSync(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

// ─────────────────────────────────────────────
// Дефолтные сети
// ─────────────────────────────────────────────

function getDefaultNetworks(): NetworkConfig[] {
  const defaultsPath = path.join(config.dataDir, '..', 'defaults', 'networks.json');
  try {
    if (fs.existsSync(defaultsPath)) {
      const data = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));
      if (data.networks && Array.isArray(data.networks)) {
        return data.networks as NetworkConfig[];
      }
    }
  } catch {
    // игнорируем ошибку чтения
  }
  return [
    {
      id: 'default',
      name: 'Основная корп. сеть',
      description: 'Главная корпоративная сеть',
      color: '#3B82F6',
    },
  ];
}

// ─────────────────────────────────────────────
// CRUD для сетей
// ─────────────────────────────────────────────

export async function loadNetworks(): Promise<NetworkConfig[]> {
  const filePath = networksFilePath();
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (data.networks && Array.isArray(data.networks)) {
      return data.networks as NetworkConfig[];
    }
  } catch {
    // файл не существует — используем дефолтные
  }

  const defaults = getDefaultNetworks();
  writeJsonSync(filePath, { networks: defaults });
  return defaults;
}

export async function saveNetworks(networks: NetworkConfig[]): Promise<void> {
  writeJsonSync(networksFilePath(), { networks });
}

export async function addNetwork(
  network: Omit<NetworkConfig, 'id'>
): Promise<NetworkConfig> {
  const networks = await loadNetworks();
  const id = `network_${Date.now()}`;
  const newNetwork: NetworkConfig = {
    id,
    name: network.name,
    description: network.description || '',
    color: network.color || '#3B82F6',
  };
  networks.push(newNetwork);
  await saveNetworks(networks);
  return newNetwork;
}

export async function updateNetwork(
  id: string,
  updates: Partial<NetworkConfig>
): Promise<boolean> {
  const networks = await loadNetworks();
  const idx = networks.findIndex(n => n.id === id);
  if (idx === -1) return false;
  networks[idx] = { ...networks[idx], ...updates, id };
  await saveNetworks(networks);
  return true;
}

export async function deleteNetwork(id: string): Promise<boolean> {
  if (id === 'default') return false;
  const networks = await loadNetworks();
  const filtered = networks.filter(n => n.id !== id);
  if (filtered.length === networks.length) return false;
  await saveNetworks(filtered);
  return true;
}

export async function getNetwork(id: string): Promise<NetworkConfig | null> {
  const networks = await loadNetworks();
  return networks.find(n => n.id === id) ?? null;
}

// ─────────────────────────────────────────────
// NetworkState — заглушки (frozen больше не используется)
// ─────────────────────────────────────────────

export async function loadNetworkStates(): Promise<Record<string, NetworkState>> {
  const networks = await loadNetworks();
  const states: Record<string, NetworkState> = {};
  for (const n of networks) {
    states[n.id] = {
      networkId: n.id,
      lastSyncAt: null,
      lastDiffId: null,
      packagesCount: 0,
      totalSize: 0,
    };
  }
  return states;
}

export async function getNetworkState(networkId: string): Promise<NetworkState> {
  return {
    networkId,
    lastSyncAt: null,
    lastDiffId: null,
    packagesCount: 0,
    totalSize: 0,
  };
}

/**
 * Путь к общей директории diff_archives.
 */
export function getNetworkDiffArchivesDir(_networkId: string): string {
  return config.diffArchivesDir;
}

/**
 * @deprecated frozen директории больше не используются.
 * Для совместимости возвращает diffArchivesDir.
 */
export function getNetworkFrozenDir(_networkId: string): string {
  return config.diffArchivesDir;
}

/**
 * @deprecated Больше не нужна — frozen не используется.
 */
export async function initializeNetworkDirectories(): Promise<void> {
  // noop
}
