// =============================================================================
// SURGE — Alpha Metrics Engine
// Sharpe · Sortino · Calmar · MAR · Profit Factor · Expectancy/R
// Input: closed TradeRecord[] array
// =============================================================================

import type { TradeRecord, PerformanceMetrics } from "../../types/index.js";
import { annFactor } from "../utils/indicators.js";

// ─── Main metrics calculator ──────────────────────────────────────────────────

export function calcMetrics(
  trades:       TradeRecord[],
  initialCapital: number,
  tf:           string,
): PerformanceMetrics {
  if (trades.length === 0) return emptyMetrics();

  const n      = trades.length;
  const wins   = trades.filter(t => t.pnlAbs > 0);
  const losses = trades.filter(t => t.pnlAbs <= 0);

  // ── P&L ──────────────────────────────────────────────────────────────────
  const grossProfit = wins  .reduce((s, t) => s + t.pnlAbs, 0);
  const grossLoss   = losses.reduce((s, t) => s + Math.abs(t.pnlAbs), 0);
  const netProfit   = grossProfit - grossLoss;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

  // ── Win stats ─────────────────────────────────────────────────────────────
  const winRate  = n > 0 ? wins.length / n : 0;
  const avgWin   = wins.length  > 0 ? grossProfit / wins.length  : 0;
  const avgLoss  = losses.length> 0 ? grossLoss   / losses.length : 0;
  const avgWinR  = wins.length  > 0 ? wins  .reduce((s,t)=>s+t.pnlR, 0) / wins.length  : 0;
  const avgLossR = losses.length> 0 ? losses.reduce((s,t)=>s+Math.abs(t.pnlR),0)/losses.length: 0;

  // ── Expectancy per R ───────────────────────────────────────────────────────
  // E[R] = WR × AvgW_R − (1−WR) × AvgL_R
  const expectancyR = winRate * avgWinR - (1 - winRate) * avgLossR;

  // ── Equity curve & drawdown ────────────────────────────────────────────────
  const equityCurve: number[] = [];
  const ddCurve:     number[] = [];
  let   equity   = initialCapital;
  let   peak     = initialCapital;
  let   maxDD    = 0;
  let   maxDDAbs = 0;
  let   ddSum    = 0;

  // Track drawdown duration
  let ddStart        = -1;
  let longestDDDays  = 0;
  let curDDDays      = 0;

  for (const t of trades) {
    equity += t.pnlAbs;
    peak    = Math.max(peak, equity);
    const dd = (peak - equity) / peak * 100;
    const ddAbs = peak - equity;

    equityCurve.push(equity);
    ddCurve.push(dd);
    ddSum  += dd;
    maxDD   = Math.max(maxDD, dd);
    maxDDAbs= Math.max(maxDDAbs, ddAbs);

    if (dd > 0) {
      curDDDays++;
      longestDDDays = Math.max(longestDDDays, curDDDays);
    } else {
      curDDDays = 0;
    }
  }
  const avgDD = n > 0 ? ddSum / n : 0;

  // ── CAGR ──────────────────────────────────────────────────────────────────
  const msSpan   = trades[n-1].exitTs - trades[0].entryTs;
  const years    = msSpan / (365.25 * 24 * 3600 * 1000);
  const endEq    = initialCapital + netProfit;
  const cagr     = years > 0 && initialCapital > 0
    ? (Math.pow(endEq / initialCapital, 1 / years) - 1) * 100
    : 0;
  const totalRet = initialCapital > 0 ? (netProfit / initialCapital) * 100 : 0;

  // ── Sharpe (annualized) ───────────────────────────────────────────────────
  // Computed on % returns per trade, annualised by avg bars held
  const pctReturns = trades.map(t => t.pnlPct);
  const muRet      = pctReturns.reduce((s,r)=>s+r,0) / n;
  const varRet     = pctReturns.reduce((s,r)=>s+(r-muRet)**2, 0) / Math.max(n-1, 1);
  const sdRet      = Math.sqrt(varRet);

  // Annualise: sqrt(trades per year)
  const avgBarsHeld = trades.reduce((s,t)=>s+t.barsHeld,0) / n;
  const barsPerYear  = annFactor(tf);
  const tradesPerYear = barsPerYear / Math.max(avgBarsHeld, 1);
  const sharpe       = sdRet > 0 ? (muRet / sdRet) * Math.sqrt(tradesPerYear) : 0;

  // ── Sortino (downside std only) ───────────────────────────────────────────
  const downside = pctReturns.filter(r => r < 0);
  const varDown  = downside.length > 1
    ? downside.reduce((s,r)=>s+r**2,0) / downside.length
    : 0;
  const sdDown   = Math.sqrt(varDown);
  const sortino  = sdDown > 0 ? (muRet / sdDown) * Math.sqrt(tradesPerYear) : 0;

  // ── Calmar / MAR ─────────────────────────────────────────────────────────
  const calmar = maxDD > 0 ? cagr / maxDD : 0;
  const mar    = calmar;   // same ratio, different name

  return {
    totalTrades:      n,
    winTrades:        wins.length,
    lossTrades:       losses.length,
    winRate,
    grossProfit,
    grossLoss,
    netProfit,
    profitFactor,
    expectancyR,
    avgWin,
    avgLoss,
    avgWinR,
    avgLossR,
    sharpe,
    sortino,
    calmar,
    mar,
    maxDrawdownPct:   maxDD,
    maxDrawdownAbs:   maxDDAbs,
    avgDrawdownPct:   avgDD,
    longestDDDays,
    cagrPct:          cagr,
    totalReturnPct:   totalRet,
    equityCurve,
    ddCurve,
  };
}

