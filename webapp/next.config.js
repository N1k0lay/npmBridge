/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ['better-sqlite3'],
  // Увеличиваем таймаут для больших файлов
  httpAgentOptions: {
    keepAlive: true,
  },
}

module.exports = nextConfig
