import type { Bar } from '../../../indicators/boom3d-tech';
import { buildVolumeProfile } from './volumeProfileHeatPrimitive';
import { sessionLevelsByBar } from './sessionLevels';
import { detectOrderBlocks } from './orderBlocks';
import { computeLiquidityThermal } from './liquidityThermal';
import type { LiquidityThermalResult } from './liquidityThermal';

export type { LiquidityThermalResult };

export type TargetBucket = 'vp' | 'sess' | 'ob' | 'liq';

export type PriceTargetRow = {
  id: string;
  label: string;
  price: number;
  /** 0–100 confluence + proximity score */
  rating: number;
  bucket: TargetBucket;
  sources: string[];
};

function atrWilder14(bars: Bar[]): number {
  if (bars.length < 2) return 0;
  const n = 14;
  let prevC = bars[0]!.close;
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!;
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - prevC), Math.abs(b.low - prevC)));
    prevC = b.close;
  }
  if (tr.length === 0) return 0;
  if (tr.length < n) return tr.reduce((a, x) => a + x, 0) / tr.length;
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < tr.length; i++) {
    a += (tr[i]! - a) / n;
  }
  return a;
}

function clusterEps(close: number, atr: number): number {
  return Math.max(close * 0.0002, atr * 0.14, 1e-8);
}

function mergeRows(rows: PriceTargetRow[], eps: number): PriceTargetRow[] {
  const sorted = [...rows].sort((a, b) => b.rating - a.rating);
  const out: PriceTargetRow[] = [];
  for (const t of sorted) {
    const hit = out.find((o) => Math.abs(o.price - t.price) <= eps);
    if (hit) {
      hit.rating = Math.min(100, hit.rating + 12);
      if (!hit.label.includes(t.label)) hit.label = `${hit.label}+${t.label}`;
      const src = new Set([...hit.sources, ...t.sources]);
      hit.sources = [...src];
    } else {
      out.push({
        ...t,
        sources: [...t.sources],
      });
    }
  }
  return out.sort((a, b) => b.rating - a.rating);
}

/**
 * Ranked price targets from VP (VPOC/VA/HVN), session (PDH/PDL/OR), live OB mids,
 * and Liquidity Thermal (300-bar, 31-bin BigBeluga-style volume profile).
 */
export function computePriceTargets(bars: Bar[]): {
  targets: PriceTargetRow[];
  lastClose: number;
  atr: number;
  lt: LiquidityThermalResult | null;
} {
  if (bars.length < 25) {
    return { targets: [], lastClose: bars[bars.length - 1]?.close ?? 0, atr: 0, lt: null };
  }
  const last = bars[bars.length - 1]!;
  const close = last.close;
  const atr = atrWilder14(bars);
  const eps = clusterEps(close, atr);

  const profile = buildVolumeProfile(bars, 28);
  const sessMap = sessionLevelsByBar(bars, 30);
  const sess = sessMap.get(last.time);

  const raw: PriceTargetRow[] = [];

  const push = (
    label: string,
    price: number | null | undefined,
    base: number,
    bucket: TargetBucket,
  ) => {
    if (price == null || !Number.isFinite(price)) return;
    const distAtr = Math.abs(price - close) / Math.max(atr, 1e-9);
    const proximity = Math.max(0, 24 - Math.min(24, distAtr * 8));
    const rating = Math.round(Math.min(100, base + proximity));
    raw.push({
      id: `${bucket}-${label}-${price}`,
      label,
      price,
      rating,
      bucket,
      sources: [label],
    });
  };

  push('VPOC', profile.vpoc, 90, 'vp');
  push('VAH', profile.vah, 64, 'vp');
  push('VAL', profile.val, 64, 'vp');
  profile.hvnsAbove.slice(0, 2).forEach((p, i) => push(`HVN↑${i + 1}`, p, 72 - i * 6, 'vp'));
  profile.hvnsBelow.slice(0, 2).forEach((p, i) => push(`HVN↓${i + 1}`, p, 72 - i * 6, 'vp'));

  if (sess) {
    push('PDH', sess.prevDayHigh, 74, 'sess');
    push('PDL', sess.prevDayLow, 74, 'sess');
    push('OR↑', sess.orHigh, 66, 'sess');
    push('OR↓', sess.orLow, 66, 'sess');
    const om =
      sess.orHigh != null && sess.orLow != null && Number.isFinite(sess.orHigh) && Number.isFinite(sess.orLow)
        ? (sess.orHigh + sess.orLow) / 2
        : null;
    push('OR·MID', om, 50, 'sess');
  }

  const lastT = last.time as number;
  const obs = detectOrderBlocks(bars, { maxEach: 14 });
  for (const z of obs.slice(-8)) {
    const mid = (z.top + z.bottom) / 2;
    const open = (z.endTime as number) >= lastT;
    push(z.dir === 1 ? 'OB·DEM' : 'OB·SUP', mid, open ? 62 : 48, 'ob');
  }

  // Liquidity Thermal levels (300-bar, 31-bin)
  const lt = computeLiquidityThermal(bars);
  if (lt) {
    push('LT-POC', lt.poc, 88, 'liq');
    lt.hvnsAbove.slice(0, 3).forEach((p, i) => push(`LT-R${i + 1}`, p, 76 - i * 8, 'liq'));
    lt.hvnsBelow.slice(0, 3).forEach((p, i) => push(`LT-S${i + 1}`, p, 76 - i * 8, 'liq'));
  }

  const targets = mergeRows(raw, eps).slice(0, 18);
  return { targets, lastClose: close, atr, lt };
}

export function formatTargetPrice(p: number): string {
  const a = Math.abs(p);
  if (a >= 1000) return p.toFixed(2);
  if (a >= 100) return p.toFixed(2);
  if (a >= 10) return p.toFixed(3);
  if (a >= 1) return p.toFixed(4);
  return p.toFixed(5);
}
