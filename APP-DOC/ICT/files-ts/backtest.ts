// =============================================================================
// SURGE — Backtest Harness
// Runs BRK engine + trailing stop simulation + alpha metrics
// on raw crypto OHLCV arrays (Binance / CCXT format)
// =============================================================================

import { nanoid }           from "nanoid";
import type {
  OHLCV, BRKConfig, TradeRecord, PerformanceMetrics,
} from "../../types/index.js";
import { BRKEngine }         from "../signals/brkEngine.js";
import { TrailingStopEngine } from "../execution/trailingStop.js";
import type { RetestEntry }   from "../execution/trailingStop.js";
import { calcMetrics, printMetrics, gradeMetrics } from "../metrics/alphaMetrics.js";
import { atr as calcATR }    from "../utils/indicators.js";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface BacktestConfig {
  brkConfig:        BRKConfig;
  initialCapital:   number;
  riskPctPerTrade:  number;     // % equity risked per trade
  commissionPct:    number;     // e.g. 0.05 for 0.05% Binance futures
  slippagePct:      number;     // e.g. 0.02
  maxConcurrent:    number;
  tf:               string;
  ticker:           string;
}

// ─── Open position tracker ────────────────────────────────────────────────────

interface OpenPosition {
  id:        string;
  entryBar:  number;
  entry:     RetestEntry;
  engine:    TrailingStopEngine;
  tp1Hit:    boolean;
  tp1Bars:   number;           // bar when TP1 was hit
  size:      number;           // $ position size
  riskAmt:   number;           // $ risk on this trade
}

// ─── Backtest runner ──────────────────────────────────────────────────────────

export class Backtest {
  private cfg: BacktestConfig;

  constructor(cfg: BacktestConfig) {
    this.cfg = cfg;
  }

