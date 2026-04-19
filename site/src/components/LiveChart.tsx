import React, { useEffect, useRef, useCallback, useState } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type CandlestickData,
  type SeriesMarker,
  type Time,
  type LineData,
} from 'lightweight-charts'
import type { AlgoSignal } from '../types'
import {
  type Bar,
  computeBB,
  computeKC,
  computeSqueezeMask,
  computeIchimoku,
  ema,
} from './indicators/indicatorMath'
import { createIchimokuCloudPrimitive } from './indicators/ichimokuPrimitive'
import { createEmaRibbonPrimitive } from './indicators/emaRibbonPrimitive'
import { createSqueezeBandsPrimitive } from './indicators/squeezeBandsPrimitive'
import { computeHeatSeeker, type HeatState, type TargetHeat } from './indicators/heatseekerMath'
import { createHeatSeekerPrimitive } from './indicators/heatseekerPrimitive'

// ── Symbol classification ──────────────────────────────────────────────────────

const CRYPTO_BASES = new Set([
  'BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','MATIC','DOT',
  'LINK','UNI','ATOM','LTC','NEAR','FIL','APT','ARB','OP','INJ',
  'SUI','SEI','TIA','PEPE','SHIB','WLD','JTO','PYTH','BOME','BONK',
  'MANA','SAND','AXS','GALA','IMX','BLUR','DYDX','GMX','SNX','CRV',
  'AAVE','COMP','MKR','YFI','SUSHI','1INCH','BAL','REN','ZRX',
  'MSTR','COIN','HOOD','PLTR',
])

function isCrypto(sym: string): boolean {
  const base = sym.toUpperCase().replace(/USDT$|BUSD$|BTC$|ETH$/, '')
  return CRYPTO_BASES.has(base)
}

function toBinanceSymbol(sym: string): string {
  sym = sym.toUpperCase()
  if (sym.endsWith('USDT') || sym.endsWith('BUSD')) return sym
  return sym + 'USDT'
}

function toBinanceInterval(tf: string): string {
  const map: Record<string, string> = {
    '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '4h': '4h', '1d': '1d',
  }
  return map[tf] ?? '1h'
}

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }

async function fetchBinanceKlines(sym: string, tf: string, limit = 300): Promise<Kline[]> {
  const symbol = toBinanceSymbol(sym)
  const interval = toBinanceInterval(tf)
  const url = `/binance/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Binance ${res.status}: ${symbol}`)
  const rows: any[][] = await res.json()
  return rows.map(r => ({
    time: Math.floor(Number(r[0]) / 1000),
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    volume: parseFloat(r[5]),
  }))
}

async function fetchStockKlines(sym: string, tf: string, limit = 300): Promise<Kline[]> {
  const url = `/ds/v1/chart/${sym.toUpperCase()}/?tf=${tf}&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Stock data ${res.status}: ${sym}`)
  const data = await res.json()
  return (data.bars ?? []) as Kline[]
}

// ── Chart config ──────────────────────────────────────────────────────────────

interface LiveChartProps {
  symbol: string
  timeframe: string
  signals?: AlgoSignal[]
}

const CHART_OPTS = {
  layout: {
    background: { type: ColorType.Solid, color: '#0d1117' },
    textColor: '#8f99a8',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(255,255,255,0.04)' },
    horzLines: { color: 'rgba(255,255,255,0.04)' },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: 'rgba(255,183,77,0.5)', labelBackgroundColor: '#1c2127' },
    horzLine: { color: 'rgba(255,183,77,0.5)', labelBackgroundColor: '#1c2127' },
  },
  rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)', textColor: '#8f99a8' },
  timeScale: {
    borderColor: 'rgba(255,255,255,0.1)',
    textColor: '#8f99a8',
    timeVisible: true,
    secondsVisible: false,
  },
}

const CANDLE_OPTS = {
  upColor: '#4ade80',
  downColor: '#f43f5e',
  borderUpColor: '#4ade80',
  borderDownColor: '#f43f5e',
  wickUpColor: '#4ade80',
  wickDownColor: '#f43f5e',
}

// BB line series: excluded from autoscale so they don't distort the price range
const LINE_NO_AUTOSCALE = {
  priceLineVisible: false,
  lastValueVisible: false,
  autoscaleInfoProvider: () => null,
}

