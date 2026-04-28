// =============================================================================
// SURGE v3 — Backtest Harness
// Runs SMC + BRK + MOM → fused signal → trail sim → alpha metrics
// =============================================================================

import { nanoid }           from "nanoid";
import type {
  OHLCV, TradeRecord, PerformanceMetrics,
  FusedSignal, SignalDir,
} from "../../types/index.js";
import { SMCEngine, DEFAULT_SMC_CONFIG } from "../signals/smcEngine.js";
import type { SMCConfig }   from "../signals/smcEngine.js";
import { BRKEngine, DEFAULT_BRK_CONFIG } from "../signals/brkEngine.js";
import type { BRKConfig }   from "../signals/brkEngine.js";
import { MomGateEngine, DEFAULT_MOM_CONFIG } from "../signals/momGates.js";
import type { MomConfig }   from "../signals/momGates.js";
import { buildFusedSignal } from "../signals/fusedEngine.js";
import { TrailingStopEngine, DEFAULT_TRAIL } from "../execution/trailingStop.js";
import type { TrailConfig } from "../execution/trailingStop.js";
import { calcMetrics, printMetrics, gradeMetrics } from "./alphaMetrics.js";
import { atr as calcATR }   from "../utils/indicators.js";
import type { ExitReason }  from "../../types/index.js";

// ─── Backtest config ──────────────────────────────────────────────────────────

export interface BacktestConfig {
  smcCfg:          SMCConfig;
  brkCfg:          BRKConfig;
  momCfg:          MomConfig;
  trailCfg:        TrailConfig;
  initialCapital:  number;
  riskPctPerTrade: number;   // % equity at risk per trade (e.g. 1.0)
  commissionPct:   number;   // taker fee e.g. 0.05
  slippagePct:     number;   // e.g. 0.02
  maxConcurrent:   number;
  tp1SizePct:      number;   // % of position closed at TP1 (e.g. 60)
  tf:              string;
  ticker:          string;
  minCompositeScore: number; // min fused score to enter (e.g. 55)
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  smcCfg:            DEFAULT_SMC_CONFIG,
  brkCfg:            DEFAULT_BRK_CONFIG,
  momCfg:            DEFAULT_MOM_CONFIG,
  trailCfg:          DEFAULT_TRAIL,
  initialCapital:    10000,
  riskPctPerTrade:   1.0,
  commissionPct:     0.05,
  slippagePct:       0.02,
  maxConcurrent:     2,
  tp1SizePct:        60,
  tf:                "1h",
  ticker:            "BTCUSDT",
  minCompositeScore: 55,
};

// ─── Open position ────────────────────────────────────────────────────────────

interface OpenPos {
  id:        string;
  entryBar:  number;
  isLong:    boolean;
  entry:     number;
  sl:        number;
  slDist:    number;
  tp1:       number;
  tp2:       number;
  tp1Hit:    boolean;
  engine:    TrailingStopEngine;
  riskAmt:   number;
  source:    "SMC"|"BRK"|"FUSED";
}

// ─── Backtest runner ──────────────────────────────────────────────────────────

export class Backtest {
  private cfg: BacktestConfig;

  constructor(cfg: Partial<BacktestConfig> = {}) {
    this.cfg = { ...DEFAULT_BACKTEST_CONFIG, ...cfg };
  }

