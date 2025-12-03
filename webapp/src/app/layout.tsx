import type { Metadata } from 'next'
import './globals.css'
import { Navigation, Footer } from '@/components/Navigation'

export const metadata: Metadata = {
  title: 'npmBridge',
  description: 'Управление NPM репозиторием',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-gray-100 flex flex-col">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 py-6 flex-1 w-full">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  )
}
