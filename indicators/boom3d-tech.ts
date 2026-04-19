/**
 * M4D — "3D BOOM TECH **" Pine-equivalent (LazyBear BB/KC + Squeeze Box [DW] + SlingShot)
 * Feeds Lightweight Charts: line series, markers, box levels from computed series.
 *
 * Source Pine: SCRIPTS/3D BOOM TECH **.pine (@version=2)
 */

export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type Boom3dParams = {
  /** BB/KC section */
  length: number;
  mult: number;
  mult2: number;
  useTrueRange: boolean;
  /** SAR */
  sarStart: number;
  sarIncrement: number;
  sarMaximum: number;
  /** Squeeze Box [DW] */
  squeezePer: number;
  squeezeNdev: number;
  squeezeThresholdPct: number;
  /** SlingShot */
  emaFastLen: number;
  emaSlowLen: number;
};

export const defaultBoom3dParams: Boom3dParams = {
  length: 20,
  mult: 2.0,
  mult2: 2.25,
  useTrueRange: false,
  sarStart: 0.02,
  sarIncrement: 0.02,
  sarMaximum: 0.2,
  squeezePer: 21,
  squeezeNdev: 2,
  squeezeThresholdPct: 50,
  emaFastLen: 38,
  emaSlowLen: 62,
};

export type Boom3dBarOut = {
  time: number;
  /** BB */
  basis: number;
  upperBB: number;
  lowerBB: number;
  /** KC */
  kcMa: number;
  kcUpper: number;
  kcLower: number;
  /** Squeeze: BB inside KC */
  squeezeOn: boolean;
  /** SlingShot */
  emaFast: number;
  emaSlow: number;
  slingshotLong: boolean;
  slingshotShort: boolean;
  pullbackUp: boolean;
  pullbackDn: boolean;
  /** SAR */
  sar: number;
  /** Squeeze Box [DW] — COVWMA path (matches Pine default matype) */
  covwma: number;
  squeezeBoxHigh: number;
  squeezeBoxLow: number;
  squeezeActive: boolean;
  /** True on the first bar squeezeActive turns false — the BOOM release bar. */
  squeezeRelease: boolean;
  boxHighPlot: number;
  boxLowPlot: number;
};

function hlc3(b: Bar): number {
  return (b.high + b.low + b.close) / 3;
}

function rollingSma(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Pine-style EMA: seeds from first bar, same alpha throughout. */
function rollingEma(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  const k = 2 / (period + 1);
  let prev = values[0]!;
  out[0] = prev;
  for (let i = 1; i < n; i++) {
    prev = (values[i]! - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

function rollingStdevSample(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += values[j];
    const mean = s / period;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += (values[j] - mean) ** 2;
    out[i] = Math.sqrt(acc / (period - 1));
  }
  return out;
}

function trueRange(high: number[], low: number[], close: number[]): number[] {
  const n = high.length;
  const tr = new Array<number>(n);
  tr[0] = high[0] - low[0];
  for (let i = 1; i < n; i++) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }
  return tr;
}

/** COVWMA from Pine: cov = stdev/sma; covwma = sum(src*cov)/sum(cov) */
function covwmaSeries(src: number[], period: number): number[] {
  const n = src.length;
  const st = rollingStdevSample(src, period);
  const sm = rollingSma(src, period);
  const cov = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!isFinite(st[i]) || !isFinite(sm[i]) || sm[i] === 0) continue;
    cov[i] = st[i] / sm[i];
  }
  const cw = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!isFinite(cov[i])) continue;
    cw[i] = src[i] * cov[i];
  }
  const sumCw = rollingSum(cw, period);
  const sumCov = rollingSum(cov, period);
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (isFinite(sumCw[i]) && isFinite(sumCov[i]) && sumCov[i] !== 0) {
      out[i] = sumCw[i]! / sumCov[i]!;
    }
  }
  return out;
}

/** Rolling sum over `period` bars; `na` treated as 0 (Pine `sum` behavior). */
function rollingSum(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j];
      s += isFinite(v) ? v! : 0;
    }
    out[i] = s;
  }
  return out;
}

