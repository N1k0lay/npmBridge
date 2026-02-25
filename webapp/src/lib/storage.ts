import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { config } from './scripts';

// Кэш статистики в памяти
let _statsCache: StorageStats | null = null;

export interface PackageVersion {
  version: string;
  filename: string;
  size: number;
  mtime: string;
  downloaded: boolean;
}

export interface PackageInfo {
  name: string;
  scope?: string;
  versions: PackageVersion[];
  latestVersion?: string;
  description?: string;
  packageJson?: Record<string, unknown>;
  allVersions?: string[]; // Все версии из package.json
}

export interface StorageStats {
  totalPackages: number;
  totalVersions: number;
  totalSize: number;
  totalSizeHuman: string;
}

export interface PackageSearchResult {
  name: string;
  scope?: string;
  isScoped: boolean;
  latestVersion?: string;
  versionsCount: number;
  description?: string;
}

export interface SearchOptions {
  query: string;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'updated' | 'relevance';
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
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
 * Получение списка пакетов в storage (базовая функция)
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
 * Чтение package.json пакета
 */
async function readPackageJson(packagePath: string): Promise<Record<string, unknown> | null> {
  const packageJsonPath = path.join(packagePath, 'package.json');
  
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  
  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Получение информации о пакете с данными из package.json
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
  
  // Читаем package.json
  const packageJson = await readPackageJson(packagePath);
  
  // Получаем все версии из package.json
  const allVersionsFromJson = packageJson?.versions 
    ? Object.keys(packageJson.versions as Record<string, unknown>).sort((a, b) => {
        // Сортируем semver (новые сверху)
        return compareSemver(b, a);
      })
    : [];
  
  // Получаем скачанные версии (файлы .tgz)
  const downloadedVersions: PackageVersion[] = [];
  const entries = await fs.readdir(packagePath, { withFileTypes: true });
  const downloadedSet = new Set<string>();
  
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.tgz')) {
      const filePath = path.join(packagePath, entry.name);
      const stats = await fs.stat(filePath);
      
      const versionMatch = entry.name.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
      const version = versionMatch ? versionMatch[1] : 'unknown';
      
      downloadedSet.add(version);
      downloadedVersions.push({
        version,
        filename: entry.name,
        size: stats.size,
        mtime: stats.mtime.toISOString(),
        downloaded: true,
      });
    }
  }
  
  // Объединяем версии: сначала из package.json, отмечаем скачанные
  const versions: PackageVersion[] = allVersionsFromJson.map(version => {
    const downloaded = downloadedVersions.find(v => v.version === version);
    if (downloaded) {
      return downloaded;
    }
    return {
      version,
      filename: '',
      size: 0,
      mtime: '',
      downloaded: false,
    };
  });
  
  // Добавляем скачанные версии, которых нет в package.json
  for (const dv of downloadedVersions) {
    if (!allVersionsFromJson.includes(dv.version)) {
      versions.push(dv);
    }
  }
  
  // Сортируем (новые сверху)
  versions.sort((a, b) => compareSemver(b.version, a.version));
  
  const latestVersion = (packageJson?.['dist-tags'] as Record<string, string>)?.latest || 
                        versions.find(v => v.downloaded)?.version;
  
  const description = packageJson?.description as string | undefined;
  
  return {
    name: name,
    scope,
    versions,
    latestVersion,
    description,
    packageJson: packageJson || undefined,
    allVersions: allVersionsFromJson,
  };
}

/**
 * Сравнение semver версий
 */
