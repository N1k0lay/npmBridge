'use client';

import { useState } from 'react';
import Link from 'next/link';
import MarkdownIt from 'markdown-it';
import { 
  Package,
  ChevronLeft, 
  Copy, 
  Check, 
  Clock, 
  Download,
  Tag,
  FileText,
  User,
  Link as LinkIcon,
  Github,
  Box,
  AlertCircle,
  ExternalLink,
  BookOpen,
  Code,
  ChevronDown
} from 'lucide-react';
import type { PackagePageData, NpmDependencies } from '@/types/npm-package';

interface Props {
  packageData: PackagePageData;
}

function formatSize(bytes: number): string {
  if (!bytes) return '—';
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
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('ru-RU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'сегодня';
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} дн. назад`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} нед. назад`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} мес. назад`;
  return `${Math.floor(diffDays / 365)} г. назад`;
}

// Инициализация markdown-it с настройками
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
});

// Кастомизация рендеринга ссылок для открытия в новой вкладке
/* eslint-disable @typescript-eslint/no-explicit-any */
const defaultLinkRender = md.renderer.rules.link_open || function(
  tokens: any[], 
  idx: number, 
  options: any, 
  _env: unknown, 
  self: any
) {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.link_open = function(
  tokens: any[], 
  idx: number, 
  options: any, 
  env: unknown, 
  self: any
) {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return defaultLinkRender(tokens, idx, options, env, self);
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// Компонент зависимостей
function DependenciesList({ deps, title }: { deps?: NpmDependencies; title: string }) {
  const [expanded, setExpanded] = useState(false);
  
  if (!deps || Object.keys(deps).length === 0) return null;
  
  const entries = Object.entries(deps);
  const showCount = 10;
  const hasMore = entries.length > showCount;
  const displayedDeps = expanded ? entries : entries.slice(0, showCount);
  
  return (
    <div className="mb-4">
      <h4 className="text-sm font-medium text-gray-500 mb-2">{title} ({entries.length})</h4>
      <div className="flex flex-wrap gap-2">
        {displayedDeps.map(([name, version]) => (
          <Link
            key={name}
            href={`/package/${encodeURIComponent(name)}`}
            className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm transition-colors"
          >
            <span className="font-medium">{name}</span>
            <span className="text-gray-400">{version}</span>
          </Link>
        ))}
        {hasMore && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="px-2 py-1 text-blue-600 hover:text-blue-800 text-sm"
          >
            +{entries.length - showCount} ещё
          </button>
        )}
      </div>
    </div>
  );
}

export function PackagePageClient({ packageData }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [activeTab, setActiveTab] = useState<'readme' | 'versions' | 'deps'>('readme');
  
  const fullName = packageData.scope 
    ? `${packageData.scope}/${packageData.name}` 
    : packageData.name;
  
  // Копирование в буфер обмена
  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };
  
  const displayedVersions = showAllVersions 
    ? packageData.versions 
    : packageData.versions.slice(0, 20);
  
  return (
    <div>
      {/* Навигация назад */}
      <Link
        href="/"
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors inline-flex"
      >
        <ChevronLeft className="w-4 h-4" />
        Назад к поиску
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Основная информация */}
          <div className="lg:col-span-2 space-y-6">
            {/* Шапка пакета */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3 flex-wrap">
                    <Package className="w-8 h-8 text-red-500 flex-shrink-0" />
                    <span className="break-all">{fullName}</span>
                  </h1>
                  {packageData.description && (
                    <p className="mt-2 text-gray-600">{packageData.description}</p>
                  )}
                  {packageData.latestVersion && (
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-sm rounded font-mono">
                        {packageData.latestVersion}
                      </span>
                      {Object.entries(packageData.distTags).filter(([tag]) => tag !== 'latest').slice(0, 3).map(([tag, ver]) => (
                        <span key={tag} className="px-2 py-1 bg-gray-100 text-gray-600 text-sm rounded">
                          {tag}: <span className="font-mono text-xs">{ver}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Команды установки */}
              <div className="mt-6 space-y-2">
                {[
                  { cmd: `npm install ${fullName}`, key: 'npm' },
                  { cmd: `yarn add ${fullName}`, key: 'yarn' },
                  { cmd: `pnpm add ${fullName}`, key: 'pnpm' },
                ].map(({ cmd, key }) => (
                  <div key={key} className="flex items-center gap-2">
                    <code className="flex-1 bg-gray-900 text-green-400 px-4 py-2 rounded font-mono text-sm overflow-x-auto">
                      {cmd}
                    </code>
                    <button
                      onClick={() => copyToClipboard(cmd, key)}
                      className="p-2 hover:bg-gray-100 rounded transition-colors flex-shrink-0"
                      title="Копировать"
                    >
                      {copied === key ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5 text-gray-400" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Табы контента */}
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="flex border-b">
                <button
                  onClick={() => setActiveTab('readme')}
                  className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors ${
                    activeTab === 'readme'
                      ? 'border-b-2 border-red-500 text-red-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  README
                </button>
                <button
                  onClick={() => setActiveTab('versions')}
                  className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors ${
                    activeTab === 'versions'
                      ? 'border-b-2 border-red-500 text-red-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  Версии ({packageData.versions.length})
                </button>
                <button
                  onClick={() => setActiveTab('deps')}
                  className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors ${
                    activeTab === 'deps'
                      ? 'border-b-2 border-red-500 text-red-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Code className="w-4 h-4" />
                  Зависимости
                </button>
              </div>

              <div className="p-6">
                {/* README */}
                {activeTab === 'readme' && (
                  <div>
                    {packageData.readme ? (
                      <div 
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: md.render(packageData.readme) }}
                      />
                    ) : (
                      <div className="text-center py-12 text-gray-500">
                        <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p>README не найден</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Версии */}
                {activeTab === 'versions' && (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-3 text-sm font-medium text-gray-500">Версия</th>
                          <th className="text-left py-2 px-3 text-sm font-medium text-gray-500">Статус</th>
                          <th className="text-left py-2 px-3 text-sm font-medium text-gray-500">Размер</th>
                          <th className="text-left py-2 px-3 text-sm font-medium text-gray-500">Дата</th>
                          <th className="text-left py-2 px-3 text-sm font-medium text-gray-500">Скачать</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedVersions.map((version) => (
                          <tr 
                            key={version.version} 
                            className={`border-b last:border-0 ${version.downloaded ? 'hover:bg-gray-50' : 'bg-gray-50 opacity-60'}`}
                          >
                            <td className="py-3 px-3">
                              <span className={`font-mono ${version.version === packageData.latestVersion ? 'text-green-700 font-semibold' : ''}`}>
                                {version.version}
                              </span>
                              {version.version === packageData.latestVersion && (
                                <span className="ml-2 text-xs bg-green-200 text-green-800 px-1.5 py-0.5 rounded">
                                  latest
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              {version.downloaded ? (
                                <span className="flex items-center gap-1 text-green-600 text-sm">
                                  <Download className="w-4 h-4" />
                                  Загружен
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-gray-400 text-sm">
                                  <AlertCircle className="w-4 h-4" />
                                  Не загружен
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-sm text-gray-600">
                              {formatSize(version.size)}
                            </td>
                            <td className="py-3 px-3 text-sm text-gray-500">
                              {version.mtime ? (
                                <span title={formatDate(version.mtime)}>
                                  {timeAgo(version.mtime)}
                                </span>
                              ) : version.publishedAt ? (
                                <span title={formatDate(version.publishedAt)}>
                                  {timeAgo(version.publishedAt)}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="py-3 px-3">
                              {version.downloaded && version.tarball ? (
                                <a
                                  href={version.tarball}
                                  download
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                                  title={`Скачать ${fullName}-${version.version}.tgz`}
                                >
                                  <Download className="w-3 h-3" />
                                  .tgz
                                </a>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    
                    {packageData.versions.length > 20 && !showAllVersions && (
                      <button
                        onClick={() => setShowAllVersions(true)}
                        className="w-full py-3 text-center text-blue-600 hover:text-blue-800 flex items-center justify-center gap-2"
                      >
                        <ChevronDown className="w-4 h-4" />
                        Показать все {packageData.versions.length} версий
                      </button>
                    )}
                  </div>
                )}

                {/* Зависимости */}
                {activeTab === 'deps' && (
                  <div>
                    <DependenciesList deps={packageData.dependencies} title="Dependencies" />
                    <DependenciesList deps={packageData.devDependencies} title="Dev Dependencies" />
                    <DependenciesList deps={packageData.peerDependencies} title="Peer Dependencies" />
                    
                    {!packageData.dependencies && !packageData.devDependencies && !packageData.peerDependencies && (
                      <div className="text-center py-12 text-gray-500">
                        <Code className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p>Зависимости не найдены</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Сайдбар */}
          <div className="space-y-6">
            {/* Метаданные */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="font-semibold mb-4">Информация</h3>
              <div className="space-y-3 text-sm">
                {packageData.license && (
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-500">Лицензия:</span>
                    <span className="font-medium">{packageData.license}</span>
                  </div>
                )}
                {packageData.author && (
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-500">Автор:</span>
                    <span className="font-medium truncate">{packageData.author}</span>
                  </div>
                )}
                {packageData.homepage && (
                  <div className="flex items-center gap-2">
                    <LinkIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <a 
                      href={packageData.homepage} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-blue-600 hover:underline truncate flex items-center gap-1"
                    >
                      {packageData.homepage.replace(/^https?:\/\//, '').slice(0, 30)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
                {packageData.repository && (
                  <div className="flex items-center gap-2">
                    <Github className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <a 
                      href={packageData.repository} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-blue-600 hover:underline truncate flex items-center gap-1"
                    >
                      Repository
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
                {packageData.bugs && (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <a 
                      href={packageData.bugs} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-blue-600 hover:underline flex items-center gap-1"
                    >
                      Issues
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Ключевые слова */}
            {packageData.keywords && packageData.keywords.length > 0 && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  Ключевые слова
                </h3>
                <div className="flex flex-wrap gap-2">
                  {packageData.keywords.slice(0, 20).map(keyword => (
                    <Link
                      key={keyword}
                      href={`/?q=${encodeURIComponent(keyword)}`}
                      className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm transition-colors"
                    >
                      {keyword}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Статистика пакета */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Box className="w-4 h-4" />
                Статистика
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Всего версий</span>
                  <span className="font-medium">{packageData.totalVersions}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Загружено</span>
                  <span className="font-medium">{packageData.downloadedVersions}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Размер загруженных</span>
                  <span className="font-medium">{formatSize(packageData.totalDownloadedSize)}</span>
                </div>
                {packageData.createdAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Создан</span>
                    <span className="font-medium" title={formatDate(packageData.createdAt)}>
                      {timeAgo(packageData.createdAt)}
                    </span>
                  </div>
                )}
                {packageData.updatedAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Обновлён</span>
                    <span className="font-medium" title={formatDate(packageData.updatedAt)}>
                      {timeAgo(packageData.updatedAt)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
    </div>
  );
}
