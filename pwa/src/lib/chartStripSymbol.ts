import type { ChartSymbol } from './fetchBars';

/** One Lightweight strip (SPX / FX / ICT / BTC) — each keeps its own last symbol; timeframe stays global. */
export type ChartStripId = 'spx' | 'fx' | 'ict' | 'btc';

function key(id: ChartStripId): string {
  return `m4d.chartStrip.${id}.symbol`;
}

export function defaultSymbolForStrip(id: ChartStripId): ChartSymbol {
  switch (id) {
    case 'spx':
      return 'ES';
    case 'fx':
      return 'EURUSD';
    case 'ict':
      return 'EURUSD';
    case 'btc':
      return 'BTC';
  }
}

export function loadChartStripSymbol(id: ChartStripId): ChartSymbol | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    const t = raw.trim().toUpperCase();
    if (t.length < 1 || t.length > 32) return null;
    return t as ChartSymbol;
  } catch {
    return null;
  }
}

export function saveChartStripSymbol(id: ChartStripId, sym: ChartSymbol): void {
  try {
    localStorage.setItem(key(id), String(sym).trim().toUpperCase());
  } catch {
    /* ignore */
  }
}
