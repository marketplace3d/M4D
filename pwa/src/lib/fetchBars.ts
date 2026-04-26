import type { Bar } from '../../../indicators/boom3d-tech';
import {
  type TimeframePreset,
  timeframeToBinanceInterval,
  timeframeToPolygonSpec,
} from './chartTimeframes';
import { makeMockBars } from './mockBars';

/** Polygon aggregates v2 — same path for stocks, forex, crypto tickers. */
const POLYGON_BASE = 'https://api.polygon.io';

/** In-memory + localStorage; shared by every import of this module (MISSION + Svelte PWA each get their own origin). */
const LS_PREFIX = 'm4d-bars-v1:';
const MAX_LS_CHARS = 850_000;

function parseEnvMs(name: string): number | null {
  try {
    const v = import.meta.env[name] as string | undefined;
    if (v == null || !String(v).trim()) return null;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) && n >= 30_000 ? n : null;
  } catch {
    return null;
  }
}

/** Default TTL when env not set — daily history changes slowly; intraday a bit fresher. */
function cacheTtlMs(spec: { timespan: 'minute' | 'day' }): number {
  const any = parseEnvMs('VITE_BARS_CACHE_TTL_MS');
  if (any != null) return any;
  if (spec.timespan === 'day') {
    const dayTtl = parseEnvMs('VITE_BARS_CACHE_TTL_DAY_MS');
    return dayTtl ?? 60 * 60 * 1000;
  }
  const minTtl = parseEnvMs('VITE_BARS_CACHE_TTL_MINUTE_MS');
  return minTtl ?? 8 * 60 * 1000;
}

function binanceCacheTtlMs(interval: '1m' | '5m' | '15m' | '1d'): number {
  const any = parseEnvMs('VITE_BARS_CACHE_TTL_MS');
  if (any != null) return any;
  return interval === '1d' ? 60 * 60 * 1000 : 5 * 60 * 1000;
}

const cache = new Map<string, { bars: Bar[]; expires: number }>();
const inflight = new Map<string, Promise<Bar[]>>();

function readLsEntry(ck: string): { bars: Bar[]; expires: number } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + ck);
    if (!raw) return null;
    const j = JSON.parse(raw) as { expires?: number; bars?: Bar[] };
    if (!Array.isArray(j.bars) || typeof j.expires !== 'number') return null;
    if (j.expires <= Date.now()) {
      localStorage.removeItem(LS_PREFIX + ck);
      return null;
    }
    return { bars: j.bars as Bar[], expires: j.expires };
  } catch {
    try {
      localStorage.removeItem(LS_PREFIX + ck);
    } catch {
      /* ignore */
    }
    return null;
  }
}

function writeLsEntry(ck: string, bars: Bar[], expires: number) {
  if (typeof localStorage === 'undefined' || bars.length === 0) return;
  try {
    const payload = JSON.stringify({ expires, bars });
    if (payload.length > MAX_LS_CHARS) return;
    localStorage.setItem(LS_PREFIX + ck, payload);
    pruneLsBarsCache(72);
  } catch {
    /* quota or private mode */
  }
}

function pruneLsBarsCache(maxKeys: number) {
  if (typeof localStorage === 'undefined') return;
  const keys = Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX));
  const now = Date.now();
  const live: { k: string; expires: number }[] = [];
  for (const k of keys) {
    try {
      const j = JSON.parse(localStorage.getItem(k) ?? '{}') as { expires?: number };
      const e = typeof j.expires === 'number' ? j.expires : 0;
      if (e <= now) {
        localStorage.removeItem(k);
        continue;
      }
      live.push({ k, expires: e });
    } catch {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  }
  if (live.length <= maxKeys) return;
  live.sort((a, b) => a.expires - b.expires);
  for (let i = 0; i < live.length - maxKeys; i++) {
    try {
      localStorage.removeItem(live[i]!.k);
    } catch {
      /* ignore */
    }
  }
}

/** Drop memory + disk cache (e.g. after auth/key change). */
export function clearBarsCache() {
  cache.clear();
  inflight.clear();
  if (typeof localStorage === 'undefined') return;
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith(LS_PREFIX)) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  }
}

export type ChartSymbol = string;

