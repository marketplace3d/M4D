// =============================================================================
// SURGE v3 — BRK Engine (Breakout + Retest)
// Integrates with SMC state: uses active OBs / FVGs as SL/TP anchors
// Real-time rolling high/low — zero pivot lag
// =============================================================================

import { nanoid }  from "nanoid";
import type {
  OHLCV, BRKBreak, BRKSignal, CandlePattern,
  Direction, SignalDir,
} from "../../types/index.js";
import type { SMCState } from "./smcEngine.js";
import {
  atr, ema, rollingHigh, rollingLow,
  lowestLow, highestHigh, volSma,
} from "../utils/indicators.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface BRKConfig {
  rollingLookback:  number;
  minBreakPct:      number;
  volConfirm:       boolean;
  volAvgLen:        number;
  volMult:          number;
  retestBars:       number;
  retestTolPct:     number;
  requirePattern:   boolean;
  atrLen:           number;
  slAtrMult:        number;
  tp1RR:            number;
  tp2RR:            number;
  useSwingSL:       boolean;
  swingSlLen:       number;
  minRR:            number;
  trendFilter:      boolean;
  ema200Len:        number;
}

export const DEFAULT_BRK_CONFIG: BRKConfig = {
  rollingLookback:  20,
  minBreakPct:      0.10,
  volConfirm:       true,
  volAvgLen:        20,
  volMult:          1.2,
  retestBars:       20,
  retestTolPct:     0.20,
  requirePattern:   true,
  atrLen:           14,
  slAtrMult:        1.5,
  tp1RR:            2.0,
  tp2RR:            5.0,
  useSwingSL:       true,
  swingSlLen:       5,
  minRR:            1.5,
  trendFilter:      true,
  ema200Len:        200,
};

// ─── Candle pattern ───────────────────────────────────────────────────────────

function classifyPattern(cur: OHLCV, prev: OHLCV): CandlePattern {
  const body  = Math.abs(cur.close - cur.open);
  const range = cur.high - cur.low;
  const uWick = cur.high - Math.max(cur.close, cur.open);
  const lWick = Math.min(cur.close, cur.open) - cur.low;

  const prevBody = Math.abs(prev.close - prev.open);
  const isBull   = cur.close > cur.open;

  if (isBull && cur.open <= prev.close && cur.close >= prev.open && body >= prevBody * 0.75)
    return "Engulfing";
  if (!isBull && cur.open >= prev.close && cur.close <= prev.open && body >= prevBody * 0.75)
    return "Engulfing";
  if (range > 0 && lWick > body * 2.0 && lWick > uWick * 2.5) return "PinBar";
  if (range > 0 && uWick > body * 2.0 && uWick > lWick * 2.5) return "PinBar";
  if (range > 0 && lWick / range > 0.60 && isBull)  return "RejectionWick";
  if (range > 0 && uWick / range > 0.60 && !isBull) return "RejectionWick";
  if (cur.high < prev.high && cur.low > prev.low)    return "InsideBar";
  if (range > 0 && body / range < 0.10)              return "Doji";
  return "None";
}