  run(bars: OHLCV[]): BacktestResult {
    const { smcCfg, brkCfg, momCfg, trailCfg, initialCapital,
            riskPctPerTrade, commissionPct, slippagePct,
            maxConcurrent, tp1SizePct, tf, ticker, minCompositeScore } = this.cfg;

    // Precompute all engines
    const smcEngine = new SMCEngine(smcCfg);
    const brkEngine = new BRKEngine(brkCfg);
    const momEngine = new MomGateEngine(momCfg);
    const atrSeries = calcATR(bars, smcCfg.atrLen);

    const smcStates = smcEngine.runBatch(bars, ticker, tf);
    // Index smcStates by barIndex for O(1) lookup
    const smcByBar = new Map(smcStates.map(s => [s.barIndex, s]));

    brkEngine.precompute(bars);
    momEngine.precompute(bars);

    let equity    = initialCapital;
    const closed: TradeRecord[]  = [];
    const open:   OpenPos[]      = [];

    const minBar = Math.max(smcCfg.ema200Len, brkCfg.ema200Len,
                            brkCfg.rollingLookback + 1, 30);

    for (let i = minBar; i < bars.length; i++) {
      const bar    = bars[i];
      const curATR = atrSeries[i] ?? NaN;

      // ── Update open positions ───────────────────────────────────────────
      const toClose: string[] = [];

      for (const pos of open) {
        // TP1 partial
        if (!pos.tp1Hit) {
          const tp1Hit = pos.isLong ? bar.high >= pos.tp1 : bar.low <= pos.tp1;
          if (tp1Hit) {
            pos.tp1Hit = true;
            // Book partial PnL
            const tp1Frac  = tp1SizePct / 100;
            const raw      = pos.isLong ? pos.tp1 - pos.entry : pos.entry - pos.tp1;
            const pnlAbs   = raw * (pos.riskAmt / pos.slDist) * tp1Frac;
            const comm     = Math.abs(pnlAbs) * commissionPct / 100;
            equity         += pnlAbs - comm;
          }
        }

        // Trail update
        const upd = pos.engine.update(bars, i, curATR);
        if (upd.stopHit) {
          const slip     = pos.isLong ? -slippagePct/100 : slippagePct/100;
          const fillPx   = (upd.exitPrice ?? pos.sl) * (1 + slip);
          const raw      = pos.isLong ? fillPx - pos.entry : pos.entry - fillPx;
          const pnlAbs   = raw * (pos.riskAmt / pos.slDist) * (1 - tp1SizePct/100);
          const comm     = Math.abs(pnlAbs) * commissionPct / 100;
          equity        += pnlAbs - comm;

          const reason: ExitReason = upd.reason.includes("TP") ? "TP2"
            : upd.reason.includes("BE") ? "TS"
            : (upd.pnlR ?? 0) < 0 ? "SL" : "TS";

          closed.push({
            id: pos.id, ticker,
            direction: pos.isLong ? "BULL" : "BEAR",
            entryTs: bars[pos.entryBar].ts, exitTs: bar.ts,
            entryPrice: pos.entry, exitPrice: fillPx,
            sl: pos.sl, tp1: pos.tp1, tp2: pos.tp2,
            pnlR:  raw / pos.slDist,
            pnlPct: raw / pos.entry * 100,
            pnlAbs: pnlAbs - comm,
            maxFavorableR: 0, maxAdverseR: 0,
            barsHeld: i - pos.entryBar,
            exitReason: reason,
            trailMode: trailCfg.mode,
            pattern: "None",
            breakQuality: "CLEAN",
            source: pos.source,
          });
          toClose.push(pos.id);
        }

        // TP2 full exit
        const tp2Hit = pos.isLong ? bar.high >= pos.tp2 : bar.low <= pos.tp2;
        if (tp2Hit && !toClose.includes(pos.id)) {
          const fillPx  = pos.tp2;
          const raw     = pos.isLong ? fillPx - pos.entry : pos.entry - fillPx;
          const pnlAbs  = raw * (pos.riskAmt / pos.slDist) * (1 - tp1SizePct/100);
          const comm    = Math.abs(pnlAbs) * commissionPct / 100;
          equity       += pnlAbs - comm;
          closed.push({
            id: pos.id+"_tp2", ticker,
            direction: pos.isLong ? "BULL" : "BEAR",
            entryTs: bars[pos.entryBar].ts, exitTs: bar.ts,
            entryPrice: pos.entry, exitPrice: fillPx,
            sl: pos.sl, tp1: pos.tp1, tp2: pos.tp2,
            pnlR: raw/pos.slDist, pnlPct: raw/pos.entry*100,
            pnlAbs: pnlAbs-comm, maxFavorableR:0, maxAdverseR:0,
            barsHeld: i-pos.entryBar, exitReason:"TP2",
            trailMode: trailCfg.mode, pattern:"None",
            breakQuality:"CLEAN", source: pos.source,
          });
          toClose.push(pos.id);
        }
      }

      for (const id of toClose) {
        const idx = open.findIndex(p => p.id === id);
        if (idx >= 0) open.splice(idx, 1);
      }

      // ── Check for new fused signal ──────────────────────────────────────
      if (open.length >= maxConcurrent) continue;

      const smcState = smcByBar.get(i) ?? null;
      const brkSig   = brkEngine.processBar(bars, i, ticker, tf, smcState);
      const momGates = momEngine.gatesAt(bars, i);

      const smcSig = smcState ? smcEngine.toSignal(smcState, bar, ticker, tf) : null;

      const fused = buildFusedSignal({
        ticker, tf, bar, smc: smcState, brk: brkSig, mom: momGates,
      });

      if (!fused || fused.direction === "HOLD") continue;
      if (fused.compositeScore < minCompositeScore) continue;

      // Prefer BRK levels for execution (more precise entry/SL/TP)
      const execEntry = brkSig?.entry   ?? smcSig?.entry   ?? bar.close;
      const execSL    = brkSig?.sl      ?? smcSig?.sl;
      const execTP1   = brkSig?.tp1     ?? smcSig?.tp1;
      const execTP2   = brkSig?.tp2     ?? smcSig?.tp2;
      if (!execSL || !execTP1 || !execTP2) continue;

      const isLong   = fused.direction === "LONG";
      const slDist   = Math.abs(execEntry - execSL);
      if (slDist <= 0) continue;

      const riskAmt  = equity * (riskPctPerTrade / 100);
      const trailEng = new TrailingStopEngine(trailCfg);
      trailEng.open({ isLong, entryPrice: execEntry, sl: execSL, slDist });

      open.push({
        id: nanoid(8), entryBar: i, isLong,
        entry: execEntry, sl: execSL, slDist,
        tp1: execTP1, tp2: execTP2, tp1Hit: false,
        engine: trailEng, riskAmt,
        source: brkSig && smcSig ? "FUSED" : brkSig ? "BRK" : "SMC",
      });
    }

    // Force-close remaining
    for (const pos of open) {
      const last  = bars[bars.length - 1];
      const raw   = pos.isLong ? last.close - pos.entry : pos.entry - last.close;
      const pnlAbs = raw * (pos.riskAmt / pos.slDist);
      const comm   = Math.abs(pnlAbs) * commissionPct / 100;
      equity      += pnlAbs - comm;
      closed.push({
        id: pos.id+"_eod", ticker,
        direction: pos.isLong ? "BULL" : "BEAR",
        entryTs: bars[pos.entryBar].ts, exitTs: last.ts,
        entryPrice: pos.entry, exitPrice: last.close,
        sl: pos.sl, tp1: pos.tp1, tp2: pos.tp2,
        pnlR: raw/pos.slDist, pnlPct: raw/pos.entry*100,
        pnlAbs: pnlAbs-comm, maxFavorableR:0, maxAdverseR:0,
        barsHeld: bars.length-1-pos.entryBar, exitReason:"MANUAL",
        trailMode: trailCfg.mode, pattern:"None",
        breakQuality:"CLEAN", source: pos.source,
      });
    }

    const metrics = calcMetrics(closed, initialCapital, tf);
    return {
      ticker, tf, trades: closed, metrics,
      summary: printMetrics(metrics, tf, ticker),
      grades:  gradeMetrics(metrics),
      finalEquity: equity,
    };
  }
}

