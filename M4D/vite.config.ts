import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import { createLogger, defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/** Django `m4d-ds` on :8050 — when only MISSION is running, avoid Vite proxy error spam + give JSON 503. */
let djangoDownWarned = false;
/** MISSION-only dev: optional backends down — Vite’s default proxy error log is very noisy. */
function devLoggerQuietProxyRefused() {
  const logger = createLogger();
  const orig = logger.error.bind(logger);
  logger.error = (msg, options) => {
    if (
      typeof msg === 'string' &&
      msg.includes('http proxy error') &&
      msg.includes('ECONNREFUSED')
    ) {
      return;
    }
    orig(msg, options);
  };
  return logger;
}

function djangoDevProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('error', (err, _req, res) => {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (!djangoDownWarned && code === 'ECONNREFUSED') {
          djangoDownWarned = true;
          console.warn(
            '[MISSION] Django not on :8050 — /crypto, BOOM, etc. need the stack:  ./go.sh all',
          );
        }
        const r = res as ServerResponse | undefined;
        if (r && !r.headersSent) {
          r.writeHead(503, { 'Content-Type': 'application/json' });
          r.end(
            JSON.stringify({
              ok: false,
              error: 'django_unavailable',
              hint: 'Start stack: ./go.sh all  (Django :8050 + proxies for /crypto)',
            }),
          );
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const envMission = loadEnv(mode, __dirname, '');
  const envPwa = loadEnv(mode, path.resolve(repoRoot, 'pwa'), '');
  const envDev = loadEnv(mode, path.resolve(repoRoot, 'tools/devdata'), '');
  const polygonKey =
    envMission.POLYGON_IO_KEY ||
    envMission.POLYGON_API_KEY ||
    envMission.VITE_POLYGON_IO_KEY ||
    envMission.VITE_POLYGON_API_KEY ||
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
      '[MISSION] Polygon key missing: set POLYGON_IO_KEY or VITE_POLYGON_* in pwa/.env (or MISSION .env) for LW charts data.',
    );
  }

  /** Large aggs payloads can be slow; transient `socket hang up` is often network/TLS — longer timeouts help a bit. */
  const polygonProxy = {
    target: 'https://api.polygon.io',
    changeOrigin: true,
    timeout: 120_000,
    proxyTimeout: 120_000,
    rewrite: (p: string) => {
      const stripped = p.replace(/^\/api\/polygon/, '');
      const sep = stripped.includes('?') ? '&' : '?';
      return `${stripped}${sep}apiKey=${encodeURIComponent(polygonKey)}`;
    },
  };

  return {
    ...(mode === 'development' ? { customLogger: devLoggerQuietProxyRefused() } : {}),
    plugins: [react()],
    /** Keep production output out of `spec-kit/` (treat as docs); emit at repo `build/mission/`. */
    build: {
      outDir: path.resolve(repoRoot, 'build/mission'),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        $indicators: path.resolve(repoRoot, 'indicators'),
        '@pwa/lib': path.resolve(repoRoot, 'pwa/src/lib'),
      },
    },
    // MISSION :5550 — PWA :5555. Default: `./go.sh` = full stack; `./go.sh mission` = UI only.
    server: {
      host: '127.0.0.1',
      port: 5550,
      strictPort: true,
      fs: {
        allow: [repoRoot],
      },
      proxy: {
        '/m4d-api': {
          target: 'http://127.0.0.1:3330',
          changeOrigin: true,
          ws: true,
          rewrite: (p) => p.replace(/^\/m4d-api/, '') || '/',
        },
        '/algo-exec': {
          target: 'http://127.0.0.1:9050',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/algo-exec/, '') || '/',
        },
        '/api/polygon': polygonProxy,
        // Django m4d-ds (port 8050) — graceful when `./go.sh` runs MISSION-only
        '/crypto': djangoDevProxy('http://127.0.0.1:8050'),
        '/engine': djangoDevProxy('http://127.0.0.1:8050'),
        '/ping': djangoDevProxy('http://127.0.0.1:8050'),
        '/boom-': djangoDevProxy('http://127.0.0.1:8050'),
        '/algo-': djangoDevProxy('http://127.0.0.1:8050'),
        '/jedi-': djangoDevProxy('http://127.0.0.1:8050'),
        '/cache': djangoDevProxy('http://127.0.0.1:8050'),
      },
      watch: {
        usePolling: true,
        interval: 200,
      },
    },
    /** Third host: same `build/mission/` — `npm run build:embed && npm run preview:embed` (port 4174 via script). */
    preview: {
      proxy: {
        '/v1': { target: 'http://127.0.0.1:3330', changeOrigin: true },
        '/health': { target: 'http://127.0.0.1:3330', changeOrigin: true },
        '/m4d-api': {
          target: 'http://127.0.0.1:3330',
          changeOrigin: true,
          ws: true,
          rewrite: (p) => p.replace(/^\/m4d-api/, '') || '/',
        },
        '/algo-exec': {
          target: 'http://127.0.0.1:9050',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/algo-exec/, '') || '/',
        },
        '/api/polygon': polygonProxy,
        '/crypto': djangoDevProxy('http://127.0.0.1:8050'),
        '/engine': djangoDevProxy('http://127.0.0.1:8050'),
      },
    },
  };
});
