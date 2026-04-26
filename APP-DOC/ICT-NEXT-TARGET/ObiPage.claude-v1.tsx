import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bar } from '$indicators/boom3d-tech';
import { fetchBarsForSymbol, type ChartSymbol } from '@pwa/lib/fetchBars';
import { defaultSymbolForStrip, loadChartStripSymbol, saveChartStripSymbol } from '@pwa/lib/chartStripSymbol';
import { TIMEFRAME_OPTIONS, loadTimeframe, saveTimeframe, type TimeframePreset } from '@pwa/lib/chartTimeframes';
import { loadControls, saveControls, setMasLayer, type ChartControls } from '@pwa/lib/chartControls';
import { computePriceTargets, type LiquidityThermalResult } from '@pwa/lib/computePriceTargets';
import { buildObiChartHeatTargets, type ObiLineDensity, type ObiLineSpread } from '@pwa/lib/obiChartHeatTargets';
import { obiBoomMinimalControls } from '@pwa/lib/obiBoomMinimalControls';
import type { HeatTarget } from '../components/BoomLwChart';
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

// NY time helpers (EST = UTC-5, no DST correction — close enough for level grouping)
const NY_OFF = 5 * 3600
const nyHour = (t: number) => Math.floor(((t - NY_OFF) % 86400 + 86400) % 86400 / 3600)
const nyDayStart = (t: number) => Math.floor((t - NY_OFF) / 86400) * 86400 + NY_OFF
const nyWeekStart = (t: number) => {
  const dow = new Date((t - NY_OFF) * 1000).getUTCDay() // 0=Sun
  return nyDayStart(t) - dow * 86400
}

interface ICTLevels {
  pdh: number; pdl: number   // prev day high/low
  ah: number;  al: number    // Asia range (8pm–midnight ET)
  lh: number;  ll: number    // London killzone (2–5am ET)
  mno: number                // midnight open (00:00 NY)
  pwh: number; pwl: number   // prev week high/low
  eqh: number[]              // equal highs (buyside liquidity)
  eql: number[]              // equal lows  (sellside liquidity)
}

function bICTLevels(bars: Bar[], atr: number): ICTLevels {
  if (!bars.length) return { pdh: 0, pdl: 0, ah: 0, al: 0, lh: 0, ll: 0, mno: 0, pwh: 0, pwl: 0, eqh: [], eql: [] }
  const last = bars[bars.length - 1]!
  const today  = nyDayStart(last.time)
  const yest   = today - 86400
  const thisWk = nyWeekStart(last.time)
  const lastWk = thisWk - 7 * 86400

  let pdh = 0, pdl = Infinity
  let ah = 0, al = Infinity     // Asia: NY hour 20–23 of yesterday
  let lh = 0, ll = Infinity     // London KZ: NY hour 2–5 of today
  let mno = 0
  let pwh = 0, pwl = Infinity

  for (const b of bars) {
    const t = b.time
    const h = nyHour(t)
    const ds = nyDayStart(t)

    // PDH/PDL — yesterday full day
    if (ds === yest) {
      pdh = Math.max(pdh, b.high)
      pdl = Math.min(pdl, b.low)
    }

    // Asia range — 8pm–midnight ET of the most-recent complete evening (yesterday NY evening)
    if (ds === yest && h >= 20) {
      ah = Math.max(ah, b.high)
      al = Math.min(al, b.low)
    }

    // London killzone — 2am–5am ET today
    if (ds === today && h >= 2 && h <= 5) {
      lh = Math.max(lh, b.high)
      ll = Math.min(ll, b.low)
    }

    // Midnight Open — first bar at hour 0 of today
    if (mno === 0 && ds === today && h === 0) mno = b.open

    // Previous week range
    if (t >= lastWk && t < thisWk) {
      pwh = Math.max(pwh, b.high)
      pwl = Math.min(pwl, b.low)
    }
  }

  if (pdl  === Infinity) { pdh = 0; pdl = 0 }
  if (al   === Infinity) { ah  = 0; al  = 0 }
  if (ll   === Infinity) { lh  = 0; ll  = 0 }
  if (pwl  === Infinity) { pwh = 0; pwl = 0 }

  // Equal Highs/Lows — swing pivots within ATR*0.18 tolerance (buyside/sellside liquidity)
  const tol = atr * 0.18
  const slice = bars.slice(-100)
  const swH: number[] = [], swL: number[] = []
  for (let i = 2; i < slice.length - 2; i++) {
    const b = slice[i]!
    if (b.high >= slice[i-1]!.high && b.high >= slice[i-2]!.high && b.high >= slice[i+1]!.high && b.high >= slice[i+2]!.high)
      swH.push(b.high)
    if (b.low  <= slice[i-1]!.low  && b.low  <= slice[i-2]!.low  && b.low  <= slice[i+1]!.low  && b.low  <= slice[i+2]!.low)
      swL.push(b.low)
  }
  const eqh = groupEqualLevels(swH, tol)
  const eql = groupEqualLevels(swL, tol)

  return { pdh, pdl, ah, al, lh, ll, mno, pwh, pwl, eqh, eql }
}

