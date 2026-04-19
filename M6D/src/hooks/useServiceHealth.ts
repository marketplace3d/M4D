import { useCallback, useEffect, useState } from 'react';
import {
  getAlgoExecHealthUrl,
  getDjangoHealthUrl,
  getRustHealthUrl,
} from '../lib/serviceHealthUrls';

export type ServiceHealthState = 'live' | 'dead' | 'check' | 'skip';

export type ServicePing = {
  id: string;
  label: string;
  state: ServiceHealthState;
  latencyMs?: number;
  hint?: string;
};

async function pingHttp(url: string, timeoutMs: number): Promise<{ ok: boolean; ms: number }> {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const tid = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'GET', signal: ctrl.signal, cache: 'no-store' });
    const ms = Math.round(performance.now() - t0);
    return { ok: r.ok, ms };
  } catch {
    const ms = Math.round(performance.now() - t0);
    return { ok: false, ms };
  } finally {
    window.clearTimeout(tid);
  }
}

function probeWebSocket(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const t = window.setTimeout(() => finish(false), timeoutMs);
    try {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        window.clearTimeout(t);
        try {
          ws.close();
        } catch {
          /* noop */
        }
        finish(true);
      };
      ws.onerror = () => {
        window.clearTimeout(t);
        finish(false);
      };
    } catch {
      window.clearTimeout(t);
      finish(false);
    }
  });
}

const HTTP_TIMEOUT = 4500;
const WS_TIMEOUT = 2800;

export function useServiceHealth(pollMs = 10_000) {
  const [services, setServices] = useState<ServicePing[]>(() => [
    { id: 'rust', label: 'RUST API', state: 'check' },
    { id: 'django', label: 'DJANGO DS', state: 'check' },
    { id: 'exec', label: 'ALGO EXEC', state: 'check' },
    { id: 'ws', label: 'LIVE WS', state: 'skip' },
  ]);
  const runProbe = useCallback(async () => {
    const rustUrl = getRustHealthUrl();
    const djangoUrl = getDjangoHealthUrl();
    const execUrl = getAlgoExecHealthUrl();
    const wsUrl = ((import.meta.env.VITE_M4D_WS_URL as string | undefined) ?? '').trim();

    const [rust, django, exec, wsLive] = await Promise.all([
      pingHttp(rustUrl, HTTP_TIMEOUT),
      djangoUrl ? pingHttp(djangoUrl, HTTP_TIMEOUT) : Promise.resolve({ ok: false, ms: 0 }),
      execUrl ? pingHttp(execUrl, HTTP_TIMEOUT) : Promise.resolve({ ok: false, ms: 0 }),
      wsUrl ? probeWebSocket(wsUrl, WS_TIMEOUT) : Promise.resolve(false),
    ]);

    setServices([
      {
        id: 'rust',
        label: 'RUST API',
        state: rust.ok ? 'live' : 'dead',
        latencyMs: rust.ms,
        hint: rustUrl,
      },
      {
        id: 'django',
        label: 'DJANGO DS',
        state: !djangoUrl ? 'skip' : django.ok ? 'live' : 'dead',
        latencyMs: djangoUrl ? django.ms : undefined,
        hint: djangoUrl || undefined,
      },
      {
        id: 'exec',
        label: 'ALGO EXEC',
        state: !execUrl ? 'skip' : exec.ok ? 'live' : 'dead',
        latencyMs: execUrl ? exec.ms : undefined,
        hint: execUrl || undefined,
      },
      {
        id: 'ws',
        label: 'LIVE WS',
        state: !wsUrl ? 'skip' : wsLive ? 'live' : 'dead',
        hint: wsUrl || undefined,
      },
    ]);
  }, []);

  useEffect(() => {
    void runProbe();
    const id = window.setInterval(() => void runProbe(), pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, runProbe]);

  return { services, recheck: runProbe };
}
