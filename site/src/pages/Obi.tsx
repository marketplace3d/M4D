import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type Time, type LineData,
} from 'lightweight-charts'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

interface ObiTarget {
  rank: number
  label: string
  price: number
  dir: 'UP' | 'DOWN'
  confluence: number
  probability: number
  systems: string[]
  heat: 'FIRE' | 'GAS' | 'CALM'
  color: string
}

interface Predictor {
  id: string
  name: string
  dir: 'BULL' | 'BEAR' | 'NEUTRAL'
  strength: number
}

interface ObiState {
  direction: 'BULL' | 'BEAR' | 'NEUTRAL'
  composite: number
  targets: ObiTarget[]
  predictors: Predictor[]
  stop: number
  entry: number
  rr: number
  atr: number
}

// ── Math: ATR ─────────────────────────────────────────────────────────────────

function calcATR(bars: Bar[], p = 14): number[] {
  const trs = bars.map((b, i) => i === 0 ? b.high - b.low :
    Math.max(b.high - b.low, Math.abs(b.high - bars[i-1].close), Math.abs(b.low - bars[i-1].close)))
  const out: number[] = new Array(bars.length).fill(NaN)
  let s = trs.slice(0, p).reduce((a, b) => a + b, 0)
  out[p - 1] = s / p
  for (let i = p; i < trs.length; i++) out[i] = (out[i-1]! * (p - 1) + trs[i]!) / p
  return out
}

// ── Math: VWAP + bands ────────────────────────────────────────────────────────

function calcVWAP(bars: Bar[]) {
  const n = bars.length
  const mk = () => new Array(n).fill(NaN) as number[]
  const [vwap, u1, d1, u2, d2, u3, d3] = [mk(), mk(), mk(), mk(), mk(), mk(), mk()]
  let cpv = 0, cv = 0, cpv2 = 0
  for (let i = 0; i < n; i++) {
    const { high: h, low: l, close: c, volume: v } = bars[i]
    const tp = (h + l + c) / 3
    cpv += tp * v; cv += v; cpv2 += tp * tp * v
    const vw = cv === 0 ? NaN : cpv / cv
    vwap[i] = vw
    if (cv > 0) {
      const sd = Math.sqrt(Math.max(0, cpv2 / cv - vw * vw))
      u1[i] = vw + sd;   d1[i] = vw - sd
      u2[i] = vw + 2*sd; d2[i] = vw - 2*sd
      u3[i] = vw + 3*sd; d3[i] = vw - 3*sd
    }
  }
  return { vwap, u1, d1, u2, d2, u3, d3 }
}

// ── Math: Volume Profile ──────────────────────────────────────────────────────

function calcVolProfile(bars: Bar[], buckets = 50) {
  if (bars.length < 5) return { poc: 0, vah: 0, val: 0 }
  const hi = Math.max(...bars.map(b => b.high))
  const lo = Math.min(...bars.map(b => b.low))
  const range = hi - lo
  if (range === 0) return { poc: bars[0].close, vah: bars[0].close, val: bars[0].close }
  const bsz = range / buckets
  const vol = new Array(buckets).fill(0) as number[]
  for (const b of bars) {
    const idx = Math.min(buckets - 1, Math.floor(((b.high + b.low + b.close) / 3 - lo) / bsz))
    if (idx >= 0) vol[idx] += b.volume
  }
  const total = vol.reduce((a, b) => a + b, 0)
  const pocIdx = vol.indexOf(Math.max(...vol))
  const poc = lo + (pocIdx + 0.5) * bsz
  let incVol = vol[pocIdx], lo2 = pocIdx, hi2 = pocIdx
  while (incVol < total * 0.70 && (lo2 > 0 || hi2 < buckets - 1)) {
    const up = hi2 + 1 < buckets ? vol[hi2 + 1] : 0
    const dn = lo2 - 1 >= 0 ? vol[lo2 - 1] : 0
    if (up >= dn && hi2 + 1 < buckets) { hi2++; incVol += vol[hi2] }
    else if (lo2 - 1 >= 0)            { lo2--; incVol += vol[lo2] }
    else                               { hi2++; incVol += vol[hi2] }
  }
  return { poc, vah: lo + (hi2 + 1) * bsz, val: lo + lo2 * bsz }
}

