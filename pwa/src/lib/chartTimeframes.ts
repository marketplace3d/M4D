/** UI + fetch contract for OHLC range / bar size. */

export type TimeframePreset = '1d1m' | '5d5m' | '1m15m' | '1y1d';

export const TIMEFRAME_OPTIONS: { id: TimeframePreset; label: string }[] = [
  { id: '1d1m', label: '1D·1m' },
  { id: '5d5m', label: '5D·5m' },
  { id: '1m15m', label: '1M·15m' },
  { id: '1y1d', label: '1Y·1D' },
];

export const DEFAULT_TIMEFRAME: TimeframePreset = '1d1m';

/** Shared by SPX / FX / ICT strips — interval preset is global; symbols are per-strip (`chartStripSymbol`). */
const TF_KEY = 'm4d-timeframe';

export function loadTimeframe(): TimeframePreset {
  if (typeof window === 'undefined') return DEFAULT_TIMEFRAME;
  try {
    const raw = localStorage.getItem(TF_KEY);
    if (raw === '1d1m' || raw === '5d5m' || raw === '1m15m' || raw === '1y1d') return raw;
  } catch {
    /* private mode */
  }
  return DEFAULT_TIMEFRAME;
}

export function saveTimeframe(tf: TimeframePreset) {
  try {
    localStorage.setItem(TF_KEY, tf);
  } catch {
    /* ignore */
  }
}

/** One candle duration in ms for padding / edge buffers. */
export function barDurationMs(preset: TimeframePreset): number {
  switch (preset) {
    case '1d1m':
      return 60_000;
    case '5d5m':
      return 5 * 60_000;
    case '1m15m':
      return 15 * 60_000;
    case '1y1d':
      return 86_400_000;
  }
}

/** Extra history on the left so zoom/pan does not run out of bars immediately. */
const LOOKBACK_EXTRA_BARS_LEFT = 10;

export function timeframeToPolygonSpec(preset: TimeframePreset): {
  multiplier: number;
  timespan: 'minute' | 'day';
  lookbackMs: number;
} {
  const pad = LOOKBACK_EXTRA_BARS_LEFT * barDurationMs(preset);
  switch (preset) {
    case '1d1m':
      return { multiplier: 1, timespan: 'minute', lookbackMs: 86400000 + pad };
    case '5d5m':
      return { multiplier: 5, timespan: 'minute', lookbackMs: 5 * 86400000 + pad };
    case '1m15m':
      return { multiplier: 15, timespan: 'minute', lookbackMs: 30 * 86400000 + pad };
    case '1y1d':
      return { multiplier: 1, timespan: 'day', lookbackMs: 365 * 86400000 + pad };
  }
}

/** Binance kline interval string for BTC. */
export function timeframeToBinanceInterval(preset: TimeframePreset): '1m' | '5m' | '15m' | '1d' {
  switch (preset) {
    case '1d1m':
      return '1m';
    case '5d5m':
      return '5m';
    case '1m15m':
      return '15m';
    case '1y1d':
      return '1d';
  }
}