function highest(arr: number[], period: number, i: number): number {
  let h = -Infinity;
  for (let j = Math.max(0, i - period + 1); j <= i; j++) {
    if (isFinite(arr[j])) h = Math.max(h, arr[j]!);
  }
  return h;
}

function lowest(arr: number[], period: number, i: number): number {
  let lo = Infinity;
  for (let j = Math.max(0, i - period + 1); j <= i; j++) {
    if (isFinite(arr[j])) lo = Math.min(lo, arr[j]!);
  }
  return lo;
}

/** valuewhen(condition, source, occurrence) — occurrence 0 = last match, 1 = previous... */
function valueWhen(
  cond: boolean[],
  source: number[],
  occurrence: number,
): number[] {
  const n = cond.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let seen = -1;
    for (let j = i; j >= 0; j--) {
      if (cond[j]) {
        seen++;
        if (seen === occurrence) {
          out[i] = source[j]!;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Parabolic SAR (Wilder-style), typical TA behavior.
 */
function parabolicSar(
  high: number[],
  low: number[],
  startAF: number,
  incrementAF: number,
  maxAF: number,
): number[] {
  const n = high.length;
  const psar = new Array<number>(n).fill(NaN);
  if (n === 0) return psar;

  const ep = new Array<number>(n).fill(0);
  const af = new Array<number>(n).fill(startAF);
  const bull = new Array<boolean>(n).fill(true);

  bull[0] = true;
  psar[0] = low[0]!;
  ep[0] = high[0]!;

  for (let i = 1; i < n; i++) {
    const h = high[i]!;
    const l = low[i]!;
    const prevPsar = psar[i - 1]!;
    const prevEp = ep[i - 1]!;
    const prevAf = af[i - 1]!;
    const prevBull = bull[i - 1]!;

    if (prevBull) {
      let next = prevPsar + prevAf * (prevEp - prevPsar);
      next = Math.min(next, low[i - 1]!, i > 1 ? low[i - 2]! : low[i - 1]!);
      if (l < next) {
        bull[i] = false;
        psar[i] = prevEp;
        ep[i] = l;
        af[i] = startAF;
      } else {
        bull[i] = true;
        psar[i] = next;
        ep[i] = h > prevEp ? h : prevEp;
        af[i] = h > prevEp ? Math.min(maxAF, prevAf + incrementAF) : prevAf;
      }
    } else {
      let next = prevPsar + prevAf * (prevEp - prevPsar);
      next = Math.max(next, high[i - 1]!, i > 1 ? high[i - 2]! : high[i - 1]!);
      if (h > next) {
        bull[i] = true;
        psar[i] = prevEp;
        ep[i] = h;
        af[i] = startAF;
      } else {
        bull[i] = false;
        psar[i] = next;
        ep[i] = l < prevEp ? l : prevEp;
        af[i] = l < prevEp ? Math.min(maxAF, prevAf + incrementAF) : prevAf;
      }
    }
  }
  return psar;
}

export function computeBoom3dTech(bars: Bar[], params: Boom3dParams = defaultBoom3dParams): Boom3dBarOut[] {
  const n = bars.length;
  const close = bars.map((b) => b.close);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const src = bars.map(hlc3);

  const L = params.length;
  const basis = rollingSma(close, L);
  const dev = rollingStdevSample(close, L).map((d) => d * params.mult2);
  const upperBB = basis.map((b, i) => (isFinite(b) && isFinite(dev[i]) ? b + dev[i]! : NaN));
  const lowerBB = basis.map((b, i) => (isFinite(b) && isFinite(dev[i]) ? b - dev[i]! : NaN));

  const range = params.useTrueRange ? trueRange(high, low, close) : high.map((h, i) => h - low[i]!);
  const rangema = rollingEma(range, L);
  const ma = rollingEma(close, L);
  const kcUpper = ma.map((m, i) => (isFinite(m) && isFinite(rangema[i]) ? m + rangema[i]! * params.mult : NaN));
  const kcLower = ma.map((m, i) => (isFinite(m) && isFinite(rangema[i]) ? m - rangema[i]! * params.mult : NaN));

  const squeezeOn = upperBB.map((ub, i) => {
    const lb = lowerBB[i];
    const u = kcUpper[i];
    const l = kcLower[i];
    if (!isFinite(ub) || !isFinite(lb) || !isFinite(u) || !isFinite(l)) return false;
    return ub < u && lb > l;
  });

  const sar = parabolicSar(high, low, params.sarStart, params.sarIncrement, params.sarMaximum);

  const per = params.squeezePer;
  const ma2 = covwmaSeries(src, per);
  const stSrc = rollingStdevSample(src, per);
  const bu = ma2.map((m, i) => (isFinite(m) && isFinite(stSrc[i]) ? m + stSrc[i]! * params.squeezeNdev : NaN));
  const bd = ma2.map((m, i) => (isFinite(m) && isFinite(stSrc[i]) ? m - stSrc[i]! * params.squeezeNdev : NaN));
  const bw = bu.map((b, i) => (isFinite(b) && isFinite(bd[i]) ? b - bd[i]! : NaN));

  const buh = new Array<number>(n).fill(NaN);
  const bdl = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    buh[i] = highest(bu, per, i);
    bdl[i] = lowest(bd, per, i);
  }
  const brng = buh.map((bh, i) => (isFinite(bh) && isFinite(bdl[i]) ? bh - bdl[i]! : NaN));
  const sqp = bw.map((w, i) => (isFinite(w) && isFinite(brng[i]) && brng[i]! !== 0 ? (100 * w) / brng[i]! : NaN));
  const sqz = sqp.map((p) => isFinite(p) && p < params.squeezeThresholdPct);

  const boxh = new Array<number>(n);
  const boxl = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (sqz[i]) {
      boxh[i] = highest(src, per, i);
      boxl[i] = lowest(src, per, i);
    } else {
      boxh[i] = src[i]!;
      boxl[i] = src[i]!;
    }
  }

  const bh = valueWhen(sqz, boxh, 1);
  const bl = valueWhen(sqz, boxl, 1);

  const emaFast = rollingEma(close, params.emaFastLen);
  const emaSlow = rollingEma(close, params.emaSlowLen);

  const out: Boom3dBarOut[] = [];
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    const ef = emaFast[i]!;
    const es = emaSlow[i]!;
    const c = b.close;
    const c1 = i > 0 ? bars[i - 1]!.close : c;

    const pullbackUp = ef > es && c < ef;
    const pullbackDn = ef < es && c > ef;
    const entryUp = ef > es && c1 < ef && c > ef;
    const entryDn = ef < es && c1 > ef && c < ef;

    out.push({
      time: b.time,
      basis: basis[i]!,
      upperBB: upperBB[i]!,
      lowerBB: lowerBB[i]!,
      kcMa: ma[i]!,
      kcUpper: kcUpper[i]!,
      kcLower: kcLower[i]!,
      squeezeOn: squeezeOn[i]!,
      emaFast: ef,
      emaSlow: es,
      slingshotLong: entryUp,
      slingshotShort: entryDn,
      pullbackUp,
      pullbackDn,
      sar: sar[i]!,
      covwma: ma2[i]!,
      squeezeBoxHigh: boxh[i]!,
      squeezeBoxLow: boxl[i]!,
      squeezeActive: sqz[i]!,
      squeezeRelease: i > 0 ? (sqz[i - 1]! && !sqz[i]!) : false,
      boxHighPlot: bh[i]!,
      boxLowPlot: bl[i]!,
    });
  }
  return out;
}

/** Lightweight Charts marker hints: conservative entries (SlingShot). */
export function boom3dSlingshotMarkers(
  series: Boom3dBarOut[],
): Array<{ time: number; kind: 'long' | 'short' }> {
  const m: Array<{ time: number; kind: 'long' | 'short' }> = [];
  for (const row of series) {
    if (row.slingshotLong) m.push({ time: row.time, kind: 'long' });
    if (row.slingshotShort) m.push({ time: row.time, kind: 'short' });
  }
  return m;
}
