/**
 * MTF ICT Level Extractor
 *
 * Given daily bars (1y1d preset), extracts all key multi-timeframe liquidity
 * reference levels used by ICT / Market Maker model:
 *
 *   PDH/PDL   — Previous Day High/Low          (daily[n-2])
 *   PWH/PWL   — Previous Week High/Low         (Mon–Fri prior to current week)
 *   CMH/CML   — Current Month High/Low so far  (this calendar month's range)
 *   PMH/PML   — Previous Month High/Low        (prior calendar month)
 *   CWH/CWL   — Current Week High/Low so far   (Mon to last bar this week)
 *   PQH/PQL   — Previous Quarter High/Low      (prior 3-month calendar quarter)
 *
 * All derived purely from daily OHLCV — no additional fetches required.
 * Returns levels in OracleSnapshot PriceLevel format, ready for chart rendering.
 */

import type { Bar } from '../../../indicators/boom3d-tech';

export type MtfLevel = {
  price: number;
  kind: string;       // 'PWH' | 'PWL' | 'PDH' | 'PDL' | 'PMH' | 'PML' | 'CWH' | 'CWL' | 'CMH' | 'CML' | 'PQH' | 'PQL'
  label: string;      // display label on chart
  color: string;      // rgba for chart line
  lineStyle: 0 | 1 | 2 | 3 | 4;  // LW LineStyle: 0=solid, 1=dotted, 2=dashed
  lineWidth: 1 | 2 | 3;
  priority: 1 | 2 | 3;
};

/** Get ISO week start (Monday 00:00 UTC) for any Date. */
function weekStart(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, …
  const diff = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diff);
  mon.setUTCHours(0, 0, 0, 0);
  return mon;
}

function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function quarterOf(d: Date): string {
  const q = Math.floor(d.getUTCMonth() / 3);
  return `${d.getUTCFullYear()}-Q${q + 1}`;
}

export function computeMtfLevels(dailyBars: Bar[]): MtfLevel[] {
  if (dailyBars.length < 5) return [];

  const levels: MtfLevel[] = [];
  const add = (price: number, kind: string, label: string, color: string,
    lineStyle: MtfLevel['lineStyle'] = 2, lineWidth: MtfLevel['lineWidth'] = 1,
    priority: MtfLevel['priority'] = 1,
  ) => {
    if (!Number.isFinite(price) || price <= 0) return;
    levels.push({ price, kind, label, color, lineStyle, lineWidth, priority });
  };

  const now = new Date();
  const thisWeekStart = weekStart(now).getTime() / 1000;
  const thisMonth = monthOf(now);
  const thisQuarter = quarterOf(now);

  // Group bars by week / month / quarter
  const thisWeekBars: Bar[] = [];
  const prevWeekBars: Bar[] = [];
  const thisMonthBars: Bar[] = [];
  const prevMonthBars: Bar[] = [];
  const thisQtrBars: Bar[] = [];
  const prevQtrBars: Bar[] = [];

  for (const b of dailyBars) {
    const t = b.time as number;
    const d = new Date(t * 1000);
    const wStart = weekStart(d).getTime() / 1000;
    const mo = monthOf(d);
    const qt = quarterOf(d);

    if (wStart >= thisWeekStart)         thisWeekBars.push(b);
    else if (wStart >= thisWeekStart - 7 * 86400) prevWeekBars.push(b);

    if (mo === thisMonth)      thisMonthBars.push(b);
    else if (prevMonthBars.length === 0 || monthOf(new Date((prevMonthBars[0]!.time as number) * 1000)) === mo)
                               prevMonthBars.push(b);

    if (qt === thisQuarter)    thisQtrBars.push(b);
    else if (prevQtrBars.length === 0 || quarterOf(new Date((prevQtrBars[0]!.time as number) * 1000)) === qt)
                               prevQtrBars.push(b);
  }

  // PDH / PDL — previous trading day (second-to-last daily bar)
  const pd = dailyBars[dailyBars.length - 2];
  if (pd) {
    add(pd.high, 'PDH', 'PDH', 'rgba(136, 46, 224, 0.90)', 2, 1, 1);
    add(pd.low,  'PDL', 'PDL', 'rgba(136, 46, 224, 0.85)', 2, 1, 1);
  }

  // CWH / CWL — current week range so far
  if (thisWeekBars.length) {
    const cwh = Math.max(...thisWeekBars.map(b => b.high));
    const cwl = Math.min(...thisWeekBars.map(b => b.low));
    add(cwh, 'CWH', 'CW↑', 'rgba(251, 191, 36, 0.60)', 1, 1, 2);
    add(cwl, 'CWL', 'CW↓', 'rgba(251, 191, 36, 0.55)', 1, 1, 2);
  }

  // PWH / PWL — previous full week (strongest weekly sweep target)
  if (prevWeekBars.length) {
    const pwh = Math.max(...prevWeekBars.map(b => b.high));
    const pwl = Math.min(...prevWeekBars.map(b => b.low));
    add(pwh, 'PWH', 'PWH', 'rgba(251, 146, 60, 0.95)', 0, 2, 1);
    add(pwl, 'PWL', 'PWL', 'rgba(251, 146, 60, 0.90)', 0, 2, 1);
  }

  // CMH / CML — current month range
  if (thisMonthBars.length) {
    const cmh = Math.max(...thisMonthBars.map(b => b.high));
    const cml = Math.min(...thisMonthBars.map(b => b.low));
    add(cmh, 'CMH', 'CM↑', 'rgba(248, 113, 113, 0.55)', 1, 1, 2);
    add(cml, 'CML', 'CM↓', 'rgba(248, 113, 113, 0.50)', 1, 1, 2);
  }

  // PMH / PML — previous full month (macro sweep target)
  if (prevMonthBars.length) {
    const pmh = Math.max(...prevMonthBars.map(b => b.high));
    const pml = Math.min(...prevMonthBars.map(b => b.low));
    add(pmh, 'PMH', 'PMH', 'rgba(239, 68, 68, 0.90)', 0, 2, 1);
    add(pml, 'PML', 'PML', 'rgba(239, 68, 68, 0.85)', 0, 2, 1);
  }

  // PQH / PQL — previous quarter (structural draw — swing)
  if (prevQtrBars.length) {
    const pqh = Math.max(...prevQtrBars.map(b => b.high));
    const pql = Math.min(...prevQtrBars.map(b => b.low));
    add(pqh, 'PQH', 'PQH', 'rgba(220, 38, 38, 0.75)', 2, 2, 1);
    add(pql, 'PQL', 'PQL', 'rgba(220, 38, 38, 0.70)', 2, 2, 1);
  }

  return levels;
}

/** Convert MtfLevel array to OracleSnapshot-compatible PriceLevel records. */
export function mtfToPriceLevels(
  mtf: MtfLevel[],
  currentPrice: number,
): import('./oracleSnapshot').PriceLevel[] {
  return mtf.map(m => {
    const proximity = Math.abs(m.price - currentPrice);
    const proxPct = proximity / currentPrice * 100;
    return {
      price: m.price,
      kind: m.kind,
      proximity,
      proxPct,
      priority: m.priority,
      dir: (proxPct < 0.01 ? 'at' : m.price > currentPrice ? 'above' : 'below') as 'above' | 'below' | 'at',
      note: m.label,
    };
  });
}
