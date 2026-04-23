import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bar } from '$indicators/boom3d-tech';
import { fetchBarsForSymbol, type ChartSymbol } from '@pwa/lib/fetchBars';
import { defaultSymbolForStrip, loadChartStripSymbol, saveChartStripSymbol } from '@pwa/lib/chartStripSymbol';
import { TIMEFRAME_OPTIONS, loadTimeframe, saveTimeframe, type TimeframePreset } from '@pwa/lib/chartTimeframes';
import { loadControls, saveControls, setMasLayer, type ChartControls } from '@pwa/lib/chartControls';
import BoomLwChart from '../components/BoomLwChart';
import { SoloMasterOrb, type SoloOrbDirection } from '../viz/SoloMasterOrb';
import './TvLwChartsPage.css';

// ── OBI Target Engine ─────────────────────────────────────────────────────────

interface ObiTarget { rank: number; label: string; price: number; dir: 'UP' | 'DOWN'; confluence: number; probability: number; systems: string[]; heat: 'FIRE' | 'GAS' | 'CALM'; color: string }
type RawL = { price: number; system: string; dir: 'UP' | 'DOWN' | 'BOTH' }
const T_COLORS = ['#ff6b00','#00d4ff','#a78bfa','#4ade80','#fbbf24','#f9a8d4']
const DIR_C: Record<string,'#4ade80'|'#f43f5e'|'#60a5fa'> = { BULL:'#4ade80', BEAR:'#f43f5e', NEUTRAL:'#60a5fa' }
const HEAT_C: Record<string,string> = { FIRE:'#ff6b00', GAS:'#00d4ff', CALM:'#60a5fa' }

function bATR(bars: Bar[], p = 14): number {
  const n = bars.length
  if (n < 2) return 0
  let sum = 0, cnt = 0
  for (let i = Math.max(1, n - p); i < n; i++) {
    const b = bars[i]!, pr = bars[i-1]!
    sum += Math.max(b.high - b.low, Math.abs(b.high - pr.close), Math.abs(b.low - pr.close))
    cnt++
  }
  return cnt ? sum / cnt : 0
}

function bEMA(vals: number[], p: number): number {
  if (!vals.length) return 0
  const k = 2 / (p + 1)
  let e = vals[Math.max(0, vals.length - p)]!
  for (let i = Math.max(1, vals.length - p + 1); i < vals.length; i++) e = vals[i]! * k + e * (1 - k)
  return e
}

function bVWAP(bars: Bar[]) {
  let cpv = 0, cv = 0, cpv2 = 0
  const last = bars[bars.length - 1]!
  for (const b of bars) {
    const tp = (b.high + b.low + b.close) / 3
    cpv += tp * (b.volume ?? 1); cv += (b.volume ?? 1); cpv2 += tp * tp * (b.volume ?? 1)
  }
  const vw = cv ? cpv / cv : last.close
  const sd = cv ? Math.sqrt(Math.max(0, cpv2 / cv - vw * vw)) : 0
  return { vw, u1: vw + sd, d1: vw - sd, u2: vw + 2*sd, d2: vw - 2*sd, u3: vw + 3*sd, d3: vw - 3*sd }
}

function bVolProfile(bars: Bar[], buckets = 50) {
  if (bars.length < 5) return { poc: 0, vah: 0, val: 0 }
  const hi = Math.max(...bars.map(b => b.high))
  const lo = Math.min(...bars.map(b => b.low))
  const rng = hi - lo
  if (!rng) return { poc: bars[0]!.close, vah: bars[0]!.close, val: bars[0]!.close }
  const bsz = rng / buckets
  const vol = new Array<number>(buckets).fill(0)
  for (const b of bars) { const idx = Math.min(buckets-1, Math.floor(((b.high+b.low+b.close)/3 - lo)/bsz)); if (idx >= 0) vol[idx]! += (b.volume ?? 1) }
  const total = vol.reduce((a,b) => a+b, 0)
  const pocIdx = vol.indexOf(Math.max(...vol))
  const poc = lo + (pocIdx + 0.5) * bsz
  let incV = vol[pocIdx]!, lo2 = pocIdx, hi2 = pocIdx
  while (incV < total * 0.70 && (lo2 > 0 || hi2 < buckets-1)) {
    const up = hi2+1 < buckets ? vol[hi2+1]! : 0, dn = lo2-1 >= 0 ? vol[lo2-1]! : 0
    if (up >= dn && hi2+1 < buckets) { hi2++; incV += vol[hi2]! } else if (lo2-1 >= 0) { lo2--; incV += vol[lo2]! } else { hi2++; incV += vol[hi2]! }
  }
  return { poc, vah: lo + (hi2+1)*bsz, val: lo + lo2*bsz }
}