// ── Math: ORB ─────────────────────────────────────────────────────────────────

function calcORB(bars: Bar[]) {
  if (bars.length < 10) return null
  const ib = bars.slice(0, 6)
  const ibH = Math.max(...ib.map(b => b.high))
  const ibL = Math.min(...ib.map(b => b.low))
  const sz = ibH - ibL
  const cur = bars[bars.length - 1].close
  const dir: 'BULL' | 'BEAR' | 'NEUTRAL' = cur > ibH ? 'BULL' : cur < ibL ? 'BEAR' : 'NEUTRAL'
  return { ibH, ibL, sz, dir, t1u: ibH + sz, t2u: ibH + sz * 2, t1d: ibL - sz, t2d: ibL - sz * 2 }
}

// ── Math: Fibonacci extensions ────────────────────────────────────────────────

function calcFib(bars: Bar[], dir: 'BULL' | 'BEAR' | 'NEUTRAL') {
  const n = Math.min(50, bars.length)
  const slice = bars.slice(-n)
  const swH = Math.max(...slice.map(b => b.high))
  const swL = Math.min(...slice.map(b => b.low))
  const rng = swH - swL
  const levels = dir === 'BULL'
    ? [1.0, 1.272, 1.618, 2.0, 2.618].map(r => ({ price: swL + rng * r, label: `FIB ${r}`, dir: 'UP' as const }))
    : dir === 'BEAR'
    ? [1.0, 1.272, 1.618, 2.0, 2.618].map(r => ({ price: swH - rng * r, label: `FIB ${r}`, dir: 'DOWN' as const }))
    : []
  return { swH, swL, levels }
}

// ── Math: Classic Pivots ──────────────────────────────────────────────────────

function calcPivots(bars: Bar[]) {
  const prev = bars.slice(-48, -24)
  if (!prev.length) return null
  const H = Math.max(...prev.map(b => b.high))
  const L = Math.min(...prev.map(b => b.low))
  const C = prev[prev.length - 1].close
  const P = (H + L + C) / 3
  return { P, R1: 2*P-L, R2: P+(H-L), R3: H+2*(P-L), S1: 2*P-H, S2: P-(H-L), S3: L-2*(H-P) }
}

// ── Math: Camarilla ───────────────────────────────────────────────────────────

function calcCam(bars: Bar[]) {
  const prev = bars.slice(-48, -24)
  if (!prev.length) return null
  const H = Math.max(...prev.map(b => b.high))
  const L = Math.min(...prev.map(b => b.low))
  const C = prev[prev.length - 1].close
  const r = H - L
  return { H3: C+r*1.1/4, H4: C+r*1.1/2, H5: C+r*1.1, L3: C-r*1.1/4, L4: C-r*1.1/2, L5: C-r*1.1 }
}

// ── Math: ICT — PDH/PDL + FVGs ────────────────────────────────────────────────

function calcICT(bars: Bar[]) {
  const prev = bars.slice(-48, -24)
  const pdh = prev.length ? Math.max(...prev.map(b => b.high)) : 0
  const pdl = prev.length ? Math.min(...prev.map(b => b.low)) : 0
  const fvgBull: { bot: number; top: number }[] = []
  const fvgBear: { bot: number; top: number }[] = []
  const rec = bars.slice(-20)
  for (let i = 2; i < rec.length; i++) {
    if (rec[i-2].high < rec[i].low)  fvgBull.push({ bot: rec[i-2].high, top: rec[i].low })
    if (rec[i-2].low  > rec[i].high) fvgBear.push({ bot: rec[i].high,   top: rec[i-2].low })
  }
  return { pdh, pdl, fvgBull: fvgBull.slice(-2), fvgBear: fvgBear.slice(-2) }
}

// ── Target Ranking Engine ─────────────────────────────────────────────────────

type RawLevel = { price: number; system: string; dir: 'UP' | 'DOWN' | 'BOTH' }
const TARGET_COLORS = ['#ff6b00', '#00d4ff', '#a78bfa', '#4ade80', '#fbbf24', '#f9a8d4']

