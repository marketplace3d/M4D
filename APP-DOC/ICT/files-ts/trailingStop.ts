// =============================================================================
// SURGE — Trailing Stop Engine
// Four modes: ATR | Swing | LiqDraw | BEthenTrail
// Runs on OHLCV bars — pure TS, no Pine
// =============================================================================

import type { OHLCV, BRKConfig, TrailState, TrailUpdate, TrailMode } from "../../types/index.js";
import { highestHigh, lowestLow } from "../utils/indicators.js";

export class TrailingStopEngine {
  private state: TrailState | null = null;
  private cfg:   BRKConfig;

  constructor(cfg: BRKConfig) {
    this.cfg = cfg;
  }

  get active(): boolean { return this.state !== null; }
  get currentStop(): number { return this.state?.currentStop ?? NaN; }
  get trailState(): TrailState | null { return this.state; }

  // ─── Open a new trade position ─────────────────────────────────────────────
  open(params: {
    isLong:      boolean;
    entryPrice:  number;
    sl:          number;
    slDist:      number;
    mode?:       TrailMode;
  }): void {
    this.state = {
      mode:          params.mode ?? this.cfg.trailMode,
      isLong:        params.isLong,
      entryPrice:    params.entryPrice,
      initialSL:     params.sl,
      slDist:        params.slDist,
      currentStop:   params.sl,
      peakPrice:     params.entryPrice,
      beTriggered:   false,
      tp1Hit:        false,
      barsInTrade:   0,
    };
  }

  // ─── Mark TP1 partially filled ─────────────────────────────────────────────
  markTP1Hit(): void {
    if (this.state) this.state.tp1Hit = true;
  }

  // ─── Update on each new bar — returns new stop level and exit event ─────────
  update(bars: OHLCV[], i: number, atrOverride?: number): TrailUpdate {
    if (!this.state) throw new Error("No active trade state");
    const s   = this.state;
    const bar = bars[i];
    s.barsInTrade++;

    // Update peak price
    if (s.isLong)  s.peakPrice = Math.max(s.peakPrice, bar.high);
    else           s.peakPrice = Math.min(s.peakPrice, bar.low);

    let newStop = s.currentStop;

    // ── ATR trail ─────────────────────────────────────────────────────────
    if (s.mode === "ATR") {
      // Need current ATR — derive from last bar range as fallback
      const trueRange = Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - bars[Math.max(0, i-1)].close),
        Math.abs(bar.low  - bars[Math.max(0, i-1)].close),
      );
      const atrApprox = Number.isFinite(atrOverride as number) ? (atrOverride as number) : trueRange;
      const trail     = this.cfg.trailAtrMult * atrApprox;