function bORB(bars: Bar[]) {
  if (bars.length < 10) return null
  const ib = bars.slice(0, 6)
  const ibH = Math.max(...ib.map(b => b.high)), ibL = Math.min(...ib.map(b => b.low)), sz = ibH - ibL
  const cur = bars[bars.length-1]!.close
  const dir: 'BULL'|'BEAR'|'NEUTRAL' = cur > ibH ? 'BULL' : cur < ibL ? 'BEAR' : 'NEUTRAL'
  return { ibH, ibL, dir, t1u: ibH+sz, t2u: ibH+sz*2, t1d: ibL-sz, t2d: ibL-sz*2 }
}

function bPivots(bars: Bar[]) {
  const prev = bars.slice(-48, -24)
  if (!prev.length) return null
  const H = Math.max(...prev.map(b => b.high)), L = Math.min(...prev.map(b => b.low)), C = prev[prev.length-1]!.close
  const P = (H+L+C)/3
  return { P, R1: 2*P-L, R2: P+(H-L), R3: H+2*(P-L), S1: 2*P-H, S2: P-(H-L), S3: L-2*(H-P) }
}

function bCam(bars: Bar[]) {
  const prev = bars.slice(-48, -24)
  if (!prev.length) return null
  const H = Math.max(...prev.map(b => b.high)), L = Math.min(...prev.map(b => b.low)), C = prev[prev.length-1]!.close, r = H-L
  return { H3: C+r*1.1/4, H4: C+r*1.1/2, L3: C-r*1.1/4, L4: C-r*1.1/2 }
}

function bICT(bars: Bar[]) {
  const prev = bars.slice(-48, -24)
  return { pdh: prev.length ? Math.max(...prev.map(b => b.high)) : 0, pdl: prev.length ? Math.min(...prev.map(b => b.low)) : 0 }
}

function bFib(bars: Bar[], dir: 'BULL'|'BEAR'|'NEUTRAL') {
  const n = Math.min(50, bars.length)
  const sl = bars.slice(-n)
  const swH = Math.max(...sl.map(b => b.high)), swL = Math.min(...sl.map(b => b.low)), rng = swH - swL
  if (dir === 'BULL') return [1.0,1.272,1.618,2.0,2.618].map(r => ({ price: swL+rng*r, system: 'FIB', dir: 'UP' as const }))
  if (dir === 'BEAR') return [1.0,1.272,1.618,2.0,2.618].map(r => ({ price: swH-rng*r, system: 'FIB', dir: 'DOWN' as const }))
  return []
}

function rankTargets(levels: RawL[], dir: 'BULL'|'BEAR'|'NEUTRAL', cur: number, atrVal: number): ObiTarget[] {
  if (!levels.length || dir === 'NEUTRAL') return []
  const tol = atrVal * 0.20
  const filtered = levels.filter(l => dir === 'BULL' ? l.price > cur*1.001 : l.price < cur*0.999)
  const used = new Set<number>()
  const clusters: RawL[][] = []
  const sorted = [...filtered].sort((a,b) => Math.abs(a.price-cur) - Math.abs(b.price-cur))
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue
    const cl = [sorted[i]!]; used.add(i)
    for (let j = i+1; j < sorted.length; j++) if (!used.has(j) && Math.abs(sorted[j]!.price - sorted[i]!.price) <= tol) { cl.push(sorted[j]!); used.add(j) }
    clusters.push(cl)
  }
  return clusters.slice(0, 6).map((cl, idx) => {
    const avg = cl.reduce((s,l) => s+l.price, 0) / cl.length
    const systems = [...new Set(cl.map(l => l.system))]
    const conf = systems.length
    const prob = Math.min(95, conf*11 + Math.max(0, 55 - (Math.abs(avg-cur)/cur)*1500))
    return {
      rank: idx+1, label: `T${idx+1}`, price: avg,
      dir: (dir === 'BULL' ? 'UP' : 'DOWN') as 'UP'|'DOWN',
      confluence: conf, probability: Math.round(prob),
      systems, heat: (conf >= 4 ? 'FIRE' : conf >= 2 ? 'GAS' : 'CALM') as ObiTarget['heat'],
      color: T_COLORS[idx] ?? '#94a3b8',
    }
  }).sort((a,b) => b.confluence-a.confluence || a.rank-b.rank).map((t,i) => ({ ...t, rank: i+1, label: `T${i+1}` }))
}