function rankTargets(levels: RawLevel[], dir: 'BULL' | 'BEAR' | 'NEUTRAL', cur: number, atrVal: number): ObiTarget[] {
  if (!levels.length || dir === 'NEUTRAL') return []
  const tol = atrVal * 0.20
  const filtered = levels.filter(l =>
    dir === 'BULL' ? l.price > cur * 1.001 : l.price < cur * 0.999
  )
  const used = new Set<number>()
  const clusters: RawLevel[][] = []
  const sorted = [...filtered].sort((a, b) => Math.abs(a.price - cur) - Math.abs(b.price - cur))
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue
    const cl = [sorted[i]]; used.add(i)
    for (let j = i+1; j < sorted.length; j++)
      if (!used.has(j) && Math.abs(sorted[j].price - sorted[i].price) <= tol) { cl.push(sorted[j]); used.add(j) }
    clusters.push(cl)
  }
  return clusters.slice(0, 6).map((cl, idx) => {
    const avg = cl.reduce((s, l) => s + l.price, 0) / cl.length
    const systems = [...new Set(cl.map(l => l.system))]
    const conf = systems.length
    const prob = Math.min(95, conf * 11 + Math.max(0, 55 - (Math.abs(avg - cur) / cur) * 1500))
    const heat: ObiTarget['heat'] = conf >= 4 ? 'FIRE' : conf >= 2 ? 'GAS' : 'CALM'
    return {
      rank: idx + 1, label: `T${idx + 1}`, price: avg,
      dir: (dir === 'BULL' ? 'UP' : 'DOWN') as 'UP' | 'DOWN',
      confluence: conf, probability: Math.round(prob),
      systems, heat, color: TARGET_COLORS[idx] ?? '#94a3b8',
    }
  }).sort((a, b) => b.confluence - a.confluence || a.rank - b.rank)
    .map((t, i) => ({ ...t, rank: i+1, label: `T${i+1}` }))
}

// ── Full OBI Engine ───────────────────────────────────────────────────────────

