import {
  useQuery,
  useMutation,
  UseQueryOptions,
} from '@tanstack/react-query'
import type {
  CouncilResponse,
  AlgoDayResponse,
  Asset,
  BacktestParams,
  BacktestResult,
} from '../types'

// Relative URLs — Vite proxy routes /v1 + /health → :3300, /ds → :8800
const BASE_URL = ''

// ─── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

// ─── Query keys ────────────────────────────────────────────────────────────────

export const queryKeys = {
  council: ['council'] as const,
  algoDay: ['algo-day'] as const,
  assets: ['assets'] as const,
  backtest: (params: BacktestParams) => ['backtest', params] as const,
  health: ['health'] as const,
}

// ─── Health ────────────────────────────────────────────────────────────────────

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => fetchJSON<{ status: string }>('/health'),
    refetchInterval: 10_000,
    retry: false,
  })
}

// ─── Council (/v1/council) — polls every 5s ───────────────────────────────────

export function useCouncil(options?: Partial<UseQueryOptions<CouncilResponse>>) {
  return useQuery<CouncilResponse>({
    queryKey: queryKeys.council,
    queryFn: () => fetchJSON<CouncilResponse>('/v1/council'),
    refetchInterval: 5_000,
    staleTime: 4_000,
    placeholderData: {
      total_long: 0,
      total_short: 0,
      jedi_score: 0,
      regime: 'NEUTRAL',
      algos: [],
    },
    ...options,
  })
}

// ─── Algo Day (/v1/algo-day) — polls every 30s ────────────────────────────────

export function useAlgoDay(options?: Partial<UseQueryOptions<AlgoDayResponse>>) {
  return useQuery<AlgoDayResponse>({
    queryKey: queryKeys.algoDay,
    queryFn: () => fetchJSON<AlgoDayResponse>('/v1/algo-day'),
    refetchInterval: 30_000,
    staleTime: 25_000,
    placeholderData: { timestamp: new Date().toISOString(), assets: [] },
    ...options,
  })
}

// ─── Assets (/v1/assets) — long-lived cache ───────────────────────────────────

export function useAssets() {
  return useQuery<Asset[]>({
    queryKey: queryKeys.assets,
    queryFn: async () => {
      const data = await fetchJSON<{ assets: Asset[] } | Asset[]>('/v1/assets')
      return Array.isArray(data) ? data : data.assets
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    placeholderData: [],
  })
}

// ─── Backtest (/v1/backtest) ──────────────────────────────────────────────────

export function useBacktest(params: BacktestParams | null) {
  return useQuery<BacktestResult>({
    queryKey: params ? queryKeys.backtest(params) : ['backtest', 'null'],
    queryFn: () => {
      if (!params) throw new Error('No params')
      const qs = new URLSearchParams({
        asset: params.asset,
        algo: params.algo,
        from: params.from,
        to: params.to,
      })
      return fetchJSON<BacktestResult>(`/v1/backtest?${qs}`)
    },
    enabled: !!params,
    staleTime: 60_000,
    retry: 1,
  })
}

// ─── Backtest mutation (for on-demand runs) ───────────────────────────────────

export function useRunBacktest() {
  return useMutation({
    mutationFn: async (params: BacktestParams): Promise<BacktestResult> => {
      const qs = new URLSearchParams({
        asset: params.asset,
        algo: params.algo,
        from: params.from,
        to: params.to,
      })
      return fetchJSON<BacktestResult>(`/v1/backtest?${qs}`)
    },
  })
}

// ─── DS API (port 8000) — backtest + optimize ────────────────────────────────

// DS calls go through Vite proxy /ds → :8800 (strips /ds prefix)
const DS_URL = '/ds'

async function dsPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${DS_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

async function dsGet<T>(path: string): Promise<T> {
  const res = await fetch(`${DS_URL}${path}`)  // proxied via Vite → :8800
  if (!res.ok) throw new Error(`DS error ${res.status}`)
  return res.json() as Promise<T>
}

export interface CryptoAlgoMeta {
  id: string
  bank: 'A' | 'B' | 'C'
  name: string
  stop_pct: number
  hold_bars: number
  default_params: Record<string, number>
  param_grid: Record<string, number[]>
}

export interface CryptoBacktestResult {
  algo: string
  asset: string
  start: string
  end: string
  params: Record<string, number>
  win_rate: number
  total_return: number
  sharpe: number
  max_drawdown: number
  num_trades: number
  equity_curve: Array<{ t: string; v: number }>
  trades: Array<{
    entry_time: string
    exit_time: string
    entry_price: number
    exit_price: number
    pnl: number
    return_pct: number
    size: number
  }>
}

export interface OptRanking {
  params: Record<string, number>
  is_stats: { total_return: number; sharpe: number; max_dd: number; win_rate: number; n_trades: number }
  oos_stats: { total_return: number; sharpe: number; max_dd: number; win_rate: number; n_trades: number }
  sharpe_decay: number
  rank_score: number
}

export interface OptResult {
  algo_id: string
  asset: string
  start: string
  end: string
  is_end: string
  oos_start: string
  n_combos_tested: number
  ranking: OptRanking[]
  best: OptRanking
}

export function useDsAlgos() {
  return useQuery<CryptoAlgoMeta[]>({
    queryKey: ['ds-algos'],
    queryFn: async () => {
      const data = await dsGet<{ algos: CryptoAlgoMeta[] }>('/v1/algos/')
      return data.algos
    },
    staleTime: Infinity,
  })
}

export function useRunCryptoBacktest() {
  return useMutation({
    mutationFn: (body: { algo: string; asset: string; start: string; end: string; params?: Record<string, number> }) =>
      dsPost<CryptoBacktestResult>('/v1/backtest/', body),
  })
}

export function useRunOptimize() {
  return useMutation({
    mutationFn: (body: { algo: string; asset: string; start: string; end: string; is_pct?: number; min_trades?: number; top_n?: number }) =>
      dsPost<OptResult>('/v1/optimize/', body),
  })
}

// ─── Mock OHLCV data (until chart feed endpoint exists) ───────────────────────

export function generateMockOHLCV(
  symbol: string,
  bars = 200
): Array<{ time: number; open: number; high: number; low: number; close: number }> {
  const seed = symbol.charCodeAt(0) * 13 + symbol.charCodeAt(1 % symbol.length) * 7
  let price = 100 + (seed % 400)
  const now = Math.floor(Date.now() / 1000)
  const interval = 60 * 60 // 1h

  return Array.from({ length: bars }, (_, i) => {
    const time = now - (bars - i) * interval
    const change = (Math.random() - 0.49) * price * 0.015
    const open = price
    price = Math.max(1, price + change)
    const close = price
    const high = Math.max(open, close) * (1 + Math.random() * 0.008)
    const low = Math.min(open, close) * (1 - Math.random() * 0.008)
    return { time, open, high, low, close }
  })
}