// ─── Walk-forward ─────────────────────────────────────────────────────────────

export function walkForward(
  bars: OHLCV[], cfg: BacktestConfig,
  opts: { inSamplePct: number; numWindows: number },
): WFResult {
  const wsz   = Math.floor(bars.length / opts.numWindows);
  const wins: WFResult["windows"] = [];
  const allOOS: TradeRecord[] = [];

  for (let w = 0; w < opts.numWindows; w++) {
    const start = w * wsz, end = start + wsz;
    const split = Math.floor(start + wsz * opts.inSamplePct);
    const isBars = bars.slice(start, split);
    const oosBars = bars.slice(split, end);
    if (isBars.length < 250 || oosBars.length < 60) continue;
    const is  = new Backtest(cfg).run(isBars);
    const oos = new Backtest(cfg).run(oosBars);
    wins.push({ inSample: is, outSample: oos });
    allOOS.push(...oos.trades);
  }

  const oos     = calcMetrics(allOOS, cfg.initialCapital, cfg.tf);
  const isAvg   = wins.reduce((s,w) => s + w.inSample.metrics.sharpe, 0) / Math.max(wins.length, 1);
  const stable  = oos.sharpe >= isAvg * 0.60;
  return { windows: wins, oos, stable };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BacktestResult {
  ticker:      string;
  tf:          string;
  trades:      TradeRecord[];
  metrics:     PerformanceMetrics;
  summary:     string;
  grades:      Record<string, { value: number; grade: string; label: string }>;
  finalEquity: number;
}

export interface WFResult {
  windows: Array<{ inSample: BacktestResult; outSample: BacktestResult }>;
  oos:     PerformanceMetrics;
  stable:  boolean;
}