function runOBI(bars: Bar[], jediScore: number): ObiState | null {
  if (bars.length < 50) return null
  const cur = bars[bars.length - 1].close
  const atrArr = calcATR(bars, 14)
  const atrVal = atrArr[bars.length - 1] ?? cur * 0.01

  const vwapData = calcVWAP(bars)
  const vw = vwapData.vwap[bars.length - 1] ?? cur
  const vwapBull = cur > vw

  const orb = calcORB(bars)
  const orbDir = orb?.dir ?? 'NEUTRAL'

  const vp = calcVolProfile(bars)
  const vpBull = cur > (vp.poc || cur)

  const jediBull = jediScore > 10; const jediBear = jediScore < -10

  const bullVotes = [vwapBull, orbDir === 'BULL', vpBull, jediBull].filter(Boolean).length
  const bearVotes = [!vwapBull, orbDir === 'BEAR', !vpBull, jediBear].filter(Boolean).length
  const direction: 'BULL' | 'BEAR' | 'NEUTRAL' =
    bullVotes > bearVotes ? 'BULL' : bearVotes > bullVotes ? 'BEAR' : 'NEUTRAL'
  const composite = Math.round(Math.abs(jediScore) * 0.5 + bullVotes * 15 + bearVotes * 15)

  const levels: RawLevel[] = []
  const add = (price: number, system: string, dir: 'UP' | 'DOWN' | 'BOTH') => {
    if (isFinite(price) && price > 0) levels.push({ price, system, dir })
  }

  // 1. VWAP bands
  const vi = bars.length - 1
  add(vwapData.u1[vi]!, 'VWAP', 'UP');  add(vwapData.d1[vi]!, 'VWAP', 'DOWN')
  add(vwapData.u2[vi]!, 'VWAP', 'UP');  add(vwapData.d2[vi]!, 'VWAP', 'DOWN')
  add(vwapData.u3[vi]!, 'VWAP', 'UP');  add(vwapData.d3[vi]!, 'VWAP', 'DOWN')

  // 2. Volume Profile
  add(vp.poc, 'VOL', 'BOTH'); add(vp.vah, 'VOL', 'UP'); add(vp.val, 'VOL', 'DOWN')

  // 3. ORB targets
  if (orb) {
    add(orb.t1u, 'ORB', 'UP'); add(orb.t2u, 'ORB', 'UP')
    add(orb.t1d, 'ORB', 'DOWN'); add(orb.t2d, 'ORB', 'DOWN')
  }

  // 4. Fibonacci
  const fib = calcFib(bars, direction)
  fib.levels.forEach(l => add(l.price, 'FIB', l.dir))

  // 5. Pivot Points
  const piv = calcPivots(bars)
  if (piv) {
    add(piv.P, 'PIV', 'BOTH')
    add(piv.R1, 'PIV', 'UP'); add(piv.R2, 'PIV', 'UP'); add(piv.R3, 'PIV', 'UP')
    add(piv.S1, 'PIV', 'DOWN'); add(piv.S2, 'PIV', 'DOWN'); add(piv.S3, 'PIV', 'DOWN')
  }

  // 6. Camarilla
  const cam = calcCam(bars)
  if (cam) {
    add(cam.H3, 'CAM', 'UP'); add(cam.H4, 'CAM', 'UP')
    add(cam.L3, 'CAM', 'DOWN'); add(cam.L4, 'CAM', 'DOWN')
  }

  // 7. ICT: PDH / PDL
  const ict = calcICT(bars)
  add(ict.pdh, 'ICT', 'UP'); add(ict.pdl, 'ICT', 'DOWN')

  // 8. ATR extensions
  const dv = direction === 'BULL' ? 1 : -1
  if (direction !== 'NEUTRAL') {
    [0.5, 1.0, 1.5, 2.0, 3.0].forEach(m =>
      add(cur + dv * atrVal * m, 'ATR', direction === 'BULL' ? 'UP' : 'DOWN')
    )
  }

  const targets = rankTargets(levels, direction, cur, atrVal)
  const stop = direction === 'BULL' ? cur - atrVal * 1.5 : cur + atrVal * 1.5
  const t1price = targets[0]?.price ?? cur
  const rr = atrVal > 0 ? parseFloat((Math.abs(t1price - cur) / (atrVal * 1.5)).toFixed(2)) : 0

  const predictors: Predictor[] = [
    { id: 'ORB',  name: 'Opening Range', dir: orbDir, strength: orb ? 72 : 0 },
    { id: 'VWAP', name: 'VWAP Bands',   dir: vwapBull ? 'BULL' : 'BEAR', strength: 68 },
    { id: 'VOL',  name: 'Vol Profile',  dir: vpBull ? 'BULL' : 'BEAR', strength: 65 },
    { id: 'FIB',  name: 'Fibonacci',    dir: direction, strength: 60 },
    { id: 'PIV',  name: 'Pivots',       dir: piv ? (cur > piv.P ? 'BULL' : 'BEAR') : 'NEUTRAL', strength: 60 },
    { id: 'CAM',  name: 'Camarilla',    dir: cam ? (cur > (cam.H3+cam.L3)/2 ? 'BULL' : 'BEAR') : 'NEUTRAL', strength: 55 },
    { id: 'ICT',  name: 'ICT/PDH/PDL',  dir: ict.pdh ? (cur > (ict.pdh+ict.pdl)/2 ? 'BULL' : 'BEAR') : 'NEUTRAL', strength: 65 },
    { id: 'JEDI', name: 'JEDI Council', dir: jediBull ? 'BULL' : jediBear ? 'BEAR' : 'NEUTRAL', strength: Math.min(100, Math.abs(jediScore)*2) },
  ]

  return { direction, composite, targets, predictors, stop, entry: cur, rr, atr: atrVal }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isCrypto(sym: string) {
  const bases = new Set(['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','MATIC','DOT','LINK','SUI','APT','ARB','OP','INJ','NEAR'])
  return bases.has(sym.toUpperCase().replace(/USDT$|BUSD$/,''))
}
function toBinSym(sym: string) { sym = sym.toUpperCase(); return sym.endsWith('USDT') ? sym : sym+'USDT' }
function toInterval(tf: string) { return ({ '1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1h','4h':'4h','1d':'1d' }[tf] ?? '1h') }

async function fetchBars(sym: string, tf: string): Promise<Bar[]> {
  const crypto = isCrypto(sym)
  if (crypto) {
    const url = `/binance/api/v3/klines?symbol=${toBinSym(sym)}&interval=${toInterval(tf)}&limit=300`
    const rows: any[][] = await fetch(url).then(r => { if(!r.ok) throw new Error(r.status+''); return r.json() })
    return rows.map(r => ({ time: Math.floor(r[0]/1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }))
  }
  const data = await fetch(`/ds/v1/chart/${sym.toUpperCase()}/?tf=${tf}&limit=300`).then(r => r.json())
  return (data.bars ?? []) as Bar[]
}

// ── Chart constants ───────────────────────────────────────────────────────────

const CHART_OPTS = {
  layout: { background: { type: ColorType.Solid, color: '#0b0e14' }, textColor: '#8f99a8', fontFamily: "'SF Mono','Fira Code',monospace", fontSize: 11 },
  grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
  crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(255,183,77,0.4)', labelBackgroundColor: '#1c2127' }, horzLine: { color: 'rgba(255,183,77,0.4)', labelBackgroundColor: '#1c2127' } },
  rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
  timeScale: { borderColor: 'rgba(255,255,255,0.08)', textColor: '#8f99a8', timeVisible: true, secondsVisible: false },
}

const SYMS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','AAPL','TSLA','SPY','QQQ','NVDA','MSFT','META','AMZN','ES1!','NQ1!']
const TFS  = ['5m','15m','30m','1h','4h','1d']

// ── Direction badge ───────────────────────────────────────────────────────────

const DIR_C = { BULL: '#4ade80', BEAR: '#f43f5e', NEUTRAL: '#60a5fa' }
const HEAT_C = { FIRE: '#ff6b00', GAS: '#00d4ff', CALM: '#60a5fa' }

function JediArrow({ dir, score }: { dir: 'BULL' | 'BEAR' | 'NEUTRAL'; score: number }) {
  const calm = score < 15 || dir === 'NEUTRAL'
  const c = calm ? '#60a5fa' : DIR_C[dir]
  const maxA = 72
  const raw = calm ? 0 : ((Math.min(score, 100) - 15) / 85) * maxA
  const angle = dir === 'BEAR' ? -raw : raw
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0' }}>
      <span style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace', letterSpacing: 1 }}>OBI SIGNAL</span>
      <svg width="60" height="60" viewBox="-30 -30 60 60"
        style={{ transform: `rotate(${-angle}deg)`, transition: 'transform 0.6s cubic-bezier(.34,1.56,.64,1)', filter: `drop-shadow(0 0 10px ${c})` }}>
        <line x1="-22" y1="0" x2="12" y2="0" stroke={c} strokeWidth="3" strokeLinecap="round" />
        <polygon points="12,-9 28,0 12,9" fill={c} />
        <line x1="-22" y1="0" x2="10" y2="0" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.25" />
      </svg>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: c, fontWeight: 800, fontFamily: 'monospace', textShadow: `0 0 10px ${c}` }}>{dir}</span>
        <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>{Math.round(score)}</span>
      </div>
    </div>
  )
}

