import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5556,
    strictPort: true,
    proxy: {
      '/v1': { target: 'http://localhost:3300', changeOrigin: true },
      '/health': { target: 'http://localhost:3300', changeOrigin: true },
      '/ds': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ds/, ''),
      },
    },
  },
  css: {
    preprocessorOptions: { scss: { quietDeps: true } },
  },
})