function computeOBI(bars: Bar[]) {
  if (bars.length < 50) return null
  const cur = bars[bars.length-1]!.close
  const atrVal = bATR(bars) || cur*0.01
  const closes = bars.map(b => b.close)
  const e9 = bEMA(closes, 9), e21 = bEMA(closes, 21)
  const vd = bVWAP(bars)
  const orb = bORB(bars)
  const vp = bVolProfile(bars)

  const bullV = [cur > vd.vw, e9 > e21, cur > vp.poc, orb?.dir === 'BULL'].filter(Boolean).length
  const bearV = [cur < vd.vw, e9 < e21, cur < vp.poc, orb?.dir === 'BEAR'].filter(Boolean).length
  const dir: 'BULL'|'BEAR'|'NEUTRAL' = bullV > bearV ? 'BULL' : bearV > bullV ? 'BEAR' : 'NEUTRAL'
  const composite = Math.round(bullV * 18 + bearV * 18)

  const lv: RawL[] = []
  const add = (price: number, system: string, d: 'UP'|'DOWN'|'BOTH') => { if (isFinite(price) && price > 0) lv.push({ price, system, dir: d }) }

  add(vd.u1,'VWAP','UP'); add(vd.d1,'VWAP','DOWN'); add(vd.u2,'VWAP','UP'); add(vd.d2,'VWAP','DOWN'); add(vd.u3,'VWAP','UP'); add(vd.d3,'VWAP','DOWN')
  add(vp.poc,'VOL','BOTH'); add(vp.vah,'VOL','UP'); add(vp.val,'VOL','DOWN')
  if (orb) { add(orb.t1u,'ORB','UP'); add(orb.t2u,'ORB','UP'); add(orb.t1d,'ORB','DOWN'); add(orb.t2d,'ORB','DOWN') }
  bFib(bars, dir).forEach(l => add(l.price, l.system, l.dir))
  const piv = bPivots(bars)
  if (piv) { add(piv.P,'PIV','BOTH'); add(piv.R1,'PIV','UP'); add(piv.R2,'PIV','UP'); add(piv.R3,'PIV','UP'); add(piv.S1,'PIV','DOWN'); add(piv.S2,'PIV','DOWN'); add(piv.S3,'PIV','DOWN') }
  const cam = bCam(bars)
  if (cam) { add(cam.H3,'CAM','UP'); add(cam.H4,'CAM','UP'); add(cam.L3,'CAM','DOWN'); add(cam.L4,'CAM','DOWN') }
  const ict = bICT(bars)
  add(ict.pdh,'ICT','UP'); add(ict.pdl,'ICT','DOWN')
  const dv = dir === 'BULL' ? 1 : -1
  if (dir !== 'NEUTRAL') [0.5,1,1.5,2,3].forEach(m => add(cur + dv*atrVal*m, 'ATR', dir === 'BULL' ? 'UP' : 'DOWN'))

  const targets = rankTargets(lv, dir, cur, atrVal)
  const stop = dir === 'BULL' ? cur - atrVal*1.5 : cur + atrVal*1.5
  const t1 = targets[0]?.price ?? cur
  const rr = parseFloat((Math.abs(t1-cur) / (atrVal*1.5)).toFixed(1))

  const preds = [
    { id:'ORB',  dir: orb?.dir ?? 'NEUTRAL' },
    { id:'VWAP', dir: cur > vd.vw ? 'BULL' : 'BEAR' },
    { id:'VOL',  dir: cur > vp.poc ? 'BULL' : 'BEAR' },
    { id:'FIB',  dir },
    { id:'PIV',  dir: piv ? (cur > piv.P ? 'BULL' : 'BEAR') : 'NEUTRAL' },
    { id:'CAM',  dir: cam ? (cur > (cam.H3+cam.L3)/2 ? 'BULL' : 'BEAR') : 'NEUTRAL' },
    { id:'ICT',  dir: ict.pdh ? (cur > (ict.pdh+ict.pdl)/2 ? 'BULL' : 'BEAR') : 'NEUTRAL' },
    { id:'EMA',  dir: e9 > e21 ? 'BULL' : 'BEAR' },
  ] as { id: string; dir: 'BULL'|'BEAR'|'NEUTRAL' }[]

  return { dir, composite, targets, stop, entry: cur, rr, atrVal, preds }
}

// ── OBI Target Panel ──────────────────────────────────────────────────────────