// ── Target Row ────────────────────────────────────────────────────────────────

function TargetRow({ t, fmtFn }: { t: ObiTarget; fmtFn: (p: number) => string }) {
  const hc = HEAT_C[t.heat]
  return (
    <div style={{ padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: t.rank === 1 ? 'rgba(255,107,0,0.05)' : 'transparent' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: t.color, fontWeight: 800, fontFamily: 'monospace', textShadow: `0 0 8px ${t.color}` }}>{t.label}</span>
          <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: hc + '22', color: hc, fontFamily: 'monospace' }}>{t.heat}</span>
          <span style={{ fontSize: 8, color: t.dir === 'UP' ? '#4ade80' : '#f43f5e' }}>{t.dir === 'UP' ? '↑' : '↓'}</span>
        </div>
        <span style={{ fontSize: 11, color: t.color, fontFamily: 'monospace', fontWeight: 700 }}>{fmtFn(t.price)}</span>
      </div>
      {/* Confluence bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, height: 3, background: '#1e293b', borderRadius: 2 }}>
          <div style={{ height: '100%', width: `${(t.confluence / 8) * 100}%`, background: t.color, borderRadius: 2, boxShadow: `0 0 6px ${t.color}` }} />
        </div>
        <span style={{ fontSize: 8, color: '#475569', fontFamily: 'monospace', minWidth: 28 }}>{t.probability}%</span>
      </div>
      {/* System tags */}
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
        {t.systems.map(s => (
          <span key={s} style={{ fontSize: 7, padding: '1px 4px', borderRadius: 2, background: 'rgba(255,255,255,0.06)', color: '#64748b', fontFamily: 'monospace' }}>{s}</span>
        ))}
      </div>
    </div>
  )
}

