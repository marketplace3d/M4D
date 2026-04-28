// =============================================================================
// SURGE v3 — Domain Types
// =============================================================================

// ─── Market data ─────────────────────────────────────────────────────────────

export interface OHLCV {
  ts:     number;   // unix ms
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

export type Timeframe = "1m"|"5m"|"15m"|"30m"|"1h"|"4h"|"1d"|"1w";

// ─── Structure ────────────────────────────────────────────────────────────────

export type Direction    = "BULL" | "BEAR";
export type SignalDir    = "LONG" | "SHORT" | "HOLD";
export type BreakQuality = "CLEAN" | "WICK";

// SwingPoint — confirmed structural pivot (no lookahead — confirmed only after N right bars)
export interface SwingPoint {
  barIndex: number;
  ts:       number;
  price:    number;
  type:     "HIGH" | "LOW";
}

// BOS — break of structure (trend continuation)
// CHoCH — change of character (reversal signal)
// KEY RULE: BOS/CHoCH are STRUCTURAL LABELS. They are NOT entry triggers.
// Entry is on the RETEST of the broken level — never on the break bar itself.
export type StructureEventType = "BOS_BULL" | "BOS_BEAR" | "CHOCH_BULL" | "CHOCH_BEAR";

export interface StructureEvent {
  id:          string;
  type:        StructureEventType;
  ts:          number;
  barIndex:    number;
  level:       number;   // the structure level that was broken
  breakClose:  number;
  confirmed:   boolean;  // retest confirmation pending or done
  retestBar?:  number;
  retestPrice?: number;
}

// ─── Liquidity ────────────────────────────────────────────────────────────────

export type LiqType = "BSL" | "SSL";  // Buy-side / Sell-side liquidity

export interface LiqLevel {
  id:       string;
  type:     LiqType;
  price:    number;
  ts:       number;
  barIndex: number;
  swept:    boolean;
  sweepBar?: number;
  sweepClose?: number;
}

export interface LiqSweep {
  id:         string;
  liqId:      string;
  type:       LiqType;
  level:      number;
  wickThrough: number;    // how far wick penetrated
  closeBack:  number;     // closed back on other side (rejection)
  ts:         number;
  barIndex:   number;
  reversal:   boolean;    // closed back through → high-quality reversal signal
}

// ─── Order Blocks ─────────────────────────────────────────────────────────────

export interface OrderBlock {
  id:          string;
  direction:   Direction;
  top:         number;
  bottom:      number;
  barIndex:    number;
  ts:          number;
  impulseSize: number;    // % move of the impulse that created this OB
  mitigated:   boolean;
  mitPct:      number;    // 0-100 % of OB body filled
  // Sweep-and-fill: wick below OB bottom (bull) / above top (bear), close back inside
  sweepFill:   boolean;
  sweepFillBar?: number;
}

// ─── Fair Value Gaps ──────────────────────────────────────────────────────────

export interface FVG {
  id:        string;
  direction: Direction;
  top:       number;
  bottom:    number;
  size:      number;    // gap size in price
  sizePct:   number;    // gap size as % of price
  barIndex:  number;    // middle bar of 3-candle pattern
  ts:        number;
  fillPct:   number;    // 0-100%
  filled:    boolean;
}

// ─── BRK Retest ──────────────────────────────────────────────────────────────

export interface BRKBreak {
  id:          string;
  direction:   Direction;
  level:       number;
  breakBar:    number;
  breakClose:  number;
  breakPct:    number;
  quality:     BreakQuality;
  volConfirmed: boolean;
  trendAligned: boolean;
  confirmed:   boolean;
  expiresAt:   number;
}

export interface BRKSignal {
  source:      "SURGE_BRK";
  alphaId:     "CONF-01";
  id:          string;
  ts:          number;
  ticker:      string;
  tf:          Timeframe | string;
  signal:      SignalDir;
  breakLevel:  number;
  breakQuality: BreakQuality;
  pattern:     CandlePattern;
  entry:       number;
  sl:          number;
  tp1:         number;
  tp2:         number;
  rrRatio:     number;
  slDist:      number;
  atr:         number;
  volConfirmed: boolean;
  trendAligned: boolean;
  confidence:  number;
}

// ─── SMC Signal ───────────────────────────────────────────────────────────────

export interface SMCSignal {
  source:     "SURGE_SMC";
  id:         string;
  ts:         number;
  ticker:     string;
  tf:         string;
  signal:     SignalDir;
  confidence: number;       // 0-100
  smcScore:   number;       // -100..+100

  // Component flags
  bosType:      StructureEventType | null;
  chochType:    StructureEventType | null;
  liqSweep:     LiqSweep | null;
  obSweepFill:  OrderBlock | null;
  fvgDetected:  FVG | null;
  trendBull:    boolean;