function compareSemver(a: string, b: string): number {
  const parseVersion = (v: string) => {
    const [main, pre] = v.split('-');
    const parts = main.split('.').map(n => parseInt(n, 10) || 0);
    return { parts, pre: pre || '' };
  };
  
  const va = parseVersion(a);
  const vb = parseVersion(b);
  
  for (let i = 0; i < 3; i++) {
    const diff = (va.parts[i] || 0) - (vb.parts[i] || 0);
    if (diff !== 0) return diff;
  }
  
  // Версии без pre-release выше
  if (!va.pre && vb.pre) return 1;
  if (va.pre && !vb.pre) return -1;
  
  return va.pre.localeCompare(vb.pre);
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
 * Получение статистики из кэша или пересчёт
 */
export async function getStorageStats(): Promise<StorageStats> {
  if (_statsCache) return _statsCache;
  // Кэша нет — запускаем пересчёт в фоне и возвращаем нулевые значения
  refreshStorageStats().catch(console.error);
  return { totalPackages: 0, totalVersions: 0, totalSize: 0, totalSizeHuman: '0 B' };
}

/**
 * Пересчёт статистики storage (запускается в фоне)
 */
export async function refreshStorageStats(): Promise<StorageStats> {
  const storagePath = config.storageDir;
  
  if (!existsSync(storagePath)) {
    const stats = { totalPackages: 0, totalVersions: 0, totalSize: 0, totalSizeHuman: '0 B' };
    _statsCache = stats;
    return stats;
  }
  
  let totalPackages = 0;
  let totalVersions = 0;
  let totalSize = 0;
  
  const packages = await getPackages();
  totalPackages = packages.length;
  
  // Обрабатываем пакеты батчами для снижения нагрузки
  const batchSize = 100;
  for (let i = 0; i < packages.length; i += batchSize) {
    const batch = packages.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (pkg) => {
      const packagePath = path.join(storagePath, pkg);
      try {
        const entries = await fs.readdir(packagePath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.tgz')) {
            totalVersions++;
            const stats = await fs.stat(path.join(packagePath, entry.name));
            totalSize += stats.size;
          }
        }
      } catch {
        // Игнорируем ошибки доступа
      }
    }));
  }
  
  const stats = {
    totalPackages,
    totalVersions,
    totalSize,
    totalSizeHuman: formatSize(totalSize),
  };
  
  _statsCache = stats;
  return stats;
}

/** @deprecated Нет SQLite, нооп для совместимости */
export function invalidateStatsCache(): void {
  _statsCache = null;
}

/**
 * Статус индексации
 */
export interface IndexingStatus {
  isIndexing: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  packagesIndexed: number;
  packagesTotal: number;
  lastError: string | null;
  statsUpdatedAt: string | null;
}

/**
 * Статус индексации (заглушка — SQLite удалён)
 */
export function getIndexingStatus(): IndexingStatus {
  return {
    isIndexing: false,
    startedAt: null,
    finishedAt: null,
    packagesIndexed: 0,
    packagesTotal: 0,
    lastError: null,
    statsUpdatedAt: null,
  };
}

/** @deprecated Индексация удалена */
export async function indexPackages(): Promise<void> { /* noop */ }

/**
 * Умный поиск с сортировкой по релевантности
 */
export async function searchPackages(options: SearchOptions): Promise<PaginatedResult<PackageSearchResult>> {
  const { query, page = 1, limit = 30 } = options;
  const lowerQuery = query.toLowerCase();

  const allPackages = await getPackages();
  const filtered = allPackages.filter(pkg => pkg.toLowerCase().includes(lowerQuery));
  const sorted = sortByRelevance(filtered, lowerQuery);

  const offset = (page - 1) * limit;
  const items = sorted.slice(offset, offset + limit).map(name => ({
    name,
    isScoped: name.startsWith('@'),
    scope: name.startsWith('@') ? name.split('/')[0] : undefined,
    versionsCount: 0,
  }));

  return { items, total: filtered.length, page, limit, hasMore: offset + limit < filtered.length };
}

/**
 * Сортировка по релевантности
 */
function sortByRelevance(packages: string[], query: string): string[] {
  return packages.sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    const aIsScoped = a.startsWith('@');
    const bIsScoped = b.startsWith('@');
    
    // 1. Сначала не-scoped пакеты
    if (!aIsScoped && bIsScoped) return -1;
    if (aIsScoped && !bIsScoped) return 1;
    
    // 2. Точное совпадение
    if (aLower === query && bLower !== query) return -1;
    if (bLower === query && aLower !== query) return 1;
    
    // 3. Начинается с query
    const aStartsWith = aLower.startsWith(query) || 
                        (aIsScoped && aLower.split('/')[1]?.startsWith(query));
    const bStartsWith = bLower.startsWith(query) || 
                        (bIsScoped && bLower.split('/')[1]?.startsWith(query));
    
    if (aStartsWith && !bStartsWith) return -1;
    if (bStartsWith && !aStartsWith) return 1;
    
    // 4. По длине имени (короче = релевантнее)
    if (a.length !== b.length) return a.length - b.length;
    
    // 5. По алфавиту
    return a.localeCompare(b);
  });
}

/**
 * Подсказки для автокомплита
 */