/** Polygon tickers (see polygon.io docs). ES uses SPY as liquid S&P proxy (true ES futures contract codes vary by month). */
export const SYMBOLS: { id: ChartSymbol; label: string; polygon: string; note?: string }[] = [
  { id: 'ES', label: 'ES (SPY)', polygon: 'SPY', note: 'S&P proxy via SPY' },
  { id: 'EURUSD', label: 'EURUSD', polygon: 'C:EURUSD' },
  { id: 'BTC', label: 'BTC', polygon: 'X:BTCUSD' },
  { id: 'XAU', label: 'XAU', polygon: 'C:XAUUSD' },
];

function resolveDynamicSymbol(sym: ChartSymbol): { id: ChartSymbol; label: string; polygon: string } {
  const clean = String(sym || '')
    .trim()
    .toUpperCase();
  const known = SYMBOLS.find((s) => s.id.toUpperCase() === clean);
  if (known) return known;
  // Custom ticker support: default to Polygon stock ticker (e.g. TSLA, NVDA, AAPL).
  return { id: clean, label: clean, polygon: clean };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function useLocalPolygonProxy(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return import.meta.env.DEV || h === 'localhost' || h === '127.0.0.1';
}

function aggsCacheKey(parts: string[]): string {
  return parts.join('|');
}

function mapPolygonRows(
  results: { t: number; o: number; h: number; l: number; c: number; v?: number }[],
): Bar[] {
  return results.map((row) => ({
    time: Math.floor(row.t / 1000),
    open: row.o,
    high: row.h,
    low: row.l,
    close: row.c,
    volume: row.v ?? 0,
  }));
}

/**
 * Polygon aggregates — any multiplier / minute | day.
 */
export async function fetchPolygonAggs(
  polygonTicker: string,
  spec: { multiplier: number; timespan: 'minute' | 'day'; lookbackMs: number },
  opts?: { directKey?: string },
): Promise<Bar[]> {
  const to = new Date();
  const from = new Date(to.getTime() - spec.lookbackMs);
  const fromStr = isoDate(from);
  const toStr = isoDate(to);
  const path = `/v2/aggs/ticker/${encodeURIComponent(polygonTicker)}/range/${spec.multiplier}/${spec.timespan}/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=50000`;

  const key =
    opts?.directKey ??
    (import.meta.env.VITE_POLYGON_IO_KEY ||
      import.meta.env.VITE_POLYGON_API_KEY) as string | undefined;
  const useProxy = useLocalPolygonProxy() && !opts?.directKey;

  let url: string;
  if (useProxy) {
    url = `/api/polygon${path}`;
  } else {
    if (!key) {
      throw new Error(
        'Polygon key missing: add POLYGON_IO_KEY or POLYGON_API_KEY to pwa/.env (or VITE_POLYGON_* for static deploy).',
      );
    }
    const sep = path.includes('?') ? '&' : '?';
    url = `${POLYGON_BASE}${path}${sep}apiKey=${encodeURIComponent(key)}`;
  }

  const ck = aggsCacheKey([
    polygonTicker,
    String(spec.multiplier),
    spec.timespan,
    String(spec.lookbackMs),
    fromStr,
    toStr,
  ]);
  const hit = cache.get(ck);
  if (hit && hit.expires > Date.now()) return hit.bars;

  const fromDisk = readLsEntry(ck);
  if (fromDisk) {
    cache.set(ck, fromDisk);
    return fromDisk.bars;
  }

  const existing = inflight.get(ck);
  if (existing) return existing;

  const run = (async () => {
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 429) {
        throw new Error(
          'Polygon rate limit (429): free tier allows few requests per minute. Wait ~60s, avoid rapid symbol switching, or upgrade. BTC uses Binance (no Polygon).',
        );
      }
      if (r.status === 403) {
        let detail = t.slice(0, 280);
        try {
          const j = JSON.parse(t) as { message?: string };
          if (j.message) detail = j.message;
        } catch {
          /* keep raw */
        }
        throw new Error(
          `Polygon 403 — ${detail} On many plans, minute (and some intraday) history for stocks/FX is paid-only. Try symbol **BTC** (free Binance data), switch timeframe to **1Y · 1D** if your plan includes daily, or upgrade: https://polygon.io/pricing`,
        );
      }
      throw new Error(`Polygon ${r.status}: ${t.slice(0, 200)}`);
    }
    const j = (await r.json()) as {
      results?: { t: number; o: number; h: number; l: number; c: number; v?: number }[];
    };
    const results = j.results ?? [];
    const bars = mapPolygonRows(results);
    if (bars.length > 0) {
      const exp = Date.now() + cacheTtlMs(spec);
      cache.set(ck, { bars, expires: exp });
      writeLsEntry(ck, bars, exp);
    }
    return bars;
  })();

  inflight.set(ck, run);
  try {
    return await run;
  } finally {
    inflight.delete(ck);
  }
}

