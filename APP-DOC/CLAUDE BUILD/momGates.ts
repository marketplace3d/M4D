// =============================================================================
// SURGE v3 — Momentum Gates (MOM-GATE)
// Binary gates ONLY. Max weight 0.20 to arbitrator. Never primary signals.
// =============================================================================

import type { OHLCV, MomGates } from "../../types/index.js";
import { rsi as calcRSI, stoch as calcStoch, ema, vwap, sma } from "../utils/indicators.js";

export interface MomConfig {
  rsiLen:         number;   // 14
  rsiOB:          number;   // 70
  rsiOS:          number;   // 30
  rsiDivLookback: number;   // 5
  stochK:         number;   // 14
  stochD:         number;   // 3
  stochSmooth:    number;   // 3
  stochOB:        number;   // 80
  stochOS:        number;   // 20
  emaFast:        number;   // 20
  emaMid:         number;   // 50
  emaSlow:        number;   // 200
  vwapLen:        number;   // 24
}

export const DEFAULT_MOM_CONFIG: MomConfig = {
  rsiLen:14, rsiOB:70, rsiOS:30, rsiDivLookback:5,
  stochK:14, stochD:3, stochSmooth:3, stochOB:80, stochOS:20,
  emaFast:20, emaMid:50, emaSlow:200, vwapLen:24,
};

function hiddenDiv(
  closes: number[], rsiSeries: number[], i: number, lookback: number
): { bull: boolean; bear: boolean } {
  if (i < lookback * 2) return { bull: false, bear: false };
  let bull = false, bear = false;
  const curC = closes[i], curR = rsiSeries[i];
  if (isNaN(curR)) return { bull: false, bear: false };

  for (let j = i - lookback; j >= Math.max(0, i - lookback * 3); j--) {
    const pC = closes[j], pR = rsiSeries[j];
    if (isNaN(pR)) continue;
    if (curC < pC && curR > pR) { bull = true; break; }
  }
  for (let j = i - lookback; j >= Math.max(0, i - lookback * 3); j--) {
    const pC = closes[j], pR = rsiSeries[j];
    if (isNaN(pR)) continue;
    if (curC > pC && curR < pR) { bear = true; break; }
  }
  return { bull, bear };
}

export class MomGateEngine {
  private cfg:     MomConfig;
  private _rsi:    number[] = [];
  private _stochK: number[] = [];
  private _stochD: number[] = [];
  private _emaF:   number[] = [];
  private _emaM:   number[] = [];
  private _emaS:   number[] = [];
  private _vwap:   number[] = [];

  constructor(cfg: MomConfig = DEFAULT_MOM_CONFIG) { this.cfg = cfg; }

  precompute(bars: OHLCV[]) {
    const c    = bars.map(b => b.close);
    this._rsi  = calcRSI(c, this.cfg.rsiLen);
    const st   = calcStoch(bars, this.cfg.stochK, this.cfg.stochD, this.cfg.stochSmooth);
    this._stochK = st.k; this._stochD = st.d;
    this._emaF = ema(c, this.cfg.emaFast);
    this._emaM = ema(c, this.cfg.emaMid);
    this._emaS = ema(c, this.cfg.emaSlow);
    this._vwap = vwap(bars, this.cfg.vwapLen);
  }

  gatesAt(bars: OHLCV[], i: number): MomGates | null {
    const bar = bars[i];
    const rv = this._rsi[i], sk = this._stochK[i], sd = this._stochD[i];
    const ef = this._emaF[i], em = this._emaM[i], es = this._emaS[i];
    const vw = this._vwap[i];
    if ([rv, sk, sd, ef, em, es].some(isNaN)) return null;

    const pk = this._stochK[i-1] ?? NaN, pd = this._stochD[i-1] ?? NaN;
    const stOB  = sk > this.cfg.stochOB;
    const stOS  = sk < this.cfg.stochOS;
    const xUp   = !isNaN(pk) && pk <= pd && sk > sd && stOS;
    const xDown = !isNaN(pk) && pk >= pd && sk < sd && stOB;

    const eStkBull = ef > em && em > es && bar.close > ef;
    const eStkBear = ef < em && em < es && bar.close < ef;
    const eBiasL   = bar.close > es;
    const eBiasS   = bar.close < es;
    const vwBull   = !isNaN(vw) && bar.close > vw;
    const vwBear   = !isNaN(vw) && bar.close < vw;

    const closes = bars.map(b => b.close);
    const div    = hiddenDiv(closes, this._rsi, i, this.cfg.rsiDivLookback);

    let s = 0;
    s += eStkBull ? 0.40 : eStkBear ? -0.40 : 0;
    s += eBiasL   ? 0.20 : eBiasS   ? -0.20 : 0;
    s += vwBull   ? 0.15 : vwBear   ? -0.15 : 0;
    s += xUp      ? 0.10 : xDown    ? -0.10 : 0;
    s += div.bull ? 0.10 : div.bear ? -0.10 : 0;
    s += stOS     ? 0.025: stOB     ? -0.025: 0;
    const cs = Math.max(-1, Math.min(1, s));

    return {
      rsiValue: rv, stochKValue: sk, stochDValue: sd,
      emaFast: ef, emaMid: em, emaSlow: es,
      vwap: isNaN(vw) ? 0 : vw,
      rsiHiddenDivBull: div.bull, rsiHiddenDivBear: div.bear,
      stochOB: stOB, stochOS: stOS,
      stochCrossUp: xUp, stochCrossDown: xDown,
      emaStackBull: eStkBull, emaStackBear: eStkBear,
      emaBiasLong: eBiasL, emaBiasShort: eBiasS,
      vwapBull: vwBull, vwapBear: vwBear,
      compositeScore: cs,
      arbitratorWeight: Math.abs(cs) * 0.20,
    };
  }

  runBatch(bars: OHLCV[]): (MomGates | null)[] {
    this.precompute(bars);
    return bars.map((_, i) => this.gatesAt(bars, i));
  }
}

// Conflict check: do gates BLOCK the proposed direction?
export function gatesBlock(g: MomGates, dir: "LONG" | "SHORT"): boolean {
  return dir === "LONG"
    ? (g.emaStackBear && g.stochOB)
    : (g.emaStackBull && g.stochOS);
}

// Gate confirmation strength 0..1
export function gatesConfirmStrength(g: MomGates, dir: "LONG" | "SHORT"): number {
  const flags = dir === "LONG"
    ? [g.emaBiasLong, g.emaStackBull, g.rsiHiddenDivBull, g.stochCrossUp, g.vwapBull]
    : [g.emaBiasShort, g.emaStackBear, g.rsiHiddenDivBear, g.stochCrossDown, g.vwapBear];
  return flags.filter(Boolean).length / flags.length;
}
