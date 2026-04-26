import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** Repo root: parent of M5D/ (contains pwa/, indicators/, M4D/) */
const repoRoot = path.resolve(__dirname, '..')

export default defineConfig(({ mode }) => {
  const envM5d = loadEnv(mode, __dirname, '')
  const envM4d = loadEnv(mode, path.resolve(repoRoot, 'M4D'), '')
  const envPwa = loadEnv(mode, path.resolve(repoRoot, 'pwa'), '')

  const polygonKey =
    envM5d.VITE_POLYGON_IO_KEY || envM5d.VITE_POLYGON_API_KEY ||
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
    resolve: {
      dedupe: ['react', 'react-dom', 'lightweight-charts'],
      alias: {
        $indicators: path.resolve(repoRoot, 'indicators'),
        '@pwa/lib': path.resolve(repoRoot, 'pwa/src/lib'),
      },
    },
    server: {
      host: true,
      port: 5556,
      strictPort: true,
      fs: { allow: [__dirname, repoRoot] },
      proxy: {
        '/v1': { target: 'http://localhost:3300', changeOrigin: true },
        '/health': { target: 'http://localhost:3300', changeOrigin: true },
        '/ds': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/ds/, ''),
        },
        '/api/polygon': polygonKey ? polygonProxy : { target: 'https://api.polygon.io', changeOrigin: true },
      },
    },
    css: {
      preprocessorOptions: { scss: { quietDeps: true } },
    },
  }
})
