// =============================================================================
// SURGE — BRK Signal Engine (TypeScript)
// Real-time structure break detection + retest confirmation
// No Pine. No lag. Runs on raw OHLCV arrays.
// =============================================================================

import { nanoid }           from "nanoid";
import type {
  OHLCV, BRKSignal, BRKConfig, StructureBreak,
  RetestConfirmation, CandlePattern, BreakQuality,
} from "../../types/index.js";
import { atr, ema, rollingHigh, rollingLow,
         lowestLow, highestHigh, volSma } from "../utils/indicators.js";
import { bullPattern, bearPattern, patternStrength } from "../utils/patterns.js";

// ─── Internal pending-break buffer ────────────────────────────────────────────

interface PendingBreak {
  break_: StructureBreak;
  expiresAt: number;   // bar index
}

export class BRKEngine {
  private cfg: BRKConfig;

  // Computed series (updated on each call to update())
  private _atr:       number[] = [];
  private _ema200:    number[] = [];
  private _volSma:    number[] = [];
  private _rollHigh:  number[] = [];
  private _rollLow:   number[] = [];

  // State
  private pending:    PendingBreak[] = [];
  private lastBullLvl = NaN;
  private lastBearLvl = NaN;

  // Output
  public breaks:     StructureBreak[]       = [];
  public retests:    RetestConfirmation[]   = [];
  public signals:    BRKSignal[]            = [];

  constructor(cfg: BRKConfig) {
    this.cfg = cfg;
  }

  // ─── Full batch run (backtest mode) ────────────────────────────────────────
  runBatch(bars: OHLCV[], ticker: string, tf: string): BRKSignal[] {
    this.reset();
    this._precompute(bars);

    for (let i = this.cfg.ema200Len; i < bars.length; i++) {
      this._processBar(bars, i, ticker, tf);
    }
    return this.signals;
  }

  // ─── Single-bar incremental (live mode) ────────────────────────────────────
  tick(bars: OHLCV[], ticker: string, tf: string): BRKSignal | null {
    this._precompute(bars);
    const i = bars.length - 1;
    if (i < this.cfg.ema200Len) return null;
    return this._processBar(bars, i, ticker, tf);
  }

  reset() {
    this.pending     = [];
    this.breaks      = [];
    this.retests     = [];
    this.signals     = [];
    this.lastBullLvl = NaN;
    this.lastBearLvl = NaN;
  }

  // ─── Precompute indicators ──────────────────────────────────────────────────
  private _precompute(bars: OHLCV[]) {
    this._atr      = atr(bars,     this.cfg.atrLen);
    this._ema200   = ema(bars.map(b => b.close), this.cfg.ema200Len);
    this._volSma   = volSma(bars,  this.cfg.volumeAvgLen);
    this._rollHigh = rollingHigh(bars, this.cfg.rollingLookback);
    this._rollLow  = rollingLow (bars, this.cfg.rollingLookback);
  }

