import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPackagePageData } from '@/lib/storage';
import { PackagePageClient } from './PackagePageClient';

// ISR: регенерация страницы каждые 60 секунд
export const revalidate = 60;

// Динамический сегмент
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ name: string }>;
}

// Генерация метаданных
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { name } = await params;
  const packageName = decodeURIComponent(name);
  
  // Получаем данные пакета для метаданных
  const packageData = await getPackagePageData(packageName);
  
  if (!packageData) {
    return {
      title: 'Пакет не найден | npmBridge',
    };
  }
  
  const fullName = packageData.scope 
    ? `${packageData.scope}/${packageData.name}` 
    : packageData.name;
  
  return {
    title: `${fullName} | npmBridge`,
    description: packageData.description || `NPM пакет ${fullName}`,
    keywords: packageData.keywords,
    openGraph: {
      title: `${fullName} - NPM Package`,
      description: packageData.description || `NPM пакет ${fullName}`,
      type: 'website',
    },
  };
}

// Серверный компонент страницы
export default async function PackagePage({ params }: PageProps) {
  const { name } = await params;
  const packageName = decodeURIComponent(name);
  
  // Получаем данные пакета на сервере
  const packageData = await getPackagePageData(packageName);
  
  if (!packageData) {
    notFound();
  }
  
  return <PackagePageClient packageData={packageData} />;
}