// ─── Grade thresholds (RenTech-calibrated) ────────────────────────────────────

export interface MetricGrade {
  value: number;
  grade: "A" | "B" | "C" | "F";
  label: string;
}

export function gradeMetrics(m: PerformanceMetrics): Record<string, MetricGrade> {
  const grade = (
    v: number, a: number, b: number, c: number, label: string
  ): MetricGrade => ({
    value: v,
    grade: v >= a ? "A" : v >= b ? "B" : v >= c ? "C" : "F",
    label,
  });

  return {
    sharpe:       grade(m.sharpe,        2.0,  1.5,  1.0,  "Sharpe (ann.)"),
    sortino:      grade(m.sortino,       2.5,  2.0,  1.2,  "Sortino (ann.)"),
    calmar:       grade(m.calmar,        1.5,  1.0,  0.5,  "Calmar / MAR"),
    profitFactor: grade(m.profitFactor,  2.5,  2.0,  1.5,  "Profit Factor"),
    expectancyR:  grade(m.expectancyR,   0.6,  0.4,  0.15, "Expectancy/R"),
    winRate:      grade(m.winRate*100,   60,   50,   40,   "Win Rate %"),
    maxDD:        grade(100-m.maxDrawdownPct, 85,75, 65,   "Max DD (100=0DD)"),
    cagr:         grade(m.cagrPct,       50,   30,   15,   "CAGR %"),
  };
}

// ─── Pretty-print summary ─────────────────────────────────────────────────────

export function printMetrics(m: PerformanceMetrics, tf: string, ticker: string): string {
  const g    = gradeMetrics(m);
  const line = (label: string, val: string, gr: MetricGrade) =>
    `  ${label.padEnd(18)} ${val.padStart(10)}   [${gr.grade}]`;

  const rows = [
    `\n╔══════════════════════════════════════════════════╗`,
    `║  SURGE α-METRICS  ${ticker} ${tf}`.padEnd(50) + "║",
    `╠══════════════════════════════════════════════════╣`,
    `║  Trades           ${String(m.totalTrades).padStart(10)}       ║`,
    `║  Win Rate      ${(m.winRate*100).toFixed(1).padStart(10)}%   ${g.winRate.grade}         ║`,
    `╠══════════════════════════════════════════════════╣`,
    `║  ${line("Sharpe (ann.)",     m.sharpe.toFixed(3),          g.sharpe)}       ║`,
    `║  ${line("Sortino (ann.)",    m.sortino.toFixed(3),         g.sortino)}       ║`,
    `║  ${line("Calmar / MAR",      m.calmar.toFixed(3),          g.calmar)}       ║`,
    `║  ${line("Profit Factor",     m.profitFactor.toFixed(3),    g.profitFactor)}  ║`,
    `║  ${line("Expectancy/R",      m.expectancyR.toFixed(3)+"R", g.expectancyR)}  ║`,
    `╠══════════════════════════════════════════════════╣`,
    `║  ${line("CAGR %",            m.cagrPct.toFixed(1)+"%",     g.cagr)}          ║`,
    `║  ${line("Max DD %",          m.maxDrawdownPct.toFixed(1)+"%", g.maxDD)}      ║`,
    `║  Avg Win/Loss  ${m.avgWinR.toFixed(2).padStart(8)}R / ${m.avgLossR.toFixed(2)}R              ║`,
    `║  Net PnL       $${m.netProfit.toFixed(2).padStart(12)}                   ║`,
    `╚══════════════════════════════════════════════════╝`,
  ];
  return rows.join("\n");
}

function emptyMetrics(): PerformanceMetrics {
  return {
    totalTrades:0, winTrades:0, lossTrades:0, winRate:0,
    grossProfit:0, grossLoss:0, netProfit:0, profitFactor:0,
    expectancyR:0, avgWin:0, avgLoss:0, avgWinR:0, avgLossR:0,
    sharpe:0, sortino:0, calmar:0, mar:0,
    maxDrawdownPct:0, maxDrawdownAbs:0, avgDrawdownPct:0, longestDDDays:0,
    cagrPct:0, totalReturnPct:0, equityCurve:[], ddCurve:[],
  };
}
