import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all local interfaces so both http://127.0.0.1:5500/ and http://localhost:5500/ work.
    host: true,
    port: 5500,
    strictPort: true,
    proxy: {
      '/v1': {
        target: 'http://localhost:3300',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3300',
        changeOrigin: true,
      },
      '/ds': {
        target: 'http://localhost:8800',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ds/, ''),
      },
      '/binance': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/binance/, ''),
        secure: true,
      },
      '/mrt-api': {
        target: 'http://localhost:3340',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mrt-api/, ''),
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        quietDeps: true,
      },
    },
  },
})
