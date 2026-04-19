import type { Bar } from '../../../indicators/boom3d-tech';

/** Deterministic mock 1m OHLC for demo (random walk + wicks). */
export function makeMockBars(count: number, startSec = Math.floor(Date.now() / 1000) - count * 60): Bar[] {
  const bars: Bar[] = [];
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed / 0xffffffff;
  };

  let price = 100 + rnd() * 10;
  for (let i = 0; i < count; i++) {
    const t = i * 60 + startSec;
    const drift = (rnd() - 0.48) * 0.15;
    const o = price;
    const c = o + drift;
    const w = rnd() * 0.25;
    const h = Math.max(o, c) + w;
    const l = Math.min(o, c) - w;
    bars.push({ time: t, open: o, high: h, low: l, close: c, volume: 1e5 + rnd() * 5e4 });
    price = c;
  }
  return bars;
}
