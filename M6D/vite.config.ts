import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot  = path.resolve(__dirname, '..')

export default defineConfig(({ mode }) => {
  // Load keys from M6D/.env.local + M4D/.env.local
  const envM6d = loadEnv(mode, __dirname, '')
  const envM4d = loadEnv(mode, path.resolve(repoRoot, 'M4D'), '')
  const envPwa = loadEnv(mode, path.resolve(repoRoot, 'pwa'), '')

  const polygonKey =
    envM6d.VITE_POLYGON_IO_KEY || envM6d.VITE_POLYGON_API_KEY ||
    envM4d.VITE_POLYGON_IO_KEY || envM4d.VITE_POLYGON_API_KEY ||
    envPwa.VITE_POLYGON_IO_KEY || envPwa.VITE_POLYGON_API_KEY || ''

  const polygonProxy = {
    target: 'https://api.polygon.io',
    changeOrigin: true,
    timeout: 120_000,
    proxyTimeout: 120_000,
    rewrite: (p: string) => {
      const stripped = p.replace(/^\/api\/polygon/, '')
      const sep = stripped.includes('?') ? '&' : '?'
      return `${stripped}${sep}apiKey=${encodeURIComponent(polygonKey)}`
    },
  }

  return {
    plugins: [react()],
    optimizeDeps: { include: ['react-is'] },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        $indicators: path.resolve(repoRoot, 'indicators'),
        '@pwa/lib':  path.resolve(repoRoot, 'pwa/src/lib'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5650,
      strictPort: true,
      fs: { allow: [__dirname, repoRoot] },
      proxy: {
        // Polygon (chart data)
        '/api/polygon': polygonProxy,
        // M4D backends
        '/m4d-api': { target: 'http://127.0.0.1:3330', changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/m4d-api/, '') || '/' },
        '/algo-exec': { target: 'http://127.0.0.1:9050', changeOrigin: true, rewrite: (p) => p.replace(/^\/algo-exec/, '') || '/' },
        '/crypto':   { target: 'http://127.0.0.1:8050', changeOrigin: true },
        '/boom-':    { target: 'http://127.0.0.1:8050', changeOrigin: true },
        '/algo-':    { target: 'http://127.0.0.1:8050', changeOrigin: true },
        '/engine':   { target: 'http://127.0.0.1:8050', changeOrigin: true },
        '/ping':     { target: 'http://127.0.0.1:8050', changeOrigin: true },
        // M3D backend
        '/v1':     { target: 'http://127.0.0.1:3300', changeOrigin: true },
        '/health': { target: 'http://127.0.0.1:3300', changeOrigin: true },
        '/ds':     { target: 'http://127.0.0.1:8800', changeOrigin: true, rewrite: (p) => p.replace(/^\/ds/, '') },
        '/binance':{ target: 'https://api.binance.com', changeOrigin: true, secure: true, rewrite: (p) => p.replace(/^\/binance/, '') },
      },
    },
  }
})