// ── Pill button ───────────────────────────────────────────────────────────────

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 10,
        padding: '2px 7px',
        borderRadius: 4,
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'monospace',
        background: active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.05)',
        color: active ? '#fff' : '#556070',
        transition: 'background 0.15s',
        userSelect: 'none',
      }}
    >
      {label}
    </button>
  )
}

// ── HeatSeeker overlay ────────────────────────────────────────────────────────

const DC: Record<string, string>  = { BULL: '#4ade80', BEAR: '#f43f5e', NEUTRAL: '#60a5fa' }
const SC: Record<string, string>  = { bull: '#4ade80', bear: '#f43f5e', neutral: '#334155' }
// fire/gas/calm palette (matches primitive)
const HC: Record<TargetHeat, { line: string; glow: string }> = {
  FIRE: { line: '#ff6b00', glow: 'rgba(255,107,0,0.7)' },
  GAS:  { line: '#00d4ff', glow: 'rgba(0,212,255,0.6)' },
  CALM: { line: '#60a5fa', glow: 'rgba(96,165,250,0.4)' },
}

// ── HEAT error badge (when bars loaded but compute failed) ────────────────────
function HeatError() {
  return (
    <div style={{
      position: 'absolute', top: 40, left: 6, zIndex: 9999,
      padding: '3px 7px', borderRadius: 4,
      background: 'rgba(248,113,113,0.85)', border: '1px solid #f87171',
      fontFamily: "'SF Mono','Fira Code',monospace", fontSize: 9, color: '#fff',
      pointerEvents: 'none',
    }}>
      HEAT ERR — check console
    </div>
  )
}