      if (s.isLong)  newStop = Math.max(s.currentStop, s.peakPrice - trail);
      else           newStop = Math.min(s.currentStop, s.peakPrice + trail);
    }

    // ── Swing trail ───────────────────────────────────────────────────────
    if (s.mode === "Swing") {
      const len = this.cfg.trailSwingLen;
      if (s.isLong) {
        const swLow  = lowestLow(bars, len, i);
        newStop = Math.max(s.currentStop, swLow);
      } else {
        const swHigh = highestHigh(bars, len, i);
        newStop = Math.min(s.currentStop, swHigh);
      }
    }

    // ── Liq Draw trail — rides to next liquidity pool ─────────────────────
    // Uses 2× swing len for wider context; buffer keeps stop outside noise
    if (s.mode === "LiqDraw") {
      const len    = this.cfg.trailSwingLen * 2;
      const buf    = this.cfg.trailLiqPct / 100;
      if (s.isLong) {
        const swLow  = lowestLow(bars, len, i);
        const trail  = swLow * (1 - buf);
        newStop = Math.max(s.currentStop, trail);
      } else {
        const swHigh = highestHigh(bars, len, i);
        const trail  = swHigh * (1 + buf);
        newStop = Math.min(s.currentStop, trail);
      }
    }

    // ── Breakeven-then-trail ──────────────────────────────────────────────
    if (s.mode === "BEthenTrail") {
      const gainR = s.isLong
        ? (bar.high - s.entryPrice) / s.slDist
        : (s.entryPrice - bar.low)  / s.slDist;

      // Move to breakeven when price reaches be_trigger_r
      if (!s.beTriggered && gainR >= this.cfg.beaTriggerR) {
        newStop      = s.entryPrice;
        s.beTriggered = true;
      }

      // After breakeven, switch to ATR trail
      if (s.beTriggered) {
        const trueRange = Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - bars[Math.max(0, i-1)].close),
          Math.abs(bar.low  - bars[Math.max(0, i-1)].close),
        );
        const atrLike = Number.isFinite(atrOverride as number) ? (atrOverride as number) : trueRange;
        const trail = this.cfg.trailAtrMult * atrLike;
        if (s.isLong)  newStop = Math.max(s.currentStop, s.peakPrice - trail);
        else           newStop = Math.min(s.currentStop, s.peakPrice + trail);
      }
    }

    // Enforce: stop can only move in favor (ratchet)
    if (s.isLong)  newStop = Math.max(s.currentStop, newStop);
    else           newStop = Math.min(s.currentStop, newStop);

    s.currentStop = newStop;

    // ── Stop hit check ────────────────────────────────────────────────────
    const stopHit = s.isLong ? bar.low <= newStop : bar.high >= newStop;

    if (stopHit) {
      // Assume fill at stop price (add slippage at execution layer)
      const exitPrice = newStop;
      const rawPnl    = s.isLong
        ? exitPrice - s.entryPrice
        : s.entryPrice - exitPrice;
      const pnlR = rawPnl / s.slDist;

      const reason = s.beTriggered ? "TrailStop(BE)"
        : pnlR < 0 ? "StopLoss"
        : "TrailStop";

      this.state = null;   // close position

      return { newStop, reason, stopHit: true, exitPrice, pnlR };
    }

    const reason = s.mode === "BEthenTrail" && s.beTriggered ? "ATR(postBE)"
      : s.mode;

    return { newStop, reason, stopHit: false };
  }

  // ─── Full trail simulation on closed trade bars (backtest util) ────────────
  static simulateTrail(
    bars:       OHLCV[],
    entryBar:   number,
    entry:      RetestEntry,
    cfg:        BRKConfig,
    atrSeries:  number[],
  ): TrailSimResult {
    const engine = new TrailingStopEngine({ ...cfg, trailMode: cfg.trailMode });
    engine.open({
      isLong:     entry.isLong,
      entryPrice: entry.entry,
      sl:         entry.sl,
      slDist:     entry.slDist,
    });

    let tp1Hit    = false;
    let exitBar   = -1;
    let exitPrice = entry.sl;
    let exitReason: string = "SL";
    let maxFavR   = 0;
    let maxAdvR   = 0;

    for (let i = entryBar + 1; i < bars.length; i++) {
      const bar    = bars[i];
      const curATR = atrSeries[i];

      // TP1 hit
      if (!tp1Hit) {
        const tp1Hit_ = entry.isLong
          ? bar.high >= entry.tp1
          : bar.low  <= entry.tp1;
        if (tp1Hit_) {
          tp1Hit = true;
          engine.markTP1Hit();
        }
      }

      // MFE / MAE
      const unrealR = entry.isLong
        ? (bar.high - entry.entry) / entry.slDist
        : (entry.entry - bar.low)  / entry.slDist;
      const adverR  = entry.isLong
        ? (entry.entry - bar.low)  / entry.slDist
        : (bar.high - entry.entry) / entry.slDist;

      maxFavR = Math.max(maxFavR, unrealR);
      maxAdvR = Math.max(maxAdvR, adverR);

      // Trail update
      const update = engine.update(bars, i, Number.isFinite(curATR) ? curATR : undefined);
      if (update.stopHit) {
        exitBar    = i;
        exitPrice  = update.exitPrice!;
        exitReason = update.reason;
        break;
      }

      // TP2 hit
      const tp2Hit = entry.isLong
        ? bar.high >= entry.tp2
        : bar.low  <= entry.tp2;
      if (tp2Hit) {
        exitBar    = i;
        exitPrice  = entry.tp2;
        exitReason = "TP2";
        break;
      }
    }

    // If never exited, mark last bar
    if (exitBar < 0) {
      exitBar    = bars.length - 1;
      exitPrice  = bars[exitBar].close;
      exitReason = "EndOfData";
    }

    const rawPnl = entry.isLong
      ? exitPrice - entry.entry
      : entry.entry - exitPrice;
    const pnlR   = rawPnl / entry.slDist;
    const pnlPct = rawPnl / entry.entry * 100;

    return {
      entryBar,
      exitBar,
      exitPrice,
      exitReason,
      pnlR,
      pnlPct,
      maxFavorableR: maxFavR,
      maxAdverseR:   maxAdvR,
      barsHeld:      exitBar - entryBar,
      tp1Hit,
    };
  }
}

// ─── Types used by simulateTrail ──────────────────────────────────────────────
export interface RetestEntry {
  isLong:     boolean;
  entry:      number;
  sl:         number;
  slDist:     number;
  tp1:        number;
  tp2:        number;
}

export interface TrailSimResult {
  entryBar:       number;
  exitBar:        number;
  exitPrice:      number;
  exitReason:     string;
  pnlR:           number;
  pnlPct:         number;
  maxFavorableR:  number;
  maxAdverseR:    number;
  barsHeld:       number;
  tp1Hit:         boolean;
}
