// =============================================================================
// SURGE v3 — Trailing Stop Engine
// 4 modes: ATR | Swing | LiqDraw | BEthenTrail
// =============================================================================

import type { OHLCV, TrailMode } from "../../types/index.js";
import { lowestLow, highestHigh } from "../utils/indicators.js";

export interface TrailConfig {
  mode:        TrailMode;
  atrMult:     number;
  swingLen:    number;
  liqBuffer:   number;   // % buffer on liq draw trail
  beTriggerR:  number;   // R at which to move to breakeven
}

export const DEFAULT_TRAIL: TrailConfig = {
  mode: "LiqDraw", atrMult: 2.0, swingLen: 5, liqBuffer: 0.05, beTriggerR: 1.0,
};

export interface TrailState {
  isLong:      boolean;
  entryPrice:  number;
  slDist:      number;
  currentStop: number;
  peakPrice:   number;
  beTriggered: boolean;
  barsHeld:    number;
}

export interface TrailUpdate {
  newStop:     number;
  stopHit:     boolean;
  exitPrice?:  number;
  pnlR?:       number;
  reason:      string;
}

export class TrailingStopEngine {
  private cfg:   TrailConfig;
  private state: TrailState | null = null;

  constructor(cfg: TrailConfig = DEFAULT_TRAIL) { this.cfg = cfg; }

  get active() { return this.state !== null; }
  get stop()   { return this.state?.currentStop ?? NaN; }

  open(p: { isLong: boolean; entryPrice: number; sl: number; slDist: number }) {
    this.state = {
      isLong: p.isLong, entryPrice: p.entryPrice, slDist: p.slDist,
      currentStop: p.sl, peakPrice: p.entryPrice, beTriggered: false, barsHeld: 0,
    };
  }

  update(bars: OHLCV[], i: number, curATR: number): TrailUpdate {
    if (!this.state) throw new Error("no position");
    const s = this.state;
    const bar = bars[i];
    s.barsHeld++;

    s.peakPrice = s.isLong
      ? Math.max(s.peakPrice, bar.high)
      : Math.min(s.peakPrice, bar.low);

    let newStop = s.currentStop;

    switch (this.cfg.mode) {
      case "ATR": {
        const trail = (isNaN(curATR) ? s.slDist : curATR) * this.cfg.atrMult;
        newStop = s.isLong
          ? Math.max(s.currentStop, s.peakPrice - trail)
          : Math.min(s.currentStop, s.peakPrice + trail);
        break;
      }
      case "Swing": {
        newStop = s.isLong
          ? Math.max(s.currentStop, lowestLow(bars,  this.cfg.swingLen, i))
          : Math.min(s.currentStop, highestHigh(bars, this.cfg.swingLen, i));
        break;
      }
      case "LiqDraw": {
        // Hug structure at 2× swing depth; only stops on structural violation
        const buf = this.cfg.liqBuffer / 100;
        newStop = s.isLong
          ? Math.max(s.currentStop, lowestLow(bars,  this.cfg.swingLen * 2, i) * (1 - buf))
          : Math.min(s.currentStop, highestHigh(bars, this.cfg.swingLen * 2, i) * (1 + buf));
        break;
      }
      case "BEthenTrail": {
        const gainR = s.isLong
          ? (bar.high - s.entryPrice) / s.slDist
          : (s.entryPrice - bar.low)  / s.slDist;
        if (!s.beTriggered && gainR >= this.cfg.beTriggerR) {
          newStop       = s.entryPrice;
          s.beTriggered = true;
        }
        if (s.beTriggered) {
          const trail = (isNaN(curATR) ? s.slDist : curATR) * this.cfg.atrMult;
          newStop = s.isLong
            ? Math.max(s.currentStop, s.peakPrice - trail)
            : Math.min(s.currentStop, s.peakPrice + trail);
        }
        break;
      }
    }

    // Ratchet — stop can only move in favour
    s.currentStop = s.isLong ? Math.max(s.currentStop, newStop) : Math.min(s.currentStop, newStop);

    const hit = s.isLong ? bar.low <= s.currentStop : bar.high >= s.currentStop;
    if (hit) {
      const exitPx = s.currentStop;
      const raw    = s.isLong ? exitPx - s.entryPrice : s.entryPrice - exitPx;
      const pnlR   = raw / s.slDist;
      const reason = s.beTriggered ? "TS-BE" : pnlR < 0 ? "SL" : "TS";
      this.state   = null;
      return { newStop: s.currentStop, stopHit: true, exitPrice: exitPx, pnlR, reason };
    }

    const reason = this.cfg.mode === "BEthenTrail" && s.beTriggered ? "TS-ATR(postBE)" : this.cfg.mode;
    return { newStop: s.currentStop, stopHit: false, reason };
  }

  close() { this.state = null; }
}