  run(bars: OHLCV[]): BacktestResult {
    const { brkConfig, initialCapital, riskPctPerTrade,
            commissionPct, slippagePct, maxConcurrent, tf, ticker } = this.cfg;

    const atrSeries  = calcATR(bars, brkConfig.atrLen);
    const brkEngine  = new BRKEngine(brkConfig);
    (brkEngine as any)._precompute(bars);

    let equity       = initialCapital;
    const closedTrades: TradeRecord[] = [];
    const openPositions: OpenPosition[] = [];

    for (let i = brkConfig.ema200Len; i < bars.length; i++) {
      const bar    = bars[i];
      const curATR = atrSeries[i];

      // ── Update existing positions ──────────────────────────────────────
      const toClose: string[] = [];

      for (const pos of openPositions) {
        // TP1 hit check
        if (!pos.tp1Hit) {
          const tp1Hit = pos.entry.isLong
            ? bar.high >= pos.entry.tp1
            : bar.low  <= pos.entry.tp1;
          if (tp1Hit) {
            pos.tp1Hit  = true;
            pos.tp1Bars = i;
            pos.engine.markTP1Hit();
          }
        }

        const update = pos.engine.update(bars, i, Number.isFinite(curATR) ? curATR : undefined);

        if (update.stopHit) {
          // Apply slippage on stop exit
          const slip      = pos.entry.isLong ? -slippagePct/100 : slippagePct/100;
          const fillPrice = (update.exitPrice ?? pos.engine.currentStop) * (1 + slip);
          const rawPnl    = pos.entry.isLong
            ? fillPrice - pos.entry.entry
            : pos.entry.entry - fillPrice;
          const pnlPct    = rawPnl / pos.entry.entry * 100;
          const pnlAbs    = rawPnl * (pos.riskAmt / pos.entry.slDist);
          const commission = Math.abs(pnlAbs) * commissionPct / 100;

          const trade: TradeRecord = {
            id:            pos.id,
            ticker,
            direction:     pos.entry.isLong ? "BULL" : "BEAR",
            entryTs:       bars[pos.entryBar].ts,
            exitTs:        bar.ts,
            entryPrice:    pos.entry.entry,
            exitPrice:     fillPrice,
            sl:            pos.entry.sl,
            tp1:           pos.entry.tp1,
            tp2:           pos.entry.tp2,
            pnlR:          update.pnlR ?? rawPnl / pos.entry.slDist,
            pnlPct,
            pnlAbs:        pnlAbs - commission,
            maxFavorable:  0,   // MFE tracked separately if needed
            maxAdverse:    0,
            barsHeld:      i - pos.entryBar,
            exitReason:    update.reason.includes("TP") ? "TP2"
                           : update.reason.includes("BE") ? "TS"
                           : update.pnlR !== undefined && update.pnlR < 0 ? "SL" : "TS",
            trailMode:     brkConfig.trailMode,
            pattern:       "None",
            breakQuality:  "CLEAN",
          };

          equity     += trade.pnlAbs;
          closedTrades.push(trade);
          toClose.push(pos.id);
          continue; // prevent double-close on same bar (e.g. TP2 after stop hit)
        }

        // TP2 hit
        const tp2Hit = pos.entry.isLong
          ? bar.high >= pos.entry.tp2
          : bar.low  <= pos.entry.tp2;

        if (tp2Hit) {
          const fillPrice = pos.entry.tp2;
          const rawPnl    = pos.entry.isLong
            ? fillPrice - pos.entry.entry
            : pos.entry.entry - fillPrice;
          const pnlAbs = rawPnl * (pos.riskAmt / pos.entry.slDist);
          const commission = Math.abs(pnlAbs) * commissionPct / 100;

          const trade: TradeRecord = {
            id:           pos.id + "_tp2",
            ticker,
            direction:    pos.entry.isLong ? "BULL" : "BEAR",
            entryTs:      bars[pos.entryBar].ts,
            exitTs:       bar.ts,
            entryPrice:   pos.entry.entry,
            exitPrice:    fillPrice,
            sl:           pos.entry.sl, tp1: pos.entry.tp1, tp2: pos.entry.tp2,
            pnlR:         rawPnl / pos.entry.slDist,
            pnlPct:       rawPnl / pos.entry.entry * 100,
            pnlAbs:       pnlAbs - commission,
            maxFavorable: 0, maxAdverse: 0,
            barsHeld:     i - pos.entryBar,
            exitReason:   "TP2",
            trailMode:    brkConfig.trailMode,
            pattern:      "None",
            breakQuality: "CLEAN",
          };
          equity += trade.pnlAbs;
          closedTrades.push(trade);
          toClose.push(pos.id);
        }
      }

      // Remove closed positions
      for (const id of toClose) {
        const idx = openPositions.findIndex(p => p.id === id);
        if (idx >= 0) openPositions.splice(idx, 1);
      }

      // ── Check for new BRK signal ────────────────────────────────────────
      if (openPositions.length < maxConcurrent) {
        const signal = brkEngine["_processBar"](bars, i, ticker, tf);
        if (signal && signal.signal !== "HOLD") {
          const isLong   = signal.signal === "LONG";
          const riskAmt  = equity * (riskPctPerTrade / 100);
          const slDist   = Math.abs(signal.entry - signal.sl);

          if (slDist > 0 && signal.rrRatio >= brkConfig.minRR) {
            // Position size: risk amount / SL distance (in $ terms per unit)
            const size = riskAmt / slDist;

            const engine = new TrailingStopEngine(brkConfig);
            engine.open({
              isLong,
              entryPrice: signal.entry,
              sl:         signal.sl,
              slDist,
            });

            const pos: OpenPosition = {
              id:       nanoid(8),
              entryBar: i,
              entry: {
                isLong,
                entry:  signal.entry,
                sl:     signal.sl,
                slDist,
                tp1:    signal.tp1,
                tp2:    signal.tp2,
              },
              engine,
              tp1Hit:   false,
              tp1Bars:  -1,
              size,
              riskAmt,
            };
            openPositions.push(pos);
          }
        }
      }
    }

    // ── Force-close any open positions at last bar ────────────────────────
    for (const pos of openPositions) {
      const lastBar   = bars[bars.length - 1];
      const rawPnl    = pos.entry.isLong
        ? lastBar.close - pos.entry.entry
        : pos.entry.entry - lastBar.close;
      const pnlAbs    = rawPnl * (pos.riskAmt / pos.entry.slDist);
      const commission = Math.abs(pnlAbs) * commissionPct / 100;

      closedTrades.push({
        id:           pos.id + "_eod",
        ticker,
        direction:    pos.entry.isLong ? "BULL" : "BEAR",
        entryTs:      bars[pos.entryBar].ts,
        exitTs:       lastBar.ts,
        entryPrice:   pos.entry.entry,
        exitPrice:    lastBar.close,
        sl: pos.entry.sl, tp1: pos.entry.tp1, tp2: pos.entry.tp2,
        pnlR:         rawPnl / pos.entry.slDist,
        pnlPct:       rawPnl / pos.entry.entry * 100,
        pnlAbs:       pnlAbs - commission,
        maxFavorable: 0, maxAdverse: 0,
        barsHeld:     bars.length - 1 - pos.entryBar,
        exitReason:   "MANUAL",
        trailMode:    brkConfig.trailMode,
        pattern:      "None",
        breakQuality: "CLEAN",
      });
      equity += pnlAbs - commission;
    }

    const metrics = calcMetrics(closedTrades, initialCapital, tf);

    return {
      ticker,
      tf,
      config:    brkConfig,
      trades:    closedTrades,
      metrics,
      summary:   printMetrics(metrics, tf, ticker),
      grades:    gradeMetrics(metrics),
      finalEquity: equity,
    };
  }
}

