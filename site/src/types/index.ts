// ─── Core algo vote ───────────────────────────────────────────────────────────

export type AlgoTier = 'A' | 'B' | 'C' | 'JEDI'
export type VoteValue = -1 | 0 | 1
export type Regime = 'BULL' | 'BEAR' | 'NEUTRAL'
export type TradeMode = 'PAPER' | 'LIVE'
export type TradeDirection = 'LONG' | 'SHORT'
export type TradeStatus = 'OPEN' | 'CLOSED' | 'CANCELLED'

// ─── API response shapes ──────────────────────────────────────────────────────

export interface AlgoVote {
  id: string
  name: string
  tier: AlgoTier
  vote: VoteValue
  score: number
}

export interface CouncilResponse {
  total_long: number
  total_short: number
  jedi_score: number
  regime: Regime
  algos: AlgoVote[]
}

export interface AssetVotes {
  NS?: VoteValue
  CI?: VoteValue
  BQ?: VoteValue
  CC?: VoteValue
  WH?: VoteValue
  SA?: VoteValue
  HK?: VoteValue
  GO?: VoteValue
  EF?: VoteValue
  '8E'?: VoteValue
  VT?: VoteValue
  MS?: VoteValue
  DP?: VoteValue
  WS?: VoteValue
  RV?: VoteValue
  HL?: VoteValue
  AI?: VoteValue
  VK?: VoteValue
  SE?: VoteValue
  IC?: VoteValue
  WN?: VoteValue
  CA?: VoteValue
  TF?: VoteValue
  RT?: VoteValue
  MM?: VoteValue
  OR?: VoteValue
  DV?: VoteValue
  [key: string]: VoteValue | undefined
}

export interface AlgoDayAsset {
  symbol: string
  votes: AssetVotes
  jedi_score: number
  price: number
  change_pct: number
}

export interface AlgoDayResponse {
  timestamp: string
  assets: AlgoDayAsset[]
}

export interface Asset {
  symbol: string
  name?: string
  sector?: string
  jedi_score?: number
  price?: number
  change_pct?: number
}

export interface AssetsResponse {
  assets: Asset[]
}

// ─── Backtest ─────────────────────────────────────────────────────────────────

export interface BacktestParams {
  asset: string
  algo: string
  from: string
  to: string
}

export interface BacktestTrade {
  entry_date: string
  exit_date: string
  direction: TradeDirection
  entry_price: number
  exit_price: number
  pnl: number
  pnl_pct: number
}

export interface BacktestEquityPoint {
  date: string
  equity: number
}

export interface BacktestResult {
  asset: string
  algo: string
  win_rate: number
  max_drawdown: number
  sharpe: number
  total_return: number
  num_trades: number
  trades: BacktestTrade[]
  equity_curve: BacktestEquityPoint[]
}

// ─── WebSocket messages ───────────────────────────────────────────────────────

export interface WsVoteUpdate {
  type: 'vote_update'
  symbol: string
  algo_id: string
  vote: VoteValue
  timestamp: string
}

export interface WsCouncilUpdate {
  type: 'council_update'
  jedi_score: number
  regime: Regime
  timestamp: string
}

export type WsMessage = WsVoteUpdate | WsCouncilUpdate

// ─── Trading ──────────────────────────────────────────────────────────────────

export interface Position {
  id: string
  symbol: string
  direction: TradeDirection
  size: number
  entry_price: number
  current_price: number
  pnl: number
  pnl_pct: number
  opened_at: string
  algo_ids: string[]
}

export interface TradeHistoryEntry {
  id: string
  symbol: string
  direction: TradeDirection
  size: number
  entry_price: number
  exit_price: number
  pnl: number
  pnl_pct: number
  opened_at: string
  closed_at: string
  status: TradeStatus
  mode: TradeMode
}

export interface AutoTraderConfig {
  enabled_algos: string[]
  min_votes: number
  risk_pct: number
  mode: TradeMode
}

// ─── Chart ────────────────────────────────────────────────────────────────────

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

export interface OHLCVBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface AlgoSignal {
  time: number
  algo_id: string
  vote: VoteValue
  price: number
}

// ─── Static algo metadata ─────────────────────────────────────────────────────

export interface AlgoMeta {
  id: string
  tier: AlgoTier
  name: string
  sub: string
  color: string
  method?: string
}

export const BANK_A_IDS = ['NS', 'CI', 'BQ', 'CC', 'WH', 'SA', 'HK', 'GO', 'EF'] as const
export const BANK_B_IDS = ['8E', 'VT', 'MS', 'DP', 'WS', 'RV', 'HL', 'AI', 'VK'] as const
export const BANK_C_IDS = ['SE', 'IC', 'WN', 'CA', 'TF', 'RT', 'MM', 'OR', 'DV'] as const
export const ALL_ALGO_IDS = [...BANK_A_IDS, ...BANK_B_IDS, ...BANK_C_IDS] as const
export type AlgoId = (typeof ALL_ALGO_IDS)[number]