function patternStrength(p: CandlePattern): number {
  const s: Record<CandlePattern, number> = {
    Engulfing: 0.90, PinBar: 0.85, RejectionWick: 0.75,
    InsideBar: 0.55, Doji: 0.50, CloseConfirm: 0.40, None: 0.00,
  };
  return s[p] ?? 0;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class BRKEngine {
  private cfg: BRKConfig;
  private _atr:    number[] = [];
  private _ema200: number[] = [];
  private _volSma: number[] = [];
  private _rHigh:  number[] = [];
  private _rLow:   number[] = [];

  private _pending:   BRKBreak[]  = [];
  private _lastBullLvl = NaN;
  private _lastBearLvl = NaN;

  constructor(cfg: BRKConfig = DEFAULT_BRK_CONFIG) {
    this.cfg = cfg;
  }

  precompute(bars: OHLCV[]) {
    this._atr    = atr(bars, this.cfg.atrLen);
    this._ema200 = ema(bars.map(b => b.close), this.cfg.ema200Len);
    this._volSma = volSma(bars, this.cfg.volAvgLen);
    this._rHigh  = rollingHigh(bars, this.cfg.rollingLookback);
    this._rLow   = rollingLow(bars,  this.cfg.rollingLookback);
  }

  processBar(
    bars:     OHLCV[],
    i:        number,
    ticker:   string,
    tf:       string,
    smcState: SMCState | null,   // optional SMC context for SL/TP anchoring
  ): BRKSignal | null {
    const bar    = bars[i];
    const curATR = this._atr[i];
    const curEMA = this._ema200[i];
    const curVol = this._volSma[i];
    const rtH    = this._rHigh[i];
    const rtL    = this._rLow[i];

    if ([curATR, rtH, rtL].some(isNaN)) return null;

    const volOk    = !this.cfg.volConfirm || bar.volume > (curVol ?? 0) * this.cfg.volMult;
    const trendBull = !this.cfg.trendFilter || isNaN(curEMA) || bar.close > curEMA;
    const trendBear = !this.cfg.trendFilter || isNaN(curEMA) || bar.close < curEMA;

    // ── Real-time break detection ─────────────────────────────────────────
    const brkPctBull = (bar.close - rtH) / rtH * 100;
    const brkPctBear = (rtL - bar.close) / rtL * 100;

    const isBullBrk = brkPctBull >= this.cfg.minBreakPct && volOk && trendBull;
    const isBearBrk = brkPctBear >= this.cfg.minBreakPct && volOk && trendBear;

    // Deduplicate
    if (isBullBrk && (isNaN(this._lastBullLvl) || Math.abs(rtH - this._lastBullLvl) / rtH > 0.001)) {
      this._lastBullLvl = rtH;
      this._pending.push({
        id: nanoid(6), direction: "BULL", level: rtH,
        breakBar: i, breakClose: bar.close, breakPct: brkPctBull,
        quality: "CLEAN", volConfirmed: volOk, trendAligned: trendBull,
        confirmed: false, expiresAt: i + this.cfg.retestBars,
      });
    }
    if (isBearBrk && (isNaN(this._lastBearLvl) || Math.abs(rtL - this._lastBearLvl) / rtL > 0.001)) {
      this._lastBearLvl = rtL;
      this._pending.push({
        id: nanoid(6), direction: "BEAR", level: rtL,
        breakBar: i, breakClose: bar.close, breakPct: brkPctBear,
        quality: "CLEAN", volConfirmed: volOk, trendAligned: trendBear,
        confirmed: false, expiresAt: i + this.cfg.retestBars,
      });
    }

    // Expire stale
    this._pending = this._pending.filter(p => p.expiresAt >= i && !p.confirmed);
    if (this._pending.length > 8) this._pending = this._pending.slice(-8);

    // ── Retest detection ─────────────────────────────────────────────────
    const tol = this.cfg.retestTolPct / 100;

    for (const brk of this._pending) {
      if (brk.confirmed) continue;
      const t    = brk.level * tol;
      const prev = bars[Math.max(0, i - 1)];
      const pat  = classifyPattern(bar, prev);
      const patOk = !this.cfg.requirePattern || pat !== "None";

      let sl = 0, dist = 0, matched = false;

      if (brk.direction === "BULL") {
        const touching    = bar.low  <= brk.level + t && bar.high >= brk.level - t;
        const closedAbove = bar.close > brk.level - t;
        if (touching && closedAbove && patOk) {
          // SL: anchor to nearest active bull OB, else swing low, else ATR
          const bullOB = smcState?.activeOBs.filter(o => o.direction === "BULL")
            .sort((a, b) => b.barIndex - a.barIndex)[0];
          const swSL   = this.cfg.useSwingSL
            ? lowestLow(bars, this.cfg.swingSlLen + 1, i) : Infinity;
          sl   = bullOB ? Math.min(bullOB.bottom, swSL, bar.close - curATR * this.cfg.slAtrMult)
                        : Math.min(swSL, bar.close - curATR * this.cfg.slAtrMult);
          dist = bar.close - sl;
          matched = dist > 0;
        }
      } else {
        const touching    = bar.high >= brk.level - t && bar.low <= brk.level + t;
        const closedBelow = bar.close < brk.level + t;
        if (touching && closedBelow && patOk) {
          const bearOB = smcState?.activeOBs.filter(o => o.direction === "BEAR")
            .sort((a, b) => b.barIndex - a.barIndex)[0];
          const swSL   = this.cfg.useSwingSL
            ? highestHigh(bars, this.cfg.swingSlLen + 1, i) : -Infinity;
          sl   = bearOB ? Math.max(bearOB.top, swSL, bar.close + curATR * this.cfg.slAtrMult)
                        : Math.max(swSL, bar.close + curATR * this.cfg.slAtrMult);
          dist = sl - bar.close;
          matched = dist > 0;
        }
      }

      if (!matched) continue;

      const rrActual = dist > 0 ? dist * this.cfg.tp1RR / dist : 0;
      const rr       = dist > 0 ? (curATR * 3) / dist : 0;
      if (rr < this.cfg.minRR) continue;

      brk.confirmed = true;

      // TP magnets: use nearest active FVG as TP1 if available
      const fvgTP = smcState?.activeFVGs
        .filter(f => brk.direction === "BULL" ? f.direction === "BULL" && f.bottom > bar.close
                                              : f.direction === "BEAR" && f.top < bar.close)
        .sort((a, b) => brk.direction === "BULL"
          ? a.bottom - b.bottom : b.top - a.top)[0];

      const tp1 = brk.direction === "BULL"
        ? (fvgTP ? Math.min(fvgTP.top, bar.close + dist * this.cfg.tp1RR) : bar.close + dist * this.cfg.tp1RR)
        : (fvgTP ? Math.max(fvgTP.bottom, bar.close - dist * this.cfg.tp1RR) : bar.close - dist * this.cfg.tp1RR);
      const tp2 = brk.direction === "BULL"
        ? bar.close + dist * this.cfg.tp2RR
        : bar.close - dist * this.cfg.tp2RR;
      const rrFinal = Math.abs(tp1 - bar.close) / dist;

      const pscore = patternStrength(pat);
      const conf   = Math.min(100, Math.round(
        (pscore * 0.40 + (brk.quality === "CLEAN" ? 0.15 : 0) +
         (brk.trendAligned ? 0.10 : 0) + (brk.volConfirmed ? 0.10 : 0) +
         Math.min(rrFinal / 5, 0.25)) * 100
      ));

      return {
        source: "SURGE_BRK", alphaId: "CONF-01",
        id: nanoid(8), ts: bar.ts, ticker, tf,
        signal: brk.direction === "BULL" ? "LONG" : "SHORT",
        breakLevel: brk.level, breakQuality: brk.quality,
        pattern: pat, entry: bar.close, sl, tp1, tp2,
        rrRatio: rrFinal, slDist: dist, atr: curATR,
        volConfirmed: brk.volConfirmed, trendAligned: brk.trendAligned,
        confidence: conf,
      };
    }

    return null;
  }

  runBatch(bars: OHLCV[], ticker: string, tf: string, smcStates: (SMCState | null)[]): BRKSignal[] {
    this._pending = []; this._lastBullLvl = NaN; this._lastBearLvl = NaN;
    this.precompute(bars);
    const out: BRKSignal[] = [];
    const minBar = Math.max(this.cfg.ema200Len, this.cfg.rollingLookback + 1);
    for (let i = minBar; i < bars.length; i++) {
      const sig = this.processBar(bars, i, ticker, tf, smcStates[i] ?? null);
      if (sig) out.push(sig);
    }
    return out;
  }
}
