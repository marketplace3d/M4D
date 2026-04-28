// =============================================================================
// SURGE v3 — Alpha Metrics
// Sharpe · Sortino · Calmar · MAR · Profit Factor · Expectancy/R
// =============================================================================

import type { TradeRecord, PerformanceMetrics } from "../../types/index.js";
import { annFactor } from "../utils/indicators.js";

export function calcMetrics(
  trades:  TradeRecord[],
  capital: number,
  tf:      string,
): PerformanceMetrics {
  const empty = (): PerformanceMetrics => ({
    totalTrades:0,winTrades:0,lossTrades:0,winRate:0,
    grossProfit:0,grossLoss:0,netProfit:0,profitFactor:0,
    expectancyR:0,avgWin:0,avgLoss:0,avgWinR:0,avgLossR:0,
    sharpe:0,sortino:0,calmar:0,mar:0,
    maxDrawdownPct:0,maxDrawdownAbs:0,avgDrawdownPct:0,longestDDDays:0,
    cagrPct:0,totalReturnPct:0,equityCurve:[],ddCurve:[],
  });
  if (!trades.length) return empty();

  const n    = trades.length;
  const wins = trades.filter(t => t.pnlAbs > 0);
  const loss = trades.filter(t => t.pnlAbs <= 0);

  const gW = wins.reduce((s,t) => s + t.pnlAbs, 0);
  const gL = loss.reduce((s,t) => s + Math.abs(t.pnlAbs), 0);
  const net = gW - gL;
  const pf  = gL > 0 ? gW / gL : Infinity;
  const wr  = wins.length / n;

  const avgWR  = wins.length > 0 ? wins.reduce((s,t)=>s+t.pnlR,0)/wins.length : 0;
  const avgLR  = loss.length > 0 ? loss.reduce((s,t)=>s+Math.abs(t.pnlR),0)/loss.length : 0;
  const expR   = wr * avgWR - (1-wr) * avgLR;

  // Equity curve + DD
  const eqCurve: number[] = [], ddCurve: number[] = [];
  let eq = capital, peak = capital, maxDD = 0, maxDDAbs = 0, ddSum = 0, ddDays = 0, maxDDDays = 0;
  for (const t of trades) {
    eq += t.pnlAbs;
    peak = Math.max(peak, eq);
    const dd = (peak - eq) / peak * 100;
    eqCurve.push(eq); ddCurve.push(dd);
    ddSum += dd; maxDD = Math.max(maxDD, dd);
    maxDDAbs = Math.max(maxDDAbs, peak - eq);
    ddDays = dd > 0 ? ddDays + 1 : 0;
    maxDDDays = Math.max(maxDDDays, ddDays);
  }

  // CAGR
  const msSpan = trades[n-1].exitTs - trades[0].entryTs;
  const years  = msSpan / (365.25*24*3600*1000);
  const endEq  = capital + net;
  const cagr   = years > 0 && capital > 0 ? (Math.pow(endEq/capital, 1/years) - 1)*100 : 0;

  // Sharpe / Sortino
  const pcts  = trades.map(t => t.pnlPct);
  const mu    = pcts.reduce((s,r)=>s+r,0)/n;
  const vari  = pcts.reduce((s,r)=>s+(r-mu)**2,0)/Math.max(n-1,1);
  const sd    = Math.sqrt(vari);
  const avgBars = trades.reduce((s,t)=>s+t.barsHeld,0)/n;
  const bpY   = annFactor(tf);
  const tpY   = bpY / Math.max(avgBars, 1);
  const sharpe = sd > 0 ? (mu/sd) * Math.sqrt(tpY) : 0;

  const dn    = pcts.filter(r=>r<0);
  const varD  = dn.length>1 ? dn.reduce((s,r)=>s+r**2,0)/dn.length : 0;
  const sdD   = Math.sqrt(varD);
  const sortino = sdD > 0 ? (mu/sdD)*Math.sqrt(tpY) : 0;

  const calmar = maxDD > 0 ? cagr/maxDD : 0;

  return {
    totalTrades: n, winTrades: wins.length, lossTrades: loss.length, winRate: wr,
    grossProfit: gW, grossLoss: gL, netProfit: net, profitFactor: pf,
    expectancyR: expR, avgWin: wins.length>0?gW/wins.length:0, avgLoss: loss.length>0?gL/loss.length:0,
    avgWinR: avgWR, avgLossR: avgLR,
    sharpe, sortino, calmar, mar: calmar,
    maxDrawdownPct: maxDD, maxDrawdownAbs: maxDDAbs,
    avgDrawdownPct: n>0?ddSum/n:0, longestDDDays: maxDDDays,
    cagrPct: cagr, totalReturnPct: capital>0?net/capital*100:0,
    equityCurve: eqCurve, ddCurve,
  };
}

