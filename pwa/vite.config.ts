import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Load pwa/.env and tools/devdata/.env so the key works from either place (pwa wins).
  const envPwa = loadEnv(mode, __dirname, '');
  const envDev = loadEnv(mode, path.resolve(__dirname, '../tools/devdata'), '');
  const polygonKey =
    envPwa.POLYGON_IO_KEY ||
    envPwa.POLYGON_API_KEY ||
    envPwa.VITE_POLYGON_IO_KEY ||
    envPwa.VITE_POLYGON_API_KEY ||
    envDev.POLYGON_IO_KEY ||
    envDev.POLYGON_API_KEY ||
    envDev.VITE_POLYGON_IO_KEY ||
    envDev.VITE_POLYGON_API_KEY ||
    '';

  if (mode === 'development' && !polygonKey) {
    console.warn(
      '[M4D] Polygon key missing: set POLYGON_IO_KEY in pwa/.env and restart dev (or use tools/devdata/.env).',
    );
  }

  const polygonProxy = {
    target: 'https://api.polygon.io',
    changeOrigin: true,
    rewrite: (path: string) => {
      const p = path.replace(/^\/api\/polygon/, '');
      const sep = p.includes('?') ? '&' : '?';
      return `${p}${sep}apiKey=${encodeURIComponent(polygonKey)}`;
    },
  };

  return {
    plugins: [
      sveltekit(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'M4D — BOOM3D Tech',
          short_name: 'M4D',
          description: 'Lightweight Charts + BOOM3D-TECH indicator',
          theme_color: '#0d1117',
          background_color: '#0d1117',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/favicon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}'],
        },
      }),
    ],
    server: {
      proxy: {
        '/api/polygon': polygonProxy,
      },
    },
    preview: {
      proxy: {
        '/api/polygon': polygonProxy,
      },
    },
  };
});
