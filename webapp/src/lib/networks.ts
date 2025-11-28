import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { config } from './scripts';

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
 * Файл конфигурации сетей
 */
interface NetworksFile {
  networks: NetworkConfig[];
}

const NETWORKS_FILE = 'networks.json';
const NETWORK_STATES_FILE = 'network_states.json';

async function getNetworksPath(): Promise<string> {
  await fs.mkdir(config.dataDir, { recursive: true });
  return path.join(config.dataDir, NETWORKS_FILE);
}

async function getNetworkStatesPath(): Promise<string> {
  await fs.mkdir(config.dataDir, { recursive: true });
  return path.join(config.dataDir, NETWORK_STATES_FILE);
}

/**
 * Получение пути к frozen директории для конкретной сети
 */
export function getNetworkFrozenDir(networkId: string): string {
  return path.join(config.frozenDir, networkId);
}

/**
 * Получение пути к diff_archives директории для конкретной сети
 */
export function getNetworkDiffArchivesDir(networkId: string): string {
  return path.join(config.diffArchivesDir, networkId);
}

/**
 * Загрузка списка сетей
 */
export async function loadNetworks(): Promise<NetworkConfig[]> {
  try {
    const networksPath = await getNetworksPath();
    const data = await fs.readFile(networksPath, 'utf-8');
    const parsed: NetworksFile = JSON.parse(data);
    return parsed.networks || [];
  } catch {
    // Возвращаем дефолтную сеть если файл не существует
    return [
      {
        id: 'default',
        name: 'Основная корп. сеть',
        description: 'Главная корпоративная сеть',
        color: '#3B82F6',
      },
    ];
  }
}

/**
 * Сохранение списка сетей
 */
export async function saveNetworks(networks: NetworkConfig[]): Promise<void> {
  const networksPath = await getNetworksPath();
  await fs.writeFile(
    networksPath,
    JSON.stringify({ networks }, null, 2)
  );
}

/**
 * Добавление новой сети
 */
export async function addNetwork(network: Omit<NetworkConfig, 'id'>): Promise<NetworkConfig> {
  const networks = await loadNetworks();
  
  // Генерируем уникальный ID
  const id = `network_${Date.now()}`;
  const newNetwork: NetworkConfig = { ...network, id };
  
  networks.push(newNetwork);
  await saveNetworks(networks);
  
  // Создаём директории для сети
  await fs.mkdir(getNetworkFrozenDir(id), { recursive: true });
  await fs.mkdir(getNetworkDiffArchivesDir(id), { recursive: true });
  
  return newNetwork;
}

/**
 * Обновление сети
 */
export async function updateNetwork(id: string, updates: Partial<NetworkConfig>): Promise<boolean> {
  const networks = await loadNetworks();
  const index = networks.findIndex(n => n.id === id);
  
  if (index === -1) {
    return false;
  }
  
  networks[index] = { ...networks[index], ...updates, id };
  await saveNetworks(networks);
  return true;
}

/**
 * Удаление сети
 */
export async function deleteNetwork(id: string): Promise<boolean> {
  if (id === 'default') {
    return false; // Нельзя удалить дефолтную сеть
  }
  
  const networks = await loadNetworks();
  const filtered = networks.filter(n => n.id !== id);
  
  if (filtered.length === networks.length) {
    return false;
  }
  
  await saveNetworks(filtered);
  return true;
}

/**
 * Получение сети по ID
 */
export async function getNetwork(id: string): Promise<NetworkConfig | null> {
  const networks = await loadNetworks();
  return networks.find(n => n.id === id) || null;
}



// ==================== Network States ====================

/**
 * Загрузка состояний сетей
 */
export async function loadNetworkStates(): Promise<Record<string, NetworkState>> {
  try {
    const statesPath = await getNetworkStatesPath();
    const data = await fs.readFile(statesPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Сохранение состояний сетей
 */
export async function saveNetworkStates(states: Record<string, NetworkState>): Promise<void> {
  const statesPath = await getNetworkStatesPath();
  await fs.writeFile(statesPath, JSON.stringify(states, null, 2));
}

/**
 * Получение состояния конкретной сети
 */
export async function getNetworkState(networkId: string): Promise<NetworkState> {
  const states = await loadNetworkStates();
  return states[networkId] || {
    networkId,
    lastSyncAt: null,
    lastDiffId: null,
    packagesCount: 0,
    totalSize: 0,
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
  const states = await loadNetworkStates();
  
  states[networkId] = {
    networkId,
    lastSyncAt: new Date().toISOString(),
    lastDiffId: diffId,
    packagesCount,
    totalSize,
  };
  
  await saveNetworkStates(states);
}

/**
 * Инициализация директорий для всех сетей
 */
export async function initializeNetworkDirectories(): Promise<void> {
  const networks = await loadNetworks();
  
  for (const network of networks) {
    await fs.mkdir(getNetworkFrozenDir(network.id), { recursive: true });
    await fs.mkdir(getNetworkDiffArchivesDir(network.id), { recursive: true });
  }
}