function ObiPanel({ bars }: { bars: Bar[] }) {
  const obi = useMemo(() => computeOBI(bars), [bars])
  if (!obi) return null

  const dc = DIR_C[obi.dir] ?? '#60a5fa'
  const fmt = (p: number) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 1 }) : p < 10 ? p.toFixed(5) : p.toFixed(2)

  return (
    <div style={{
      width: 240, flexShrink: 0,
      background: 'rgba(8,11,18,0.97)', borderLeft: '1px solid rgba(167,139,250,0.15)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: '#a78bfa', fontFamily: 'monospace', letterSpacing: 2, textShadow: '0 0 10px #a78bfa' }}>◉ OBI</span>
          <span style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace' }}>8-ENGINE</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: dc, fontFamily: 'monospace', textShadow: `0 0 8px ${dc}` }}>{obi.dir}</span>
          <span style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace' }}>R:R 1:{obi.rr}</span>
          <span style={{ fontSize: 9, color: '#f43f5e', fontFamily: 'monospace', marginLeft: 'auto' }}>⊗ {fmt(obi.stop)}</span>
        </div>
      </div>

      {/* Targets */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {obi.targets.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 9, color: '#1e293b', fontFamily: 'monospace' }}>NEUTRAL — NO TARGETS</div>
        )}
        {obi.targets.map(t => {
          const hc = HEAT_C[t.heat] ?? '#60a5fa'
          return (
            <div key={t.rank} style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: t.rank === 1 ? 'rgba(255,107,0,0.04)' : 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: t.color, fontWeight: 800, fontFamily: 'monospace', textShadow: `0 0 6px ${t.color}` }}>{t.label}</span>
                  <span style={{ fontSize: 7, padding: '1px 3px', borderRadius: 2, background: hc+'22', color: hc, fontFamily: 'monospace' }}>{t.heat}</span>
                  <span style={{ fontSize: 8, color: t.dir === 'UP' ? '#4ade80' : '#f43f5e' }}>{t.dir === 'UP' ? '↑' : '↓'}</span>
                </div>
                <span style={{ fontSize: 10, color: t.color, fontFamily: 'monospace', fontWeight: 700 }}>{fmt(t.price)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ flex: 1, height: 2, background: '#1e293b', borderRadius: 1 }}>
                  <div style={{ height: '100%', width: `${(t.confluence/8)*100}%`, background: t.color, borderRadius: 1, boxShadow: `0 0 4px ${t.color}` }} />
                </div>
                <span style={{ fontSize: 7, color: '#475569', fontFamily: 'monospace', minWidth: 26 }}>{t.probability}%</span>
              </div>
              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 3 }}>
                {t.systems.map(s => <span key={s} style={{ fontSize: 7, padding: '1px 3px', borderRadius: 2, background: 'rgba(255,255,255,0.05)', color: '#475569', fontFamily: 'monospace' }}>{s}</span>)}
              </div>
            </div>
          )
        })}
      </div>

      {/* Predictor matrix */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, padding: '4px 0' }}>
        <div style={{ padding: '2px 10px 3px', fontSize: 7, color: '#1e293b', fontFamily: 'monospace', letterSpacing: 2, textTransform: 'uppercase' }}>Predictors</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          {obi.preds.map(p => {
            const c = DIR_C[p.dir] ?? '#60a5fa'
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 10px' }}>
                <span style={{ fontSize: 9, color: c }}>{p.dir === 'NEUTRAL' ? '○' : '●'}</span>
                <span style={{ fontSize: 7, color: p.dir === 'NEUTRAL' ? '#1e293b' : '#475569', fontFamily: 'monospace', flex: 1 }}>{p.id}</span>
                <span style={{ fontSize: 7, color: c, fontFamily: 'monospace' }}>{p.dir === 'BULL' ? '↑' : p.dir === 'BEAR' ? '↓' : '—'}</span>
              </div>
            )
          })}
        </div>
        <div style={{ height: 4 }} />
      </div>
    </div>
  )
}

// ── OBI Page ──────────────────────────────────────────────────────────────────

const CHART_STRIP_ID = 'spx' as const
const SOLO_DOCK_KEY = 'm4d.obi.soloDock'
const SOLO_PARTICIPATION_FLOOR_PCT = 15

type SoloDockSide = 'left' | 'right'
type SoloDockTier = 0 | 1 | 2
type SoloDockState = { side: SoloDockSide; tier: SoloDockTier; visible: boolean }

function loadSoloDock(): SoloDockState {
  try { const j = JSON.parse(localStorage.getItem(SOLO_DOCK_KEY) ?? '{}') as Partial<SoloDockState>; return { side: j.side === 'left' ? 'left' : 'right', tier: j.tier === 0 || j.tier === 1 || j.tier === 2 ? j.tier : 1, visible: j.visible !== false } } catch { return { side: 'right', tier: 1, visible: true } }
}
function saveSoloDock(s: SoloDockState) { try { localStorage.setItem(SOLO_DOCK_KEY, JSON.stringify(s)) } catch {} }