export async function getSuggestions(query: string, limit: number = 10): Promise<PackageSearchResult[]> {
  if (!query || query.length < 2) return [];
  const lowerQuery = query.toLowerCase();
  const allPackages = await getPackages();
  const filtered = allPackages.filter(pkg => pkg.toLowerCase().includes(lowerQuery));
  const sorted = sortByRelevance(filtered, lowerQuery);
  return sorted.slice(0, limit).map(name => ({
    name,
    isScoped: name.startsWith('@'),
    scope: name.startsWith('@') ? name.split('/')[0] : undefined,
    versionsCount: 0,
  }));
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
 * Получение истории пакетов с пагинацией (оптимизированное сканирование)
 */
export async function getPackageHistory(
  page: number = 1, 
  limit: number = 50
): Promise<PaginatedResult<PackageHistoryItem>> {
  const storagePath = config.storageDir;
  const offset = (page - 1) * limit;
  
  // Шаг 1: Быстро собираем список пакетов с mtime директории
  const packageList: Array<{ name: string; scope: string | null; path: string; mtime: number }> = [];
  
  try {
    const entries = await fs.readdir(storagePath, { withFileTypes: true });
    
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory() || entry.name.startsWith('.')) return;
      
      const packagePath = path.join(storagePath, entry.name);
      
      if (entry.name.startsWith('@')) {
        // Scoped package
        try {
          const scopeEntries = await fs.readdir(packagePath, { withFileTypes: true });
          await Promise.all(scopeEntries.map(async (scopeEntry) => {
            if (!scopeEntry.isDirectory() || scopeEntry.name.startsWith('.')) return;
            
            const scopedPackagePath = path.join(packagePath, scopeEntry.name);
            try {
              const stat = await fs.stat(scopedPackagePath);
              packageList.push({
                name: `${entry.name}/${scopeEntry.name}`,
                scope: entry.name,
                path: scopedPackagePath,
                mtime: stat.mtime.getTime(),
              });
            } catch { /* ignore */ }
          }));
        } catch { /* ignore */ }
      } else {
        try {
          const stat = await fs.stat(packagePath);
          packageList.push({
            name: entry.name,
            scope: null,
            path: packagePath,
            mtime: stat.mtime.getTime(),
          });
        } catch { /* ignore */ }
      }
    }));
    
    // Сортируем по дате (новые первыми)
    packageList.sort((a, b) => b.mtime - a.mtime);
    
    const total = packageList.length;
    
    // Шаг 2: Загружаем детали только для нужной страницы
    const pageItems = packageList.slice(offset, offset + limit);
    const items: PackageHistoryItem[] = [];
    
    await Promise.all(pageItems.map(async (pkg, idx) => {
      const pkgInfo = await scanPackageForHistory(pkg.path, pkg.name, pkg.scope);
      if (pkgInfo) {
        items[idx] = pkgInfo;
      }
    }));
    
    return {
      items: items.filter(Boolean),
      total,
      page,
      limit,
      hasMore: offset + limit < total,
    };
  } catch (error) {
    console.error('Error scanning package history:', error);
    return {
      items: [],
      total: 0,
      page,
      limit,
      hasMore: false,
    };
  }
}

/**
 * Вспомогательная функция для сканирования пакета для истории
 */