// ── Signal rail (left edge) ───────────────────────────────────────────────────
function HeatSignalRail({ state }: { state: HeatState }) {
  return (
    <div style={{
      position: 'absolute', top: 40, left: 0, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 3,
      padding: '8px 0 8px 6px',
      pointerEvents: 'none', userSelect: 'none',
    }}>
      {state.signals.map(sig => {
        const c = SC[sig.dir] ?? '#334155'
        const glow = sig.dir !== 'neutral' ? `0 0 6px ${c}` : 'none'
        return (
          <div key={sig.id} style={{
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {/* dot */}
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: c, boxShadow: glow,
              flexShrink: 0,
            }} />
            {/* label */}
            <span style={{
              fontSize: 9, fontFamily: "'SF Mono','Fira Code',monospace",
              color: sig.dir !== 'neutral' ? c : '#2d3748',
              fontWeight: sig.dir !== 'neutral' ? 700 : 400,
              letterSpacing: 0.5,
              textShadow: sig.dir !== 'neutral' ? glow : 'none',
              lineHeight: 1,
            }}>{sig.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── JEDI arrow (combined direction + strength) ────────────────────────────────
// Score < 15 → blue calm horizontal. 15–90 → angle ramps. >90 → capped at 75°.
// BULL = positive angle (up-right). BEAR = negative (down-right).
function HeatJediArrow({ state }: { state: HeatState }) {
  const score = state.composite
  const calm  = score < 15 || state.direction === 'NEUTRAL'

  // Color: use heat palette when active, blue when calm
  const heatC = HC[state.targetHeat]
  const dc    = calm ? '#60a5fa' : heatC.line

  // Directional color tint: BULL=green, BEAR=red, blended with heat color
  const dirC  = calm ? '#60a5fa' : DC[state.direction] ?? heatC.line

  // angle: 0 = right, positive = up-right (BULL), negative = down-right (BEAR)
  const maxAngle = 75
  const rawAngle = calm ? 0 : ((Math.min(score, 90) - 15) / 75) * maxAngle
  const angle    = state.direction === 'BEAR' ? -rawAngle : rawAngle

  const intensity = calm ? 0.45 : state.targetHeat === 'FIRE' ? 1.0 : 0.85
  const glowStr   = calm
    ? '0 0 10px #60a5fa66'
    : `0 0 20px ${heatC.glow}, 0 0 40px ${dirC}44`

  // SVG arrow: shaft + head, pointing right (rotation handles direction)
  // Centered at 40×40 viewBox
  return (
    <div style={{
      position: 'absolute', bottom: 50, right: 16, zIndex: 9999,
      pointerEvents: 'none', userSelect: 'none',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        {/* Composite score */}
        <span style={{
          fontSize: 9, fontFamily: "'SF Mono','Fira Code',monospace",
          color: dc, fontWeight: 700, letterSpacing: 1,
          textShadow: `0 0 8px ${dc}`,
          opacity: intensity,
        }}>
          {Math.round(score)}
        </span>
        {/* Arrow SVG */}
        <svg
          width="52" height="52"
          viewBox="-26 -26 52 52"
          style={{
            transform: `rotate(${-angle}deg)`,
            transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
            filter: `drop-shadow(0 0 8px ${dirC}) drop-shadow(0 0 16px ${dc}66)`,
            opacity: intensity,
          }}
        >
          {/* Shaft — heat color */}
          <line x1="-20" y1="0" x2="10" y2="0"
            stroke={dc} strokeWidth="3" strokeLinecap="round" />
          {/* Directional core stripe */}
          <line x1="-20" y1="0" x2="10" y2="0"
            stroke={dirC} strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
          {/* Head — direction color */}
          <polygon points="10,-8 26,0 10,8" fill={dirC} />
          <polygon points="10,-5 22,0 10,5" fill={dc} opacity="0.7" />
          {/* Bright core */}
          <line x1="-20" y1="0" x2="8" y2="0"
            stroke="white" strokeWidth="0.8" strokeLinecap="round" opacity="0.3" />
        </svg>
        {/* Direction label */}
        <span style={{
          fontSize: 8, fontFamily: "'SF Mono','Fira Code',monospace",
          color: dc, letterSpacing: 1, opacity: intensity,
          textShadow: `0 0 6px ${dc}`,
        }}>
          {calm ? 'CALM' : state.direction}
        </span>
      </div>
      {/* Outer glow ring */}
      <div style={{
        position: 'absolute', inset: -4,
        borderRadius: '50%',
        border: `1px solid ${dc}33`,
        boxShadow: glowStr,
        pointerEvents: 'none',
      }} />
    </div>
  )
}

// ── Compact target table (bottom of signal rail) ──────────────────────────────
function HeatTargetTable({ state }: { state: HeatState }) {
  const bull = state.direction === 'BULL'
  const bear = state.direction === 'BEAR'
  const tc   = bull ? '#4ade80' : bear ? '#f43f5e' : '#94a3b8'
  const fmt  = (p: number) => p.toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: state.atr < 0.01 ? 6 : 4,
  })
  return (
    <div style={{
      position: 'absolute', top: 40 + state.signals.length * 18 + 10, left: 0,
      zIndex: 9999, padding: '6px 8px',
      background: 'rgba(8,12,18,0.82)',
      borderRadius: '0 4px 4px 0',
      borderRight: `1px solid ${tc}33`,
      pointerEvents: 'none', userSelect: 'none',
    }}>
      {[
        { badge: '②', label: 'T2',   price: state.tgt2, c: tc + 'aa' },
        { badge: '①', label: 'T1',   price: state.tgt1, c: tc },
        { badge: '◎', label: 'IN',   price: state.entry, c: '#475569' },
        { badge: '⊗', label: 'STP',  price: state.stop,  c: '#f97316' },
      ].map(({ badge, label, price, c }) => (
        <div key={label} style={{
          display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2,
        }}>
          <span style={{ fontSize: 10, color: c, width: 12, textAlign: 'center',
            textShadow: `0 0 6px ${c}` }}>{badge}</span>
          <span style={{ fontSize: 8, color: '#2d3748', width: 22,
            fontFamily: "'SF Mono','Fira Code',monospace" }}>{label}</span>
          <span style={{ fontSize: 9, color: c, fontWeight: 700,
            fontFamily: "'SF Mono','Fira Code',monospace",
            textShadow: `0 0 5px ${c}88` }}>{fmt(price)}</span>
        </div>
      ))}
      {/* votes + score */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 4, marginTop: 3,
        display: 'flex', gap: 6, fontSize: 8,
        fontFamily: "'SF Mono','Fira Code',monospace", color: '#334155' }}>
        <span style={{ color: '#4ade80' }}>▲{state.bullVotes}</span>
        <span style={{ color: '#f43f5e' }}>▼{state.bearVotes}</span>
        <span style={{ color: DC[state.direction] ?? '#60a5fa', fontWeight: 700 }}>
          {Math.round(state.composite)}
        </span>
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export const LiveChart: React.FC<LiveChartProps> = ({ symbol, timeframe, signals = [] }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const seriesRef    = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef       = useRef<ISeriesApi<'Histogram'> | null>(null)
  const wsRef        = useRef<WebSocket | null>(null)
  const statusRef    = useRef<HTMLSpanElement | null>(null)
  const barsRef      = useRef<Bar[]>([])
  // line series for BB (recreated on toggle)
  const bbSeriesRef  = useRef<ISeriesApi<'Line'>[]>([])

  const heatPrimRef  = useRef<ReturnType<typeof createHeatSeekerPrimitive> | null>(null)
  const heatLinesRef = useRef<IPriceLine[]>([])
  const [heatState,  setHeatState]  = useState<HeatState | null>(null)

  // Exact 4 toggles from TvLwChartsLivePage
  const [showBB,     setShowBB]     = useState(true)
  const [showIchi,   setShowIchi]   = useState(true)
  const [showMas,    setShowMas]    = useState(false)
  const [showPurple, setShowPurple] = useState(true)
  const [showHeat,   setShowHeat]   = useState(false)

  const buildMarkers = useCallback(
    (sigs: AlgoSignal[]): SeriesMarker<Time>[] =>
      sigs
        .filter(s => s.vote !== 0)
        .map(s => ({
          time: s.time as Time,
          position: (s.vote > 0 ? 'belowBar' : 'aboveBar') as import('lightweight-charts').SeriesMarkerPosition,
          color: s.vote > 0 ? '#4ade80' : '#f43f5e',
          shape: (s.vote > 0 ? 'arrowUp' : 'arrowDown') as import('lightweight-charts').SeriesMarkerShape,
          text: s.algo_id,
          size: 1,
        }))
        .sort((a, b) => (a.time as number) - (b.time as number)),
    []
  )

  // ── Remove all indicator overlays (primitives + BB line series) ──────────────
  // Primitives are attached to the candle series; to remove them we recreate
  // the series. Instead we track them via refs and detach/re-attach.
  // Simpler: re-render the indicator layer by calling drawIndicators when needed.

  const clearBBLines = useCallback(() => {
    for (const s of bbSeriesRef.current) {
      try { chartRef.current?.removeSeries(s) } catch {}
    }
    bbSeriesRef.current = []
  }, [])

  // ── Draw/redraw all indicator overlays onto the existing candle series ────────
  const drawIndicators = useCallback((
    bars: Bar[],
    bbOn: boolean,
    ichiOn: boolean,
    masOn: boolean,
    purpleOn: boolean,
  ) => {
    const chart  = chartRef.current
    const series = seriesRef.current
    if (!chart || !series || bars.length < 26) return

    clearBBLines()
    // Detach primitives: recreate candle series each time indicators change.
    // lightweight-charts v4: primitives don't have a public remove method,
    // so we re-attach on the existing series. Since we only call this after
    // full data load (not tick updates), this is safe.

    const closes = bars.map(b => b.close)
    const highs  = bars.map(b => b.high)
    const lows   = bars.map(b => b.low)
    const times  = bars.map(b => b.time)

    // BB — line series (color: #58a6ff at 50% = rgba(88,166,255,0.5))
    if (bbOn) {
      const bb = computeBB(closes, 20, 2.25)
      for (const values of [bb.upper, bb.lower]) {
        const s = chart.addLineSeries({
          ...LINE_NO_AUTOSCALE,
          color: 'rgba(88, 166, 255, 0.5)',
          lineWidth: 1,
        })
        const data: LineData[] = []
        for (let i = 0; i < values.length; i++) {
          if (isFinite(values[i]!)) data.push({ time: times[i] as Time, value: values[i]! })
        }
        s.setData(data)
        bbSeriesRef.current.push(s)
      }
    }

    // ICHI — canvas primitive on candle series
    if (ichiOn) {
      const { senkouA, senkouB } = computeIchimoku(bars)
      series.attachPrimitive(createIchimokuCloudPrimitive(bars, senkouA, senkouB))
    }

    // MAs — EMA38/62 ribbon primitive (same as M4D-REF showMas)
    if (masOn) {
      const fast = ema(closes, 38)
      const slow = ema(closes, 62)
      series.attachPrimitive(createEmaRibbonPrimitive(bars, fast, slow))
    }

    // PURPLE — squeeze background (BB inside KC)
    if (purpleOn) {
      const bb = computeBB(closes, 20, 2.25)
      const kc = computeKC(highs, lows, closes, 20, 2.0)
      const mask = computeSqueezeMask(bb, kc)
      // 50% of ref default 22% → 11%
      series.attachPrimitive(createSqueezeBandsPrimitive(times, mask, 'rgba(136, 46, 224, 0.11)'))
    }
  }, [clearBBLines])

  // ── HeatSeeker: attach/detach glow primitive + price lines ──────────────────
  const drawHeat = useCallback((bars: Bar[], on: boolean) => {
    console.log('[HEAT] drawHeat on=', on, 'bars=', bars.length, 'series=', !!seriesRef.current)
    const series = seriesRef.current
    if (!series) { console.warn('[HEAT] no series'); return }

    // Clear previous glow primitive
    if (heatPrimRef.current) {
      try { series.detachPrimitive(heatPrimRef.current) } catch {}
      heatPrimRef.current = null
    }
    // Clear previous price lines
    for (const ln of heatLinesRef.current) {
      try { series.removePriceLine(ln) } catch {}
    }
    heatLinesRef.current = []

    if (!on || bars.length < 60) {
      console.log('[HEAT] off or not enough bars (', bars.length, ')')
      setHeatState(null); return
    }

    let hs: ReturnType<typeof computeHeatSeeker> | null = null
    try {
      hs = computeHeatSeeker(bars)
      console.log('[HEAT] computed:', hs ? `entry=${hs.entry} t1=${hs.tgt1} score=${hs.composite}` : 'null')
    } catch (err) {
      console.error('[HeatSeeker] compute failed:', err)
      setHeatState(null)
      return
    }

    if (!hs || !isFinite(hs.entry)) {
      console.warn('[HeatSeeker] invalid state — entry=', hs?.entry)
      setHeatState(null)
      return
    }

    setHeatState(hs)

    // ── fire/gas/calm palette for price lines ──────────────────────────────
    const HEAT_COLOR: Record<string, { t1: string; t2: string }> = {
      FIRE: { t1: '#ff6b00', t2: '#ff6b0088' },
      GAS:  { t1: '#00d4ff', t2: '#00d4ff88' },
      CALM: { t1: '#60a5fa', t2: '#60a5fa66' },
    }
    const hc = HEAT_COLOR[hs.targetHeat] ?? HEAT_COLOR.CALM

    // Safe price guard — skip NaN/Infinity entries to prevent TVLW throws
    const safeLine = (price: number, color: string, lw: number, style: LineStyle, visible: boolean, title: string) => {
      if (!isFinite(price)) return null
      try {
        return series!.createPriceLine({ price, color, lineWidth: lw as 1|2|3|4, lineStyle: style, axisLabelVisible: visible, title })
      } catch (e) {
        console.warn('[HeatSeeker] createPriceLine failed for price', price, e)
        return null
      }
    }

    // Native TVLW price lines — guaranteed visible (confirmed working API)
    const lines = [
      safeLine(hs.tgt2,  hc.t2,      1, LineStyle.Dashed,  true,  '② T2'),
      safeLine(hs.tgt1,  hc.t1,      2, LineStyle.Dashed,  true,  '① T1'),
      safeLine(hs.entry, '#ffffff22', 1, LineStyle.Dotted,  false, ''),
      safeLine(hs.stop,  '#f97316',  2, LineStyle.Dashed,  true,  '⊗ STOP'),
    ].filter((l): l is IPriceLine => l !== null)
    heatLinesRef.current = lines

    // Gas-fire glow halos via canvas primitive
    try {
      const prim = createHeatSeekerPrimitive(hs)
      series.attachPrimitive(prim)
      heatPrimRef.current = prim
    } catch (err) {
      console.warn('[HeatSeeker] primitive attach failed:', err)
    }
  }, [])

  // ── Init chart once ──────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      ...CHART_OPTS,
      width: container.clientWidth,
      height: container.clientHeight || 400,
    })
    chartRef.current = chart

    const series = chart.addCandlestickSeries(CANDLE_OPTS)
    seriesRef.current = series

    const vol = chart.addHistogramSeries({
      color: '#334155',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, borderVisible: false })
    volRef.current = vol

    const ro = new ResizeObserver(entries => {
      const e = entries[0]
      if (e && chartRef.current) {
        chartRef.current.applyOptions({ width: e.contentRect.width, height: e.contentRect.height })
        chartRef.current.timeScale().fitContent()
      }
    })
    ro.observe(container)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      volRef.current = null
      bbSeriesRef.current = []
    }
  }, [])

  // ── Fetch + render when symbol/timeframe changes ───────────────────────────
  useEffect(() => {
    if (!seriesRef.current) return
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }

    const setStatus = (text: string, color = '#64748b') => {
      if (statusRef.current) { statusRef.current.textContent = text; statusRef.current.style.color = color }
    }
    setStatus('loading…')

    let alive = true
    const crypto = isCrypto(symbol)

    const fetchKlines = crypto
      ? fetchBinanceKlines(symbol, timeframe, 300)
      : fetchStockKlines(symbol, timeframe, 300)

    fetchKlines.then(klines => {
      if (!alive || !seriesRef.current) return

      const bars: Bar[] = klines.map(k => ({
        time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
      }))
      barsRef.current = bars

      seriesRef.current.setData(bars.map(b => ({
        time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close,
      })) as CandlestickData[])

      volRef.current?.setData(klines.map(k => ({
        time: k.time as Time,
        value: k.volume,
        color: k.close >= k.open ? 'rgba(74,222,128,0.25)' : 'rgba(244,63,94,0.25)',
      })))

      chartRef.current?.timeScale().fitContent()
      setStatus('live', '#4ade80')

      drawIndicators(bars, showBB, showIchi, showMas, showPurple)
      drawHeat(bars, showHeat)

      // WebSocket live tick (crypto only)
      if (!crypto) return
      const binSym = toBinanceSymbol(symbol).toLowerCase()
      const interval = toBinanceInterval(timeframe)
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${binSym}@kline_${interval}`)
      wsRef.current = ws

      ws.onmessage = (evt) => {
        if (!seriesRef.current) return
        try {
          const msg = JSON.parse(evt.data)
          const k = msg.k
          if (!k) return
          const bar: CandlestickData = {
            time: Math.floor(k.t / 1000) as Time,
            open: parseFloat(k.o), high: parseFloat(k.h),
            low: parseFloat(k.l), close: parseFloat(k.c),
          }
          seriesRef.current.update(bar)
          volRef.current?.update({
            time: bar.time, value: parseFloat(k.v),
            color: parseFloat(k.c) >= parseFloat(k.o) ? 'rgba(74,222,128,0.25)' : 'rgba(244,63,94,0.25)',
          })
          setStatus(`● ${parseFloat(k.c).toFixed(2)}`, '#4ade80')
        } catch {}
      }
      ws.onerror = () => setStatus('ws error', '#f87171')
      ws.onclose = () => { if (alive) setStatus('reconnecting…', '#fbbf24') }

    }).catch(err => {
      if (alive) setStatus(`error: ${err.message}`, '#f87171')
    })

    return () => {
      alive = false
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe])

  // ── Redraw indicators when toggles change ─────────────────────────────────
  useEffect(() => {
    const bars = barsRef.current
    if (bars.length > 0) drawIndicators(bars, showBB, showIchi, showMas, showPurple)
  }, [showBB, showIchi, showMas, showPurple, drawIndicators])

  useEffect(() => {
    drawHeat(barsRef.current, showHeat)
  }, [showHeat, drawHeat])

  // ── Update markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current) return
    seriesRef.current.setMarkers(buildMarkers(signals))
  }, [signals, buildMarkers])

  return (
    <div className="chart-container">
      {/* symbol + tf + status */}
      <div style={{
        position: 'absolute', top: 12, left: 16, zIndex: 10,
        display: 'flex', gap: 8, alignItems: 'center', pointerEvents: 'none',
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
          {symbol}
        </span>
        <span style={{
          fontSize: 11, color: '#FFB74D', background: 'rgba(255,183,77,0.15)',
          padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace',
        }}>
          {timeframe}
        </span>
        <span ref={statusRef} style={{ fontSize: 10, fontFamily: 'monospace', color: '#64748b' }} />
      </div>

      {/* Indicator toggles */}
      <div style={{
        position: 'absolute', top: 10, right: 12, zIndex: 10,
        display: 'flex', gap: 4, alignItems: 'center',
      }}>
        <Pill label="BB"     active={showBB}     onClick={() => setShowBB(v => !v)} />
        <Pill label="ICHI"   active={showIchi}   onClick={() => setShowIchi(v => !v)} />
        <Pill label="MAs"    active={showMas}    onClick={() => setShowMas(v => !v)} />
        <Pill label="PURPLE" active={showPurple} onClick={() => setShowPurple(v => !v)} />
        <Pill label="HEAT"   active={showHeat}   onClick={() => setShowHeat(v => !v)} />
      </div>

      {/* HeatSeeker debug sentinel — always visible when HEAT is on */}
      {showHeat && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '2px 10px', borderRadius: 3,
          background: heatState ? 'rgba(0,212,100,0.85)' : 'rgba(248,113,113,0.85)',
          fontFamily: 'monospace', fontSize: 9, color: '#fff', pointerEvents: 'none',
          letterSpacing: 1,
        }}>
          {heatState
            ? `HEAT ${heatState.targetHeat} ${heatState.direction} ${Math.round(heatState.composite)}`
            : 'HEAT — no data (check console)'}
        </div>
      )}

      {/* HeatSeeker overlay */}
      {showHeat && heatState && (
        <>
          <HeatSignalRail   state={heatState} />
          <HeatTargetTable  state={heatState} />
          <HeatJediArrow    state={heatState} />
        </>
      )}
      {showHeat && !heatState && <HeatError />}

      {/* Jump to latest */}
      <button
        onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
        title="Jump to latest"
        style={{
          position: 'absolute', bottom: 36, right: 12, zIndex: 10,
          width: 28, height: 28, borderRadius: 4, border: 'none',
          background: 'rgba(255,255,255,0.08)', color: '#8f99a8',
          cursor: 'pointer', fontSize: 14, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          lineHeight: 1,
        }}
      >
        ⏩
      </button>

      {/* YODA Chart Vision — screenshot to Grok */}
      <button
        onClick={() => {
          const canvas = chartRef.current?.takeScreenshot()
          if (!canvas) return
          const b64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
          // Store in sessionStorage for WIZZO to pick up
          try { sessionStorage.setItem('m3d.chart.snapshot', JSON.stringify({
            b64, symbol, tf: timeframe, ts: Date.now(),
          })) } catch {}
          // Visual feedback
          const btn = document.getElementById('chart-vision-btn')
          if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '👁' }, 1500) }
        }}
        id="chart-vision-btn"
        title="Send chart to YODA (Grok vision)"
        style={{
          position: 'absolute', bottom: 70, right: 12, zIndex: 10,
          width: 28, height: 28, borderRadius: 4,
          border: '1px solid rgba(168,85,247,0.3)',
          background: 'rgba(168,85,247,0.15)', color: '#a855f7',
          cursor: 'pointer', fontSize: 14, display: 'flex',
          alignItems: 'center', justifyContent: 'center', lineHeight: 1,
        } as React.CSSProperties}
      >
        👁
      </button>

      <div ref={containerRef} className="chart-inner" />
    </div>
  )
}

// ─── Equity curve (area chart) ────────────────────────────────────────────────

interface EquityChartProps {
  data: Array<{ date: string; equity: number }>
  height?: number
}

export const EquityChart: React.FC<EquityChartProps> = ({ data, height = 200 }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      ...CHART_OPTS,
      width: container.clientWidth,
      height,
      rightPriceScale: { ...CHART_OPTS.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } },
    })
    chartRef.current = chart

    const series = chart.addAreaSeries({
      lineColor: '#4ade80',
      topColor: 'rgba(74, 222, 128, 0.25)',
      bottomColor: 'rgba(74, 222, 128, 0.0)',
      lineWidth: 2,
    })

    if (data.length > 0) {
      const parsed = data
        .map(d => ({ time: d.date as Time, value: d.equity }))
        .sort((a, b) => (a.time < b.time ? -1 : 1))
      series.setData(parsed)
      chart.timeScale().fitContent()
    }

    const ro = new ResizeObserver(entries => {
      const e = entries[0]
      if (e && chartRef.current) chartRef.current.applyOptions({ width: e.contentRect.width })
    })
    ro.observe(container)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [data, height])

  return (
    <div ref={containerRef} style={{ width: '100%', height, background: '#0d1117', borderRadius: 6 }} />
  )
}