function groupEqualLevels(prices: number[], tol: number): number[] {
  const groups: number[][] = []
  for (const p of prices) {
    const g = groups.find(gr => Math.abs(gr[0]! - p) <= tol)
    if (g) g.push(p); else groups.push([p])
  }
  return groups.filter(g => g.length >= 2).map(g => g.reduce((a, b) => a + b, 0) / g.length)
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
  return clusters.slice(0, 4).map((cl, idx) => {
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

  // VWAP SD1/SD2 — algo anchors, ICT watches these for reversals
  add(vd.u1,'VWAP','UP'); add(vd.d1,'VWAP','DOWN'); add(vd.u2,'VWAP','UP'); add(vd.d2,'VWAP','DOWN')
  // Volume profile POC/VA — institutional volume concentration
  add(vp.poc,'VOL','BOTH'); add(vp.vah,'VOL','UP'); add(vp.val,'VOL','DOWN')
  // ICT structural liquidity — the only real price magnets
  const ict = bICTLevels(bars, atrVal)
  if (ict.pdh) { add(ict.pdh, 'PDH', 'UP');  add(ict.pdl, 'PDL', 'DOWN') }
  if (ict.ah)  { add(ict.ah,  'AH',  'UP');  add(ict.al,  'AL',  'DOWN') }
  if (ict.lh)  { add(ict.lh,  'LH',  'UP');  add(ict.ll,  'LL',  'DOWN') }
  if (ict.mno) { add(ict.mno, 'MNO', 'BOTH') }
  if (ict.pwh) { add(ict.pwh, 'PWH', 'UP');  add(ict.pwl, 'PWL', 'DOWN') }
  ict.eqh.forEach(p => add(p, 'EQH', 'UP'))   // buyside liquidity above equal highs
  ict.eql.forEach(p => add(p, 'EQL', 'DOWN'))  // sellside liquidity below equal lows

  const targets = rankTargets(lv, dir, cur, atrVal)
  const stop = dir === 'BULL' ? cur - atrVal*1.5 : cur + atrVal*1.5
  const t1 = targets[0]?.price ?? cur
  const rr = parseFloat((Math.abs(t1-cur) / (atrVal*1.5)).toFixed(1))

  const preds = [
    { id:'ORB',  dir: orb?.dir ?? 'NEUTRAL' },
    { id:'VWAP', dir: cur > vd.vw ? 'BULL' : 'BEAR' },
    { id:'VOL',  dir: cur > vp.poc ? 'BULL' : 'BEAR' },
    { id:'ICT',  dir: ict.pdh ? (cur > (ict.pdh+ict.pdl)/2 ? 'BULL' : 'BEAR') : 'NEUTRAL' },
    { id:'EMA',  dir: e9 > e21 ? 'BULL' : 'BEAR' },
    { id:'WEEK', dir: ict.pwh ? (cur > (ict.pwh+ict.pwl)/2 ? 'BULL' : 'BEAR') : 'NEUTRAL' },
  ] as { id: string; dir: 'BULL'|'BEAR'|'NEUTRAL' }[]

  return { dir, composite, targets, stop, entry: cur, rr, atrVal, preds, ict }
}

// ── OBI Target Panel ──────────────────────────────────────────────────────────

function ObiPanel({ bars }: { bars: Bar[] }) {
  const obi = useMemo(() => computeOBI(bars), [bars])
  if (!obi) return null

  const dc = DIR_C[obi.dir] ?? '#60a5fa'
  const fmt = (p: number) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 1 }) : p < 10 ? p.toFixed(5) : p.toFixed(2)

  return (
    <div style={{
      width: 200, flexShrink: 0,
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

      {/* ICT Magnets — the key daily liquidity pools ICT hunts */}
      <div style={{ borderTop: '1px solid rgba(0,212,255,0.15)', flexShrink: 0, padding: '4px 0 0' }}>
        <div style={{ padding: '2px 10px 3px', fontSize: 7, color: '#00d4ff', fontFamily: 'monospace', letterSpacing: 2, opacity: 0.7 }}>ICT MAGNETS</div>
        {(() => {
          const { ict } = obi
          const cur = obi.entry
          const rows: { label: string; price: number; side: 'above'|'below'|'at' }[] = []
          const addRow = (label: string, price: number) => {
            if (!price) return
            const side = price > cur * 1.0005 ? 'above' : price < cur * 0.9995 ? 'below' : 'at'
            rows.push({ label, price, side })
          }
          addRow('PDH', ict.pdh); addRow('PDL', ict.pdl)
          addRow('PWH', ict.pwh); addRow('PWL', ict.pwl)
          addRow('AH',  ict.ah);  addRow('AL',  ict.al)
          addRow('LH',  ict.lh);  addRow('LL',  ict.ll)
          if (ict.mno) addRow('MNO', ict.mno)
          ict.eqh.slice(0,2).forEach((p,i) => addRow(`EQH${i+1}`, p))
          ict.eql.slice(0,2).forEach((p,i) => addRow(`EQL${i+1}`, p))
          const sorted = rows.sort((a,b) => b.price - a.price)
          return sorted.map(r => {
            const isKey = r.label === 'PDH' || r.label === 'PDL' || r.label.startsWith('EQ')
            const c = r.side === 'above' ? '#00d4ff' : r.side === 'below' ? '#f43f5e' : '#fbbf24'
            return (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 10px' }}>
                <span style={{ fontSize: isKey ? 8 : 7, fontWeight: isKey ? 800 : 400, color: c, fontFamily: 'monospace', minWidth: 28, opacity: isKey ? 1 : 0.7 }}>{r.label}</span>
                <div style={{ flex: 1, height: 1, background: c, opacity: r.side === 'at' ? 0.9 : 0.2 }} />
                <span style={{ fontSize: 8, color: c, fontFamily: 'monospace', opacity: isKey ? 1 : 0.75 }}>{fmt(r.price)}</span>
              </div>
            )
          })
        })()}
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
const SOLO_DOCK_KEY = 'm5d.obi.soloDock'
/** LT blue/red/ICT OBI line overlay — on/off and 3 vs 7 levels (persists) */
const OBI_CHART_LINES_KEY = 'm5d.obi.chartLines' as const
const OBI_BOOM_MIN_KEY = 'm5d.obi.boomMinimal' as const
const SOLO_PARTICIPATION_FLOOR_PCT = 15

type SoloDockSide = 'left' | 'right'
type SoloDockTier = 0 | 1 | 2
type SoloDockState = { side: SoloDockSide; tier: SoloDockTier; visible: boolean }

function loadSoloDock(): SoloDockState {
  try { const j = JSON.parse(localStorage.getItem(SOLO_DOCK_KEY) ?? '{}') as Partial<SoloDockState>; return { side: j.side === 'left' ? 'left' : 'right', tier: j.tier === 0 || j.tier === 1 || j.tier === 2 ? j.tier : 1, visible: j.visible !== false } } catch { return { side: 'right', tier: 1, visible: true } }
}
function saveSoloDock(s: SoloDockState) { try { localStorage.setItem(SOLO_DOCK_KEY, JSON.stringify(s)) } catch {} }

type ObiChartLines = { show: boolean; density: ObiLineDensity; spread: ObiLineSpread }
function loadObiChartLines(): ObiChartLines {
  try {
    const raw = localStorage.getItem(OBI_CHART_LINES_KEY)
    if (!raw) return { show: true, density: 3, spread: 'normal' }
    const j = JSON.parse(raw) as Record<string, unknown>
    const show = j.show !== false
    if (j.density === 7 || j.density === '7') {
      return { show, density: 7, spread: j.spread === 'wide' ? 'wide' : 'normal' }
    }
    if (j.density === 'multi' || j.density === 'M' || j.density === 'm') {
      return { show, density: 'multi', spread: j.spread === 'wide' ? 'wide' : 'normal' }
    }
    if (j.full === true) {
      return { show, density: 7, spread: j.spread === 'wide' ? 'wide' : 'normal' }
    }
    if (j.full === false) {
      return { show, density: 3, spread: j.spread === 'wide' ? 'wide' : 'normal' }
    }
    return { show, density: 3, spread: j.spread === 'wide' ? 'wide' : 'normal' }
  } catch { return { show: true, density: 3, spread: 'normal' } }
}
function saveObiChartLines(s: ObiChartLines) { try { localStorage.setItem(OBI_CHART_LINES_KEY, JSON.stringify(s)) } catch { /* */ } }

function loadObiBoomMinimal(): boolean {
  try {
    const raw = localStorage.getItem(OBI_BOOM_MIN_KEY)
    if (raw == null) return false
    const j = JSON.parse(raw) as { v?: boolean }
    return j.v === true
  } catch { return false }
}
function saveObiBoomMinimal(v: boolean) { try { localStorage.setItem(OBI_BOOM_MIN_KEY, JSON.stringify({ v })) } catch { /* */ } }

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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showHeat, setShowHeat] = useState(true)
  const [obiVisible, setObiVisible] = useState(true)
  const [obiChartLines, setObiChartLines] = useState<ObiChartLines>(() => loadObiChartLines())
  const [obiBoomMinimal, setObiBoomMinimal] = useState<boolean>(() => loadObiBoomMinimal())
  const [soloDock, setSoloDock] = useState<SoloDockState>(() => loadSoloDock())
  const setObiChartLinesPatch = useCallback((patch: Partial<ObiChartLines> | ((p: ObiChartLines) => ObiChartLines)) => {
    setObiChartLines(prev => {
      const n = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
      saveObiChartLines(n)
      return n
    })
  }, [])
  const setObiBoomMinimalPatch = useCallback((v: boolean) => { setObiBoomMinimal(v); saveObiBoomMinimal(v) }, [])
  const boomControls = useMemo(
    () => (obiBoomMinimal ? obiBoomMinimalControls(controls) : controls),
    [obiBoomMinimal, controls],
  )
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
    window.addEventListener('m5d:setTf', onTf); window.addEventListener('m5d:setSym', onSym)
    return () => {
      window.removeEventListener('m6d:setTf', onTf); window.removeEventListener('m6d:setSym', onSym)
      window.removeEventListener('m5d:setTf', onTf); window.removeEventListener('m5d:setSym', onSym)
    }
  }, [load, sym])

  const setTimeframe = useCallback((next: TimeframePreset) => { setTf(next); saveTimeframe(next); void load(sym, next) }, [load, sym])

  const allIndicatorsOn =
    controls.showBB &&
    controls.showKC &&
    controls.showSqueeze &&
    controls.showPoc &&
    controls.showLt &&
    controls.showVwap &&
    controls.showCouncilArrows &&
    controls.showIchimoku &&
    controls.showMas &&
    controls.showFvg &&
    controls.squeezePurpleBg &&
    controls.showOrderBlocks &&
    controls.showSwingRays &&
    controls.showSessionLevels
  const safetySummary = `RV ${controls.sigRvolMin.toFixed(2)}x · ATR ${controls.sigAtrExpandMin.toFixed(2)}x · BRK ${(controls.sigBreakAtrFrac * 100).toFixed(0)}% · ${controls.sigMode === 'strict' ? 'STR' : 'BAL'}`

  // ICT master: masterOn tracks whether user explicitly activated the ICT clean preset.
  // defaultControls.masterOn=true, so we DON'T use it to drive the toggle — instead
  // we track whether the pack is currently in “ICT clean state” by checking all 7 keys.
  const ict7Keys: (keyof ChartControls)[] = [
    'showOrderBlocks', 'showFvg', 'showPoc', 'showLt', 'showVwap', 'showSwingRays', 'showSessionLevels',
  ]
  // “ICT mode” = all 7 are on AND the noisy layers are off
  const ictModeOn =
    ict7Keys.every((k) => controls[k] === true) &&
    !controls.showBB && !controls.showKC && !controls.showSqueeze && !controls.showCouncilArrows

  const applyIctPack = useCallback((on: boolean) => {
    if (on) {
      persist({
        ...controls,
        showBB: false, showKC: false, showSar: false,
        showSqueeze: false, squeezeLinesGreen: false, squeezePurpleBg: false,
        showDarvas: false, showCouncilArrows: false, showVoteDots: false,
        showLt: true, showKillzones: false, showEqualLevels: false,
        showBreakerBlocks: false, showVolBubbles: false, showMmBrain: false,
        showOrderBlocks: true, showFvg: true, showPoc: true, showVwap: true,
        showSwingRays: true, showSessionLevels: true,
        showIchimoku: false, showMas: false,
        masterOn: true,
      })
    } else {
      persist({ ...controls, showOrderBlocks: false, showFvg: false, showPoc: false, showLt: false, showVwap: false, showSwingRays: false, showSessionLevels: false, masterOn: false })
    }
  }, [controls, persist])

  const toggleIctMaster = useCallback(() => {
    applyIctPack(!ictModeOn)
  }, [ictModeOn, applyIctPack])

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
  const targetPack = useMemo(() => computePriceTargets(bars), [bars])
  const lt: LiquidityThermalResult | null = targetPack.lt
  const chartLtHeatTargets = useMemo((): HeatTarget[] => {
    return buildObiChartHeatTargets(bars, lt, targetPack.targets, targetPack.atr, {
      show: obiChartLines.show,
      density: obiChartLines.density,
      spread: obiChartLines.spread,
    })
  }, [lt, obiChartLines, bars, targetPack.targets, targetPack.atr])

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

      {/* Control strip (full parity with M4D #spx + M5D ICT-6 master) */}
      <div className="tv-lw-control-strip">
        <div className="tv-lw-masters-row" role="group" aria-label="Chart overlays">
          <div className="tv-lw-masters-seg" style={{ paddingRight: 4 }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: '#a78bfa', fontFamily: 'monospace', letterSpacing: 1, textShadow: '0 0 8px #a78bfa', padding: '1px 4px' }}>◉ OBI</span>
          </div>

          <div className="tv-lw-masters-seg tv-lw-masters-seg--sym">
            <div className="tv-lw-ticker-wrap">
              <input type="text" className="tv-lw-ticker-input" value={tickerInput} placeholder={sym}
                onFocus={() => setTickerFocus(true)} onClick={() => setTickerFocus(true)} onBlur={() => setTimeout(() => setTickerFocus(false), 120)}
                onChange={e => setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void selectTicker(tickerInput) } }} />
              {tickerFocus && (
                <div className="tv-lw-ticker-dd" role="listbox">
                  {tickerSuggestions.map(t => <button key={t} type="button" className="tv-lw-ticker-dd-item" onMouseDown={e => { e.preventDefault(); void selectTicker(t) }}>{t}</button>)}
                </div>
              )}
            </div>
          </div>

          <div className="tv-lw-masters-seg tv-lw-masters-seg--tf">
            {TIMEFRAME_OPTIONS.map(o => <button key={o.id} type="button" className={tf === o.id ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => setTimeframe(o.id)}>{o.label}</button>)}
          </div>

          <div className="tv-lw-masters-seg tv-lw-masters-seg--ict-master" role="group" aria-label="ICT-6 master">
            <button type="button" className={ictModeOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={toggleIctMaster} title="ICT preset: OB·FVG·VP·LT·VWAP·SWG·SESS on — strips BB/SQZ/SIG noise. Press again to clear all.">ICT</button>
          </div>
          <div className="tv-lw-masters-seg tv-lw-masters-seg--ict" role="group" aria-label="ICT · heat bases">
            <button type="button" className={controls.showOrderBlocks ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showOrderBlocks: !controls.showOrderBlocks })} title="Order blocks (SMC)">OB</button>
            <button type="button" className={controls.showFvg ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showFvg: !controls.showFvg })} title="FVG heat bands (horizontal)">FVG</button>
            <button type="button" className={controls.showPoc ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showPoc: !controls.showPoc })} title="VP heat + VPOC line (volume-at-price)">VP</button>
            <button type="button" className={controls.showLt ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showLt: !controls.showLt })} title="Liquidity Thermal — 300-bar 31-bin volume heatmap (full canvas)">LT</button>
            <button type="button" className={controls.showVwap ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showVwap: !controls.showVwap })} title="Session VWAP + ±1σ bands (trend read)">VWAP</button>
            <button type="button" className={controls.showSwingRays ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showSwingRays: !controls.showSwingRays })} title="Fractal swing rays">SWG</button>
            <button type="button" className={controls.showSessionLevels ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showSessionLevels: !controls.showSessionLevels })} title="Session levels: OR / PDH / PDL">SESS</button>
            <button type="button" className={controls.showIchimoku ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showIchimoku: !controls.showIchimoku })} title="Ichimoku cloud">ICHI</button>
            <button type="button" className={controls.showMas ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist(setMasLayer(controls, !controls.showMas))} title="EMA ribbon">MAs</button>
          </div>

          <div className="tv-lw-masters-seg tv-lw-masters-seg--vol" role="group" aria-label="Volatility · signals">
            <button type="button" className={controls.showBB || controls.showKC ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => { const next = !(controls.showBB || controls.showKC); persist({ ...controls, showBB: next, showKC: next }) }}>BB·KC</button>
            <button type="button" className={controls.showSqueeze ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showSqueeze: !controls.showSqueeze })} title="BOOM squeeze: box lines + trend fill">SQZ</button>
            <button type="button" className={controls.showCouncilArrows ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showCouncilArrows: !controls.showCouncilArrows })} title="SIG arrows: box break + RVOL + ATR (targets expansion)">SIG</button>
            <button type="button" className={controls.sigMode === 'strict' ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => persist({ ...controls, sigMode: controls.sigMode === 'strict' ? 'balanced' : 'strict' })} title="SIG density: BAL vs STR">{controls.sigMode === 'strict' ? 'SIG STR' : 'SIG BAL'}</button>
            <button type="button" className={controls.squeezePurpleBg ? 'tv-lw-pill tv-lw-pill--purple-on' : 'tv-lw-pill tv-lw-pill--purple-off'}
              onClick={() => persist({ ...controls, squeezePurpleBg: !controls.squeezePurpleBg })} title="Purple squeeze tint">PURPLE</button>
            <button type="button"
              className={controls.squeezePurpleBg && controls.showSqueeze && controls.showCouncilArrows && controls.showSessionLevels ? 'tv-lw-pill tv-lw-pill--purple-on' : 'tv-lw-pill tv-lw-pill--purple-off'}
              onClick={() => {
                const next = !(controls.squeezePurpleBg && controls.showSqueeze && controls.showCouncilArrows && controls.showSessionLevels)
                persist({ ...controls, squeezePurpleBg: next, showSqueeze: next, showCouncilArrows: next, showSessionLevels: next })
              }} title="BOOM mode: Purple + SQZ + SIG + SESS">BOOM</button>
          </div>

          <div className="tv-lw-masters-seg tv-lw-masters-seg--obi-lines" role="group" aria-label="OBI level lines (chart) — own layer" style={{ borderLeft: '1px solid rgba(59,130,246,0.4)', paddingLeft: 8, marginLeft: 4, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }}>
            <button
              type="button"
              className={obiChartLines.show ? 'tv-lw-pill tv-lw-pill--purple-on' : 'tv-lw-pill tv-lw-pill--purple-off'}
              onClick={() => setObiChartLinesPatch(s => ({ ...s, show: !s.show }))}
              style={{ minWidth: 40, fontWeight: 800, letterSpacing: 0.5 }}
              title="OBI level lines (own chart layer, drawn on top): blue above last · red below · purple ~at. Liquidity-thermal levels."
            >
              LINES
            </button>
            <button
              type="button"
              className={!obiChartLines.show ? 'tv-lw-pill tv-lw-pill--ghost' : 'tv-lw-pill tv-lw-pill--on'}
              onClick={() => {
                if (!obiChartLines.show) return
                setObiChartLinesPatch((s) => ({
                  ...s,
                  density: s.density === 3 ? 7 : s.density === 7 ? 'multi' : 3,
                }))
              }}
              title={obiChartLines.show
                ? 'Cycle: 3 = LT core · 7 = up to 4 LT rungs · M = ICT (OB·sess·VP + swings), max 4, wide spacing'
                : 'Turn on LINES first'}
              disabled={!obiChartLines.show}
            >
              {obiChartLines.show
                ? (obiChartLines.density === 3 ? '3' : obiChartLines.density === 7 ? '7' : 'M')
                : '—'}
            </button>
            <button
              type="button"
              className={!obiChartLines.show ? 'tv-lw-pill tv-lw-pill--ghost' : obiChartLines.spread === 'wide' ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => {
                if (obiChartLines.show) { setObiChartLinesPatch(s => ({ ...s, spread: s.spread === 'wide' ? 'normal' : 'wide' })) }
              }}
              style={{ minWidth: 24 }}
              title="Spread: N ≈0.62 A·TR + 0.15% price min gap; W ≈1.15 A·TR + 0.26% (fewer, farther magnets)"
              disabled={!obiChartLines.show}
            >
              {obiChartLines.show ? (obiChartLines.spread === 'wide' ? 'W' : 'N') : '·'}
            </button>
            <button
              type="button"
              className={obiBoomMinimal ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => setObiBoomMinimalPatch(!obiBoomMinimal)}
              style={{ marginLeft: 4, minWidth: 32 }}
              title="MIN: hide FVG·OB·LT·VWAP·ICHI·SIG·MM·… on the chart. Strip pills stay as saved; off = full layer stack. Default off (new visit / no stored MIN)."
            >
              MIN
            </button>
          </div>

          <div className="tv-lw-masters-seg tv-lw-masters-seg--heat" role="group" aria-label="OBI page overlays">
            <button type="button" className={showHeat ? 'tv-lw-pill tv-lw-pill--purple-on' : 'tv-lw-pill tv-lw-pill--purple-off'} onClick={() => setShowHeat(v => !v)} title="Heatseeker alpha score overlay">HEAT</button>
            <button type="button" className={obiVisible ? 'tv-lw-pill tv-lw-pill--purple-on' : 'tv-lw-pill tv-lw-pill--purple-off'} onClick={() => setObiVisible(v => !v)} style={{ marginLeft: 2 }} title="OBI confluence & targets side panel">OBI</button>
          </div>

          <div className="tv-lw-masters-seg tv-lw-masters-seg--tail" role="group" aria-label="Layout · defence">
            <button type="button" className={allIndicatorsOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => {
                const next = !allIndicatorsOn
                persist({ ...controls, showFvg: next, showBB: next, showKC: next, showSqueeze: next, showPoc: next, showLt: next, showVwap: next, showCouncilArrows: next, showIchimoku: next, showMas: next, squeezePurpleBg: next, showOrderBlocks: next, showSwingRays: next, showSessionLevels: next })
              }} title="Toggle all strip overlays (VP, LT, heat bases, BOOM, SIG levels)">IND</button>
            <button type="button" className={controls.showGrid ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => persist({ ...controls, showGrid: !controls.showGrid })}>GRID</button>
            <button type="button" className={controls.safetyDefenseOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={toggleSafetyDefense} title="DEF: defence profile — stricter chart confirmations + softer SOLO conviction">DEF</button>
            <button type="button" className={settingsOpen ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={() => setSettingsOpen(v => !v)} title="FVG count + SIG (opacity, RVOL, ATR, BRK)">⚙ {settingsOpen ? '▴' : '▾'}</button>
          </div>
        </div>
      </div>

      {settingsOpen ? (
        <div className="tv-lw-settings-panel" role="group" aria-label="Indicator slider settings">
          <label className="tv-lw-opacity" dir="ltr" title="Max FVG heat zones drawn (most recent in list)">
            <span className="tv-lw-opacity__val">FVG ×{controls.fvgMaxDisplay}</span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>4</span>
            <input type="range" min={4} max={80} step={2} value={controls.fvgMaxDisplay} aria-label="Number of FVG zones to display"
              onChange={(e) => { const v = Number.parseInt(e.target.value, 10); persist({ ...controls, fvgMaxDisplay: Number.isFinite(v) ? v : 28 }) }} />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>80</span>
          </label>
          <label className="tv-lw-opacity" dir="ltr">
            <span className="tv-lw-opacity__val">SIG {controls.sigOpacity}%</span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>0</span>
            <input type="range" min={0} max={100} step={5} value={controls.sigOpacity} aria-label="SIG overlay opacity"
              onChange={(e) => persist({ ...controls, sigOpacity: Number.parseInt(e.target.value, 10) || 0 })} />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>100</span>
          </label>
          <label className="tv-lw-opacity" dir="ltr" title="SIG RVOL minimum">
            <span className="tv-lw-opacity__val">RV {controls.sigRvolMin.toFixed(2)}x</span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>1.00</span>
            <input type="range" min={1} max={2} step={0.05} value={controls.sigRvolMin} aria-label="SIG RVOL minimum multiplier"
              onChange={(e) => persist({ ...controls, sigRvolMin: Number.parseFloat(e.target.value) || 1.65 })} />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>2.00</span>
          </label>
          <label className="tv-lw-opacity" dir="ltr" title="SIG ATR expansion minimum">
            <span className="tv-lw-opacity__val">ATR {controls.sigAtrExpandMin.toFixed(2)}x</span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>1.00</span>
            <input type="range" min={1} max={2} step={0.01} value={controls.sigAtrExpandMin} aria-label="SIG ATR expansion minimum multiplier"
              onChange={(e) => persist({ ...controls, sigAtrExpandMin: Number.parseFloat(e.target.value) || 1.2 })} />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>2.00</span>
          </label>
          <label className="tv-lw-opacity" dir="ltr" title="SIG breakout distance as ATR fraction">
            <span className="tv-lw-opacity__val">BRK {(controls.sigBreakAtrFrac * 100).toFixed(0)}%</span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>1</span>
            <input type="range" min={0.01} max={0.2} step={0.01} value={controls.sigBreakAtrFrac} aria-label="SIG breakout ATR fraction"
              onChange={(e) => persist({ ...controls, sigBreakAtrFrac: Number.parseFloat(e.target.value) || 0.03 })} />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>20</span>
          </label>
        </div>
      ) : null}

      {controls.safetyDefenseOn ? (
        <div className="tv-lw-safety-chip" role="status" aria-live="polite">
          <span className="tv-lw-safety-chip__title">DEF · ARMED</span>
          <span className="tv-lw-safety-chip__meta">{safetySummary}</span>
        </div>
      ) : null}
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
            {obiBoomMinimal && <span className="tv-lw-overlay-heat" style={{ color: '#38bdf8', textShadow: '0 0 6px #38bdf8' }}>MIN</span>}
          </div>
          {loading && <p className="muted">Loading…</p>}
          {!loading && bars.length > 0 && chartKey && (
            <BoomLwChart
              key={chartKey}
              bars={bars}
              controls={boomControls}
              symbol={sym}
              obiConfirmTargets
              heatTargets={chartLtHeatTargets}
              heatTarget={(heat && (heat.tier === 'S' || heat.tier === 'A')) ? { price: heat.targetLevel, tier: heat.tier } : null}
            />
          )}
        </div>
        {/* OBI panel — fixed width, full height */}
        {obiVisible && bars.length > 0 && <ObiPanel bars={bars} />}
      </div>
    </div>
  )
}
