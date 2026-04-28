// =============================================================================
// SURGE v3 — CLI Runner
// npx ts-node --esm src/run.ts [--ticker BTCUSDT] [--tf 1h] [--trail LiqDraw]
// =============================================================================

import { Backtest, walkForward, DEFAULT_BACKTEST_CONFIG } from "./metrics/backtest.js";
import type { BacktestConfig } from "./metrics/backtest.js";
import type { OHLCV } from "../types/index.js";
import { DEFAULT_SMC_CONFIG } from "./signals/smcEngine.js";
import { DEFAULT_BRK_CONFIG } from "./signals/brkEngine.js";
import type { TrailMode } from "../types/index.js";

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args  = process.argv.slice(2);
const get   = (f: string, d: string) => { const i = args.indexOf(f); return i>=0?args[i+1]:d; };

const ticker  = get("--ticker",   "BTCUSDT");
const tf      = get("--tf",       "1h");
const trail   = get("--trail",    "LiqDraw") as TrailMode;
const capital = parseFloat(get("--capital", "10000"));
const lookback= parseInt(get("--lookback", "20"));
const swR     = parseInt(get("--swingRight", "3"));   // lower = less lag

console.log(`\nSURGE v3 | ${ticker} ${tf} | trail=${trail} | swingRight=${swR}`);
console.log("═".repeat(55));

// ─── Load data ────────────────────────────────────────────────────────────────
async function loadBars(): Promise<OHLCV[]> {
  try {
    const { readFileSync } = await import("fs");
    const raw = JSON.parse(readFileSync(`./data/${ticker}_${tf}.json`, "utf-8"));
    // Support Binance format [[ts,o,h,l,c,v],...] or OHLCV[]
    if (Array.isArray(raw[0])) {
      return raw.map((r: number[]) => ({ ts:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5] }));
    }
    console.log(`Loaded ${raw.length} bars from disk`);
    return raw;
  } catch {
    console.log("No local data — using synthetic bars");
    return syntheticBars(2500, ticker);
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────
function buildConfig(): BacktestConfig {
  return {
    ...DEFAULT_BACKTEST_CONFIG,
    ticker, tf,
    smcCfg:  { ...DEFAULT_SMC_CONFIG, swingRight: swR },
    brkCfg:  { ...DEFAULT_BRK_CONFIG, rollingLookback: lookback },
    trailCfg: { ...DEFAULT_BACKTEST_CONFIG.trailCfg, mode: trail },
    initialCapital: capital,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const bars = await loadBars();
  const cfg  = buildConfig();

  // Single-pass
  const bt = new Backtest(cfg).run(bars);
  console.log(bt.summary);

  // Grade table
  console.log("\nGrades:");
  const bars_ = "████";
  for (const [, g] of Object.entries(bt.grades)) {
    const fill = { A: bars_, B: "███░", C: "██░░", F: "█░░░" }[g.grade] ?? "░░░░";
    console.log(`  ${g.label.padEnd(18)} ${String(g.value.toFixed(3)).padStart(9)}  ${fill} [${g.grade}]`);
  }

  // Source breakdown
  const bySource = { SMC:0, BRK:0, FUSED:0 };
  for (const t of bt.trades) bySource[t.source]++;
  console.log(`\nSignal source: SMC=${bySource.SMC} BRK=${bySource.BRK} FUSED=${bySource.FUSED}`);

  // Walk-forward
  console.log("\n── Walk-Forward (70/30, 3 windows) ──────────────────────");
  const wf = walkForward(bars, cfg, { inSamplePct: 0.70, numWindows: 3 });
  console.log(`OOS Sharpe    ${wf.oos.sharpe.toFixed(3)}`);
  console.log(`OOS Calmar    ${wf.oos.calmar.toFixed(3)}`);
  console.log(`OOS PF        ${wf.oos.profitFactor.toFixed(3)}`);
  console.log(`OOS MaxDD     ${wf.oos.maxDrawdownPct.toFixed(1)}%`);
  console.log(`Stable        ${wf.stable ? "✓ YES" : "✗ NO — check overfit"}`);

  for (let w = 0; w < wf.windows.length; w++) {
    const win = wf.windows[w];
    console.log(`  W${w+1}: IS Sharpe=${win.inSample.metrics.sharpe.toFixed(2)} → OOS=${win.outSample.metrics.sharpe.toFixed(2)}  trades IS=${win.inSample.metrics.totalTrades} OOS=${win.outSample.metrics.totalTrades}`);
  }
}

// ─── Synthetic bars (realistic BTC-like OHLCV) ───────────────────────────────
function syntheticBars(n: number, sym: string): OHLCV[] {
  const MS = 3_600_000;
  let px  = sym.includes("BTC") ? 45000 : sym.includes("ETH") ? 2500 : 100;
  const start = Date.now() - n * MS;
  const bars: OHLCV[] = [];

  for (let i = 0; i < n; i++) {
    // GBM-like price with occasional regime shifts
    const regime = Math.floor(i / 200) % 3;  // cycle through bull/bear/range
    const drift  = regime === 0 ? 0.0002 : regime === 1 ? -0.0002 : 0.00005;
    const vol    = 0.012;
    px           = Math.max(px * 0.1, px * Math.exp(drift + vol * (Math.random()*2-1)));
    const r      = px * (0.004 + Math.random() * 0.012);
    const o      = px;
    const c      = px + (Math.random() - 0.5) * r;
    const h      = Math.max(o, c) + Math.random() * r * 0.4;
    const l      = Math.min(o, c) - Math.random() * r * 0.4;
    bars.push({ ts: start + i*MS, open: o, high: h, low: l, close: c,
                volume: 200 + Math.random() * 8000 });
  }
  return bars;
}

main().catch(console.error);
