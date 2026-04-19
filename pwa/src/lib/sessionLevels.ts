import type { Bar } from '../../../indicators/boom3d-tech';

export type SessionDayLevels = {
  day: string;
  utcDay: string;
  prevDayHigh: number | null;
  prevDayLow: number | null;
  /** first `orBars` bars of session */
  orHigh: number | null;
  orLow: number | null;
};

/** UTC calendar day buckets; opening range = first `orBars` bars of each day. */
export function sessionLevelsByBar(bars: Bar[], orBars = 30): Map<number, SessionDayLevels> {
  const byDay = new Map<string, Bar[]>();
  for (const b of bars) {
    const d = new Date(b.time * 1000).toISOString().slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(b);
  }

  const days = [...byDay.keys()].sort();
  const dayPrev = new Map<string, { high: number; low: number }>();
  for (const d of days) {
    const bs = byDay.get(d)!;
    let hi = -Infinity;
    let lo = Infinity;
    for (const x of bs) {
      hi = Math.max(hi, x.high);
      lo = Math.min(lo, x.low);
    }
    dayPrev.set(d, { high: hi, low: lo });
  }

  const map = new Map<number, SessionDayLevels>();
  for (let di = 0; di < days.length; di++) {
    const d = days[di]!;
    const prev = di > 0 ? dayPrev.get(days[di - 1]!) : null;
    const bs = byDay.get(d)!;
    const slice = bs.slice(0, Math.min(orBars, bs.length));
    let orH = -Infinity;
    let orL = Infinity;
    for (const x of slice) {
      orH = Math.max(orH, x.high);
      orL = Math.min(orL, x.low);
    }
    const lev: SessionDayLevels = {
      day: d,
      utcDay: d,
      prevDayHigh: prev?.high ?? null,
      prevDayLow: prev?.low ?? null,
      orHigh: slice.length ? orH : null,
      orLow: slice.length ? orL : null,
    };
    for (const b of bs) {
      map.set(b.time, lev);
    }
  }
  return map;
}