/** Map kline row to Bar (Binance returns ms open time). */
function binanceRow(row: unknown): Bar {
  const k = row as number[];
  const t = Math.floor(k[0]! / 1000);
  return {
    time: t,
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  };
}

/**
 * Binance BTC — paginate when we need >1000 bars (e.g. 15m × 1 month).
 */
async function fetchBinanceBtcBars(
  interval: '1m' | '5m' | '15m' | '1d',
  lookbackMs: number,
): Promise<Bar[]> {
  const ck = aggsCacheKey(['binance', 'btc', interval, String(lookbackMs)]);
  const hit = cache.get(ck);
  if (hit && hit.expires > Date.now()) return hit.bars;

  const fromDisk = readLsEntry(ck);
  if (fromDisk) {
    cache.set(ck, fromDisk);
    return fromDisk.bars;
  }

  const endMs = Date.now();
  const startMs = endMs - lookbackMs;

  const estBars =
    interval === '1d'
      ? Math.ceil(lookbackMs / 86400000) + 5
      : Math.ceil(
          lookbackMs /
            ((interval === '1m' ? 1 : interval === '5m' ? 5 : 15) * 60 * 1000),
        ) + 50;
  const maxPerReq = 1000;

  if (estBars <= maxPerReq) {
    const limit = Math.min(maxPerReq, Math.max(50, estBars));
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const rows = (await r.json()) as unknown[];
    const bars = rows.map(binanceRow).filter((b) => b.time * 1000 >= startMs);
    if (bars.length > 0) {
      const exp = Date.now() + binanceCacheTtlMs(interval);
      cache.set(ck, { bars, expires: exp });
      writeLsEntry(ck, bars, exp);
    }
    return bars;
  }

  const out: Bar[] = [];
  let end = endMs;
  const guard = 24;
  for (let i = 0; i < guard && end > startMs; i++) {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${maxPerReq}&endTime=${end}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const rows = (await r.json()) as unknown[];
    if (rows.length === 0) break;
    const chunk = rows.map(binanceRow);
    for (const b of chunk) {
      if (b.time * 1000 >= startMs) out.push(b);
    }
    const oldestKline = rows[0] as number[];
    end = oldestKline[0]! - 1;
    if (chunk.length < maxPerReq) break;
  }
  out.sort((a, b) => a.time - b.time);
  const seen = new Set<number>();
  const dedup = out.filter((b) => {
    if (seen.has(b.time)) return false;
    seen.add(b.time);
    return true;
  });
  if (dedup.length > 0) {
    const exp = Date.now() + binanceCacheTtlMs(interval);
    cache.set(ck, { bars: dedup, expires: exp });
    writeLsEntry(ck, dedup, exp);
  }
  return dedup;
}

export async function fetchBarsForSymbol(
  sym: ChartSymbol,
  vitePolygonKey: string | undefined,
  preset: TimeframePreset,
): Promise<Bar[]> {
  const meta = resolveDynamicSymbol(sym);

  if (meta.id === 'BTC') {
    const iv = timeframeToBinanceInterval(preset);
    const { lookbackMs } = timeframeToPolygonSpec(preset);
    return fetchBinanceBtcBars(iv, lookbackMs);
  }

  const spec = timeframeToPolygonSpec(preset);
  let bars = await fetchPolygonAggs(meta.polygon, spec, { directKey: vitePolygonKey });

  /** 1D·1m on weekends / holidays: widen once so we still get a session. */
  if (bars.length === 0 && preset === '1d1m') {
    bars = await fetchPolygonAggs(
      meta.polygon,
      { multiplier: 1, timespan: 'minute', lookbackMs: 7 * 86400000 },
      { directKey: vitePolygonKey },
    );
  }

  /** Generic empty widen for thin windows */
  if (bars.length === 0 && spec.lookbackMs < 14 * 86400000) {
    bars = await fetchPolygonAggs(
      meta.polygon,
      { ...spec, lookbackMs: Math.max(spec.lookbackMs * 2, 14 * 86400000) },
      { directKey: vitePolygonKey },
    );
  }

  return bars;
}
