import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-gray-700 mb-2">Пакет не найден</h2>
        <p className="text-gray-500 mb-6">Возможно, пакет ещё не загружен в локальный репозиторий</p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
        >
          Вернуться на главную
        </Link>
      </div>
    </div>
  );
}