export default function ObiPage() {
  const vitePolygonKey = (import.meta.env.VITE_POLYGON_IO_KEY || import.meta.env.VITE_POLYGON_API_KEY) as string | undefined
  const [bars, setBars]         = useState<Bar[]>([])
  const [sym, setSym]           = useState<ChartSymbol>(() => loadChartStripSymbol(CHART_STRIP_ID) ?? defaultSymbolForStrip(CHART_STRIP_ID))
  const [err, setErr]           = useState('')
  const [loading, setLoading]   = useState(true)
  const [controls, setControls] = useState<ChartControls>(() => loadControls())
  const [tf, setTf]             = useState<TimeframePreset>(() => loadTimeframe())
  const [tickerInput, setTickerInput] = useState('')
  const [tickerFocus, setTickerFocus] = useState(false)
  const [showHeat, setShowHeat] = useState(true)
  const [obiVisible, setObiVisible] = useState(true)
  const [soloDock, setSoloDock] = useState<SoloDockState>(() => loadSoloDock())
  const preSafetySigRef = useRef<{ sigMode: ChartControls['sigMode']; sigRvolMin: number; sigAtrExpandMin: number; sigBreakAtrFrac: number } | null>(null)

  const TOP_STOCKS = ['ES','SPY','QQQ','EURUSD','XAUUSD','BTC','NVDA','AAPL','MSFT','TSLA','AMZN','META','GOOGL'] as const

  const persist = useCallback((next: ChartControls) => { setControls(next); saveControls(next) }, [])
  const setSoloDockPatch = useCallback((patch: Partial<SoloDockState> | ((p: SoloDockState) => Partial<SoloDockState>)) => {
    setSoloDock(prev => { const delta = typeof patch === 'function' ? patch(prev) : patch; const next = { ...prev, ...delta }; saveSoloDock(next); return next })
  }, [])

  // SOLO orb
  const solo = useMemo(() => {
    if (bars.length < 35) return { dir: 0, strength: 0, confidence: 0, volPct: 0, rvolRatio: 0, biasScore: 0, belowParticipationFloor: true, dirText: 'HOLD' }
    const closes = bars.map(b => b.close), vols = bars.map(b => b.volume ?? 0)
    const last = bars[bars.length-1]!, prev = bars[bars.length-2]!
    const alpha = (len: number) => { const a = 2/(len+1); let v = closes[Math.max(0, closes.length-len)]!; for (let i = Math.max(0, closes.length-len+1); i < closes.length; i++) v = closes[i]!*a + v*(1-a); return v }
    const emaFast = alpha(9), emaSlow = alpha(21), trendDir = emaFast > emaSlow ? 1 : emaFast < emaSlow ? -1 : 0
    const lastMove = (last.close - prev.close) / Math.max(1e-9, prev.close), moveDir = lastMove > 0 ? 1 : lastMove < 0 ? -1 : 0
    const dirRaw = trendDir*0.7 + moveDir*0.3, biasScore = Math.round(Math.max(-27, Math.min(27, dirRaw*27)))
    let trSum = 0; for (let i = bars.length-14; i < bars.length; i++) { const b = bars[i]!, bp = bars[i-1] ?? b; trSum += Math.max(b.high-b.low, Math.abs(b.high-bp.close), Math.abs(b.low-bp.close)) }
    const atr = trSum/14, atrNorm = atr/Math.max(1e-9, last.close), moveStrength = Math.min(1, Math.abs(lastMove)/Math.max(1e-9, atrNorm))
    const volNow = vols[vols.length-1]!, volAvg = vols.slice(-20).reduce((a,b) => a+b, 0)/20, rvol = volAvg > 0 ? volNow/volAvg : 0
    const strength = Math.round((moveStrength*0.55 + Math.min(1,rvol/2)*0.45)*100)
    const confidence = Math.round(Math.max(0, Math.min(1, Math.abs(dirRaw)*0.5+(strength/100)*0.5 - (controls.safetyDefenseOn ? 0.06 : 0)))*100)
    const belowParticipationFloor = strength < SOLO_PARTICIPATION_FLOOR_PCT
    const idleBand = strength >= 50 ? 5 : 9
    let dir = 0; if (!belowParticipationFloor) { if (biasScore > idleBand) dir = 1; else if (biasScore < -idleBand) dir = -1 }
    return { dir, biasScore, belowParticipationFloor, strength, confidence, volPct: Math.round(Math.min(1,rvol/2)*100), rvolRatio: rvol, dirText: dir > 0 ? 'UP' : dir < 0 ? 'DOWN' : 'HOLD' }
  }, [bars, controls.safetyDefenseOn])

  const soloOrbDir: SoloOrbDirection = solo.dir > 0 ? 'LONG' : solo.dir < 0 ? 'SHORT' : 'FLAT'
  const soloOrbScore = solo.belowParticipationFloor ? 0 : solo.biasScore
  const soloOrbConv  = solo.belowParticipationFloor ? 0 : solo.confidence
  const soloOnMove   = !solo.belowParticipationFloor && solo.strength >= 50 && (soloOrbDir === 'LONG' || soloOrbDir === 'SHORT')

  const load = useCallback(async (s: ChartSymbol, preset?: TimeframePreset) => {
    const activeTf = preset ?? tf
    setSym(s); saveChartStripSymbol(CHART_STRIP_ID, s); setLoading(true); setErr('')
    try { const data = await fetchBarsForSymbol(s, vitePolygonKey, activeTf); setBars(data); if (!data.length) setErr('No bars returned') }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBars([]) }
    finally { setLoading(false) }
  }, [tf, vitePolygonKey])

  useEffect(() => { void load(loadChartStripSymbol(CHART_STRIP_ID) ?? defaultSymbolForStrip(CHART_STRIP_ID)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onTf = (e: Event) => { const p = (e as CustomEvent<TimeframePreset>).detail; if (p) { setTf(p); saveTimeframe(p); void load(sym, p) } }
    const onSym = (e: Event) => { const n = (e as CustomEvent<string>).detail?.trim().toUpperCase(); if (n) void load(n) }
    window.addEventListener('m6d:setTf', onTf); window.addEventListener('m6d:setSym', onSym)
    return () => { window.removeEventListener('m6d:setTf', onTf); window.removeEventListener('m6d:setSym', onSym) }
  }, [load, sym])

  const setTimeframe = useCallback((next: TimeframePreset) => { setTf(next); saveTimeframe(next); void load(sym, next) }, [load, sym])

  const allIctOn = controls.showOrderBlocks && controls.showFvg && controls.showPoc && controls.showVwap && controls.showSwingRays && controls.showSessionLevels && controls.showIchimoku && controls.showMas
  const toggleAllIct = useCallback(() => {
    const next = !allIctOn
    persist(setMasLayer({ ...controls, showOrderBlocks: next, showFvg: next, showPoc: next, showVwap: next, showSwingRays: next, showSessionLevels: next, showIchimoku: next }, next))
  }, [allIctOn, controls, persist])

  const tickerQuery = tickerInput.trim().toUpperCase()
  const tickerSuggestions = (tickerQuery.length === 0 ? TOP_STOCKS : TOP_STOCKS.filter(t => t.startsWith(tickerQuery) || t.includes(tickerQuery))).slice(0, 13)
  const selectTicker = useCallback((raw: string) => { const n = raw.trim().toUpperCase(); if (!n) return; setTickerInput(''); setTickerFocus(false); void load(n) }, [load])

  const toggleSafetyDefense = useCallback(() => {
    if (!controls.safetyDefenseOn) { preSafetySigRef.current = { sigMode: controls.sigMode, sigRvolMin: controls.sigRvolMin, sigAtrExpandMin: controls.sigAtrExpandMin, sigBreakAtrFrac: controls.sigBreakAtrFrac }; persist({ ...controls, safetyDefenseOn: true, sigMode: 'strict', sigRvolMin: Math.max(1.8, controls.sigRvolMin), sigAtrExpandMin: Math.max(1.25, controls.sigAtrExpandMin), sigBreakAtrFrac: Math.max(0.06, controls.sigBreakAtrFrac) }); return }
    const prev = preSafetySigRef.current; persist({ ...controls, safetyDefenseOn: false, sigMode: prev?.sigMode ?? controls.sigMode, sigRvolMin: prev?.sigRvolMin ?? controls.sigRvolMin, sigAtrExpandMin: prev?.sigAtrExpandMin ?? controls.sigAtrExpandMin, sigBreakAtrFrac: prev?.sigBreakAtrFrac ?? controls.sigBreakAtrFrac })
  }, [controls, persist])

  const lastBar = bars.length > 0 ? bars[bars.length-1]! : null
  const prevBar = bars.length > 1 ? bars[bars.length-2]! : null
  const lastPrice = lastBar?.close ?? null
  const priceChgPct = lastPrice && prevBar ? (lastBar!.close - prevBar.close)/prevBar.close*100 : null
  const fmtPrice = (p: number) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p < 10 ? p.toFixed(5) : p.toFixed(2)
  const chartKey = bars.length > 0 ? `${sym}-${tf}-${bars[0]!.time}-${bars[bars.length-1]!.time}-${bars.length}` : ''

  // Heatseeker (reuse from TvLwChartsPage logic)
  const heat = useMemo(() => {
    if (!showHeat || bars.length < 55) return null
    const closes = bars.map(b => b.close), opens = bars.map(b => b.open), highs = bars.map(b => b.high), lows = bars.map(b => b.low), vols = bars.map(b => b.volume ?? 0)
    const ema = (vals: number[], p: number) => { const k = 2/(p+1); let e = vals[Math.max(0,vals.length-p)]!; for (let i = Math.max(1,vals.length-p+1); i < vals.length; i++) e = vals[i]!*k+e*(1-k); return e }
    const sma = (vals: number[], p: number) => { const s = vals.slice(-p); return s.length ? s.reduce((a,b) => a+b,0)/s.length : 0 }
    const n = bars.length
    const diffs = closes.map((c,i) => c - opens[i]!), emaDiff = ema(diffs, 21), dirBias = emaDiff > 0 ? 1 : emaDiff < 0 ? -1 : 0
    let trSum2 = 0; for (let i = Math.max(1,n-14); i < n; i++) { const b = bars[i]!, p2 = bars[i-1]!; trSum2 += Math.max(b.high-b.low, Math.abs(b.high-p2.close), Math.abs(b.low-p2.close)) }
    const atr14 = trSum2 / Math.min(14, n-1) || 0
    const avgBody = sma(closes.map((c,i) => Math.abs(c-opens[i]!)), 20)
    const bullFVG = lows[n-1]! > highs[n-3]! && (lows[n-1]!-highs[n-3]!) >= 0.45*atr14 && (closes[n-2]!-opens[n-2]!) > 1.3*avgBody
    const bearFVG = highs[n-1]! < lows[n-3]! && (lows[n-3]!-highs[n-1]!) >= 0.45*atr14 && (opens[n-2]!-closes[n-2]!) > 1.3*avgBody
    const rangeHigh = Math.max(...highs.slice(-50)), rangeLow = Math.min(...lows.slice(-50)), poc = (rangeHigh+rangeLow)/2
    const rvol = (vols[n-1]!)/Math.max(1e-9, sma(vols, 20))
    const shapeScore = (dirBias > 0 && closes[n-1]! > poc)||(dirBias < 0 && closes[n-1]! < poc) ? 1.0 : 0.4
    const e9 = ema(closes,9), e21 = ema(closes,21), adxProxy = Math.min(50, Math.abs(e9-e21)/Math.max(1e-9,atr14)*20)
    const regimeRaw = shapeScore*0.8 + (adxProxy > 25 ? dirBias*0.8 : 0) + (rvol > 1.8 ? dirBias*0.4 : 0)
    const regimeScore = Math.min(1, Math.max(-1, regimeRaw))
    const volAcc = sma(vols,14)/Math.max(1e-9,sma(vols,50)), fvgHit = bullFVG||bearFVG ? 1.0 : 0.6, obHit = dirBias !== 0 ? 1.0 : 0.5
    const alphaScore = Math.min(100, Math.max(0, Math.round((volAcc*35*0.38 + fvgHit*25*0.25 + obHit*20*0.14 + 1.0*25*0.23 + regimeScore*15)*1.61)))
    const tier = alphaScore >= 85 ? 'S' : alphaScore >= 72 ? 'A' : alphaScore >= 58 ? 'B' : 'C' as 'S'|'A'|'B'|'C'
    const regime = Math.abs(regimeScore) < 0.3 ? 'RANGING' : regimeScore > 0.5 ? 'BULL TREND' : regimeScore < -0.5 ? 'BEAR TREND' : 'TRANSITION'
    return { alphaScore, tier, regime, dirBias, targetLevel: dirBias > 0 ? rangeHigh+atr14*0.6 : rangeLow-atr14*0.6, jediBull: regimeScore > 0.4 && alphaScore >= 72, jediBear: regimeScore < -0.4 && alphaScore >= 72 }
  }, [bars, showHeat])

  return (
    <div className="tv-lw-page">
      {/* SOLO orb dock */}
      <div className={`tv-lw-solo-dock tv-lw-solo-dock--${soloDock.side} tv-lw-solo-dock--tier-${soloDock.tier} ${soloDock.visible ? '' : 'tv-lw-solo-dock--collapsed'}`}>
        {soloDock.visible ? (
          <>
            <div className={['tv-lw-solo-dock__orb', soloOnMove && soloOrbDir === 'LONG' ? 'tv-lw-solo-dock__orb--move-long' : '', soloOnMove && soloOrbDir === 'SHORT' ? 'tv-lw-solo-dock__orb--move-short' : ''].filter(Boolean).join(' ')}>
              <SoloMasterOrb direction={soloOrbDir} score={soloOrbScore} conviction={soloOrbConv} strengthPct={solo.strength} onMoveStrengthPct={50} rvolRatio={solo.rvolRatio} density="focus" />
            </div>
            <div className="tv-lw-solo-dock__controls">
              <div className="tv-lw-solo-dock__row">
                <button type="button" className={`tv-lw-solo-dock__btn ${soloDock.side === 'left' ? 'is-active' : ''}`} onClick={() => setSoloDockPatch({ side: 'left' })}>L</button>
                <button type="button" className={`tv-lw-solo-dock__btn ${soloDock.side === 'right' ? 'is-active' : ''}`} onClick={() => setSoloDockPatch({ side: 'right' })}>R</button>
              </div>
              <button type="button" className="tv-lw-solo-dock__btn tv-lw-solo-dock__btn--hs" onClick={() => setSoloDockPatch({ visible: false })}>H/S</button>
              <div className="tv-lw-solo-dock__row">
                <button type="button" className="tv-lw-solo-dock__btn" onClick={() => setSoloDockPatch(p => ({ tier: Math.max(0, p.tier-1) as SoloDockTier }))}>U</button>
                <button type="button" className="tv-lw-solo-dock__btn" onClick={() => setSoloDockPatch(p => ({ tier: Math.min(2, p.tier+1) as SoloDockTier }))}>D</button>
              </div>
            </div>
          </>
        ) : (
          <button type="button" className="tv-lw-solo-dock__btn tv-lw-solo-dock__reveal" onClick={() => setSoloDockPatch({ visible: true })}>S</button>
        )}
      </div>

      {/* Control strip */}
      <div className="tv-lw-control-strip">
        <div className="tv-lw-masters-row">
          {/* OBI badge */}
          <div className="tv-lw-masters-seg" style={{ paddingRight: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#a78bfa', fontFamily: 'monospace', letterSpacing: 2, textShadow: '0 0 8px #a78bfa', padding: '2px 6px' }}>◉ OBI</span>
          </div>

          {/* Ticker */}
          <div className="tv-lw-masters-seg tv-lw-masters-seg--sym">
            <div className="tv-lw-ticker-wrap">
              <input type="text" className="tv-lw-ticker-input" value={tickerInput} placeholder={sym}
                onFocus={() => setTickerFocus(true)} onClick={() => setTickerFocus(true)} onBlur={() => setTimeout(() => setTickerFocus(false), 120)}
                onChange={e => setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void selectTicker(tickerInput) } }} />
              {tickerFocus && (
                <div className="tv-lw-ticker-dd">
                  {tickerSuggestions.map(t => <button key={t} type="button" className="tv-lw-ticker-dd-item" onMouseDown={e => { e.preventDefault(); void selectTicker(t) }}>{t}</button>)}
                </div>
              )}
            </div>
          </div>

          {/* TF */}
          <div className="tv-lw-masters-seg tv-lw-masters-seg--tf">
            {TIMEFRAME_OPTIONS.map(o => <button key={o.id} type="button" className={tf === o.id ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => setTimeframe(o.id)}>{o.label}</button>)}
          </div>

          {/* ICT group */}
          <div className="tv-lw-masters-seg tv-lw-masters-seg--ict-master">
            <button type="button" className={allIctOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={toggleAllIct}>ICT</button>
          </div>
          <div className="tv-lw-masters-seg tv-lw-masters-seg--ict">
            {([['OB','showOrderBlocks'],['FVG','showFvg'],['VP','showPoc'],['VWAP','showVwap'],['SWG','showSwingRays'],['SESS','showSessionLevels'],['ICHI','showIchimoku'],['MAs','showMas']] as [string, keyof ChartControls][]).map(([lbl, key]) => (
              <button key={key} type="button" className={controls[key] ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, [key]: !controls[key] })}>{lbl}</button>
            ))}
          </div>

          {/* Heat + OBI toggle */}
          <div className="tv-lw-masters-seg tv-lw-masters-seg--heat">
            <button type="button" className={showHeat ? 'tv-lw-pill tv-lw-pill--purple-on' : 'tv-lw-pill tv-lw-pill--purple-off'} onClick={() => setShowHeat(v => !v)}>HEAT</button>
            <button type="button" className={obiVisible ? 'tv-lw-pill tv-lw-pill--purple-on' : 'tv-lw-pill tv-lw-pill--purple-off'} onClick={() => setObiVisible(v => !v)} style={{ marginLeft: 2 }}>OBI</button>
          </div>

          {/* DEF */}
          <div className="tv-lw-masters-seg tv-lw-masters-seg--tail">
            <button type="button" className={controls.showGrid ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showGrid: !controls.showGrid })}>GRID</button>
            <button type="button" className={controls.safetyDefenseOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={toggleSafetyDefense}>DEF</button>
          </div>
        </div>
      </div>

      {controls.safetyDefenseOn && <div className="tv-lw-safety-chip"><span className="tv-lw-safety-chip__title">DEF · ARMED</span></div>}
      {err && <p className="err">{err}</p>}

      {/* Chart stage — flex row: chart left, OBI panel right */}
      <div className="chart-stage" style={{ flexDirection: 'row' }}>
        {/* Chart column */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div className="tv-lw-chart-overlay">
            <span className="tv-lw-overlay-sym">{sym}</span>
            {lastPrice !== null && <span className="tv-lw-overlay-price">{fmtPrice(lastPrice)}</span>}
            {priceChgPct !== null && <span className={`tv-lw-overlay-chg ${priceChgPct >= 0 ? 'pos' : 'neg'}`}>{priceChgPct >= 0 ? '+' : ''}{priceChgPct.toFixed(2)}%</span>}
            {heat && <span className={`tv-lw-overlay-heat tv-lw-overlay-heat--${heat.tier.toLowerCase()}`}>{heat.tier} {heat.alphaScore} {heat.jediBull ? '▲' : heat.jediBear ? '▼' : '·'} {heat.regime.replace(' TREND','')}</span>}
          </div>
          {loading && <p className="muted">Loading…</p>}
          {!loading && bars.length > 0 && chartKey && (
            <BoomLwChart key={chartKey} bars={bars} controls={controls} symbol={sym}
              heatTarget={(heat && (heat.tier === 'S' || heat.tier === 'A')) ? { price: heat.targetLevel, tier: heat.tier } : null} />
          )}
        </div>
        {/* OBI panel — fixed width, full height */}
        {obiVisible && bars.length > 0 && <ObiPanel bars={bars} />}
      </div>
    </div>
  )
}