export const ALGO_META: AlgoMeta[] = [
  // Bank A — BOOM
  { id: 'NS',  tier: 'A', name: 'NIALL SPIKE',     sub: 'Vol Delta Explosion',      color: '#22d3ee' },
  { id: 'CI',  tier: 'A', name: 'CYBER-ICT',        sub: 'OB Heatseeker',            color: '#a78bfa' },
  { id: 'BQ',  tier: 'A', name: 'BANSHEE SQUEEZE',  sub: 'TTM Momentum Release',     color: '#f43f5e' },
  { id: 'CC',  tier: 'A', name: 'CELTIC CROSS',     sub: 'EMA Ribbon Alignment',     color: '#4ade80' },
  { id: 'WH',  tier: 'A', name: 'WOLFHOUND',        sub: 'Scalp Velocity',           color: '#fb923c' },
  { id: 'SA',  tier: 'A', name: 'STONE ANCHOR',     sub: 'Volume Profile VPOC',      color: '#94a3b8' },
  { id: 'HK',  tier: 'A', name: 'HIGH KING',        sub: 'Opening Range Bias',       color: '#fbbf24' },
  { id: 'GO',  tier: 'A', name: 'GALLOWGLASS OB',   sub: 'Aggressive OB Retest',     color: '#c084fc' },
  { id: 'EF',  tier: 'A', name: 'EMERALD FLOW',     sub: 'Money Flow MFI',           color: '#34d399' },
  // Bank B — STRAT
  { id: '8E',  tier: 'B', name: '8-EMA RIBBON',     sub: 'Trend Momentum Gate',      color: '#67e8f9' },
  { id: 'VT',  tier: 'B', name: 'VEGA TRAP',        sub: 'Options Gamma Squeeze',    color: '#818cf8' },
  { id: 'MS',  tier: 'B', name: 'MARKET SHIFT',     sub: 'CHoCH / BOS Detector',     color: '#f97316' },
  { id: 'DP',  tier: 'B', name: 'DARK POOL',        sub: 'Institutional Prints',     color: '#e879f9' },
  { id: 'WS',  tier: 'B', name: 'WYCKOFF SPRING',   sub: 'Accum Phase Detector',     color: '#fde68a' },
  { id: 'RV',  tier: 'B', name: 'RENKO VAULT',      sub: 'Noise-Filtered Trend',     color: '#86efac' },
  { id: 'HL',  tier: 'B', name: 'HARMONIC LENS',    sub: 'Gartley/Bat/Butterfly PRZ',color: '#f0abfc' },
  { id: 'AI',  tier: 'B', name: 'ALPHA IMBALANCE',  sub: 'FVG Fill Probability',     color: '#a5f3fc' },
  { id: 'VK',  tier: 'B', name: 'VOLKOV KELTNER',   sub: 'Keltner Breakout',         color: '#60a5fa' },
  // Bank C — LEGEND
  { id: 'SE',  tier: 'C', name: 'STOCKBEE EP',      sub: 'Episodic Pivot 3×Vol',     color: '#4ade80' },
  { id: 'IC',  tier: 'C', name: 'ICT WEEKLY FVG',   sub: 'Virgin FVG Displacement',  color: '#a78bfa' },
  { id: 'WN',  tier: 'C', name: 'WEINSTEIN STAGE',  sub: 'Stage 2 Base Breakout',    color: '#fbbf24' },
  { id: 'CA',  tier: 'C', name: 'CASPER IFVG',      sub: 'Inverse FVG Deep Draw',    color: '#f9a8d4' },
  { id: 'TF',  tier: 'C', name: 'TTRADES FRACTAL',  sub: 'MTF Fractal Swing',        color: '#fb923c' },
  { id: 'RT',  tier: 'C', name: 'RAYNER TREND',     sub: '200MA Pullback Entry',     color: '#34d399' },
  { id: 'MM',  tier: 'C', name: 'MINERVINI VCP',    sub: 'Volatility Contraction',   color: '#67e8f9' },
  { id: 'OR',  tier: 'C', name: "O'NEIL BREAKOUT",  sub: 'CAN SLIM Cup & Handle',    color: '#e879f9' },
  { id: 'DV',  tier: 'C', name: 'DRAGONFLY VOL',    sub: 'Sector Rotation RS',       color: '#fde68a' },
]

export const getAlgoMeta = (id: string): AlgoMeta | undefined =>
  ALGO_META.find(a => a.id === id)
