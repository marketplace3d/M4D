// =============================================================================
// SURGE v3 — SMC Engine
//
// ARCHITECTURE CONTRACT:
//   BOS/CHoCH  = structural LABELS, never entry triggers
//               → logged to StructureEvent[], fed to arbitrator as context
//               → ENTRY is always on the RETEST (BRK engine handles that)
//   LiqSweep   = high-quality reversal setup when close rejects back
//   OB S&F     = wick through OB + close back inside = institutional entry
//   FVG        = imbalance zone, fills tracked, used as TP magnet
//
// Output: SMCState per bar — consumed by FusedEngine + Arbitrator
// =============================================================================

import { nanoid }    from "nanoid";
import type {
  OHLCV, Direction, StructureEvent, StructureEventType,
  LiqLevel, LiqSweep, OrderBlock, FVG, SMCSignal, SignalDir,
} from "../../types/index.js";
import {
  atr, ema, rollingHigh, rollingLow,
  swingPivots, confirmedSwingsAt, lowestLow, highestHigh,
  type SwingPivot,
} from "../utils/indicators.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface SMCConfig {
  swingLeft:      number;   // pivot left bars (5)
  swingRight:     number;   // pivot right bars — determines confirmation lag
                            // LOWER = less lag but more noise
                            // Set to 2-3 for aggressive, 5 for conservative
  liqEqualPct:   number;   // equal H/L tolerance % (0.05)
  liqLookback:   number;   // bars to look for equal levels (30)
  obLookback:    number;   // bars to search for OB candle (20)
  obMinImpulsePct: number; // min impulse % to qualify OB (0.3)
  fvgMinPct:     number;   // min FVG size as % of price (0.05)
  atrLen:        number;
  ema200Len:     number;
  slAtrMult:     number;
  tp1RR:         number;
  tp2RR:         number;
}

export const DEFAULT_SMC_CONFIG: SMCConfig = {
  swingLeft:       5,
  swingRight:      3,     // 3-bar confirmation — faster than Pine's default 10
  liqEqualPct:    0.05,
  liqLookback:    30,
  obLookback:     20,
  obMinImpulsePct: 0.3,
  fvgMinPct:      0.05,
  atrLen:         14,
  ema200Len:      200,
  slAtrMult:      1.5,
  tp1RR:          2.0,
  tp2RR:          5.0,
};

// ─── Per-bar SMC state (immutable snapshot) ───────────────────────────────────

export interface SMCState {
  barIndex:       number;
  ts:             number;
  trendBull:      boolean | null;

  // Latest events (null if nothing fired this bar)
  newBOS:         StructureEvent | null;
  newCHoCH:       StructureEvent | null;
  newLiqSweep:    LiqSweep | null;
  newOBSweepFill: OrderBlock | null;
  newFVG:         FVG | null;

  // Running state (accumulated)
  allStructure:   StructureEvent[];
  activeLiq:      LiqLevel[];
  activeOBs:      OrderBlock[];
  activeFVGs:     FVG[];
  allSweeps:      LiqSweep[];

