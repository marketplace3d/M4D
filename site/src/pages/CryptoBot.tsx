/**
 * Paper crypto bot — Binance public OHLCV via /binance proxy, local strategies, no keys.
 * Main chart: LW-charts candlestick + trade markers + indicator overlays.
 * Secondary chart: LW-charts line (equity curve).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  HTMLSelect,
  NumericInput,
  Tag,
  HTMLTable,
  Slider,
} from '@blueprintjs/core'
import {
  createChart,
  ColorType,
  CrosshairMode,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  type Bar,
  computeBB,
  computeKC,
  computeSqueezeMask,
  computeIchimoku,
  ema as emaRibbon,
} from '../components/indicators/indicatorMath'
import { createIchimokuCloudPrimitive } from '../components/indicators/ichimokuPrimitive'
import { createEmaRibbonPrimitive } from '../components/indicators/emaRibbonPrimitive'
import { createSqueezeBandsPrimitive } from '../components/indicators/squeezeBandsPrimitive'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
interface Position { pair: string; entry: number; qty: number; amount: number; entryTime: number }
interface Trade {
  id: string; pair: string; entry: number; exit: number
  pnl: number; pnlPct: number; exitTime: number; entryTime: number; reason: string
}
interface EquityPoint { time: number; value: number }
type LogType = 'info' | 'buy' | 'sell' | 'warn' | 'sys'
interface LogEntry { time: string; msg: string; type: LogType }
type Signal = 'BUY' | 'SELL' | 'HOLD'
type Strategy = 'rsi' | 'macd' | 'sma' | 'breakout'
type Pair = 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT' | 'BNBUSDT' | 'XRPUSDT' | 'DOGEUSDT'
type Interval = '1m' | '5m' | '15m' | '1h' | '4h'

// ─── Constants ────────────────────────────────────────────────────────────────

const INIT_CASH = 10_000
const FEE = 0.001
const LIVE_PRICE_MS = 1_500
const LIVE_KLINE_MS = 3_000
const BOT_TICK_MS = 15_000

const PAIRS: Pair[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']
const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '4h']
const STRATEGIES: { value: Strategy; label: string }[] = [
  { value: 'rsi', label: 'RSI Reversal' },
  { value: 'macd', label: 'MACD Crossover' },
  { value: 'sma', label: 'SMA 5×20' },
  { value: 'breakout', label: '20-bar Breakout' },
]

const LOG_COLORS: Record<LogType, string> = {
  info: '#94a3b8', buy: '#4ade80', sell: '#f43f5e', warn: '#FFB74D', sys: '#64748b',
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchBinanceKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const q = new URLSearchParams({ symbol, interval, limit: String(limit) })
  const r = await fetch(`/binance/api/v3/klines?${q}`)
  if (!r.ok) throw new Error(await r.text() || r.statusText)
  const raw = (await r.json()) as unknown[]
  return raw.map(row => {
    const a = row as (number | string)[]
    return { t: Number(a[0]), o: Number(a[1]), h: Number(a[2]), l: Number(a[3]), c: Number(a[4]), v: Number(a[5]) }
  })
}

async function fetchBinanceLastPrice(symbol: string): Promise<number> {
  const q = new URLSearchParams({ symbol })
  const r = await fetch(`/binance/api/v3/ticker/price?${q}`)
  if (!r.ok) throw new Error(await r.text() || r.statusText)
  const j = (await r.json()) as { price: string }
  return Number(j.price)
}

// ─── Indicator math ───────────────────────────────────────────────────────────

function calcSMA(arr: number[], n: number): number | null {
  if (arr.length < n) return null
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n
}

function calcRSI(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null
  const sliced = closes.slice(-n - 1)
  let gains = 0, losses = 0
  for (let i = 1; i < sliced.length; i++) {
    const d = sliced[i] - sliced[i - 1]
    if (d > 0) gains += d; else losses -= d
  }
  return 100 - 100 / (1 + gains / (losses || 0.0001))
}

function calcMACD(closes: number[]): { macd: number | null; signal: number | null } {
  if (closes.length < 26) return { macd: null, signal: null }
  const ema = (arr: number[], n: number): number => {
    const k = 2 / (n + 1)
    let e = arr.slice(0, n).reduce((a, b) => a + b, 0) / n
    for (let i = n; i < arr.length; i++) e = arr[i] * k + e * (1 - k)
    return e
  }
  const macd = ema(closes, 12) - ema(closes, 26)
  return { macd, signal: macd * 0.9 }
}

function computeSignal(
  closes: number[], rsi: number | null, sma20: number | null,
  macd: number | null, last: number, strat: Strategy
): Signal {
  if (!rsi || !sma20) return 'HOLD'
  switch (strat) {
    case 'rsi':
      if (rsi < 32) return 'BUY'
      if (rsi > 68) return 'SELL'
      return 'HOLD'
    case 'macd':
      if (macd === null) return 'HOLD'
      return macd > 0 ? 'BUY' : 'SELL'
    case 'sma': {
      const sma5 = calcSMA(closes, 5)
      if (!sma5) return 'HOLD'
      return sma5 > sma20 ? 'BUY' : 'SELL'
    }
    case 'breakout': {
      const win = closes.slice(-20)
      const maxH = Math.max(...win.slice(0, -1))
      const minL = Math.min(...win.slice(0, -1))
      if (last > maxH) return 'BUY'
      if (last < minL) return 'SELL'
      return 'HOLD'
    }
  }
}

function candlesToBars(candles: Candle[]): Bar[] {
  return candles.map(k => ({
    time: Math.floor(k.t / 1000), open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v,
  }))
}

// ─── Chart constants ──────────────────────────────────────────────────────────

const CHART_OPTS = {
  layout: {
    background: { type: ColorType.Solid, color: '#0d1117' },
    textColor: '#8f99a8', fontFamily: "'SF Mono','Fira Code',monospace", fontSize: 11,
  },
  grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: 'rgba(255,183,77,0.5)', labelBackgroundColor: '#1c2127' },
    horzLine: { color: 'rgba(255,183,77,0.5)', labelBackgroundColor: '#1c2127' },
  },
  rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)', textColor: '#8f99a8' },
  timeScale: { borderColor: 'rgba(255,255,255,0.1)', textColor: '#8f99a8', timeVisible: true, secondsVisible: false },
}

const CANDLE_OPTS = {
  upColor: '#4ade80', downColor: '#f43f5e',
  borderUpColor: '#4ade80', borderDownColor: '#f43f5e',
  wickUpColor: '#4ade80', wickDownColor: '#f43f5e',
}

const LINE_NO_AUTOSCALE = {
  priceLineVisible: false, lastValueVisible: false, autoscaleInfoProvider: () => null,
} as const

const EQUITY_CHART_OPTS = {
  layout: {
    background: { type: ColorType.Solid, color: '#0d1117' },
    textColor: '#8f99a8', fontFamily: "'SF Mono','Fira Code',monospace", fontSize: 10,
  },
  grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', textColor: '#8f99a8' },
  timeScale: { borderColor: 'rgba(255,255,255,0.08)', textColor: '#8f99a8', timeVisible: true, secondsVisible: false },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: '#1c2127', borderRadius: 8, padding: '10px 14px', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'monospace', color: '#e2e8f0' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function SignalBadge({ signal }: { signal: Signal }) {
  const styles: Record<Signal, { bg: string; color: string }> = {
    BUY: { bg: 'rgba(74,222,128,0.15)', color: '#4ade80' },
    SELL: { bg: 'rgba(244,63,94,0.15)', color: '#f43f5e' },
    HOLD: { bg: 'rgba(255,183,77,0.12)', color: '#FFB74D' },
  }
  return (
    <span style={{
      fontSize: 11, padding: '2px 9px', borderRadius: 4, fontWeight: 600,
      fontFamily: 'monospace', letterSpacing: '0.05em', ...styles[signal],
    }}>
      {signal}
    </span>
  )
}

function IndicatorPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 10, padding: '2px 7px', borderRadius: 4, border: 'none', cursor: 'pointer',
        fontFamily: 'monospace',
        background: active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.05)',
        color: active ? '#fff' : '#556070',
        transition: 'background 0.15s', userSelect: 'none',
      }}
    >
      {label}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CryptoBot() {
  const [candles, setCandles] = useState<Candle[]>([])
  const [pair, setPair] = useState<Pair>('BTCUSDT')
  const [interval, setInterval] = useState<Interval>('5m')
  const [strategy, setStrategy] = useState<Strategy>('rsi')
  const [tradeSize, setTradeSize] = useState(20)
  const [stopLoss, setStopLoss] = useState(3)
  const [takeProfit, setTakeProfit] = useState(6)
  const [botRunning, setBotRunning] = useState(false)
  const [live, setLive] = useState(true)

  const [cash, setCash] = useState(INIT_CASH)
  const [position, setPosition] = useState<Position | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])
  const [equityHistory, setEquityHistory] = useState<EquityPoint[]>([
    { time: Math.floor(Date.now() / 1000), value: INIT_CASH },
  ])

  const [winCount, setWinCount] = useState(0)
  const [lossCount, setLossCount] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: '00:00:00', msg: 'Initialised. Select strategy → Start Bot.', type: 'sys' },
  ])
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const [priceChange, setPriceChange] = useState<number | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [loading, setLoading] = useState(false)

  const [rsiLo, setRsiLo] = useState(32)
  const [rsiHi, setRsiHi] = useState(68)

  // Indicators (display)
  const [rsiVal, setRsiVal] = useState<number | null>(null)
  const [sma20Val, setSma20Val] = useState<number | null>(null)
  const [macdVal, setMacdVal] = useState<number | null>(null)
  const [signal, setSignal] = useState<Signal>('HOLD')

  // Indicator overlay toggles
  const [showBB, setShowBB] = useState(true)
  const [showIchi, setShowIchi] = useState(true)
  const [showMas, setShowMas] = useState(false)
  const [showPurple, setShowPurple] = useState(true)

  // Refs for mutable state inside intervals
  const positionRef = useRef<Position | null>(null)
  const cashRef = useRef(INIT_CASH)
  const winRef = useRef(0)
  const lossRef = useRef(0)
  const tradesRef = useRef<Trade[]>([])
  const equityRef = useRef<EquityPoint[]>([{ time: Math.floor(Date.now() / 1000), value: INIT_CASH }])
  const botIntervalRef = useRef<number | null>(null)

  useEffect(() => { positionRef.current = position }, [position])
  useEffect(() => { cashRef.current = cash }, [cash])
  useEffect(() => { winRef.current = winCount }, [winCount])
  useEffect(() => { lossRef.current = lossCount }, [lossCount])
  useEffect(() => { tradesRef.current = trades }, [trades])

  // ── Chart refs ────────────────────────────────────────────────────────────

  const mainChartRef = useRef<HTMLDivElement>(null)
  const mainChartApi = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const bbSeriesRef = useRef<ISeriesApi<'Line'>[]>([])
  const chartIndicatorKeyRef = useRef('')
  const mainRoRef = useRef<ResizeObserver | null>(null)

  const equityChartRef = useRef<HTMLDivElement>(null)
  const equityChartApi = useRef<IChartApi | null>(null)
  const equitySeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const equityRoRef = useRef<ResizeObserver | null>(null)

  const chartIndicatorKey = useMemo(
    () => `${pair}|${interval}|${showBB ? 1 : 0}|${showIchi ? 1 : 0}|${showMas ? 1 : 0}|${showPurple ? 1 : 0}`,
    [pair, interval, showBB, showIchi, showMas, showPurple],
  )

  // ── Logging ───────────────────────────────────────────────────────────────

  const addLog = useCallback((msg: string, type: LogType = 'info') => {
    const time = new Date().toLocaleTimeString('en', { hour12: false })
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 60))
  }, [])

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async (silent = false): Promise<Candle[]> => {
    if (!silent) { setLoading(true); setLoadErr('') }
    try {
      const data = await fetchBinanceKlines(pair, interval, 300)
      setCandles(data)
      if (data.length) {
        const last = data[data.length - 1]
        const prev = data[data.length - 2]
        setLivePrice(last.c)
        if (prev) setPriceChange(((last.c - prev.c) / prev.c) * 100)
        const closes = data.map(c => c.c)
        const r = calcRSI(closes)
        const s20 = calcSMA(closes, 20)
        const { macd } = calcMACD(closes)
        setRsiVal(r)
        setSma20Val(s20)
        setMacdVal(macd)
        setSignal(computeSignal(closes, r, s20, macd, last.c, strategy))
      }
      return data
    } catch (e) {
      const msg = (e as Error).message
      setLoadErr(msg)
      if (!silent) addLog('Fetch error: ' + msg, 'warn')
      return []
    } finally {
      if (!silent) setLoading(false)
    }
  }, [pair, interval, strategy, addLog])

  useEffect(() => { void fetchData(false) }, [fetchData])

  // Live price tick
  useEffect(() => {
    if (!live) return
    let cancelled = false
    const id = window.setInterval(async () => {
      try {
        const px = await fetchBinanceLastPrice(pair)
        if (cancelled) return
        setLivePrice(px)
        setCandles(prev => {
          if (!prev.length) return prev
          const next = [...prev]
          const last = { ...next[next.length - 1] }
          last.c = px; last.h = Math.max(last.h, px); last.l = Math.min(last.l, px)
          next[next.length - 1] = last
          return next
        })
      } catch { /* ignore */ }
    }, LIVE_PRICE_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [live, pair])

  // Full kline refresh
  useEffect(() => {
    if (!live) return
    const id = window.setInterval(() => { void fetchData(true) }, LIVE_KLINE_MS)
    return () => window.clearInterval(id)
  }, [live, fetchData])

  // ── Trade actions ─────────────────────────────────────────────────────────

  const recordEquity = useCallback((newCash: number, pos: Position | null, price: number) => {
    const posVal = pos ? pos.qty * price : 0
    const pt: EquityPoint = { time: Math.floor(Date.now() / 1000), value: newCash + posVal }
    equityRef.current = [...equityRef.current, pt]
    setEquityHistory(equityRef.current)
  }, [])

  const openTrade = useCallback((price: number, currentCash: number) => {
    if (positionRef.current) { addLog('Already in position', 'warn'); return }
    const amount = currentCash * (tradeSize / 100)
    const fee = amount * FEE
    const cost = amount + fee
    if (cost > currentCash) { addLog('Insufficient cash', 'warn'); return }
    const qty = amount / price
    const newPos: Position = { pair, entry: price, qty, amount, entryTime: Date.now() }
    setPosition(newPos)
    positionRef.current = newPos
    const newCash = currentCash - cost
    setCash(newCash)
    cashRef.current = newCash
    recordEquity(newCash, newPos, price)
    addLog(`OPEN LONG ${pair} @ $${price.toFixed(2)} | Qty: ${qty.toFixed(6)} | Size: $${amount.toFixed(2)}`, 'buy')
  }, [pair, tradeSize, recordEquity, addLog])

  const closeTrade = useCallback((price: number, reason = '', pos?: Position | null) => {
    const p = pos ?? positionRef.current
    if (!p) { addLog('No position to close', 'warn'); return }
    const proceeds = p.qty * price
    const fee = proceeds * FEE
    const net = proceeds - fee
    const pnl = net - p.amount
    const pnlPct = (pnl / p.amount) * 100
    const newCash = cashRef.current + net
    setCash(newCash)
    cashRef.current = newCash
    if (pnl > 0) { setWinCount(w => w + 1); winRef.current++ }
    else { setLossCount(l => l + 1); lossRef.current++ }
    const trade: Trade = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pair: p.pair, entry: p.entry, exit: price, pnl, pnlPct,
      exitTime: Date.now(), entryTime: p.entryTime, reason,
    }
    setTrades(prev => [trade, ...prev])
    tradesRef.current = [trade, ...tradesRef.current]
    setPosition(null)
    positionRef.current = null
    recordEquity(newCash, null, price)
    addLog(
      `CLOSE ${p.pair} @ $${price.toFixed(2)} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%) ${reason}`,
      pnl >= 0 ? 'buy' : 'sell',
    )
  }, [recordEquity, addLog])

  const checkSLTP = useCallback((price: number) => {
    const pos = positionRef.current
    if (!pos) return
    const slPrice = pos.entry * (1 - stopLoss / 100)
    const tpPrice = pos.entry * (1 + takeProfit / 100)
    if (price <= slPrice) closeTrade(price, 'SL')
    else if (price >= tpPrice) closeTrade(price, 'TP')
  }, [stopLoss, takeProfit, closeTrade])

  // ── Bot tick ──────────────────────────────────────────────────────────────

  const botTick = useCallback(async () => {
    const data = await fetchData(true)
    if (!data.length) return
    const closes = data.map(c => c.c)
    const price = closes[closes.length - 1]
    const r = calcRSI(closes)
    const s20 = calcSMA(closes, 20)
    const { macd } = calcMACD(closes)
    const sig = computeSignal(closes, r, s20, macd, price, strategy)
    setRsiVal(r); setSma20Val(s20); setMacdVal(macd); setSignal(sig)
    checkSLTP(price)
    if (sig === 'BUY' && !positionRef.current) openTrade(price, cashRef.current)
    else if (sig === 'SELL' && positionRef.current) closeTrade(price, 'Signal')
  }, [fetchData, strategy, checkSLTP, openTrade, closeTrade])

  const toggleBot = useCallback(() => {
    if (!botRunning) {
      setBotRunning(true)
      addLog(`Bot started — ${strategy} on ${pair}`, 'sys')
      void fetchData(false)
      botIntervalRef.current = window.setInterval(() => { void botTick() }, BOT_TICK_MS)
    } else {
      setBotRunning(false)
      if (botIntervalRef.current) clearInterval(botIntervalRef.current)
      addLog('Bot stopped', 'sys')
    }
  }, [botRunning, strategy, pair, fetchData, botTick, addLog])

  useEffect(() => () => { if (botIntervalRef.current) clearInterval(botIntervalRef.current) }, [])

  const resetPaper = useCallback(() => {
    if (botRunning) { setBotRunning(false); if (botIntervalRef.current) clearInterval(botIntervalRef.current) }
    if (positionRef.current && candles.length)
      closeTrade(candles[candles.length - 1].c, 'Reset')
    setCash(INIT_CASH); cashRef.current = INIT_CASH
    setTrades([]); tradesRef.current = []
    setWinCount(0); winRef.current = 0
    setLossCount(0); lossRef.current = 0
    setPosition(null); positionRef.current = null
    const init: EquityPoint[] = [{ time: Math.floor(Date.now() / 1000), value: INIT_CASH }]
    equityRef.current = init; setEquityHistory(init)
    addLog('Paper account reset to $10,000', 'sys')
  }, [botRunning, candles, closeTrade, addLog])

  const manualTrade = useCallback((side: 'BUY' | 'SELL') => {
    if (!candles.length) { addLog('No data — fetch first', 'warn'); return }
    const price = candles[candles.length - 1].c
    if (side === 'BUY') openTrade(price, cashRef.current)
    else closeTrade(price, 'Manual')
  }, [candles, openTrade, closeTrade, addLog])

  // ── Derived ───────────────────────────────────────────────────────────────

  const currentPrice = livePrice ?? 0
  const posVal = position ? position.qty * currentPrice : 0
  const totalPortfolio = cash + posVal
  const pnl = totalPortfolio - INIT_CASH
  const totalTrades = winCount + lossCount
  const winRate = totalTrades ? Math.round((winCount / totalTrades) * 100) : null
  const unrealisedPnl = position ? (currentPrice - position.entry) * position.qty : 0
  const unrealisedPct = position ? ((currentPrice - position.entry) / position.entry) * 100 : 0

  // ── Trade markers for main chart ──────────────────────────────────────────

  const chartMarkers: SeriesMarker<Time>[] = useMemo(() => {
    const m: SeriesMarker<Time>[] = []
    for (const t of trades) {
      const entSec = Math.floor(t.entryTime / 1000) as UTCTimestamp
      const extSec = Math.floor(t.exitTime / 1000) as UTCTimestamp
      m.push({ time: entSec, position: 'belowBar', color: '#4ade80', shape: 'arrowUp', text: 'B', size: 0.9 })
      m.push({ time: extSec, position: 'aboveBar', color: '#f43f5e', shape: 'arrowDown', text: 'S', size: 0.9 })
    }
    return m.sort((a, b) => (a.time as number) - (b.time as number))
  }, [trades])

  // ── Main chart ────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = mainChartRef.current
    if (!el || !candles.length) return

    const mustRebuild = chartIndicatorKeyRef.current !== chartIndicatorKey || mainChartApi.current == null

    if (mustRebuild) {
      mainRoRef.current?.disconnect(); mainRoRef.current = null
      mainChartApi.current?.remove(); mainChartApi.current = null
      seriesRef.current = null; volRef.current = null; bbSeriesRef.current = []
      chartIndicatorKeyRef.current = chartIndicatorKey

      const chart = createChart(el, { ...CHART_OPTS, width: el.clientWidth, height: 360 })
      mainChartApi.current = chart
      const series = chart.addCandlestickSeries(CANDLE_OPTS)
      seriesRef.current = series

      const vol = chart.addHistogramSeries({
        color: '#334155', priceFormat: { type: 'volume' }, priceScaleId: 'vol',
      })
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, borderVisible: false })
      volRef.current = vol

      const bars = candlesToBars(candles)
      if (bars.length >= 26) {
        const closes = bars.map(b => b.close)
        const highs = bars.map(b => b.high)
        const lows = bars.map(b => b.low)
        const times = bars.map(b => b.time)

        if (showBB) {
          const bb = computeBB(closes, 20, 2.25)
          for (const values of [bb.upper, bb.lower]) {
            const s = chart.addLineSeries({ ...LINE_NO_AUTOSCALE, color: 'rgba(88,166,255,0.5)', lineWidth: 1 })
            const d: LineData[] = []
            for (let i = 0; i < values.length; i++) {
              const v = values[i]!
              if (Number.isFinite(v)) d.push({ time: times[i] as Time, value: v })
            }
            s.setData(d)
            bbSeriesRef.current.push(s)
          }
        }
        if (showIchi) {
          const { senkouA, senkouB } = computeIchimoku(bars)
          series.attachPrimitive(createIchimokuCloudPrimitive(bars, senkouA, senkouB))
        }
        if (showMas) {
          const fast = emaRibbon(closes, 38)
          const slow = emaRibbon(closes, 62)
          series.attachPrimitive(createEmaRibbonPrimitive(bars, fast, slow))
        }
        if (showPurple) {
          const bb = computeBB(closes, 20, 2.25)
          const kc = computeKC(highs, lows, closes, 20, 2.0)
          const mask = computeSqueezeMask(bb, kc)
          series.attachPrimitive(createSqueezeBandsPrimitive(times, mask, 'rgba(136,46,224,0.11)'))
        }
      }

      const ro = new ResizeObserver(() => {
        if (mainChartApi.current && el) mainChartApi.current.applyOptions({ width: el.clientWidth })
      })
      ro.observe(el); mainRoRef.current = ro
    }

    const chart = mainChartApi.current
    const series = seriesRef.current
    const vol = volRef.current
    if (!chart || !series) return

    const bars = candlesToBars(candles)
    const cand: CandlestickData[] = candles.map(k => ({
      time: Math.floor(k.t / 1000) as Time, open: k.o, high: k.h, low: k.l, close: k.c,
    }))
    series.setData(cand)
    vol?.setData(candles.map(k => ({
      time: Math.floor(k.t / 1000) as Time, value: k.v,
      color: k.c >= k.o ? 'rgba(74,222,128,0.22)' : 'rgba(244,63,94,0.22)',
    })))
    series.setMarkers(chartMarkers)

    if (bbSeriesRef.current.length === 2) {
      const closes = bars.map(b => b.close)
      const times = bars.map(b => b.time)
      const bb = computeBB(closes, 20, 2.25)
      const du: LineData[] = []; const dl: LineData[] = []
      for (let i = 0; i < bb.upper.length; i++) {
        if (Number.isFinite(bb.upper[i]!)) du.push({ time: times[i] as Time, value: bb.upper[i]! })
        if (Number.isFinite(bb.lower[i]!)) dl.push({ time: times[i] as Time, value: bb.lower[i]! })
      }
      bbSeriesRef.current[0]!.setData(du)
      bbSeriesRef.current[1]!.setData(dl)
    }

    chart.timeScale().scrollToRealTime()
  }, [chartIndicatorKey, candles, chartMarkers, showBB, showIchi, showMas, showPurple])

  // ── Equity curve chart ────────────────────────────────────────────────────

  useEffect(() => {
    const el = equityChartRef.current
    if (!el) return

    if (!equityChartApi.current) {
      const chart = createChart(el, { ...EQUITY_CHART_OPTS, width: el.clientWidth, height: 160 })
      equityChartApi.current = chart
      const series = chart.addLineSeries({
        color: '#4ade80', lineWidth: 2,
        priceLineVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBackgroundColor: '#4ade80',
      })
      equitySeriesRef.current = series

      const ro = new ResizeObserver(() => {
        if (equityChartApi.current && el) equityChartApi.current.applyOptions({ width: el.clientWidth })
      })
      ro.observe(el); equityRoRef.current = ro
    }

    const series = equitySeriesRef.current
    if (!series) return
    const data: LineData[] = equityHistory.map(pt => ({ time: pt.time as Time, value: pt.value }))
    series.setData(data)
    equityChartApi.current?.timeScale().scrollToRealTime()
  }, [equityHistory])

  // Cleanup
  useEffect(() => () => {
    mainRoRef.current?.disconnect()
    mainChartApi.current?.remove(); mainChartApi.current = null
    seriesRef.current = null; volRef.current = null; bbSeriesRef.current = []
    equityRoRef.current?.disconnect()
    equityChartApi.current?.remove(); equityChartApi.current = null
    equitySeriesRef.current = null
  }, [])

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16, background: 'var(--bg-dark, #0d1117)', color: '#e2e8f0' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#4ade80', fontFamily: 'monospace', letterSpacing: 1 }}>
            PAPER CRYPTO BOT
          </span>
          <span style={{
            fontSize: 10, color: '#64748b', background: 'rgba(255,255,255,0.04)',
            padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)',
          }}>
            PAPER · FEES {(FEE * 100).toFixed(1)}% · {LIVE_PRICE_MS / 1000}s TICK
          </span>
          {loadErr && <span style={{ fontSize: 11, color: '#f43f5e' }}>⚠ {loadErr}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
            background: botRunning ? '#4ade80' : '#64748b',
            boxShadow: botRunning ? '0 0 0 3px rgba(74,222,128,0.2)' : 'none',
          }} />
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{botRunning ? 'Running' : 'Idle'}</span>
          <Button
            small intent={botRunning ? 'danger' : 'success'}
            onClick={toggleBot}
            style={{ fontFamily: 'monospace' }}
          >
            {botRunning ? 'Stop Bot' : 'Start Bot'}
          </Button>
          <Button small minimal onClick={resetPaper} style={{ fontFamily: 'monospace', color: '#64748b' }}>
            Reset $10k
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 14 }}>
        <MetricCard
          label="Portfolio"
          value={'$' + totalPortfolio.toLocaleString('en', { maximumFractionDigits: 0 })}
          sub={`${pnl >= 0 ? '+' : ''}${((pnl / INIT_CASH) * 100).toFixed(1)}% return`}
        />
        <MetricCard label="Cash" value={'$' + cash.toLocaleString('en', { maximumFractionDigits: 0 })} />
        <MetricCard
          label="P&L"
          value={(pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2)}
          sub={pnl >= 0 ? undefined : 'drawdown'}
        />
        <MetricCard label="Win Rate" value={winRate !== null ? winRate + '%' : '—'} sub={`${totalTrades} trades`} />
        <MetricCard
          label="Signal"
          value={signal}
          sub={strategy.toUpperCase()}
        />
      </div>

      {/* Main row: chart + strategy */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 12, marginBottom: 12 }}>

        {/* Main chart */}
        <div style={{ background: '#0d1117', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden', position: 'relative' }}>
          {/* Chart toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <HTMLSelect value={pair} onChange={e => setPair(e.target.value as Pair)} style={{ fontSize: 12, minWidth: 120 }}>
                {PAIRS.map(p => <option key={p} value={p}>{p.replace('USDT', '/USDT')}</option>)}
              </HTMLSelect>
              <HTMLSelect value={interval} onChange={e => setInterval(e.target.value as Interval)} style={{ fontSize: 12 }}>
                {INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </HTMLSelect>
              <Button small loading={loading} onClick={() => void fetchData(false)} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                ↻ Refresh
              </Button>
              <Button small active={live} intent={live ? 'success' : 'none'} onClick={() => setLive(l => !l)} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {live ? '● LIVE' : '○ Paused'}
              </Button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 18, fontWeight: 600, fontFamily: 'monospace', color: '#e2e8f0' }}>
                  {livePrice ? '$' + livePrice.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}
                </span>
                {priceChange !== null && (
                  <span style={{ fontSize: 11, marginLeft: 8, color: priceChange >= 0 ? '#4ade80' : '#f43f5e' }}>
                    {(priceChange >= 0 ? '+' : '') + priceChange.toFixed(2) + '%'}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <IndicatorPill label="BB" active={showBB} onClick={() => setShowBB(v => !v)} />
                <IndicatorPill label="ICHI" active={showIchi} onClick={() => setShowIchi(v => !v)} />
                <IndicatorPill label="MAs" active={showMas} onClick={() => setShowMas(v => !v)} />
                <IndicatorPill label="SQZ" active={showPurple} onClick={() => setShowPurple(v => !v)} />
              </div>
            </div>
          </div>
          {/* Indicator stats */}
          <div style={{ display: 'flex', gap: 16, padding: '5px 10px', fontSize: 11, color: '#64748b', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
            <span>RSI <b style={{ color: rsiVal && rsiVal < 32 ? '#4ade80' : rsiVal && rsiVal > 68 ? '#f43f5e' : '#94a3b8' }}>{rsiVal ? rsiVal.toFixed(1) : '—'}</b></span>
            <span>SMA20 <b style={{ color: '#94a3b8' }}>{sma20Val ? '$' + sma20Val.toFixed(2) : '—'}</b></span>
            <span>MACD <b style={{ color: '#94a3b8' }}>{macdVal ? macdVal.toFixed(4) : '—'}</b></span>
            <span>Signal <SignalBadge signal={signal} /></span>
          </div>
          <div ref={mainChartRef} style={{ width: '100%', minHeight: 360 }} />
          <button
            type="button"
            title="Jump to latest"
            onClick={() => mainChartApi.current?.timeScale().scrollToRealTime()}
            style={{
              position: 'absolute', bottom: 28, right: 8, zIndex: 2,
              width: 26, height: 26, borderRadius: 4, border: 'none',
              background: 'rgba(255,255,255,0.08)', color: '#8f99a8', cursor: 'pointer', fontSize: 13,
            }}
          >
            ⏩
          </button>
        </div>

        {/* Strategy config */}
        <div style={{ background: '#1c2127', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB74D', letterSpacing: '0.06em' }}>STRATEGY CONFIG</div>

          <div>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Strategy</div>
            <HTMLSelect value={strategy} onChange={e => setStrategy(e.target.value as Strategy)} fill style={{ fontSize: 12 }}>
              {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </HTMLSelect>
          </div>

          {strategy === 'rsi' && (
            <div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                RSI Buy &lt; <b style={{ color: '#4ade80' }}>{rsiLo}</b> / Sell &gt; <b style={{ color: '#f43f5e' }}>{rsiHi}</b>
              </div>
              <Slider min={10} max={45} value={rsiLo} onChange={setRsiLo} labelRenderer={false} />
              <div style={{ marginTop: 8 }}>
                <Slider min={55} max={90} value={rsiHi} onChange={setRsiHi} labelRenderer={false} />
              </div>
            </div>
          )}

          <div>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Trade Size — <b style={{ color: '#e2e8f0' }}>{tradeSize}% cash</b>
            </div>
            <Slider min={5} max={50} value={tradeSize} onChange={setTradeSize} labelRenderer={false} />
          </div>

          <div>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Stop Loss / Take Profit
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <NumericInput value={stopLoss} min={0.5} max={20} stepSize={0.5} onValueChange={v => setStopLoss(v || 1)} fill style={{ fontSize: 12 }} />
              <NumericInput value={takeProfit} min={0.5} max={50} stepSize={0.5} onValueChange={v => setTakeProfit(v || 2)} fill style={{ fontSize: 12 }} />
            </div>
            <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>SL {stopLoss}% / TP {takeProfit}%</div>
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button intent="success" fill onClick={() => manualTrade('BUY')} style={{ fontFamily: 'monospace' }}>
              Manual BUY
            </Button>
            <Button intent="danger" fill onClick={() => manualTrade('SELL')} style={{ fontFamily: 'monospace' }}>
              Manual SELL
            </Button>
          </div>
        </div>
      </div>

      {/* Second row: open position + equity curve */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>

        {/* Open position */}
        <div style={{ background: '#1c2127', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Open Position
          </div>
          {position ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                {[
                  ['Pair', <Tag key="pair" intent="primary" minimal>{position.pair}</Tag>],
                  ['Side', <Tag key="side" intent="success" minimal>LONG</Tag>],
                  ['Entry', '$' + position.entry.toFixed(2)],
                  ['Current', '$' + currentPrice.toFixed(2)],
                  ['Unrealised', <b key="upnl" style={{ color: unrealisedPnl >= 0 ? '#4ade80' : '#f43f5e' }}>
                    {unrealisedPnl >= 0 ? '+' : ''}${unrealisedPnl.toFixed(2)} ({unrealisedPct.toFixed(1)}%)
                  </b>],
                  ['Qty', position.qty.toFixed(6)],
                  ['Stop Loss', <b key="sl" style={{ color: '#f43f5e' }}>${(position.entry * (1 - stopLoss / 100)).toFixed(2)}</b>],
                  ['Take Profit', <b key="tp" style={{ color: '#4ade80' }}>${(position.entry * (1 + takeProfit / 100)).toFixed(2)}</b>],
                ].map(([label, val], i) => (
                  <div key={i}>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{val}</div>
                  </div>
                ))}
              </div>
              <Button
                intent="danger" fill small style={{ marginTop: 14, fontFamily: 'monospace' }}
                onClick={() => { if (candles.length) closeTrade(candles[candles.length - 1].c, 'Manual') }}
              >
                Close Position
              </Button>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '24px 0' }}>
              No open position
            </div>
          )}
        </div>

        {/* Equity curve */}
        <div style={{ background: '#0d1117', borderRadius: 8, border: '1px solid rgba(74,222,128,0.12)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Equity Curve
            </span>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: pnl >= 0 ? '#4ade80' : '#f43f5e' }}>
              ${totalPortfolio.toFixed(0)} · {pnl >= 0 ? '+' : ''}{((pnl / INIT_CASH) * 100).toFixed(2)}%
            </span>
          </div>
          <div ref={equityChartRef} style={{ width: '100%', minHeight: 160 }} />
        </div>
      </div>

      {/* Trade log table */}
      <div style={{ background: '#1c2127', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Trade History
        </div>
        <HTMLTable compact striped style={{ width: '100%', fontSize: 11 }}>
          <thead>
            <tr>
              {['Pair', 'Entry', 'Exit', 'PnL $', 'PnL %', 'Reason', 'Time'].map(h => (
                <th key={h} style={{ color: '#64748b', fontWeight: 500, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: '#475569', textAlign: 'center', padding: '14px 0' }}>No trades yet</td>
              </tr>
            ) : trades.slice(0, 30).map(t => (
              <tr key={t.id}>
                <td style={{ fontFamily: 'monospace' }}>{t.pair.replace('USDT', '')}</td>
                <td style={{ fontFamily: 'monospace' }}>${t.entry.toFixed(2)}</td>
                <td style={{ fontFamily: 'monospace' }}>${t.exit.toFixed(2)}</td>
                <td style={{ color: t.pnl >= 0 ? '#4ade80' : '#f43f5e', fontFamily: 'monospace' }}>
                  {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                </td>
                <td style={{ color: t.pnl >= 0 ? '#4ade80' : '#f43f5e', fontFamily: 'monospace' }}>
                  {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
                </td>
                <td><Tag minimal intent={t.reason === 'TP' ? 'success' : t.reason === 'SL' ? 'danger' : 'none'}>{t.reason || '—'}</Tag></td>
                <td style={{ color: '#475569', fontSize: 10 }}>{new Date(t.exitTime).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      </div>

      {/* Bot log */}
      <div style={{ background: '#1c2127', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Bot Log
        </div>
        <div style={{ maxHeight: 130, overflowY: 'auto', fontFamily: 'monospace' }}>
          {logs.map((entry, i) => (
            <div key={i} style={{ fontSize: 11, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 10 }}>
              <span style={{ color: '#475569', minWidth: 65, flexShrink: 0 }}>{entry.time}</span>
              <span style={{ color: LOG_COLORS[entry.type] }}>{entry.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
