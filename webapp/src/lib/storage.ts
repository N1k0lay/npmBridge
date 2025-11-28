import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { config } from './scripts';

export interface PackageVersion {
  version: string;
  filename: string;
  size: number;
  mtime: string;
}

export interface PackageInfo {
  name: string;
  scope?: string;
  versions: PackageVersion[];
  latestVersion?: string;
}

export interface StorageStats {
  totalPackages: number;
  totalVersions: number;
  totalSize: number;
  totalSizeHuman: string;
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Получение списка пакетов в storage
 */
export async function getPackages(scope?: string): Promise<string[]> {
  const storagePath = config.storageDir;
  
  if (!existsSync(storagePath)) {
    return [];
  }
  
  const packages: string[] = [];
  const entries = await fs.readdir(storagePath, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    
    if (entry.name.startsWith('@')) {
      // Scoped пакеты
      if (scope && entry.name !== scope) {
        continue;
      }
      
      const scopePath = path.join(storagePath, entry.name);
      const scopedEntries = await fs.readdir(scopePath, { withFileTypes: true });
      
      for (const scopedEntry of scopedEntries) {
        if (scopedEntry.isDirectory() && !scopedEntry.name.startsWith('.')) {
          packages.push(`${entry.name}/${scopedEntry.name}`);
        }
      }
    } else if (!scope) {
      packages.push(entry.name);
    }
  }
  
  return packages.sort();
}

/**
 * Получение информации о пакете
 */
export async function getPackageInfo(packageName: string): Promise<PackageInfo | null> {
  const storagePath = config.storageDir;
  const packagePath = path.join(storagePath, packageName);
  
  if (!existsSync(packagePath)) {
    return null;
  }
  
  const isScoped = packageName.startsWith('@');
  const [scope, name] = isScoped 
    ? [packageName.split('/')[0], packageName.split('/')[1]] 
    : [undefined, packageName];
  
  const versions: PackageVersion[] = [];
  const entries = await fs.readdir(packagePath, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.tgz')) {
      const filePath = path.join(packagePath, entry.name);
      const stats = await fs.stat(filePath);
      
      // Извлекаем версию из имени файла
      const versionMatch = entry.name.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
      const version = versionMatch ? versionMatch[1] : 'unknown';
      
      versions.push({
        version,
        filename: entry.name,
        size: stats.size,
        mtime: stats.mtime.toISOString(),
      });
    }
  }
  
  // Сортируем версии (новые сверху)
  versions.sort((a, b) => {
    return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
  });
  
  // Пытаемся получить latest из package.json
  let latestVersion: string | undefined;
  const packageJsonPath = path.join(packagePath, 'package.json');
  
  if (existsSync(packageJsonPath)) {
    try {
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);
      latestVersion = packageJson['dist-tags']?.latest;
    } catch {
      // Игнорируем ошибки парсинга
    }
  }
  
  return {
    name: name,
    scope,
    versions,
    latestVersion,
  };
}

/**
 * Получение списка scopes
 */
export async function getScopes(): Promise<string[]> {
  const storagePath = config.storageDir;
  
  if (!existsSync(storagePath)) {
    return [];
  }
  
  const scopes: string[] = [];
  const entries = await fs.readdir(storagePath, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('@')) {
      scopes.push(entry.name);
    }
  }
  
  return scopes.sort();
}

/**
 * Получение статистики storage
 */
export async function getStorageStats(): Promise<StorageStats> {
  const storagePath = config.storageDir;
  
  if (!existsSync(storagePath)) {
    return {
      totalPackages: 0,
      totalVersions: 0,
      totalSize: 0,
      totalSizeHuman: '0 B',
    };
  }
  
  let totalPackages = 0;
  let totalVersions = 0;
  let totalSize = 0;
  
  const packages = await getPackages();
  totalPackages = packages.length;
  
  for (const pkg of packages) {
    const packagePath = path.join(storagePath, pkg);
    const entries = await fs.readdir(packagePath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.tgz')) {
        totalVersions++;
        const stats = await fs.stat(path.join(packagePath, entry.name));
        totalSize += stats.size;
      }
    }
  }
  
  return {
    totalPackages,
    totalVersions,
    totalSize,
    totalSizeHuman: formatSize(totalSize),
  };
}

/**
 * Поиск пакетов по имени
 */
export async function searchPackages(query: string): Promise<string[]> {
  const packages = await getPackages();
  const lowerQuery = query.toLowerCase();
  
  return packages.filter(pkg => pkg.toLowerCase().includes(lowerQuery));
}

export interface PackageHistoryItem {
  name: string;
  scope: string | null;
  latestVersion: string;
  versions: {
    version: string;
    filename: string;
    size: number;
    addedAt: string;
  }[];
  totalSize: number;
  lastUpdated: string;
}

/**
 * Получение полной истории пакетов с датами добавления
 */
export async function getPackageHistory(): Promise<PackageHistoryItem[]> {
  const storagePath = config.storageDir;
  
  if (!existsSync(storagePath)) {
    return [];
  }
  
  const packages = await getPackages();
  const history: PackageHistoryItem[] = [];
  
  for (const pkg of packages) {
    const packagePath = path.join(storagePath, pkg);
    const isScoped = pkg.startsWith('@');
    const scope = isScoped ? pkg.split('/')[0].substring(1) : null;
    
    const versions: PackageHistoryItem['versions'] = [];
    let totalSize = 0;
    let lastUpdated = new Date(0);
    let latestVersion = '0.0.0';
    
    try {
      const entries = await fs.readdir(packagePath, { withFileTypes: true });
      
      // Пытаемся получить latest из package.json
      const packageJsonPath = path.join(packagePath, 'package.json');
      if (existsSync(packageJsonPath)) {
        try {
          const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(packageJsonContent);
          latestVersion = packageJson['dist-tags']?.latest || latestVersion;
        } catch {
          // Игнорируем
        }
      }
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.tgz')) {
          const filePath = path.join(packagePath, entry.name);
          const stats = await fs.stat(filePath);
          
          // Извлекаем версию из имени файла
          const versionMatch = entry.name.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
          const version = versionMatch ? versionMatch[1] : 'unknown';
          
          versions.push({
            version,
            filename: entry.name,
            size: stats.size,
            addedAt: stats.mtime.toISOString(),
          });
          
          totalSize += stats.size;
          
          if (stats.mtime > lastUpdated) {
            lastUpdated = stats.mtime;
          }
        }
      }
      
      if (versions.length > 0) {
        history.push({
          name: pkg,
          scope,
          latestVersion,
          versions,
          totalSize,
          lastUpdated: lastUpdated.toISOString(),
        });
      }
    } catch {
      // Пропускаем пакеты с ошибками доступа
    }
  }
  
  // Сортируем по дате последнего обновления (новые сверху)
  history.sort((a, b) => 
    new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
  );
  
  return history;
}

/**
 * Получение пути к файлу архива пакета
 */
export function getPackageArchivePath(packageName: string, filename: string): string {
  return path.join(config.storageDir, packageName, filename);
}

/**
 * Получение пути к diff архиву
 */
export function getDiffArchivePath(diffId: string): string {
  return path.join(config.diffArchivesDir, `${diffId}.tar.gz`);
}