  // ─── Per-bar logic ─────────────────────────────────────────────────────────
  private _processBar(
    bars:   OHLCV[],
    i:      number,
    ticker: string,
    tf:     string,
  ): BRKSignal | null {
    const bar      = bars[i];
    const curATR   = this._atr[i];
    const curEMA   = this._ema200[i];
    const curVSma  = this._volSma[i];
    const rtH      = this._rollHigh[i];
    const rtL      = this._rollLow[i];

    if (isNaN(curATR) || isNaN(curEMA) || isNaN(rtH) || isNaN(rtL)) return null;

    const volOk    = !this.cfg.volumeConfirm || bar.volume > curVSma * this.cfg.volumeMult;
    const trendBull = !this.cfg.trendFilter  || bar.close > curEMA;
    const trendBear = !this.cfg.trendFilter  || bar.close < curEMA;

    // ── Structure break detection ──────────────────────────────────────────
    const breakPctBull = (bar.close - rtH) / rtH * 100;
    const breakPctBear = (rtL - bar.close) / rtL  * 100;

    const isBullBreak = breakPctBull >= this.cfg.minBreakPct && volOk && trendBull;
    const isBearBreak = breakPctBear >= this.cfg.minBreakPct && volOk && trendBear;

    // Deduplicate
    const newBull = isBullBreak && (isNaN(this.lastBullLvl) ||
                    Math.abs(rtH - this.lastBullLvl) / rtH > 0.001);
    const newBear = isBearBreak && (isNaN(this.lastBearLvl) ||
                    Math.abs(rtL - this.lastBearLvl) / rtL > 0.001);

    if (newBull) {
      this.lastBullLvl = rtH;
      const brk = this._makeBreak(bar, i, "BULL", rtH, breakPctBull, "CLEAN", volOk, trendBull);
      this.breaks.push(brk);
      this.pending.push({ break_: brk, expiresAt: i + this.cfg.retestBars });
    }

    if (newBear) {
      this.lastBearLvl = rtL;
      const brk = this._makeBreak(bar, i, "BEAR", rtL, breakPctBear, "CLEAN", volOk, trendBear);
      this.breaks.push(brk);
      this.pending.push({ break_: brk, expiresAt: i + this.cfg.retestBars });
    }

    // Expire stale pending breaks
    this.pending = this.pending.filter(p => p.expiresAt >= i && !p.break_.confirmed);

    // ── Retest detection ───────────────────────────────────────────────────
    for (const pb of this.pending) {
      const brk  = pb.break_;
      if (brk.confirmed) continue;

      const tol   = brk.level * (this.cfg.retestTolPct / 100);
      const prev  = bars[Math.max(0, i - 1)];
      let signal: BRKSignal | null = null;

      if (brk.direction === "BULL") {
        const touching    = bar.low  <= brk.level + tol && bar.high >= brk.level - tol;
        const closedAbove = bar.close > brk.level - tol;
        const pat         = bullPattern(bar, prev);
        const patOk       = !this.cfg.requirePattern || pat !== "None";

        if (touching && closedAbove && patOk) {
          const ret = this._calcEntry(bars, i, "BULL", brk, curATR, pat);
          if (ret && ret.rrRatio >= this.cfg.minRR) {
            brk.confirmed  = true;
            brk.retested   = true;
            this.retests.push(ret);
            signal = this._makeSignal(ticker, tf, bar, brk, ret, curATR, pat, trendBull);
          }
        }

      } else {
        const touching    = bar.high >= brk.level - tol && bar.low <= brk.level + tol;
        const closedBelow = bar.close < brk.level + tol;
        const pat         = bearPattern(bar, prev);
        const patOk       = !this.cfg.requirePattern || pat !== "None";

        if (touching && closedBelow && patOk) {
          const ret = this._calcEntry(bars, i, "BEAR", brk, curATR, pat);
          if (ret && ret.rrRatio >= this.cfg.minRR) {
            brk.confirmed  = true;
            brk.retested   = true;
            this.retests.push(ret);
            signal = this._makeSignal(ticker, tf, bar, brk, ret, curATR, pat, trendBear);
          }
        }
      }

      if (signal) {
        this.signals.push(signal);
        return signal;    // one signal per bar max
      }
    }

    return null;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  private _makeBreak(
    bar: OHLCV, i: number, dir: "BULL" | "BEAR",
    level: number, breakPct: number, quality: BreakQuality,
    volOk: boolean, trendOk: boolean,
  ): StructureBreak {
    return {
      id:               nanoid(8),
      ts:               bar.ts,
      barIndex:         i,
      direction:        dir,
      level,
      breakClose:       bar.close,
      breakPct,
      quality,
      volumeConfirmed:  volOk,
      trendAligned:     trendOk,
      retested:         false,
      confirmed:        false,
    };
  }

  private _calcEntry(
    bars: OHLCV[], i: number, dir: "BULL" | "BEAR",
    brk: StructureBreak, curATR: number, pat: CandlePattern,
  ): RetestConfirmation | null {
    const bar  = bars[i];
    const cfg  = this.cfg;

    let sl: number;
    if (dir === "BULL") {
      const swingRef = cfg.useSwingSL ? lowestLow(bars, cfg.trailSwingLen + 1, i) : Infinity;
      sl = Math.min(swingRef, bar.close - curATR * cfg.slAtrMult);
    } else {
      const swingRef = cfg.useSwingSL ? highestHigh(bars, cfg.trailSwingLen + 1, i) : -Infinity;
      sl = Math.max(swingRef, bar.close + curATR * cfg.slAtrMult);
    }

    const dist  = Math.abs(bar.close - sl);
    if (dist <= 0) return null;

    const tp1   = dir === "BULL" ? bar.close + dist * cfg.tp1RR : bar.close - dist * cfg.tp1RR;
    const tp2   = dir === "BULL" ? bar.close + dist * cfg.tp2RR : bar.close - dist * cfg.tp2RR;
    const rrRatio = dist > 0 ? (Math.abs(tp1 - bar.close)) / dist : 0;

    return {
      breakId:    brk.id,
      ts:         bar.ts,
      barIndex:   i,
      touchPrice: dir === "BULL" ? bar.low : bar.high,
      closePrice: bar.close,
      pattern:    pat,
      entry:      bar.close,
      sl,
      tp1,
      tp2,
      rrRatio,
      slDist:     dist,
    };
  }

  private _makeSignal(
    ticker: string, tf: string, bar: OHLCV,
    brk: StructureBreak, ret: RetestConfirmation,
    curATR: number, pat: CandlePattern, trendAligned: boolean,
  ): BRKSignal {
    // Confidence: break quality + pattern strength + trend alignment
    const patScore    = patternStrength(pat);
    const cleanBonus  = brk.quality === "CLEAN" ? 0.15 : 0;
    const trendBonus  = trendAligned ? 0.10 : 0;
    const volBonus    = brk.volumeConfirmed ? 0.10 : 0;
    const rrBonus     = Math.min(ret.rrRatio / 5, 0.15);
    const confidence  = Math.min(100,
      Math.round((patScore + cleanBonus + trendBonus + volBonus + rrBonus) * 100)
    );

    return {
      source:           "SURGE_BRK",
      alphaId:          "CONF-01",
      ts:               bar.ts,
      ticker,
      tf,
      signal:           brk.direction === "BULL" ? "LONG" : "SHORT",
      breakQuality:     brk.quality,
      breakLevel:       brk.level,
      pattern:          pat,
      entry:            ret.entry,
      sl:               ret.sl,
      tp1:              ret.tp1,
      tp2:              ret.tp2,
      rrRatio:          Math.round(ret.rrRatio * 100) / 100,
      atr:              curATR,
      volumeConfirmed:  brk.volumeConfirmed,
      trendAligned,
      confidence,
    };
  }
}
