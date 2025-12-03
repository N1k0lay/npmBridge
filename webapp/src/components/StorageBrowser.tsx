'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { 
  Search, 
  Package, 
  ChevronRight, 
  Loader2
} from 'lucide-react';
import { useDebounce, useIntersectionObserver } from '@/hooks/useDebounce';
import IndexingStatusIndicator from './IndexingStatus';

interface StorageStats {
  totalPackages: number;
  totalVersions: number;
  totalSize: number;
  totalSizeHuman: string;
}

interface PackageSearchResult {
  name: string;
  scope?: string;
  isScoped: boolean;
  latestVersion?: string;
  versionsCount: number;
  description?: string;
}

interface SearchResponse {
  items: PackageSearchResult[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

interface SuggestResponse {
  suggestions: PackageSearchResult[];
}

const fetcher = (url: string) => fetch(url).then(res => res.json());

export function StorageBrowser() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PackageSearchResult[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalResults, setTotalResults] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const debouncedQuery = useDebounce(searchQuery, 300);
  
  const { data: stats } = useSWR<StorageStats>('/api/storage?action=stats', fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  });
  
  const { data: suggestData } = useSWR<SuggestResponse>(
    debouncedQuery.length >= 2 && showSuggestions
      ? `/api/storage?action=suggest&q=${encodeURIComponent(debouncedQuery)}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const performSearch = useCallback(async (query: string, pageNum: number = 1, append: boolean = false) => {
    if (!query.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }
    
    setIsSearching(true);
    setHasSearched(true);
    setShowSuggestions(false);
    
    try {
      const res = await fetch(
        `/api/storage?action=search&q=${encodeURIComponent(query)}&page=${pageNum}&limit=30`
      );
      const data: SearchResponse = await res.json();
      
      if (append) {
        setSearchResults(prev => [...prev, ...data.items]);
      } else {
        setSearchResults(data.items);
      }
      
      setPage(pageNum);
      setHasMore(data.hasMore);
      setTotalResults(data.total);
    } catch (error) {
      console.error('Error searching packages:', error);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const loadMore = useCallback(() => {
    if (!isSearching && hasMore && searchQuery) {
      performSearch(searchQuery, page + 1, true);
    }
  }, [isSearching, hasMore, searchQuery, page, performSearch]);

  const loadMoreRef = useIntersectionObserver(loadMore);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setShowSuggestions(false);
      performSearch(searchQuery, 1, false);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (pkg: PackageSearchResult) => {
    setShowSuggestions(false);
    router.push(`/package/${encodeURIComponent(pkg.name)}`);
  };

  const openPackage = (packageName: string) => {
    router.push(`/package/${encodeURIComponent(packageName)}`);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-end mb-4">
        <IndexingStatusIndicator />
      </div>

      <div className="text-center py-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Поиск NPM пакетов
        </h1>
        <p className="text-gray-600 mb-8">
          {stats ? (
            <>Найдите нужный пакет среди <span className="font-semibold">{stats.totalPackages.toLocaleString()}</span> доступных</>
          ) : (
            'Поиск по локальному NPM репозиторию'
          )}
        </p>

        <div className="max-w-2xl mx-auto relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                placeholder="Поиск пакетов..."
                className="w-full pl-12 pr-4 py-4 text-lg border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all"
                autoFocus
              />
              
              {showSuggestions && suggestData?.suggestions && suggestData.suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-xl border max-h-80 overflow-y-auto z-50">
                  {suggestData.suggestions.map((pkg) => (
                    <button
                      key={pkg.name}
                      onClick={() => selectSuggestion(pkg)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left border-b last:border-0"
                    >
                      <Package className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">{pkg.name}</div>
                        {pkg.description && (
                          <div className="text-sm text-gray-500 truncate">{pkg.description}</div>
                        )}
                      </div>
                      {pkg.latestVersion && (
                        <span className="text-xs text-gray-400 font-mono flex-shrink-0">
                          {pkg.latestVersion}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => performSearch(searchQuery, 1, false)}
              disabled={isSearching}
              className="px-8 py-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium disabled:opacity-50 flex-shrink-0"
            >
              {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Найти'}
            </button>
          </div>
        </div>

        {stats && (
          <div className="flex justify-center gap-8 mt-8">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{stats.totalPackages.toLocaleString()}</div>
              <div className="text-sm text-gray-500">Пакетов</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{stats.totalVersions.toLocaleString()}</div>
              <div className="text-sm text-gray-500">Версий</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{stats.totalSizeHuman}</div>
              <div className="text-sm text-gray-500">Размер</div>
            </div>
          </div>
        )}
      </div>

      {hasSearched && (
        <div className="mt-8">
          {searchResults.length === 0 && !isSearching ? (
            <div className="text-center py-12 bg-white rounded-lg shadow">
              <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Пакеты не найдены</p>
              <p className="text-sm text-gray-400 mt-2">Попробуйте изменить поисковый запрос</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  Найдено: <span className="font-semibold">{totalResults.toLocaleString()}</span> пакетов
                </span>
              </div>
              <div className="divide-y">
                {searchResults.map((pkg) => (
                  <button
                    key={pkg.name}
                    onClick={() => openPackage(pkg.name)}
                    className="w-full flex items-center gap-4 px-4 py-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    <Package className="w-10 h-10 text-red-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{pkg.name}</span>
                        {pkg.latestVersion && (
                          <span className="text-xs text-gray-400 font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                            {pkg.latestVersion}
                          </span>
                        )}
                      </div>
                      {pkg.description && (
                        <div className="text-sm text-gray-500 truncate mt-0.5">{pkg.description}</div>
                      )}
                      <div className="text-xs text-gray-400 mt-1">
                        {pkg.versionsCount} версий
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  </button>
                ))}
              </div>
              
              {hasMore && (
                <div ref={loadMoreRef} className="py-4 text-center">
                  {isSearching ? (
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
                  ) : (
                    <span className="text-sm text-gray-400">Прокрутите для загрузки ещё</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!hasSearched && (
        <div className="mt-12 text-center text-gray-500">
          <p className="mb-4">Начните вводить название пакета для поиска</p>
          <div className="flex justify-center gap-2 flex-wrap">
            {['react', 'lodash', 'typescript', 'express', 'next'].map((example) => (
              <button
                key={example}
                onClick={() => {
                  setSearchQuery(example);
                  performSearch(example, 1, false);
                }}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full text-sm transition-colors"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
