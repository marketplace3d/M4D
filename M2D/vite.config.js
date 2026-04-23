import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5565,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3030',
        rewrite: path => path.replace(/^\/api/, ''),
        changeOrigin: true
      },
      '/ds': {
        target: 'http://localhost:8000',
        rewrite: path => path.replace(/^\/ds/, ''),
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3030',
        ws: true
      }
    }
  }
})