export interface MetricGrade {
  value: number; grade: "A"|"B"|"C"|"F"; label: string;
}

export function gradeMetrics(m: PerformanceMetrics): Record<string, MetricGrade> {
  const g = (v:number, a:number, b:number, c:number, label:string): MetricGrade =>
    ({ value:v, grade: v>=a?"A":v>=b?"B":v>=c?"C":"F", label });
  return {
    sharpe:       g(m.sharpe,           2.0,  1.5,  1.0,  "Sharpe (ann.)"),
    sortino:      g(m.sortino,          2.5,  2.0,  1.2,  "Sortino (ann.)"),
    calmar:       g(m.calmar,           1.5,  1.0,  0.5,  "Calmar / MAR"),
    profitFactor: g(m.profitFactor,     2.5,  2.0,  1.5,  "Profit Factor"),
    expectancyR:  g(m.expectancyR,      0.6,  0.4,  0.15, "Expectancy/R"),
    winRate:      g(m.winRate*100,      60,   50,   40,   "Win Rate %"),
    maxDD:        g(100-m.maxDrawdownPct, 85, 75,   65,   "DD Inverse"),
    cagr:         g(m.cagrPct,          50,   30,   15,   "CAGR %"),
  };
}

export function printMetrics(m: PerformanceMetrics, tf: string, ticker: string): string {
  const g = gradeMetrics(m);
  const row = (lbl: string, val: string, grd: MetricGrade) =>
    `  ${lbl.padEnd(18)} ${val.padStart(10)}   [${grd.grade}]`;
  return [
    `\n╔═══════════════════════════════════════════════════╗`,
    `║  SURGE α  ${ticker} ${tf}`.padEnd(51)+"║",
    `╠═══════════════════════════════════════════════════╣`,
    `║  Trades         ${String(m.totalTrades).padStart(10)}                    ║`,
    `║  Win Rate    ${(m.winRate*100).toFixed(1).padStart(10)}%   ${g.winRate.grade}              ║`,
    `╠═══════════════════════════════════════════════════╣`,
    `║  ${row("Sharpe (ann.)",    m.sharpe.toFixed(3),        g.sharpe)}       ║`,
    `║  ${row("Sortino (ann.)",   m.sortino.toFixed(3),       g.sortino)}       ║`,
    `║  ${row("Calmar / MAR",     m.calmar.toFixed(3),        g.calmar)}       ║`,
    `║  ${row("Profit Factor",    m.profitFactor.toFixed(3),  g.profitFactor)}  ║`,
    `║  ${row("Expectancy/R",     m.expectancyR.toFixed(3)+"R",g.expectancyR)} ║`,
    `╠═══════════════════════════════════════════════════╣`,
    `║  ${row("CAGR %",           m.cagrPct.toFixed(1)+"%",   g.cagr)}          ║`,
    `║  ${row("Max DD %",         m.maxDrawdownPct.toFixed(1)+"%", g.maxDD)}     ║`,
    `║  Net PnL       $${m.netProfit.toFixed(2).padStart(12)}                    ║`,
    `╚═══════════════════════════════════════════════════╝`,
  ].join("\n");
}