// ─── Walk-forward wrapper ─────────────────────────────────────────────────────

export interface WFConfig {
  inSamplePct:  number;     // e.g. 0.70 = 70% in-sample
  numWindows:   number;     // number of OOS windows
}

export interface WFResult {
  windows:  Array<{ inSample: BacktestResult; outSample: BacktestResult }>;
  oos:      PerformanceMetrics;    // combined out-of-sample metrics
  stable:   boolean;               // Sharpe degradation < 40% IS→OOS
}

export function walkForward(
  bars:    OHLCV[],
  btCfg:   BacktestConfig,
  wfCfg:   WFConfig,
): WFResult {
  const windowSize = Math.floor(bars.length / wfCfg.numWindows);
  const results: WFResult["windows"] = [];
  const allOOSTrades: TradeRecord[] = [];

  for (let w = 0; w < wfCfg.numWindows; w++) {
    const start   = w * windowSize;
    const end     = start + windowSize;
    const split   = Math.floor(start + windowSize * wfCfg.inSamplePct);

    const inBars  = bars.slice(start, split);
    const oosBars = bars.slice(split, end);

    if (inBars.length < 200 || oosBars.length < 50) continue;

    const is  = new Backtest(btCfg).run(inBars);
    const oos = new Backtest(btCfg).run(oosBars);

    results.push({ inSample: is, outSample: oos });
    allOOSTrades.push(...oos.trades);
  }

  const combinedOOS = calcMetrics(
    allOOSTrades,
    btCfg.initialCapital,
    btCfg.tf,
  );

  // Stability: OOS Sharpe >= 60% of IS Sharpe avg
  const isAvgSharpe = results.reduce((s,r)=>s+r.inSample.metrics.sharpe,0) / results.length;
  const stable      = combinedOOS.sharpe >= isAvgSharpe * 0.60;

  return { windows: results, oos: combinedOOS, stable };
}

// ─── Result type ──────────────────────────────────────────────────────────────
export interface BacktestResult {
  ticker:      string;
  tf:          string;
  config:      BRKConfig;
  trades:      TradeRecord[];
  metrics:     PerformanceMetrics;
  summary:     string;
  grades:      Record<string, { value: number; grade: string; label: string }>;
  finalEquity: number;
}
