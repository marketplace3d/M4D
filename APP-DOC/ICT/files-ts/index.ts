// =============================================================================
// SURGE — Core Domain Types
// =============================================================================

export interface OHLCV {
  ts: number;       // unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Structure ────────────────────────────────────────────────────────────────

export type BreakDirection = "BULL" | "BEAR";
export type BreakQuality  = "CLEAN" | "WICK";

export interface StructureBreak {
  id: string;
  ts: number;
  barIndex: number;
  direction: BreakDirection;
  level: number;         // broken structure level
  breakClose: number;
  breakPct: number;      // how far body closed through (%)
  quality: BreakQuality;
  volumeConfirmed: boolean;
  trendAligned: boolean;
  retested: boolean;
  confirmed: boolean;
}

export interface RetestConfirmation {
  breakId: string;
  ts: number;
  barIndex: number;
  touchPrice: number;
  closePrice: number;
  pattern: CandlePattern;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rrRatio: number;
  slDist: number;
}

// ─── Candle Patterns ─────────────────────────────────────────────────────────

export type CandlePattern =
  | "Engulfing"
  | "PinBar"
  | "RejectionWick"
  | "InsideBar"
  | "Doji"
  | "CloseConfirm"
  | "None";

export interface CandleFeatures {
  body: number;
  range: number;
  upperWick: number;
  lowerWick: number;
  isBull: boolean;
  bodyPct: number;   // body / range
  upperWickPct: number;
  lowerWickPct: number;
}

// ─── Trailing Stop ────────────────────────────────────────────────────────────

export type TrailMode = "ATR" | "Swing" | "LiqDraw" | "BEthenTrail";

export interface TrailState {
  mode: TrailMode;
  isLong: boolean;
  entryPrice: number;
  initialSL: number;
  slDist: number;
  currentStop: number;
  peakPrice: number;    // highest (long) or lowest (short) since entry
  beTriggered: boolean;
  tp1Hit: boolean;
  barsInTrade: number;
}

export interface TrailUpdate {
  newStop: number;
  reason: string;
  stopHit: boolean;
  exitPrice?: number;
  pnlR?: number;
}

// ─── Signals ─────────────────────────────────────────────────────────────────

export type SignalDirection = "LONG" | "SHORT" | "HOLD";

export interface BRKSignal {
  source: "SURGE_BRK";
  alphaId: "CONF-01";
  ts: number;
  ticker: string;
  tf: string;
  signal: SignalDirection;
  breakQuality: BreakQuality;
  breakLevel: number;
  pattern: CandlePattern;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rrRatio: number;
  atr: number;
  volumeConfirmed: boolean;
  trendAligned: boolean;
  confidence: number;   // 0-100
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface TradeRecord {
  id: string;
  ticker: string;
  direction: BreakDirection;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  sl: number;
  tp1: number;
  tp2: number;
  pnlR: number;        // P&L in R-units
  pnlPct: number;      // P&L %
  pnlAbs: number;      // P&L $
  maxFavorable: number; // MFE in R
  maxAdverse: number;   // MAE in R
  barsHeld: number;
  exitReason: "TP1" | "TP2" | "TS" | "SL" | "MANUAL";
  trailMode: TrailMode;
  pattern: CandlePattern;
  breakQuality: BreakQuality;
}

export interface PerformanceMetrics {
  // Volume
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  winRate: number;            // 0-1

  // Returns
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  profitFactor: number;       // grossProfit / |grossLoss|
  expectancyR: number;        // E[R] per trade
  avgWin: number;             // avg $ win
  avgLoss: number;            // avg $ loss
  avgWinR: number;
  avgLossR: number;

  // Risk-adjusted
  sharpe: number;             // annualised
  sortino: number;            // downside-only volatility
  calmar: number;             // CAGR / maxDD
  mar: number;                // same as calmar (alias)

  // Drawdown
  maxDrawdownPct: number;
  maxDrawdownAbs: number;
  avgDrawdownPct: number;
  longestDDDays: number;

  // Growth
  cagrPct: number;
  totalReturnPct: number;

  // Per-bar
  equityCurve: number[];      // equity at each closed trade
  ddCurve: number[];          // drawdown % at each closed trade
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface BRKConfig {
  // Structure detection
  rollingLookback: number;       // rt_lookback equivalent
  minBreakPct: number;           // body close-through %
  volumeConfirm: boolean;
  volumeAvgLen: number;
  volumeMult: number;

  // Retest
  retestBars: number;
  retestTolPct: number;
  requirePattern: boolean;

  // Risk
  atrLen: number;
  slAtrMult: number;
  tp1RR: number;
  tp2RR: number;
  tp1SizePct: number;            // % of position closed at TP1
  useSwingSL: boolean;
  minRR: number;

  // Trail
  trailMode: TrailMode;
  trailAtrMult: number;
  trailSwingLen: number;
  trailLiqPct: number;
  beaTriggerR: number;           // breakeven trigger in R

  // Filters
  trendFilter: boolean;
  ema200Len: number;
  maxConcurrentTrades: number;
}

export const DEFAULT_BRK_CONFIG: BRKConfig = {
  rollingLookback:    20,
  minBreakPct:        0.10,
  volumeConfirm:      true,
  volumeAvgLen:       20,
  volumeMult:         1.2,
  retestBars:         20,
  retestTolPct:       0.20,
  requirePattern:     true,
  atrLen:             14,
  slAtrMult:          1.5,
  tp1RR:              2.0,
  tp2RR:              5.0,
  tp1SizePct:         0.60,
  useSwingSL:         true,
  minRR:              1.5,
  trailMode:          "LiqDraw",
  trailAtrMult:       2.0,
  trailSwingLen:      5,
  trailLiqPct:        0.05,
  beaTriggerR:        1.0,
  trendFilter:        true,
  ema200Len:          200,
  maxConcurrentTrades: 2,
};