// ── Predictor row ─────────────────────────────────────────────────────────────

function PredRow({ p }: { p: Predictor }) {
  const c = DIR_C[p.dir]
  const dot = p.dir === 'NEUTRAL' ? '○' : '●'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px' }}>
      <span style={{ fontSize: 10, color: c, width: 8 }}>{dot}</span>
      <span style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace', width: 32, flexShrink: 0 }}>{p.id}</span>
      <div style={{ flex: 1, height: 2, background: '#1e293b', borderRadius: 1 }}>
        <div style={{ height: '100%', width: `${p.strength}%`, background: c + '88', borderRadius: 1 }} />
      </div>
      <span style={{ fontSize: 7, color: c, fontFamily: 'monospace', minWidth: 34 }}>{p.dir}</span>
    </div>
  )
}

// ── OBI Page ──────────────────────────────────────────────────────────────────

export default function Obi() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef       = useRef<ISeriesApi<'Histogram'> | null>(null)
  const vwapSeriesRef = useRef<ISeriesApi<'Line'>[]>([])
  const targetLinesRef = useRef<IPriceLine[]>([])

  const [symbol, setSymbol] = useState('BTCUSDT')
  const [tf, setTf]         = useState('15m')
  const [obi, setObi]       = useState<ObiState | null>(null)
  const [status, setStatus] = useState<{ text: string; color: string }>({ text: '—', color: '#475569' })
  const [symInput, setSymInput] = useState('BTCUSDT')
  const jediRef = useRef(0)

  const fmtPrice = useCallback((p: number) => {
    const decimals = p < 1 ? 6 : p < 10 ? 4 : p < 1000 ? 2 : 0
    return p.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  }, [])

  // ── Init chart once ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = createChart(el, { ...CHART_OPTS, width: el.clientWidth, height: el.clientHeight || 500 })
    chartRef.current = chart

    const candle = chart.addCandlestickSeries({
      upColor: '#4ade80', downColor: '#f43f5e',
      borderUpColor: '#4ade80', borderDownColor: '#f43f5e',
      wickUpColor: '#4ade80', wickDownColor: '#f43f5e',
    })
    candleRef.current = candle

    const vol = chart.addHistogramSeries({ color: '#334155', priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, borderVisible: false })
    volRef.current = vol

    const ro = new ResizeObserver(entries => {
      const e = entries[0]
      if (e && chartRef.current) {
        chartRef.current.applyOptions({ width: e.contentRect.width, height: e.contentRect.height })
        chartRef.current.timeScale().fitContent()
      }
    })
    ro.observe(el)

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
  }, [])

  // ── Clear overlays ─────────────────────────────────────────────────────────
  const clearOverlays = useCallback(() => {
    for (const s of vwapSeriesRef.current) try { chartRef.current?.removeSeries(s) } catch {}
    vwapSeriesRef.current = []
    for (const l of targetLinesRef.current) try { candleRef.current?.removePriceLine(l) } catch {}
    targetLinesRef.current = []
  }, [])

  // ── Draw chart overlays from OBI state ────────────────────────────────────
  const drawOverlays = useCallback((bars: Bar[], state: ObiState) => {
    clearOverlays()
    const chart = chartRef.current
    const candle = candleRef.current
    if (!chart || !candle || bars.length < 50) return

    const times = bars.map(b => b.time)
    const vd = calcVWAP(bars)
    const addLine = (vals: number[], color: string, lw: 1|2|3|4, opacity = 1) => {
      const s = chart.addLineSeries({ color: color.replace(')', `,${opacity})`).replace('rgb(', 'rgba('), lineWidth: lw, priceLineVisible: false, lastValueVisible: false, autoscaleInfoProvider: () => null })
      const data: LineData[] = []
      for (let i = 0; i < vals.length; i++) if (isFinite(vals[i]!)) data.push({ time: times[i] as Time, value: vals[i]! })
      s.setData(data)
      vwapSeriesRef.current.push(s)
    }

    // VWAP + bands
    addLine(vd.vwap, '#00d4ff', 2)
    addLine(vd.u1,   '#00d4ff', 1, 0.5); addLine(vd.d1, '#00d4ff', 1, 0.5)
    addLine(vd.u2,   '#00d4ff', 1, 0.3); addLine(vd.d2, '#00d4ff', 1, 0.3)
    addLine(vd.u3,   '#00d4ff', 1, 0.2); addLine(vd.d3, '#00d4ff', 1, 0.2)

    // ORB levels
    const orb = calcORB(bars)
    if (orb) {
      const safeP = (price: number, color: string, title: string, style: LineStyle) => {
        if (!isFinite(price)) return
        try { const l = candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }); targetLinesRef.current.push(l) } catch {}
      }
      safeP(orb.ibH, '#fbbf24cc', 'IB Hi', LineStyle.Dotted)
      safeP(orb.ibL, '#fbbf24cc', 'IB Lo', LineStyle.Dotted)
    }

    // Volume Profile
    const vp = calcVolProfile(bars)
    const priceLine = (price: number, color: string, title: string, lw: 1|2, style: LineStyle) => {
      if (!isFinite(price) || price <= 0) return
      try { const l = candle.createPriceLine({ price, color, lineWidth: lw, lineStyle: style, axisLabelVisible: true, title }); targetLinesRef.current.push(l) } catch {}
    }
    priceLine(vp.poc, '#ff8c00', 'POC', 2, LineStyle.Solid)
    priceLine(vp.vah, '#ff8c0088', 'VAH', 1, LineStyle.Dashed)
    priceLine(vp.val, '#ff8c0088', 'VAL', 1, LineStyle.Dashed)

    // ICT: PDH/PDL
    const ict = calcICT(bars)
    priceLine(ict.pdh, '#818cf866', 'PDH', 1, LineStyle.Dashed)
    priceLine(ict.pdl, '#818cf866', 'PDL', 1, LineStyle.Dashed)

    // Ranked targets — glow price lines
    for (const t of state.targets) {
      priceLine(t.price, t.color, `${t.label} ${Math.round(t.probability)}%`, t.rank === 1 ? 2 : 1, LineStyle.Dashed)
    }

    // Stop
    priceLine(state.stop, '#f43f5e', '⊗ STOP', 2, LineStyle.Dashed)
  }, [clearOverlays])

  // ── Load + compute ─────────────────────────────────────────────────────────
  const load = useCallback(async (sym: string, timeframe: string) => {
    setStatus({ text: 'loading…', color: '#475569' })
    setObi(null)
    clearOverlays()
    try {
      const [bars, council] = await Promise.all([
        fetchBars(sym, timeframe),
        fetch('/v1/council').then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      if (!bars.length) { setStatus({ text: 'no data', color: '#f87171' }); return }

      const jedi = (council?.jedi_score ?? 0) as number
      jediRef.current = jedi

      const candle = candleRef.current
      const vol = volRef.current
      if (!candle || !vol) return

      candle.setData(bars.map(b => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })))
      vol.setData(bars.map(b => ({ time: b.time as Time, value: b.volume, color: b.close >= b.open ? 'rgba(74,222,128,0.2)' : 'rgba(244,63,94,0.2)' })))
      chartRef.current?.timeScale().fitContent()

      const state = runOBI(bars, jedi)
      if (state) {
        setObi(state)
        drawOverlays(bars, state)
        const dc = DIR_C[state.direction]
        setStatus({ text: `● ${state.direction} · RR ${state.rr}:1 · ${state.targets.length} targets`, color: dc })
      } else {
        setStatus({ text: 'need more bars', color: '#fbbf24' })
      }
    } catch (e: any) {
      setStatus({ text: `error: ${e.message ?? e}`, color: '#f87171' })
    }
  }, [clearOverlays, drawOverlays])

  // auto-load on symbol/tf change
  useEffect(() => { load(symbol, tf) }, [symbol, tf, load])

  const handleGo = () => {
    const s = symInput.trim().toUpperCase()
    if (s) { setSymbol(s); setSymInput(s) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0b0e14', overflow: 'hidden' }}>

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div style={{ height: 44, background: '#0f1318', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#a78bfa', fontFamily: 'monospace', letterSpacing: 2, textShadow: '0 0 16px #a78bfa' }}>OBI</span>
        <span style={{ fontSize: 9, color: '#334155', fontFamily: 'monospace' }}>AI CO-TRADER · 8-ENGINE TARGET PREDICTION</span>

        <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
          <input
            value={symInput}
            onChange={e => setSymInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleGo()}
            style={{ width: 100, padding: '3px 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', outline: 'none' }}
          />
          <button onClick={handleGo} style={{ padding: '3px 10px', background: '#a78bfa22', border: '1px solid #a78bfa44', borderRadius: 4, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}>GO</button>
        </div>

        <div style={{ display: 'flex', gap: 3 }}>
          {TFS.map(t => (
            <button key={t} onClick={() => setTf(t)} style={{
              padding: '2px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10,
              background: tf === t ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.05)',
              color: tf === t ? '#a78bfa' : '#475569',
            }}>{t}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 3 }}>
          {['BTC','ETH','SOL','SPY','QQQ','NVDA'].map(s => {
            const sym = isCrypto(s) ? s+'USDT' : s
            return (
              <button key={s} onClick={() => { setSymbol(sym); setSymInput(sym) }} style={{
                padding: '2px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10,
                background: symbol === sym ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                color: symbol === sym ? '#e2e8f0' : '#475569',
              }}>{s}</button>
            )
          })}
        </div>

        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'monospace', color: status.color }}>{status.text}</span>
      </div>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Chart */}
        <div ref={containerRef} style={{ flex: 1, position: 'relative', minWidth: 0 }} />

        {/* OBI Panel */}
        <div style={{ width: 268, background: '#0c1018', borderLeft: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>

          {/* Direction */}
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            {obi ? <JediArrow dir={obi.direction} score={obi.composite} /> : (
              <div style={{ padding: 20, textAlign: 'center', color: '#1e293b', fontSize: 10, fontFamily: 'monospace' }}>COMPUTING…</div>
            )}
          </div>

          {/* Stats strip */}
          {obi && (
            <div style={{ display: 'flex', justifyContent: 'space-around', padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
              {[
                { label: 'ENTRY', val: fmtPrice(obi.entry) },
                { label: 'STOP',  val: fmtPrice(obi.stop), c: '#f43f5e' },
                { label: 'R:R',   val: `1:${obi.rr}`, c: obi.rr >= 2 ? '#4ade80' : '#fbbf24' },
              ].map(({ label, val, c }) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 7, color: '#334155', fontFamily: 'monospace', letterSpacing: 1 }}>{label}</div>
                  <div style={{ fontSize: 9, color: c ?? '#94a3b8', fontFamily: 'monospace', fontWeight: 700 }}>{val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Targets */}
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            <div style={{ padding: '6px 10px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace', letterSpacing: 2, textTransform: 'uppercase' }}>Ranked Targets</span>
              {obi && <span style={{ fontSize: 7, color: '#1e293b', fontFamily: 'monospace' }}>{obi.targets.length} levels</span>}
            </div>

            {obi?.targets.length ? obi.targets.map(t => (
              <TargetRow key={t.rank} t={t} fmtFn={fmtPrice} />
            )) : (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 10, color: '#1e293b', fontFamily: 'monospace' }}>
                {obi ? 'NO TARGETS — NEUTRAL' : 'LOAD SYMBOL'}
              </div>
            )}
          </div>

          {/* Predictor matrix */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <div style={{ padding: '5px 10px 3px', fontSize: 7, color: '#334155', fontFamily: 'monospace', letterSpacing: 2 }}>PREDICTOR MATRIX</div>
            {obi ? obi.predictors.map(p => <PredRow key={p.id} p={p} />) : (
              <div style={{ padding: '6px 10px', fontSize: 9, color: '#1e293b', fontFamily: 'monospace' }}>—</div>
            )}
            <div style={{ height: 6 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
