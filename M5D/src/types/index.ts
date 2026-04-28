export type Theme = 'navy-subtle' | 'navy-vibrant' | 'navy-glow' | 'hc-dark' | 'colour'
export type PageId =
  | 'market'
  | 'market-audit'
  | 'pulse'
  | 'trade'
  | 'ict-smc'
  | 'starray'
  | 'perf'
  | 'alphaseek'
  | 'medallion'
  | 'obi'
  | 'trade-lab'
  | 'backtest-lab'

export interface AlgoVote {
  id: string
  name: string
  tier: string
  vote: -1 | 0 | 1
  score: number
  win_rate: number
}

export interface CouncilSnapshot {
  timestamp: string
  jedi_score: number
  total_long: number
  total_short: number
  regime: string
  algos: AlgoVote[]
}

export interface CrossAssetDimension {
  name: string
  value: number
  signal: string
}

export interface CrossAssetReport {
  ok: boolean
  ts: number
  composite: number
  regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL'
  dimensions: CrossAssetDimension[]
}

export interface GateResult {
  gate: string
  enabled: boolean
  sharpe_delta: number
  trigger_rate: number
}

export interface GateReport {
  ok: boolean
  gates: GateResult[]
  stacked_sharpe: number
}

export interface PaperStatus {
  ok: boolean
  account?: {
    equity: number
    cash: number
    unrealized_pl: number
  }
  positions?: Array<{
    symbol: string
    side: string
    qty: number
    entry_price: number
    current_price: number
    unrealized_pl: number
    unrealized_plpc: number
  }>
  broker: string
}

export interface ActivityReport {
  ok: boolean
  gate_status: 'DEAD' | 'SLOW' | 'ALIVE' | 'HOT'
  activity_score: number
  tick_score: number
}