  // Composite score for this bar (-100..+100)
  smcScore:       number;
  normScore:      number;   // 0-100
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class SMCEngine {
  private cfg: SMCConfig;

  // Precomputed series
  private _atr:      number[] = [];
  private _ema200:   number[] = [];
  private _rHigh:    number[] = [];   // rolling high (no current bar)
  private _rLow:     number[] = [];
  private _pivots:   SwingPivot[] = [];

  // Mutable state (accumulated across bars)
  private _structure:  StructureEvent[] = [];
  private _liqLevels:  LiqLevel[]       = [];
  private _sweeps:     LiqSweep[]       = [];
  private _obs:        OrderBlock[]     = [];
  private _fvgs:       FVG[]            = [];
  private _trendBull:  boolean | null   = null;

  constructor(cfg: SMCConfig = DEFAULT_SMC_CONFIG) {
    this.cfg = cfg;
  }

  // ─── Batch run ──────────────────────────────────────────────────────────
  runBatch(bars: OHLCV[], ticker: string, tf: string): SMCState[] {
    this._reset();
    this._precompute(bars);
    const states: SMCState[] = [];
    const minBar = Math.max(this.cfg.ema200Len, this.cfg.swingLeft + this.cfg.swingRight + 1);
    for (let i = minBar; i < bars.length; i++) {
      states.push(this._processBar(bars, i, ticker, tf));
    }
    return states;
  }

  /** Incremental tick for live mode */
  tick(bars: OHLCV[], ticker: string, tf: string): SMCState | null {
    this._precompute(bars);
    const i = bars.length - 1;
    const minBar = Math.max(this.cfg.ema200Len, this.cfg.swingLeft + this.cfg.swingRight + 1);
    if (i < minBar) return null;
    return this._processBar(bars, i, ticker, tf);
  }

  // ─── Precompute ─────────────────────────────────────────────────────────
  private _precompute(bars: OHLCV[]) {
    this._atr    = atr(bars, this.cfg.atrLen);
    this._ema200 = ema(bars.map(b => b.close), this.cfg.ema200Len);
    this._rHigh  = rollingHigh(bars, this.cfg.liqLookback);
    this._rLow   = rollingLow(bars,  this.cfg.liqLookback);
    // Pivots pre-confirmed — confBar indexed, so no lookahead at runtime
    this._pivots = swingPivots(bars, this.cfg.swingLeft, this.cfg.swingRight);
  }

  private _reset() {
    this._structure = []; this._liqLevels = []; this._sweeps = [];
    this._obs = []; this._fvgs = []; this._trendBull = null;
  }

  // ─── Per-bar processing ─────────────────────────────────────────────────
  private _processBar(bars: OHLCV[], i: number, ticker: string, tf: string): SMCState {
    const bar    = bars[i];
    const curATR = this._atr[i];
    const curEMA = this._ema200[i];

    if (!isNaN(curEMA)) this._trendBull = bar.close > curEMA;

    let newBOS:        StructureEvent | null = null;
    let newCHoCH:      StructureEvent | null = null;
    let newLiqSweep:   LiqSweep | null       = null;
    let newOBSF:       OrderBlock | null     = null;
    let newFVG:        FVG | null            = null;

    // ── [1] Structure: BOS / CHoCH ────────────────────────────────────────
    // Get last 2 confirmed swing highs + lows available at bar i (no lookahead)
    const confHighs = confirmedSwingsAt(this._pivots, i, "HIGH", 3);
    const confLows  = confirmedSwingsAt(this._pivots, i, "LOW",  3);

    if (confHighs.length >= 2 && confLows.length >= 2) {
      const prevHigh = confHighs[confHighs.length - 2];
      const prevLow  = confLows [confLows.length  - 2];

      // Bull BOS / CHoCH: close above previous confirmed HIGH
      if (bar.close > prevHigh.price) {
        const isBOS   = this._trendBull === true;
        const isCHoCH = this._trendBull === false;
        const type: StructureEventType = isCHoCH ? "CHOCH_BULL" : "BOS_BULL";
        const ev: StructureEvent = {
          id: nanoid(6), type, ts: bar.ts, barIndex: i,
          level: prevHigh.price, breakClose: bar.close, confirmed: false,
        };
        this._structure.push(ev);
        if (this._trendBull !== true) newCHoCH = ev;
        else                          newBOS   = ev;
        this._trendBull = true;
      }

      // Bear BOS / CHoCH: close below previous confirmed LOW
      if (bar.close < prevLow.price) {
        const isCHoCH = this._trendBull === true;
        const type: StructureEventType = isCHoCH ? "CHOCH_BEAR" : "BOS_BEAR";
        const ev: StructureEvent = {
          id: nanoid(6), type, ts: bar.ts, barIndex: i,
          level: prevLow.price, breakClose: bar.close, confirmed: false,
        };
        this._structure.push(ev);
        if (this._trendBull !== false) newCHoCH = ev;
        else                           newBOS   = ev;
        this._trendBull = false;
      }
    }

    // ── [2] Liquidity levels (BSL/SSL from equal highs/lows) ─────────────
    // Identify equal highs (BSL) and equal lows (SSL) in confirmed swings
    if (confHighs.length >= 2) {
      for (let a = 0; a < confHighs.length - 1; a++) {
        for (let b = a + 1; b < confHighs.length; b++) {
          const h1 = confHighs[a].price, h2 = confHighs[b].price;
          if (Math.abs(h1 - h2) / h2 <= this.cfg.liqEqualPct / 100) {
            const lvl = Math.max(h1, h2);
            if (!this._liqLevels.some(l => l.type === "BSL" && Math.abs(l.price - lvl) / lvl < 0.001)) {
              this._liqLevels.push({ id: nanoid(6), type: "BSL", price: lvl,
                ts: bar.ts, barIndex: i, swept: false });
            }
          }
        }
      }
    }
    if (confLows.length >= 2) {
      for (let a = 0; a < confLows.length - 1; a++) {
        for (let b = a + 1; b < confLows.length; b++) {
          const l1 = confLows[a].price, l2 = confLows[b].price;
          if (Math.abs(l1 - l2) / l2 <= this.cfg.liqEqualPct / 100) {
            const lvl = Math.min(l1, l2);
            if (!this._liqLevels.some(l => l.type === "SSL" && Math.abs(l.price - lvl) / lvl < 0.001)) {
              this._liqLevels.push({ id: nanoid(6), type: "SSL", price: lvl,
                ts: bar.ts, barIndex: i, swept: false });
            }
          }
        }
      }
    }

    // Cap liquidity levels to most recent 10
    if (this._liqLevels.length > 10) this._liqLevels = this._liqLevels.slice(-10);

    // ── [3] Liquidity sweep detection ─────────────────────────────────────
    for (const liq of this._liqLevels) {
      if (liq.swept) continue;
      if (liq.type === "BSL" && bar.high > liq.price && bar.close < liq.price) {
        // Wick above BSL, closed below → stop hunt + rejection
        liq.swept = true; liq.sweepBar = i; liq.sweepClose = bar.close;
        const sweep: LiqSweep = {
          id: nanoid(6), liqId: liq.id, type: "BSL",
          level: liq.price, wickThrough: bar.high - liq.price,
          closeBack: liq.price - bar.close, ts: bar.ts, barIndex: i, reversal: true,
        };
        this._sweeps.push(sweep);
        newLiqSweep = sweep;
      }
      if (liq.type === "SSL" && bar.low < liq.price && bar.close > liq.price) {
        liq.swept = true; liq.sweepBar = i; liq.sweepClose = bar.close;
        const sweep: LiqSweep = {
          id: nanoid(6), liqId: liq.id, type: "SSL",
          level: liq.price, wickThrough: liq.price - bar.low,
          closeBack: bar.close - liq.price, ts: bar.ts, barIndex: i, reversal: true,
        };
        this._sweeps.push(sweep);
        newLiqSweep = sweep;
      }
    }

    // ── [4] Order Block engine ────────────────────────────────────────────
    // Detect impulse moves → find last opposing candle before impulse → OB
    const impulseThresh = this.cfg.obMinImpulsePct / 100;

    // 3-bar momentum burst
    if (i >= 3) {
      const bullImpulse = (bar.close - bars[i-3].close) / bars[i-3].close > impulseThresh
        && bar.close > bar.open && bars[i-1].close > bars[i-1].open;
      const bearImpulse = (bars[i-3].close - bar.close) / bars[i-3].close > impulseThresh
        && bar.close < bar.open && bars[i-1].close < bars[i-1].open;

      if (bullImpulse) {
        for (let k = 1; k <= Math.min(this.cfg.obLookback, i); k++) {
          if (bars[i-k].close < bars[i-k].open) {
            const ob: OrderBlock = {
              id: nanoid(6), direction: "BULL",
              top: bars[i-k].open, bottom: bars[i-k].close,
              barIndex: i-k, ts: bars[i-k].ts,
              impulseSize: (bar.close - bars[i-3].close) / bars[i-3].close * 100,
              mitigated: false, mitPct: 0, sweepFill: false,
            };
            this._obs.push(ob);
            break;
          }
        }
      }
      if (bearImpulse) {
        for (let k = 1; k <= Math.min(this.cfg.obLookback, i); k++) {
          if (bars[i-k].close > bars[i-k].open) {
            const ob: OrderBlock = {
              id: nanoid(6), direction: "BEAR",
              top: bars[i-k].close, bottom: bars[i-k].open,
              barIndex: i-k, ts: bars[i-k].ts,
              impulseSize: (bars[i-3].close - bar.close) / bars[i-3].close * 100,
              mitigated: false, mitPct: 0, sweepFill: false,
            };
            this._obs.push(ob);
            break;
          }
        }
      }
    }

    // OB mitigation tracking + sweep-and-fill detection
    if (this._obs.length > 12) this._obs = this._obs.slice(-12);
    for (const ob of this._obs) {
      if (ob.mitigated) continue;
      const range = ob.top - ob.bottom;
      if (ob.direction === "BULL") {
        if (bar.low <= ob.top) {
          const pen   = Math.max(0, ob.top - bar.low);
          ob.mitPct   = Math.min(100, pen / range * 100);
          // Sweep-and-fill: wick below OB bottom, close back inside OB
          if (bar.low < ob.bottom && bar.close > ob.bottom && !ob.sweepFill) {
            ob.sweepFill = true; ob.sweepFillBar = i;
            newOBSF = ob;
          }
          if (bar.close < ob.bottom) ob.mitigated = true;
        }
      } else {
        if (bar.high >= ob.bottom) {
          const pen   = Math.max(0, bar.high - ob.bottom);
          ob.mitPct   = Math.min(100, pen / range * 100);
          if (bar.high > ob.top && bar.close < ob.top && !ob.sweepFill) {
            ob.sweepFill = true; ob.sweepFillBar = i;
            newOBSF = ob;
          }
          if (bar.close > ob.top) ob.mitigated = true;
        }
      }
    }

    // ── [5] FVG engine ────────────────────────────────────────────────────
    // 3-candle imbalance: bull FVG = bars[i].low > bars[i-2].high
    if (i >= 2) {
      const bullFVGSize = bar.low - bars[i-2].high;
      const bearFVGSize = bars[i-2].low - bar.high;

      if (bullFVGSize > 0 && bullFVGSize / bar.close * 100 >= this.cfg.fvgMinPct) {
        const fvg: FVG = {
          id: nanoid(6), direction: "BULL",
          top: bar.low, bottom: bars[i-2].high,
          size: bullFVGSize, sizePct: bullFVGSize / bar.close * 100,
          barIndex: i - 1, ts: bars[i-1].ts, fillPct: 0, filled: false,
        };
        this._fvgs.push(fvg);
        newFVG = fvg;
      }
      if (bearFVGSize > 0 && bearFVGSize / bar.close * 100 >= this.cfg.fvgMinPct) {
        const fvg: FVG = {
          id: nanoid(6), direction: "BEAR",
          top: bars[i-2].low, bottom: bar.high,
          size: bearFVGSize, sizePct: bearFVGSize / bar.close * 100,
          barIndex: i - 1, ts: bars[i-1].ts, fillPct: 0, filled: false,
        };
        this._fvgs.push(fvg);
        newFVG = fvg;
      }
    }

    // FVG fill tracking
    if (this._fvgs.length > 20) this._fvgs = this._fvgs.slice(-20);
    for (const fvg of this._fvgs) {
      if (fvg.filled) continue;
      const range = fvg.top - fvg.bottom;
      if (range <= 0) continue;
      if (fvg.direction === "BULL" && bar.low <= fvg.top) {
        fvg.fillPct = Math.min(100, (fvg.top - bar.low) / range * 100);
        if (bar.close < fvg.bottom) fvg.filled = true;
      } else if (fvg.direction === "BEAR" && bar.high >= fvg.bottom) {
        fvg.fillPct = Math.min(100, (bar.high - fvg.bottom) / range * 100);
        if (bar.close > fvg.top) fvg.filled = true;
      }
    }

    // ── [6] Score synthesis ───────────────────────────────────────────────
    // Component weights — CHoCH + OB S&F highest, FVG lowest
    let score = 0;
    if (newCHoCH)    score += newCHoCH.type.includes("BULL") ? 25 : -25;
    else if (newBOS) score += newBOS.type.includes("BULL")   ? 15 : -15;
    if (newOBSF)     score += newOBSF.direction === "BULL"   ? 25 : -25;
    if (newLiqSweep) score += newLiqSweep.type === "SSL"     ? 20 : -20;
    if (newFVG)      score += newFVG.direction === "BULL"    ?  5 : -5;
    if (this._trendBull !== null) score += this._trendBull   ?  5 : -5;

    const clamped = Math.max(-100, Math.min(100, score));
    const norm    = (clamped + 100) / 2;

    return {
      barIndex: i, ts: bar.ts,
      trendBull: this._trendBull,
      newBOS, newCHoCH, newLiqSweep, newOBSF, newFVG,
      allStructure:  [...this._structure],
      activeLiq:     this._liqLevels.filter(l => !l.swept),
      activeOBs:     this._obs.filter(o => !o.mitigated),
      activeFVGs:    this._fvgs.filter(f => !f.filled),
      allSweeps:     [...this._sweeps],
      smcScore:      clamped,
      normScore:     norm,
    };
  }

  // ─── Build SMCSignal from state (called by FusedEngine) ─────────────────
  toSignal(state: SMCState, bar: OHLCV, ticker: string, tf: string): SMCSignal | null {
    const clamped = state.smcScore;
    const signal: SignalDir = clamped >= 40 ? "LONG" : clamped <= -40 ? "SHORT" : "HOLD";
    const conf = Math.abs(clamped);

    const curATR = this._atr[state.barIndex];
    if (isNaN(curATR)) return null;

    // SL/TP from nearest active OB or ATR fallback
    let sl: number, tp1: number, tp2: number;
    if (signal === "LONG") {
      const nearOB = state.activeOBs.filter(o => o.direction === "BULL").slice(-1)[0];
      sl  = nearOB ? nearOB.bottom : bar.close - curATR * this.cfg.slAtrMult;
      const dist = bar.close - sl;
      tp1 = bar.close + dist * this.cfg.tp1RR;
      tp2 = bar.close + dist * this.cfg.tp2RR;
    } else if (signal === "SHORT") {
      const nearOB = state.activeOBs.filter(o => o.direction === "BEAR").slice(-1)[0];
      sl  = nearOB ? nearOB.top : bar.close + curATR * this.cfg.slAtrMult;
      const dist = sl - bar.close;
      tp1 = bar.close - dist * this.cfg.tp1RR;
      tp2 = bar.close - dist * this.cfg.tp2RR;
    } else {
      return null;
    }

    return {
      source: "SURGE_SMC", id: nanoid(8),
      ts: bar.ts, ticker, tf, signal, confidence: conf,
      smcScore: clamped,
      bosType:     state.newBOS?.type   ?? null,
      chochType:   state.newCHoCH?.type ?? null,
      liqSweep:    state.newLiqSweep,
      obSweepFill: state.newOBSF,
      fvgDetected: state.newFVG,
      trendBull:   state.trendBull ?? false,
      entry: bar.close, sl, tp1, tp2, atr: curATR,
    };
  }
}