  // Levels
  entry:  number;
  sl:     number;
  tp1:    number;
  tp2:    number;
  atr:    number;
}

// ─── MTF ──────────────────────────────────────────────────────────────────────

export type TFBias = "BULL" | "BEAR" | "NEUTRAL";

export interface TFState {
  tf:       string;
  bias:     TFBias;
  score:    number;   // -7..+7 (EMA stack + RSI + HH/HL)
  rsi:      number;
  emaFast:  number;
  emaSlow:  number;
  emaTrend: number;
}

export interface MTFResult {
  alignScore:    number;   // 0-100
  adjScore:      number;   // conflict-adjusted
  bias:          TFBias;
  agreement:     number;   // 0-N TFs aligned
  htfLtfAligned: boolean;
  conflictPenalty: number;
  tfs:           TFState[];
}

// ─── Candle patterns ─────────────────────────────────────────────────────────

export type CandlePattern =
  | "Engulfing" | "PinBar" | "RejectionWick"
  | "InsideBar" | "Doji" | "CloseConfirm" | "None";

// ─── Fused signal (all modules combined) ─────────────────────────────────────

export interface FusedSignal {
  id:           string;
  ticker:       string;
  tf:           string;
  ts:           number;
  smc:          SMCSignal   | null;
  brk:          BRKSignal   | null;
  mtf:          MTFResult   | null;
  mom:          MomGates    | null;
  compositeScore: number;   // 0-100
  direction:    SignalDir;
  keyEvents:    string[];
}

// ─── Arbitrator output ────────────────────────────────────────────────────────

export interface ArbitratorDecision {
  id:           string;
  ticker:       string;
  tf:           string;
  ts:           string;
  signal:       SignalDir;
  confidence:   number;
  entry:        number | null;
  sl:           number | null;
  tp1:          number | null;
  tp2:          number | null;
  rr:           number | null;
  reasoning:    string;
  smcSummary:   string;
  brkSummary:   string;
  mtfSummary:   string;
  momSummary:   string;
  modelUsed:    string;
  rawComposite: number;
  execAllowed:  boolean;
  gateConflict: boolean;
}

// ─── Momentum gates ───────────────────────────────────────────────────────────

export interface MomGates {
  rsiValue:         number;
  stochKValue:      number;
  stochDValue:      number;
  emaFast:          number;
  emaMid:           number;
  emaSlow:          number;
  vwap:             number;
  rsiHiddenDivBull: boolean;
  rsiHiddenDivBear: boolean;
  stochOB:          boolean;
  stochOS:          boolean;
  stochCrossUp:     boolean;
  stochCrossDown:   boolean;
  emaStackBull:     boolean;
  emaStackBear:     boolean;
  emaBiasLong:      boolean;
  emaBiasShort:     boolean;
  vwapBull:         boolean;
  vwapBear:         boolean;
  compositeScore:   number;   // -1..+1
  arbitratorWeight: number;   // 0..0.20
}

// ─── Trade record ─────────────────────────────────────────────────────────────

export type TrailMode = "ATR" | "Swing" | "LiqDraw" | "BEthenTrail";
export type ExitReason = "TP1" | "TP2" | "TS" | "SL" | "MANUAL";

export interface TradeRecord {
  id:           string;
  ticker:       string;
  direction:    Direction;
  entryTs:      number;
  exitTs:       number;
  entryPrice:   number;
  exitPrice:    number;
  sl:           number;
  tp1:          number;
  tp2:          number;
  pnlR:         number;
  pnlPct:       number;
  pnlAbs:       number;
  maxFavorableR: number;
  maxAdverseR:  number;
  barsHeld:     number;
  exitReason:   ExitReason;
  trailMode:    TrailMode;
  pattern:      CandlePattern;
  breakQuality: BreakQuality;
  source:       "SMC" | "BRK" | "FUSED";
}

export interface PerformanceMetrics {
  totalTrades:     number;
  winTrades:       number;
  lossTrades:      number;
  winRate:         number;
  grossProfit:     number;
  grossLoss:       number;
  netProfit:       number;
  profitFactor:    number;
  expectancyR:     number;
  avgWin:          number;
  avgLoss:         number;
  avgWinR:         number;
  avgLossR:        number;
  sharpe:          number;
  sortino:         number;
  calmar:          number;
  mar:             number;
  maxDrawdownPct:  number;
  maxDrawdownAbs:  number;
  avgDrawdownPct:  number;
  longestDDDays:   number;
  cagrPct:         number;
  totalReturnPct:  number;
  equityCurve:     number[];
  ddCurve:         number[];
}
