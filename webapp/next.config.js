/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: {
      bodySizeLimit: '50gb',
    },
  },
  // Увеличиваем таймаут для больших файлов
  httpAgentOptions: {
    keepAlive: true,
  },
}

module.exports = nextConfig
