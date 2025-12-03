/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  // Увеличиваем таймаут для больших файлов
  httpAgentOptions: {
    keepAlive: true,
  },
}

module.exports = nextConfig
