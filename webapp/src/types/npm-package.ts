/**
 * TypeScript типы для NPM package.json
 * Полное описание структуры пакета из npm registry
 */

// Информация о человеке (автор/контрибьютор)
export interface NpmPerson {
  name: string;
  email?: string;
  url?: string;
}

// Репозиторий
export interface NpmRepository {
  type?: string;
  url?: string;
  directory?: string;
}

// Баг-трекер
export interface NpmBugs {
  url?: string;
  email?: string;
}

// Лицензия (старый формат)
export interface NpmLicense {
  type: string;
  url?: string;
}

// Dist информация о tarball
export interface NpmDist {
  tarball: string;
  shasum?: string;
  integrity?: string;
  fileCount?: number;
  unpackedSize?: number;
  signatures?: Array<{
    keyid: string;
    sig: string;
  }>;
}

// Зависимости
export type NpmDependencies = Record<string, string>;

// Peer зависимости с meta
export interface NpmPeerDependenciesMeta {
  [packageName: string]: {
    optional?: boolean;
  };
}

// Информация о npm user
export interface NpmUser {
  name: string;
  email?: string;
}

// Engines
export interface NpmEngines {
  node?: string;
  npm?: string;
  [engine: string]: string | undefined;
}

// Описание одной версии пакета
export interface NpmPackageVersion {
  name: string;
  version: string;
  description?: string;
  main?: string;
  module?: string;
  types?: string;
  typings?: string;
  browser?: string | Record<string, string | false>;
  bin?: string | Record<string, string>;
  exports?: Record<string, unknown>;
  
  // Мета информация о пакете
  keywords?: string[];
  author?: NpmPerson | string;
  contributors?: Array<NpmPerson | string>;
  maintainers?: NpmUser[];
  license?: string | NpmLicense | NpmLicense[];
  licenses?: NpmLicense[];
  
  // Ссылки
  homepage?: string;
  repository?: NpmRepository | string;
  bugs?: NpmBugs | string;
  funding?: { type?: string; url: string } | string | Array<{ type?: string; url: string } | string>;
  
  // Зависимости
  dependencies?: NpmDependencies;
  devDependencies?: NpmDependencies;
  peerDependencies?: NpmDependencies;
  peerDependenciesMeta?: NpmPeerDependenciesMeta;
  optionalDependencies?: NpmDependencies;
  bundledDependencies?: string[];
  bundleDependencies?: string[];
  
  // Скрипты
  scripts?: Record<string, string>;
  
  // Engines и OS
  engines?: NpmEngines;
  os?: string[];
  cpu?: string[];
  
  // Dist info
  dist: NpmDist;
  
  // NPM internal fields
  _id?: string;
  _npmVersion?: string;
  _nodeVersion?: string;
  _npmUser?: NpmUser;
  _hasShrinkwrap?: boolean;
  
  // Legacy fields
  _engineSupported?: boolean;
  _defaultsLoaded?: boolean;
  directories?: Record<string, string>;
  
  // Дополнительные поля
  [key: string]: unknown;
}

// Dist-tags (latest, next, etc.)
export type NpmDistTags = Record<string, string>;

// Time info (когда версия была опубликована)
export type NpmTime = Record<string, string> & {
  created?: string;
  modified?: string;
};

// Uplinks info (verdaccio specific)
export interface NpmUplinks {
  [uplinkName: string]: {
    etag?: string;
    fetched?: number;
  };
}

// Dist files (verdaccio specific)
export interface NpmDistFiles {
  [filename: string]: {
    url: string;
    sha?: string;
    registry?: string;
  };
}

// Attachments (verdaccio specific)
export interface NpmAttachments {
  [filename: string]: {
    shasum?: string;
    content_type?: string;
    length?: number;
  };
}

/**
 * Полная структура package.json из npm registry / verdaccio
 */
export interface NpmPackageJson {
  // Обязательные поля
  name: string;
  versions: Record<string, NpmPackageVersion>;
  
  // Dist tags
  'dist-tags': NpmDistTags;
  
  // Время публикаций
  time?: NpmTime;
  
  // Мета информация
  description?: string;
  keywords?: string[];
  author?: NpmPerson | string;
  maintainers?: NpmUser[];
  contributors?: Array<NpmPerson | string>;
  license?: string | NpmLicense | NpmLicense[];
  
  // Ссылки
  homepage?: string;
  repository?: NpmRepository | string;
  bugs?: NpmBugs | string;
  
  // README
  readme?: string;
  readmeFilename?: string;
  
  // NPM internal fields
  _id?: string;
  _rev?: string;
  
  // Verdaccio specific fields
  _uplinks?: NpmUplinks;
  _distfiles?: NpmDistFiles;
  _attachments?: NpmAttachments;
  
  // Дополнительные поля
  [key: string]: unknown;
}

/**
 * Краткая информация о пакете для UI
 */
export interface PackageSummary {
  name: string;
  scope?: string;
  isScoped: boolean;
  description?: string;
  latestVersion?: string;
  versionsCount: number;
  keywords?: string[];
  license?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  readme?: string;
}

/**
 * Информация о версии для UI
 */
export interface VersionInfo {
  version: string;
  filename: string;
  size: number;
  mtime: string;
  downloaded: boolean;
  publishedAt?: string;
  npmVersion?: string;
  nodeVersion?: string;
  tarball?: string;
}

/**
 * Полная информация о пакете для страницы пакета
 */
export interface PackagePageData {
  name: string;
  scope?: string;
  isScoped: boolean;
  
  // Мета информация
  description?: string;
  keywords?: string[];
  license?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  bugs?: string;
  
  // README
  readme?: string;
  
  // Версии
  latestVersion?: string;
  distTags: NpmDistTags;
  versions: VersionInfo[];
  
  // Зависимости последней версии
  dependencies?: NpmDependencies;
  devDependencies?: NpmDependencies;
  peerDependencies?: NpmDependencies;
  
  // Статистика
  totalDownloadedSize: number;
  totalVersions: number;
  downloadedVersions: number;
  
  // Время
  createdAt?: string;
  updatedAt?: string;
  
  // Raw package.json для advanced users
  packageJson?: NpmPackageJson;
}

/**
 * Хелпер функции для работы с типами
 */
export function normalizeAuthor(author: NpmPerson | string | undefined): string | undefined {
  if (!author) return undefined;
  if (typeof author === 'string') return author;
  return author.name;
}

export function normalizeRepository(repo: NpmRepository | string | undefined): string | undefined {
  if (!repo) return undefined;
  if (typeof repo === 'string') return repo;
  return repo.url?.replace(/^git\+/, '').replace(/\.git$/, '');
}

export function normalizeBugs(bugs: NpmBugs | string | undefined): string | undefined {
  if (!bugs) return undefined;
  if (typeof bugs === 'string') return bugs;
  return bugs.url;
}

export function normalizeLicense(license: string | NpmLicense | NpmLicense[] | undefined): string | undefined {
  if (!license) return undefined;
  if (typeof license === 'string') return license;
  if (Array.isArray(license)) {
    return license.map(l => l.type).join(', ');
  }
  return license.type;
}