async function scanPackageForHistory(
  packagePath: string,
  packageName: string,
  scope: string | null
): Promise<PackageHistoryItem | null> {
  try {
    const entries = await fs.readdir(packagePath, { withFileTypes: true });
    const versions: PackageHistoryItem['versions'] = [];
    let totalSize = 0;
    let latestMtime = 0;
    let latestVersion = '';
    
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.tgz')) continue;
      
      const filePath = path.join(packagePath, entry.name);
      const stats = await fs.stat(filePath);
      
      const versionMatch = entry.name.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
      const version = versionMatch ? versionMatch[1] : 'unknown';
      
      versions.push({
        version,
        filename: entry.name,
        size: stats.size,
        addedAt: stats.mtime.toISOString(),
      });
      
      totalSize += stats.size;
      
      if (stats.mtime.getTime() > latestMtime) {
        latestMtime = stats.mtime.getTime();
        latestVersion = version;
      }
    }
    
    if (versions.length === 0) {
      return null;
    }
    
    return {
      name: packageName,
      scope,
      latestVersion,
      versions,
      totalSize,
      lastUpdated: new Date(latestMtime).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Получение недавно загруженных пакетов (по mtime файлов .tgz)
 * Сканирует файловую систему напрямую для актуальных данных
 */
export async function getRecentDownloads(
  hours: number = 24,
  limit: number = 100
): Promise<{
  items: Array<{
    name: string;
    version: string;
    filename: string;
    size: number;
    downloadedAt: string;
  }>;
  total: number;
}> {
  const storagePath = config.storageDir;
  const cutoffTime = Date.now() - hours * 60 * 60 * 1000;
  const recentFiles: Array<{
    name: string;
    version: string;
    filename: string;
    size: number;
    downloadedAt: string;
    mtime: number;
  }> = [];
  
  try {
    // Сканируем все директории в storage
    const entries = await fs.readdir(storagePath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      
      const packagePath = path.join(storagePath, entry.name);
      
      if (entry.name.startsWith('@')) {
        // Scoped package - нужно просканировать поддиректории
        try {
          const scopeEntries = await fs.readdir(packagePath, { withFileTypes: true });
          for (const scopeEntry of scopeEntries) {
            if (!scopeEntry.isDirectory() || scopeEntry.name.startsWith('.')) continue;
            
            const scopedPackagePath = path.join(packagePath, scopeEntry.name);
            const packageName = `${entry.name}/${scopeEntry.name}`;
            
            await scanPackageForRecent(scopedPackagePath, packageName, cutoffTime, recentFiles);
          }
        } catch {
          // ignore
        }
      } else {
        // Regular package
        await scanPackageForRecent(packagePath, entry.name, cutoffTime, recentFiles);
      }
    }
    
    // Сортируем по времени загрузки (новые первыми)
    recentFiles.sort((a, b) => b.mtime - a.mtime);
    
    return {
      items: recentFiles.slice(0, limit).map(f => ({
        name: f.name,
        version: f.version,
        filename: f.filename,
        size: f.size,
        downloadedAt: f.downloadedAt,
      })),
      total: recentFiles.length,
    };
  } catch (error) {
    console.error('Error scanning recent downloads:', error);
    return { items: [], total: 0 };
  }
}

/**
 * Вспомогательная функция для сканирования пакета на недавние файлы
 */
async function scanPackageForRecent(
  packagePath: string,
  packageName: string,
  cutoffTime: number,
  results: Array<{
    name: string;
    version: string;
    filename: string;
    size: number;
    downloadedAt: string;
    mtime: number;
  }>
): Promise<void> {
  try {
    const files = await fs.readdir(packagePath);
    
    for (const file of files) {
      if (!file.endsWith('.tgz')) continue;
      
      const filePath = path.join(packagePath, file);
      const stats = await fs.stat(filePath);
      const mtime = stats.mtime.getTime();
      
      if (mtime >= cutoffTime) {
        // Извлекаем версию из имени файла
        const versionMatch = file.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
        const version = versionMatch ? versionMatch[1] : 'unknown';
        
        results.push({
          name: packageName,
          version,
          filename: file,
          size: stats.size,
          downloadedAt: stats.mtime.toISOString(),
          mtime,
        });
      }
    }
  } catch {
    // ignore
  }
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

/**
 * Получение полных данных пакета для ISR страницы
 */
export async function getPackagePageData(packageName: string): Promise<PackagePageData | null> {
  const storagePath = config.storageDir;
  const packagePath = path.join(storagePath, packageName);
  
  if (!existsSync(packagePath)) {
    return null;
  }
  
  const isScoped = packageName.startsWith('@');
  const [scope, name] = isScoped 
    ? [packageName.split('/')[0], packageName.split('/')[1]] 
    : [undefined, packageName];
  
  // Читаем package.json
  const packageJsonPath = path.join(packagePath, 'package.json');
  let packageJson: NpmPackageJson | null = null;
  
  if (existsSync(packageJsonPath)) {
    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      packageJson = JSON.parse(content);
    } catch {
      // ignore
    }
  }
  
  if (!packageJson) {
    return null;
  }
  
  // Получаем все версии из package.json
  const allVersionsFromJson = packageJson.versions 
    ? Object.keys(packageJson.versions).sort((a, b) => compareSemver(b, a))
    : [];
  
  // Получаем скачанные версии (файлы .tgz)
  const downloadedVersions: Map<string, { filename: string; size: number; mtime: string }> = new Map();
  let totalDownloadedSize = 0;
  
  try {
    const entries = await fs.readdir(packagePath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.tgz')) {
        const filePath = path.join(packagePath, entry.name);
        const stats = await fs.stat(filePath);
        
        const versionMatch = entry.name.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
        const version = versionMatch ? versionMatch[1] : 'unknown';
        
        downloadedVersions.set(version, {
          filename: entry.name,
          size: stats.size,
          mtime: stats.mtime.toISOString(),
        });
        
        totalDownloadedSize += stats.size;
      }
    }
  } catch {
    // ignore
  }
  
  // Объединяем версии
  const versions: VersionInfo[] = allVersionsFromJson.map(version => {
    const downloaded = downloadedVersions.get(version);
    const versionData = packageJson?.versions?.[version];
    
    // Формируем URL для скачивания tarball
    // Для scoped: /@scope/name/-/name-version.tgz
    // Для обычных: /name/-/name-version.tgz
    const baseName = isScoped ? name.split('/')[1] : name;
    const tarballPath = isScoped 
      ? `/${name}/-/${baseName}-${version}.tgz`
      : `/${name}/-/${name}-${version}.tgz`;
    
    return {
      version,
      filename: downloaded?.filename || '',
      size: downloaded?.size || 0,
      mtime: downloaded?.mtime || '',
      downloaded: !!downloaded,
      publishedAt: packageJson?.time?.[version],
      npmVersion: versionData?._npmVersion,
      nodeVersion: versionData?._nodeVersion,
      tarball: downloaded ? tarballPath : undefined,
    };
  });
  
  // Добавляем скачанные версии, которых нет в package.json
  for (const [version, data] of downloadedVersions) {
    if (!allVersionsFromJson.includes(version)) {
      const baseName = isScoped ? name.split('/')[1] : name;
      const tarballPath = isScoped 
        ? `/${name}/-/${baseName}-${version}.tgz`
        : `/${name}/-/${name}-${version}.tgz`;
      
      versions.push({
        version,
        filename: data.filename,
        size: data.size,
        mtime: data.mtime,
        downloaded: true,
        tarball: tarballPath,
      });
    }
  }
  
  // Сортируем (новые сверху)
  versions.sort((a, b) => compareSemver(b.version, a.version));
  
  // Получаем данные последней версии
  const latestVersion = packageJson['dist-tags']?.latest || versions.find(v => v.downloaded)?.version;
  const latestVersionData = latestVersion ? packageJson.versions?.[latestVersion] : undefined;
  
  // Нормализуем данные
  const description = latestVersionData?.description || packageJson.description;
  const keywords = latestVersionData?.keywords || packageJson.keywords || [];
  const license = normalizeLicense(latestVersionData?.license || packageJson.license);
  const author = normalizeAuthor(latestVersionData?.author || packageJson.author);
  const homepage = (latestVersionData?.homepage || packageJson.homepage) as string | undefined;
  const repository = normalizeRepository(latestVersionData?.repository || packageJson.repository);
  const bugs = normalizeBugs(latestVersionData?.bugs || packageJson.bugs);
  const readme = packageJson.readme || '';
  
  return {
    name,
    scope,
    isScoped,
    
    description,
    keywords,
    license,
    author,
    homepage,
    repository,
    bugs,
    readme,
    
    latestVersion,
    distTags: packageJson['dist-tags'] || {},
    versions,
    
    dependencies: latestVersionData?.dependencies,
    devDependencies: latestVersionData?.devDependencies,
    peerDependencies: latestVersionData?.peerDependencies,
    
    totalDownloadedSize,
    totalVersions: versions.length,
    downloadedVersions: downloadedVersions.size,
    
    createdAt: packageJson.time?.created,
    updatedAt: packageJson.time?.modified,
    
    packageJson,
  };
}

// Import types for getPackagePageData
import type { 
  NpmPackageJson, 
  PackagePageData, 
  VersionInfo,
  NpmPerson,
  NpmRepository,
  NpmBugs,
  NpmLicense
} from '@/types/npm-package';

/**
 * Нормализация автора
 */
function normalizeAuthor(author: NpmPerson | string | undefined): string | undefined {
  if (!author) return undefined;
  if (typeof author === 'string') return author;
  return author.name;
}

/**
 * Нормализация репозитория
 */
function normalizeRepository(repo: NpmRepository | string | undefined): string | undefined {
  if (!repo) return undefined;
  if (typeof repo === 'string') return repo;
  return repo.url?.replace(/^git\+/, '').replace(/\.git$/, '');
}

/**
 * Нормализация bugs
 */
function normalizeBugs(bugs: NpmBugs | string | undefined): string | undefined {
  if (!bugs) return undefined;
  if (typeof bugs === 'string') return bugs;
  return bugs.url;
}

/**
 * Нормализация лицензии
 */
function normalizeLicense(license: string | NpmLicense | NpmLicense[] | undefined): string | undefined {
  if (!license) return undefined;
  if (typeof license === 'string') return license;
  if (Array.isArray(license)) {
    return license.map(l => l.type).join(', ');
  }
  return license.type;
}
