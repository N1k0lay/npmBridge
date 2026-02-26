'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Package, 
  RefreshCw, 
  AlertTriangle, 
  Clock,
  Globe,
  Search,
  Copy,
  Check,
  Settings,
  HardDrive
} from 'lucide-react';

type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: React.ReactNode;
};

const navItems: NavItem[] = [
  { id: 'search', href: '/', label: 'Пакеты', icon: <Search className="w-4 h-4" /> },
  { id: 'update', href: '/update', label: 'Обновление', icon: <RefreshCw className="w-4 h-4" /> },
  { id: 'diff', href: '/diff', label: 'Diff', icon: <Package className="w-4 h-4" /> },
  { id: 'broken', href: '/broken', label: 'Проверка', icon: <AlertTriangle className="w-4 h-4" /> },
  { id: 'history', href: '/history', label: 'История', icon: <Clock className="w-4 h-4" /> },
  { id: 'networks',  href: '/networks',  label: 'Сети',       icon: <Globe className="w-4 h-4" /> },
  { id: 'binaries',  href: '/binaries',  label: 'Бинарники',  icon: <HardDrive className="w-4 h-4" /> },
];

export function Navigation() {
  const pathname = usePathname();
  const [registryUrl, setRegistryUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // URL теперь на том же хосте, порт для npm registry
      const host = window.location.host;
      setRegistryUrl(`http://${host}`);
    }
  }, []);

  const copyRegistryUrl = async () => {
    try {
      await navigator.clipboard.writeText(`npm config set registry ${registryUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // Определяем активный пункт меню
  const getActiveId = () => {
    if (pathname === '/') return 'search';
    if (pathname.startsWith('/package/')) return 'search';
    if (pathname.startsWith('/update')) return 'update';
    if (pathname.startsWith('/diff')) return 'diff';
    if (pathname.startsWith('/broken')) return 'broken';
    if (pathname.startsWith('/history')) return 'history';
    if (pathname.startsWith('/networks')) return 'networks';
    if (pathname.startsWith('/binaries')) return 'binaries';
    return 'search';
  };

  const activeId = getActiveId();

  return (
    <>
      {/* Header */}
      <header className="bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link 
              href="/"
              className="text-2xl font-bold flex items-center gap-3 hover:opacity-90 transition-opacity"
            >
              <Package className="w-8 h-8" />
              npmBridge
            </Link>
            
            {/* Registry URL */}
            <div className="flex items-center gap-3">
              <div className="bg-white/10 backdrop-blur rounded-lg px-4 py-2 flex items-center gap-2">
                <code className="text-sm font-mono">{registryUrl || 'Loading...'}</code>
                <button
                  onClick={copyRegistryUrl}
                  className="p-1 hover:bg-white/10 rounded transition-colors"
                  title="Копировать команду npm config"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-300" />
                  ) : (
                    <Copy className="w-4 h-4 text-white/70" />
                  )}
                </button>
              </div>
              <Link
                href="/networks"
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Настройки"
              >
                <Settings className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex space-x-1">
            {navItems.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeId === item.id
                    ? 'border-red-500 text-red-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>
    </>
  );
}

export function Footer() {
  return (
    <footer className="bg-white border-t mt-auto">
      <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
        npmBridge — Локальный NPM репозиторий
      </div>
    </footer>
  );
}
