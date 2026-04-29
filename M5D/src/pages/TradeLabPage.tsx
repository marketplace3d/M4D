import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCouncil, usePoll } from '../api/client';
import { computeBoom3dTech, type Bar, type Boom3dBarOut } from '$indicators/boom3d-tech';
import { fetchBarsForSymbol, type ChartSymbol } from '@pwa/lib/fetchBars';
import { defaultSymbolForStrip, loadChartStripSymbol, saveChartStripSymbol } from '@pwa/lib/chartStripSymbol';
import { TIMEFRAME_OPTIONS, loadTimeframe, saveTimeframe, type TimeframePreset } from '@pwa/lib/chartTimeframes';
import { loadControls, saveControls, setMasLayer, type ChartControls } from '@pwa/lib/chartControls';
import { computePriceTargets, type LiquidityThermalResult } from '@pwa/lib/computePriceTargets';
import { buildObiChartHeatTargets, type ObiLineDensity, type ObiLineSpread } from '@pwa/lib/obiChartHeatTargets';
import { obiBoomMinimalControls } from '@pwa/lib/obiBoomMinimalControls';
import { useObPressureStream } from '../hooks/useObPressureStream';
import { clampHeatLineWidth, type HeatTarget } from '../components/BoomLwChart';
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

// ── Liquidity Walls — Volume At Price HVN/LVN ────────────────────────────────

interface LiqWall {
  price:     number
  relVol:    number   // volume / median (≥1.5 = wall, ≤0.5 = LVN)
  type:      'WALL' | 'LVN'
  side:      'ABOVE' | 'BELOW'
}

function computeLiquidityWalls(bars: Bar[], nBins = 80): LiqWall[] {
  const slice = bars.slice(-400)
  if (slice.length < 30) return []
  const pMin = Math.min(...slice.map(b => b.low))
  const pMax = Math.max(...slice.map(b => b.high))
  const range = pMax - pMin
  if (range <= 0) return []
  const binSz = range / nBins
  const vols = new Array<number>(nBins).fill(0)
  for (const b of slice) {
    const vol = b.volume ?? 1
    const barRange = Math.max(b.high - b.low, binSz * 0.01)
    for (let i = 0; i < nBins; i++) {
      const bLow  = pMin + i * binSz
      const bHigh = bLow + binSz
      const oLow  = Math.max(b.low, bLow)
      const oHigh = Math.min(b.high, bHigh)
      if (oHigh > oLow) vols[i] += vol * ((oHigh - oLow) / barRange)
    }
  }
  const sorted = [...vols].sort((a, b) => a - b)
  const median = sorted[Math.floor(nBins / 2)] ?? 1
  if (median <= 0) return []
  const cur = slice[slice.length - 1]!.close
  const walls: LiqWall[] = []
  for (let i = 0; i < nBins; i++) {
    const rel = vols[i]! / median
    const price = pMin + (i + 0.5) * binSz
    if (rel >= 1.5)       walls.push({ price, relVol: rel, type: 'WALL', side: price >= cur ? 'ABOVE' : 'BELOW' })
    else if (rel <= 0.4)  walls.push({ price, relVol: rel, type: 'LVN',  side: price >= cur ? 'ABOVE' : 'BELOW' })
  }
  // Merge adjacent same-type bins into single representative level
  const merged: LiqWall[] = []
  for (const w of walls) {
    const last = merged[merged.length - 1]
    if (last && last.type === w.type && last.side === w.side && Math.abs(w.price - last.price) < binSz * 2.5) {
      if (w.relVol > last.relVol) { last.price = w.price; last.relVol = w.relVol }
    } else {
      merged.push({ ...w })
    }
  }
  return merged
}

// ── ICT Brain helpers ─────────────────────────────────────────────────────────

function computeKillzone(lastTime: number): 'ASIA' | 'LONDON' | 'NY_AM' | 'OFF' {
  const h = nyHour(lastTime)
  if (h >= 20 || h <= 1) return 'ASIA'
  if (h >= 2 && h <= 5)  return 'LONDON'
  if (h >= 7 && h <= 10) return 'NY_AM'
  return 'OFF'
}

function detectFVG(bars: Bar[], dir: 'BULL' | 'BEAR'): { low: number; high: number; type: 'FVG' } | null {
  const sl = bars.slice(-40)
  for (let i = sl.length - 3; i >= 0; i--) {
    const a = sl[i]!, c = sl[i + 2]!
    if (dir === 'BULL' && a.high < c.low)  return { low: a.high, high: c.low,  type: 'FVG' }
    if (dir === 'BEAR' && a.low  > c.high) return { low: c.high, high: a.low,  type: 'FVG' }
  }
  return null
}

function detectOB(bars: Bar[], dir: 'BULL' | 'BEAR', cur: number, atr: number): { low: number; high: number; type: 'OB' } | null {
  const sl = bars.slice(-50)
  const reach = atr * 3
  if (dir === 'BULL') {
    for (let i = sl.length - 1; i >= 1; i--) {
      const b = sl[i]!
      if (b.close < b.open && b.high < cur && b.high > cur - reach)
        return { low: b.low, high: b.high, type: 'OB' }
    }
  } else {
    for (let i = sl.length - 1; i >= 1; i--) {
      const b = sl[i]!
      if (b.close > b.open && b.low > cur && b.low < cur + reach)
        return { low: b.low, high: b.high, type: 'OB' }
    }
  }
  return null
}

const ICT_LEVEL_SYSTEMS = new Set(['PDH','PDL','PWH','PWL','EQH','EQL','AH','AL','LH','LL','MNO'])

// ── ORB: Opening Range Breakout (NY 9:30–10:00 ET) ───────────────────────────

function computeORB(bars: Bar[]): { high: number; low: number; breakout: boolean } {
  const NY_OFF_S = 5 * 3600
  const last = bars[bars.length - 1]!
  const todayBaseS = Math.floor((last.time - NY_OFF_S) / 86400) * 86400 + NY_OFF_S
  const orbStart  = todayBaseS + 9.5 * 3600   // 9:30am ET
  const orbEnd    = todayBaseS + 10  * 3600   // 10:00am ET
  const orbBars   = bars.filter(b => b.time >= orbStart && b.time < orbEnd)
  if (orbBars.length < 3) return { high: 0, low: 0, breakout: false }
  const h = Math.max(...orbBars.map(b => b.high))
  const l = Math.min(...orbBars.map(b => b.low))
  return { high: h, low: l, breakout: last.close > h || last.close < l }
}

interface ICTBrain {
  killzone:       'ASIA' | 'LONDON' | 'NY_AM' | 'OFF'
  killzoneNow:    boolean
  dol:            ObiTarget | null
  t1IsICTLevel:   boolean
  entryZone:      { low: number; high: number; type: 'OB' | 'FVG' } | null
  invalidation:   number
  rapidExpansion: boolean   // last candle range ≥ 0.5×ATR (displacement)
  expansionRatio: number    // lastRange / ATR
  orbHigh:        number
  orbLow:         number
  orbBreakout:    boolean   // price outside today's opening range
}

function computeICTBrain(bars: Bar[], obi: NonNullable<ReturnType<typeof computeOBI>>): ICTBrain {
  const last = bars[bars.length - 1]!
  const killzone    = computeKillzone(last.time)
  const killzoneNow = killzone === 'LONDON' || killzone === 'NY_AM'
  const dol         = obi.targets[0] ?? null
  const t1IsICTLevel = dol ? dol.systems.some(s => ICT_LEVEL_SYSTEMS.has(s)) : false

  // Displacement: last 5m candle range vs ATR
  const lastRange    = last.high - last.low
  const expansionRatio = obi.atrVal > 0 ? lastRange / obi.atrVal : 0
  const rapidExpansion = expansionRatio >= 0.5

  const orb = computeORB(bars)

  let entryZone: ICTBrain['entryZone'] = null
  if (obi.dir !== 'NEUTRAL' && dol) {
    const ob = detectOB(bars, obi.dir, obi.entry, obi.atrVal)
    if (ob) entryZone = ob
    else { const fvg = detectFVG(bars, obi.dir); if (fvg) entryZone = fvg }
  }

  return {
    killzone, killzoneNow, dol, t1IsICTLevel, entryZone,
    invalidation:  obi.stop,
    rapidExpansion, expansionRatio,
    orbHigh: orb.high, orbLow: orb.low, orbBreakout: orb.breakout,
  }
}

interface ObiJediCondition { id: string; label: string; pass: boolean; note: string; isHardGate?: boolean }

interface ObiJediSignal {
  whackReady:     boolean   // hard gate: dir≠NEUTRAL AND kz AND (displace OR entryZone)
  fireScore:      number    // conditions passing (0–5)
  conditions:     ObiJediCondition[]
  obiDir:         'BULL' | 'BEAR' | 'NEUTRAL'
  t1Price:        number | null   // TP target = nearest ICT institutional level
  tpLabel:        string          // e.g. "PDH" "PWH"
  killzone:       'ASIA' | 'LONDON' | 'NY_AM' | 'OFF'
  killzoneNow:    boolean
  orbBreakout:    boolean
  entryZone:      ICTBrain['entryZone']
  rr:             number
  sizeMultiplier: number    // 1.2 aligned · 1.0 neutral · 0.5 conflict
  multReason:     string
}

interface LiquidityGlowState {
  compressionExpansion: number
  liquidityInteraction: number
  aggressionSpike: number
  structuralBreak: number
  total: number
}

function computeObiJediGate(
  obi: NonNullable<ReturnType<typeof computeOBI>>,
  brain: ICTBrain,
  jediScore: number,
): ObiJediSignal {
  const dol = brain.dol
  const f = (p: number) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 1 }) : p < 10 ? p.toFixed(5) : p.toFixed(2)

  // Kelly size multiplier: week+day bias agree with JEDI direction → 1.2×; conflict → 0.5×
  const jediDir = jediScore > 1 ? 'BULL' : jediScore < -1 ? 'BEAR' : 'NEUTRAL'
  const biasAligned = obi.biasStrong && obi.dir !== 'NEUTRAL' && (obi.dir === jediDir)
  const biasConflict = obi.dir !== 'NEUTRAL' && jediDir !== 'NEUTRAL' && obi.dir !== jediDir
  const sizeMultiplier = biasAligned ? 1.2 : biasConflict ? 0.5 : 1.0
  const multReason = biasAligned ? 'JEDI+ICT ALIGNED ↑' : biasConflict ? 'JEDI/ICT CONFLICT ↓' : 'NEUTRAL'

  // TP target: nearest ICT institutional level in bias direction
  const tpTarget = dol ?? null
  const tpLabel = tpTarget?.systems.filter(s => ICT_LEVEL_SYSTEMS.has(s)).join('/') ?? (tpTarget ? 'VWAP' : '—')

  // 5 conditions — KZ is the ONLY hard gate
  const displacedNote = `${brain.expansionRatio.toFixed(2)}×ATR${brain.rapidExpansion ? '' : ' (weak)'}`
  const entryNote = brain.entryZone
    ? `${brain.entryZone.type} ${f(brain.entryZone.low)}–${f(brain.entryZone.high)}`
    : brain.orbBreakout ? 'ORB BRK' : 'none'
  const conditions: ObiJediCondition[] = [
    { id: 'REGIME',  label: 'Direction',           pass: obi.dir !== 'NEUTRAL', note: obi.dir,          isHardGate: false },
    { id: 'KZ',      label: 'Kill Zone',            pass: brain.killzoneNow,    note: brain.killzone,    isHardGate: true  },
    { id: 'DISPLACE',label: 'Displacement ≥0.5ATR', pass: brain.rapidExpansion, note: displacedNote,    isHardGate: false },
    { id: 'ENTRY',   label: 'OB / FVG / ORB',       pass: !!brain.entryZone || brain.orbBreakout, note: entryNote, isHardGate: false },
    { id: 'RR',      label: 'R:R ≥ 2.0',            pass: obi.rr >= 2.0,        note: `1:${obi.rr}`,   isHardGate: false },
  ]

  // WHACK = direction + KZ (hard gate) + momentum (displacement OR entry zone)
  const momentum = brain.rapidExpansion || !!brain.entryZone || brain.orbBreakout
  const whackReady = obi.dir !== 'NEUTRAL' && brain.killzoneNow && momentum

  return {
    whackReady, fireScore: conditions.filter(c => c.pass).length,
    conditions, obiDir: obi.dir,
    t1Price: tpTarget?.price ?? null, tpLabel,
    killzone: brain.killzone, killzoneNow: brain.killzoneNow, orbBreakout: brain.orbBreakout,
    entryZone: brain.entryZone, rr: obi.rr,
    sizeMultiplier, multReason,
  }
}

function computeLiquidityGlowState(
  bars: Bar[],
  obi: NonNullable<ReturnType<typeof computeOBI>> | null,
  walls: LiqWall[],
): LiquidityGlowState {
  if (!obi || bars.length < 30) {
    return { compressionExpansion: 0, liquidityInteraction: 0, aggressionSpike: 0, structuralBreak: 0, total: 0 }
  }

  const last = bars[bars.length - 1]!
  const prev = bars[bars.length - 2]!
  const atrFast = bATR(bars.slice(-30), 10)
  const atrSlow = bATR(bars.slice(-140), 28) || atrFast || Math.max(1e-6, last.close * 0.005)
  const lastRange = Math.max(1e-9, last.high - last.low)
  const fastVsSlow = atrFast / atrSlow
  const expansionNow = lastRange / Math.max(1e-9, atrFast)
  const compressionExpansion = Math.max(0, Math.min(1, ((1 - Math.min(1.2, fastVsSlow)) * 0.45) + (Math.min(2.5, expansionNow) / 2.5) * 0.8))

  const candidateLevels: number[] = []
  const push = (v: number) => { if (isFinite(v) && v > 0) candidateLevels.push(v) }
  push(obi.ict.pdh); push(obi.ict.pdl); push(obi.ict.pwh); push(obi.ict.pwl)
  push(obi.ict.ah); push(obi.ict.al); push(obi.ict.lh); push(obi.ict.ll); push(obi.ict.mno)
  obi.ict.eqh.forEach(push); obi.ict.eql.forEach(push)
  walls.filter(w => w.type === 'WALL').slice(0, 24).forEach(w => push(w.price))
  const nearestDist = candidateLevels.length ? Math.min(...candidateLevels.map(p => Math.abs(p - last.close))) : atrFast * 2
  const liquidityInteraction = Math.max(0, Math.min(1, 1 - (nearestDist / Math.max(1e-9, atrFast * 1.6))))

  const lastVol = last.volume ?? 0
  const prevVol = bars.slice(-21, -1).reduce((s, b) => s + (b.volume ?? 0), 0) / 20
  const volSpike = prevVol > 0 ? lastVol / prevVol : 1
  const bodyFrac = Math.abs(last.close - last.open) / lastRange
  const aggressionSpike = Math.max(0, Math.min(1, (Math.min(3, volSpike) / 3) * 0.65 + bodyFrac * 0.45))

  const swingHigh = Math.max(...bars.slice(-24, -1).map(b => b.high))
  const swingLow = Math.min(...bars.slice(-24, -1).map(b => b.low))
  const breakout = last.close > swingHigh || last.close < swingLow
  const sweep = (last.high > swingHigh && last.close <= swingHigh) || (last.low < swingLow && last.close >= swingLow)
  const continuation = (last.close - prev.close) * (prev.close - bars[Math.max(0, bars.length - 3)]!.close) > 0
  const structuralBreak = breakout ? (continuation ? 1 : 0.85) : sweep ? 0.7 : 0.15

  const total = Math.max(
    0,
    Math.min(
      1,
      compressionExpansion * 0.25 +
      liquidityInteraction * 0.30 +
      aggressionSpike * 0.25 +
      structuralBreak * 0.20,
    ),
  )

  return { compressionExpansion, liquidityInteraction, aggressionSpike, structuralBreak, total }
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

  // ICT-native bias — computed first, drives everything
  const ict = bICTLevels(bars, atrVal)
  const weeklyBias: 'BULL'|'BEAR'|'NEUTRAL' = ict.pwh ? (cur > (ict.pwh+ict.pwl)/2 ? 'BULL' : 'BEAR') : 'NEUTRAL'
  const dailyBias:  'BULL'|'BEAR'|'NEUTRAL' = ict.pdh ? (cur > (ict.pdh+ict.pdl)/2 ? 'BULL' : 'BEAR') : 'NEUTRAL'

  // Both agree = strong. One neutral (no data) = weak single-TF. Both disagree = NEUTRAL (wait).
  const dir: 'BULL'|'BEAR'|'NEUTRAL' =
    weeklyBias !== 'NEUTRAL' && dailyBias !== 'NEUTRAL'
      ? (weeklyBias === dailyBias ? weeklyBias : 'NEUTRAL')
      : weeklyBias !== 'NEUTRAL' ? weeklyBias
      : dailyBias !== 'NEUTRAL' ? dailyBias
      : 'NEUTRAL'

  const biasStrong = weeklyBias !== 'NEUTRAL' && weeklyBias === dailyBias
  const composite = biasStrong ? (dir === 'BULL' ? 82 : 18) : dir !== 'NEUTRAL' ? (dir === 'BULL' ? 65 : 35) : 50

  // Secondary indicators — used for preds matrix only, NOT for dir
  const closes = bars.map(b => b.close)
  const e9 = bEMA(closes, 9), e21 = bEMA(closes, 21)
  const vd = bVWAP(bars)
  const orb = bORB(bars)
  const vp = bVolProfile(bars)

  const lv: RawL[] = []
  const add = (price: number, system: string, d: 'UP'|'DOWN'|'BOTH') => { if (isFinite(price) && price > 0) lv.push({ price, system, dir: d }) }

  // VWAP SD1/SD2 — algo anchors, ICT watches these for reversals
  add(vd.u1,'VWAP','UP'); add(vd.d1,'VWAP','DOWN'); add(vd.u2,'VWAP','UP'); add(vd.d2,'VWAP','DOWN')
  // Volume profile POC/VA — institutional volume concentration
  add(vp.poc,'VOL','BOTH'); add(vp.vah,'VOL','UP'); add(vp.val,'VOL','DOWN')
  // ICT structural liquidity — the only real price magnets
  if (ict.pdh) { add(ict.pdh, 'PDH', 'UP');  add(ict.pdl, 'PDL', 'DOWN') }
  if (ict.ah)  { add(ict.ah,  'AH',  'UP');  add(ict.al,  'AL',  'DOWN') }
  if (ict.lh)  { add(ict.lh,  'LH',  'UP');  add(ict.ll,  'LL',  'DOWN') }
  if (ict.mno) { add(ict.mno, 'MNO', 'BOTH') }
  if (ict.pwh) { add(ict.pwh, 'PWH', 'UP');  add(ict.pwl, 'PWL', 'DOWN') }
  ict.eqh.forEach(p => add(p, 'EQH', 'UP'))
  ict.eql.forEach(p => add(p, 'EQL', 'DOWN'))

  const targets = rankTargets(lv, dir, cur, atrVal)
  const stop = dir === 'BULL' ? cur - atrVal*1.5 : cur + atrVal*1.5
  const t1 = targets[0]?.price ?? cur
  const rr = parseFloat((Math.abs(t1-cur) / (atrVal*1.5)).toFixed(1))

  const preds = [
    { id:'WEEK', dir: weeklyBias },
    { id:'DAILY', dir: dailyBias },
    { id:'VWAP', dir: cur > vd.vw ? 'BULL' : 'BEAR' as 'BULL'|'BEAR' },
    { id:'VOL',  dir: cur > vp.poc ? 'BULL' : 'BEAR' as 'BULL'|'BEAR' },
    { id:'EMA',  dir: e9 > e21 ? 'BULL' : 'BEAR' as 'BULL'|'BEAR' },
    { id:'ORB',  dir: orb?.dir ?? 'NEUTRAL' },
  ] as { id: string; dir: 'BULL'|'BEAR'|'NEUTRAL' }[]

  return { dir, composite, targets, stop, entry: cur, rr, atrVal, preds, ict, weeklyBias, dailyBias, biasStrong }
}

// ── OBI Direction Arrow — chart overlay ───────────────────────────────────────

const ARROW_UP_PATH   = 'M24 2 L44 30 L32 30 L32 52 L16 52 L16 30 L4 30 Z'
const ARROW_DOWN_PATH = 'M24 54 L44 26 L32 26 L32 4 L16 4 L16 26 L4 26 Z'

function ObiDirectionArrow({ obi, rightOffset = 20 }: { obi: NonNullable<ReturnType<typeof computeOBI>>; rightOffset?: number }) {
  if (obi.dir === 'NEUTRAL' || obi.targets.length === 0) return null
  const isUp  = obi.dir === 'BULL'
  const t1    = obi.targets[0]!
  const color = isUp ? '#4ade80' : '#f43f5e'
  const isFire = t1.heat === 'FIRE'
  const animDur = isFire ? '1.1s' : '2.8s'
  const glowPeak = isFire ? '28px' : '14px'
  const fmt = (p: number) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 1 }) : p < 10 ? p.toFixed(5) : p.toFixed(2)

  return (
    <div style={{
      position: 'absolute', bottom: 78, right: rightOffset, zIndex: 12,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      pointerEvents: 'none', userSelect: 'none',
    }}>
      <style>{`
        @keyframes obiArrowGlow {
          0%,100%{filter:drop-shadow(0 0 6px ${color})  opacity:0.72}
          50%    {filter:drop-shadow(0 0 ${glowPeak} ${color}) opacity:1}
        }
        .obi-arr{animation:obiArrowGlow ${animDur} ease-in-out infinite}
      `}</style>
      <svg width="48" height="56" viewBox="0 0 48 56" className="obi-arr" aria-hidden>
        <path d={isUp ? ARROW_UP_PATH : ARROW_DOWN_PATH} fill={color} opacity="0.88" />
        {isFire && <path d={isUp ? ARROW_UP_PATH : ARROW_DOWN_PATH} fill={color} opacity="0.22" transform="scale(1.18)" style={{ transformOrigin: '24px 28px' }} />}
      </svg>
      <div style={{ fontSize: 10, fontWeight: 900, color, fontFamily: 'monospace', textShadow: `0 0 10px ${color}`, letterSpacing: 1, marginTop: 1 }}>
        {fmt(t1.price)}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <span style={{ fontSize: 7, fontFamily: 'monospace', color: isFire ? '#ff6b00' : color, opacity: 0.9, letterSpacing: 1 }}>{t1.heat}</span>
        {obi.biasStrong && <span style={{ fontSize: 7, fontFamily: 'monospace', color, opacity: 0.75, letterSpacing: 1 }}>STRONG</span>}
      </div>
    </div>
  )
}
// placeholder — actual right offset passed as prop
const _obiArrowRight = 20

// ── OBI Target Panel ──────────────────────────────────────────────────────────

interface PDZoneDS { mid: number; cur_zone: string; pct_of_range: number }

function ObiPanel({ obi, gate, walls, pdZone }: {
  obi:    NonNullable<ReturnType<typeof computeOBI>>
  gate:   ObiJediSignal
  walls:  LiqWall[]
  pdZone: PDZoneDS | null
}) {

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
          <span style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace' }}>ICT-BIAS</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: dc, fontFamily: 'monospace', textShadow: `0 0 8px ${dc}` }}>{obi.dir}</span>
          {obi.biasStrong && <span style={{ fontSize: 7, color: dc, fontFamily: 'monospace', opacity: 0.8 }}>STRONG</span>}
          <span style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace', marginLeft: 'auto' }}>R:R 1:{obi.rr}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
          {(['WEEK','DAILY'] as const).map(k => {
            const bdir = k === 'WEEK' ? obi.weeklyBias : obi.dailyBias
            const bc = DIR_C[bdir] ?? '#60a5fa'
            return <span key={k} style={{ fontSize: 7, fontFamily: 'monospace', color: bc, opacity: 0.85 }}>{k}:{bdir[0]}</span>
          })}
          <span style={{ fontSize: 9, color: '#f43f5e', fontFamily: 'monospace', marginLeft: 'auto' }}>⊗ {fmt(obi.stop)}</span>
        </div>
      </div>

      {/* WHACKER — hard gate block */}
      <div style={{ borderBottom: '1px solid rgba(255,107,0,0.15)', flexShrink: 0 }}>

        {/* Header row */}
        <div style={{ padding: '4px 10px 3px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 7, color: '#475569', fontFamily: 'monospace', letterSpacing: 2 }}>WHACKER</span>
          <span style={{
            fontSize: gate.whackReady ? 10 : 8, fontWeight: 800, fontFamily: 'monospace',
            color: gate.whackReady ? '#ff6b00' : gate.fireScore >= 4 ? '#fbbf24' : '#334155',
            textShadow: gate.whackReady ? '0 0 12px #ff6b00aa' : 'none',
          }}>
            {gate.whackReady ? '⚡ WHACK' : `${gate.fireScore}/5`}
          </span>
        </div>

        {/* KZ hard gate — always prominent */}
        <div style={{
          margin: '0 10px 4px',
          padding: '3px 6px', borderRadius: 3,
          background: gate.killzoneNow ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.02)',
          border: `1px solid ${gate.killzoneNow ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.05)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 7, fontFamily: 'monospace', color: gate.killzoneNow ? '#fbbf24' : '#334155' }}>
            ⏱ KZ GATE
          </span>
          <span style={{ fontSize: 7, fontFamily: 'monospace', color: gate.killzoneNow ? '#fbbf24' : '#334155', fontWeight: 700 }}>
            {gate.killzone}{gate.killzoneNow ? ' ✓' : ' —'}
          </span>
        </div>

        {/* Conditions list (4 non-gate) */}
        <div style={{ padding: '0 10px 4px' }}>
          {gate.conditions.filter(c => c.id !== 'KZ').map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <span style={{ fontSize: 8, color: c.pass ? '#4ade80' : '#334155', flexShrink: 0, width: 10 }}>{c.pass ? '✓' : '○'}</span>
              <span style={{ fontSize: 6, fontFamily: 'monospace', color: c.pass ? '#64748b' : '#1e293b', flex: 1 }}>{c.label}</span>
              <span style={{ fontSize: 6, fontFamily: 'monospace', color: c.pass ? '#475569' : '#1e293b', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}
                title={c.note}>{c.note}</span>
            </div>
          ))}
        </div>

        {/* SIZE MULTIPLIER */}
        <div style={{
          margin: '0 10px 4px',
          padding: '3px 8px', borderRadius: 3,
          background: gate.sizeMultiplier > 1 ? 'rgba(0,212,176,0.08)' : gate.sizeMultiplier < 1 ? 'rgba(244,63,94,0.08)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${gate.sizeMultiplier > 1 ? 'rgba(0,212,176,0.3)' : gate.sizeMultiplier < 1 ? 'rgba(244,63,94,0.25)' : 'rgba(255,255,255,0.05)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#475569' }}>KELLY SIZE</span>
          <span style={{
            fontSize: 9, fontWeight: 800, fontFamily: 'monospace',
            color: gate.sizeMultiplier > 1 ? '#00d4b0' : gate.sizeMultiplier < 1 ? '#f43f5e' : '#64748b',
          }}>
            {gate.sizeMultiplier.toFixed(1)}×
          </span>
        </div>
        <div style={{ padding: '0 10px 2px', fontSize: 6, fontFamily: 'monospace', color: '#334155' }}>
          {gate.multReason}
        </div>

        {/* TP TARGET */}
        {gate.t1Price && (
          <div style={{
            margin: '2px 10px 6px',
            padding: '4px 8px', borderRadius: 3,
            background: 'rgba(255,107,0,0.07)',
            border: '1px solid rgba(255,107,0,0.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#ff8c42' }}>TP TARGET · {gate.tpLabel}</span>
              <span style={{ fontSize: 10, fontWeight: 800, fontFamily: 'monospace', color: '#ff6b00' }}>
                {fmt(gate.t1Price)}
              </span>
            </div>
          </div>
        )}
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

      {/* Premium / Discount zone indicator */}
      {pdZone && (
        <div style={{
          margin: '0 10px 6px', padding: '4px 8px', borderRadius: 3,
          background: pdZone.cur_zone === 'PREMIUM'  ? 'rgba(244,63,94,0.08)'   :
                      pdZone.cur_zone === 'DISCOUNT' ? 'rgba(74,222,128,0.08)'  :
                                                       'rgba(251,191,36,0.08)',
          border: `1px solid ${
            pdZone.cur_zone === 'PREMIUM'  ? 'rgba(244,63,94,0.3)'  :
            pdZone.cur_zone === 'DISCOUNT' ? 'rgba(74,222,128,0.3)' :
                                             'rgba(251,191,36,0.3)'
          }`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#475569' }}>P/D ZONE</span>
            <span style={{
              fontSize: 8, fontWeight: 700, fontFamily: 'monospace',
              color: pdZone.cur_zone === 'PREMIUM'  ? '#f43f5e' :
                     pdZone.cur_zone === 'DISCOUNT' ? '#4ade80' : '#fbbf24',
            }}>{pdZone.cur_zone}</span>
          </div>
          {/* Range bar */}
          <div style={{ marginTop: 3, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 1, position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 0, height: '100%', width: '50%',
              background: 'rgba(74,222,128,0.3)', borderRadius: '1px 0 0 1px',
            }} />
            <div style={{
              position: 'absolute', right: 0, left: '50%', height: '100%',
              background: 'rgba(244,63,94,0.3)', borderRadius: '0 1px 1px 0',
            }} />
            <div style={{
              position: 'absolute', top: -1, bottom: -1, width: 2, borderRadius: 1,
              background: '#fbbf24',
              left: `${Math.min(97, Math.max(2, pdZone.pct_of_range * 100))}%`,
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: 6, fontFamily: 'monospace', color: '#334155' }}>
            <span>DISC ↓</span>
            <span>MID {fmt(pdZone.mid)}</span>
            <span>↑ PREM</span>
          </div>
          {pdZone.cur_zone === 'PREMIUM' && obi.dir === 'BULL' && (
            <div style={{ marginTop: 3, fontSize: 6, fontFamily: 'monospace', color: '#f43f5e' }}>
              ⚠ CHASING — BULL in premium zone
            </div>
          )}
          {pdZone.cur_zone === 'DISCOUNT' && obi.dir === 'BEAR' && (
            <div style={{ marginTop: 3, fontSize: 6, fontFamily: 'monospace', color: '#f43f5e' }}>
              ⚠ CHASING — BEAR in discount zone
            </div>
          )}
        </div>
      )}

      {/* Liquidity Walls — nearest HVN above and below */}
      {walls.length > 0 && (() => {
        const cur = obi.entry
        const above = walls.filter(w => w.type === 'WALL' && w.side === 'ABOVE').sort((a, b) => a.price - b.price).slice(0, 3)
        const below = walls.filter(w => w.type === 'WALL' && w.side === 'BELOW').sort((a, b) => b.price - a.price).slice(0, 3)
        if (!above.length && !below.length) return null
        return (
          <div style={{ borderTop: '1px solid rgba(74,222,128,0.12)', flexShrink: 0, padding: '4px 0 0' }}>
            <div style={{ padding: '2px 10px 3px', fontSize: 7, color: '#4ade80', fontFamily: 'monospace', letterSpacing: 2, opacity: 0.7 }}>LIQ WALLS</div>
            {above.map((w, i) => (
              <div key={`wa${i}`} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 10px' }}>
                <span style={{ fontSize: 7, color: '#4ade80', fontFamily: 'monospace', minWidth: 28 }}>B{i + 1}↑</span>
                <div style={{ flex: 1, height: Math.min(2, w.relVol * 0.5), background: '#4ade80', opacity: Math.min(0.9, 0.3 + w.relVol * 0.12), borderRadius: 1 }} />
                <span style={{ fontSize: 7, color: '#4ade80', fontFamily: 'monospace', opacity: 0.85 }}>{fmt(w.price)}</span>
                <span style={{ fontSize: 6, color: '#4ade80', fontFamily: 'monospace', opacity: 0.5 }}>{w.relVol.toFixed(1)}×</span>
              </div>
            ))}
            <div style={{ height: 2 }} />
            {below.map((w, i) => (
              <div key={`wb${i}`} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 10px' }}>
                <span style={{ fontSize: 7, color: '#f43f5e', fontFamily: 'monospace', minWidth: 28 }}>S{i + 1}↓</span>
                <div style={{ flex: 1, height: Math.min(2, w.relVol * 0.5), background: '#f43f5e', opacity: Math.min(0.9, 0.3 + w.relVol * 0.12), borderRadius: 1 }} />
                <span style={{ fontSize: 7, color: '#f43f5e', fontFamily: 'monospace', opacity: 0.85 }}>{fmt(w.price)}</span>
                <span style={{ fontSize: 6, color: '#f43f5e', fontFamily: 'monospace', opacity: 0.5 }}>{w.relVol.toFixed(1)}×</span>
              </div>
            ))}
          </div>
        )
      })()}

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
const TRADELAB_LAYOUT_PANEL_KEY = 'm5d.tradeLab.layoutPanelOpen' as const
const TRADELAB_MAIN_HEIGHT_KEY = 'm5d.tradeLab.mainHeightVh' as const
const TRADELAB_STACK_HEIGHT_KEY = 'm5d.tradeLab.stackHeightPct' as const
const TRADELAB_SIM_SPEED_KEY = 'm5d.tradeLab.simSpeed' as const
const TRADELAB_SIM_CANDLE_WINDOW_KEY = 'm5d.tradeLab.simCandleWindow' as const
const TRADELAB_LIVE_TRADE_KEY = 'm5d.tradeLab.liveTradeArmed' as const
const TRADELAB_MODE_KEY = 'm5d.tradeLab.mode' as const
const TRADELAB_KZ_ONLY_KEY = 'm5d.tradeLab.killzoneOnly' as const
const TRADELAB_PRO_KEY = 'm5d.tradeLab.proStrongBias' as const
const TRADELAB_EDGE70_KEY = 'm5d.tradeLab.requireGoldEdge70' as const
/** Paper only: starting wallet for $ PnL display in sim (not real). */
const SIM_PAPER_NOTIONAL_USD = 10_000

type TradeMode = 'COUNCIL' | 'ICT' | 'BOTH' | 'JEDI' | 'JEDI_MASTER' | 'BOOM' | 'ALL'
const SIM_TUNE_MODES: Exclude<TradeMode, 'ALL'>[] = ['COUNCIL', 'ICT', 'BOTH', 'JEDI', 'JEDI_MASTER', 'BOOM']
const SIM_MIN_HOLD_BARS = 1
const SIM_IN_PLAY_BARS = 3       // bars before normal stop checks begin
const SIM_IN_PLAY_MIN_ATR = 0.20 // min ATR fraction of directional progress to confirm "in play"
type IctSymbolPreset = {
  entry: { use_t1: boolean; use_killzone: boolean }
  retest: { mode: 'loose' | 'strict' }
  exit: { max_hold_bars: number; stop_atr: number; take_profit_atr: number }
}
const ICT_SYMBOL_PRESETS: Record<'ES' | 'NQ' | 'BTC', IctSymbolPreset> = {
  ES: {
    entry: { use_t1: false, use_killzone: false },
    retest: { mode: 'loose' },
    exit: { max_hold_bars: 6, stop_atr: 1.5, take_profit_atr: 2.0 },
  },
  NQ: {
    entry: { use_t1: true, use_killzone: false },
    retest: { mode: 'loose' },
    exit: { max_hold_bars: 6, stop_atr: 1.0, take_profit_atr: 1.0 },
  },
  BTC: {
    entry: { use_t1: false, use_killzone: false },
    retest: { mode: 'strict' },
    exit: { max_hold_bars: 8, stop_atr: 2.0, take_profit_atr: 1.5 },
  },
}
function presetKeyForSymbol(raw: string): 'ES' | 'NQ' | 'BTC' {
  const s = raw.toUpperCase().split(/[\/\-]/)[0] ?? 'BTC'
  if (s === 'ES') return 'ES'
  if (s === 'NQ') return 'NQ'
  return 'BTC'
}
const SOLO_PARTICIPATION_FLOOR_PCT = 15

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function loadTradeLabInt(key: string, fallback: number, lo: number, hi: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n)) return fallback
    return clamp(n, lo, hi)
  } catch {
    return fallback
  }
}

/** Gold-tier session envelope by UTC clock (ICTSMC doc — institutional windows). */
function goldSessionUtc(utcSec: number): { id: string; label: string; quality: 'A' | 'B' | 'C' | 'D'; mult: number } {
  const h = new Date(utcSec * 1000).getUTCHours()
  if (h >= 2 && h < 5) return { id: 'LONDON', label: 'London KZ', quality: 'A', mult: 1.08 }
  if (h >= 12 && h < 15) return { id: 'NY_AM', label: 'NY AM KZ', quality: 'A', mult: 1.06 }
  if (h >= 17 && h < 20) return { id: 'NY_PM', label: 'NY PM', quality: 'B', mult: 0.85 }
  if (h >= 22 || h < 2) return { id: 'ASIA', label: 'Asia', quality: 'D', mult: 0.65 }
  return { id: 'OFF', label: 'Off-session', quality: 'C', mult: 0.92 }
}

/** LQ: only A/B session windows (London / NY AM / NY PM per gold doc). */
function goldLqSessionOk(utcSec: number): boolean {
  const q = goldSessionUtc(utcSec).quality
  return q === 'A' || q === 'B'
}

/** Precompute RVOL + ATR(14) — must match `pwa/src/lib/boomChartBuild.ts` SIG block. */
function precomputeSigBoomVolumeAtr(bars: Bar[]) {
  const n = bars.length
  const avgVol20 = new Array<number>(n).fill(0)
  const avgVol50 = new Array<number>(n).fill(0)
  let rollingVol = 0
  let rollingVol50 = 0
  for (let i = 0; i < n; i++) {
    rollingVol += bars[i]!.volume ?? 0
    if (i >= 20) rollingVol -= bars[i - 20]!.volume ?? 0
    avgVol20[i] = i >= 19 ? rollingVol / 20 : 0
    rollingVol50 += bars[i]!.volume ?? 0
    if (i >= 50) rollingVol50 -= bars[i - 50]!.volume ?? 0
    avgVol50[i] = i >= 49 ? rollingVol50 / 50 : 0
  }
  const atrPeriod = 14
  const atr = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) {
    const b = bars[i]!
    const bp = bars[i - 1]!
    const tr = Math.max(b.high - b.low, Math.abs(b.high - bp.close), Math.abs(b.low - bp.close))
    atr[i] = i < atrPeriod ? tr : atr[i - 1]! + (tr - atr[i - 1]!) / atrPeriod
  }
  return { avgVol20, avgVol50, atr }
}

/**
 * One-bar evaluation — same rules as chart SIG layer when `showCouncilArrows` is on
 * (squeeze/box/RVOL/ATR) — your cyan/red BOOM chart arrows, not the API council matrix.
 */
function evalSigBoomAtIndex(
  bars: Bar[],
  boom: Boom3dBarOut[],
  i: number,
  c: ChartControls,
  pre: ReturnType<typeof precomputeSigBoomVolumeAtr>,
): { dir: 'LONG' | 'SHORT' | 'FLAT'; allowed: boolean; reason: string } {
  if (bars.length < 20) return { dir: 'FLAT', allowed: false, reason: 'need ≥20 bars' }
  if (i < 1 || i >= bars.length) return { dir: 'FLAT', allowed: false, reason: 'index' }
  if (boom.length !== bars.length) return { dir: 'FLAT', allowed: false, reason: 'boom' }
  if (c.showCouncilArrows === false) return { dir: 'FLAT', allowed: false, reason: 'enable SIG strip' }

  const mode = c.sigMode ?? 'balanced'
  const safetyDefenseOn = c.safetyDefenseOn === true
  const strict = mode === 'strict' || safetyDefenseOn
  const rvolMin = strict ? Math.max(c.sigRvolMin ?? 1.65, 1.35) : (c.sigRvolMin ?? 1.65)
  const atrExpandMin = strict ? Math.max(c.sigAtrExpandMin ?? 1.2, 1.03) : (c.sigAtrExpandMin ?? 1.2)
  const breakAtrFrac = strict ? Math.max(c.sigBreakAtrFrac ?? 0.03, 0.06) : (c.sigBreakAtrFrac ?? 0.03)

  const bo = boom[i]!
  const bar = bars[i]!
  const releaseNow = bo.squeezeRelease
  const releasePrev = i > 1 ? (boom[i - 1]!.squeezeRelease ?? false) : false
  const squeezeContext = bo.squeezeOn || bo.squeezeActive || releaseNow || releasePrev
  if (!squeezeContext) return { dir: 'FLAT', allowed: false, reason: 'no squeeze context' }
  const bull = bo.emaFast > bo.emaSlow
  const boxBreakBull = bar.close > bo.boxHighPlot
  const boxBreakBear = bar.close < bo.boxLowPlot
  const boxBreak = bull ? boxBreakBull : boxBreakBear
  if (!boxBreak) return { dir: 'FLAT', allowed: false, reason: 'no box break' }

  const { avgVol20, avgVol50, atr } = pre
  const volNow = bar.volume ?? 0
  const volAvg = avgVol20[i] ?? 0
  const rvol = volAvg > 0 ? volNow / volAvg : 0
  const rvolOk = rvol >= rvolMin
  const atrNow = atr[i] ?? 0
  const atrPrev = atr[i - 1] ?? 0
  const atrOk = atrNow > 0 && atrPrev > 0 && atrNow >= atrPrev * atrExpandMin
  const breakoutDist = bull ? bar.close - bo.boxHighPlot : bo.boxLowPlot - bar.close
  const breakoutOk = atrNow > 0 && breakoutDist >= atrNow * breakAtrFrac
  const volBase50 = avgVol50[i] ?? 0
  const hasLiquidity = volBase50 > 0 && volNow >= volBase50 * (strict ? 0.62 : 0.35)
  const atrToPrice = bar.close > 0 ? atrNow / bar.close : 0
  const atrRegimeOk = atrToPrice >= (strict ? 0.00045 : 0.0002)
  const body = Math.abs(bar.close - bar.open)
  const bodyOk = atrNow > 0 && body >= atrNow * (strict ? 0.34 : 0.16)
  const momentumOk = strict ? rvolOk && atrOk : rvolOk || atrOk || releaseNow

  if (breakoutOk && momentumOk && hasLiquidity && atrRegimeOk && bodyOk) {
    return { dir: bull ? 'LONG' : 'SHORT', allowed: true, reason: 'sig boom' }
  }
  return { dir: 'FLAT', allowed: false, reason: 'sig filters not met' }
}

type SoloDockSide = 'left' | 'right'
type SoloDockTier = 0 | 1 | 2
type SoloDockState = { side: SoloDockSide; tier: SoloDockTier; visible: boolean }
type PaperTrade = {
  side: 'LONG' | 'SHORT'
  entryTime: number
  exitTime: number
  entry: number
  exit: number
  ret: number
}
type AlgoFireEvent = {
  time: number
  price: number
  dir: 'LONG' | 'SHORT'
  kind: 'entry' | 'exit'
  mode: TradeMode
}

/** Closed legs from ICTSMC/Gold-style algo replay on sim index path (signal exits only). */
type SimExitReason = 'STOP' | 'TP' | 'TRAIL' | 'TIMEOUT' | 'NOT_IN_PLAY' | 'GAP_STOP' | 'CLIMAX'

type SimAlgoClosedTrade = {
  id: number
  side: 'LONG' | 'SHORT'
  entryIdx: number
  exitIdx: number
  entryTime: number
  exitTime: number
  entryPx: number
  exitPx: number
  pnlPct: number
  edgeEntry: number | null
  sessionUtcLabel: string
  mode: TradeMode
  holdBars: number
  exitReason: SimExitReason
}

type SimAlgoOpenLeg = {
  side: 'LONG' | 'SHORT'
  entryIdx: number
  entryTime: number
  entryPx: number
  edgeEntry: number | null
  stopPx: number
  tp1Px: number
  tp2Px: number
  tp1Hit: boolean
  trailPx: number
  peakPx: number
  atrEntry: number
}
type LtVizState = {
  glowGain: number;
  lt2PriceBins: number;
  lt2TimeBins: number;
  lt2OpacityGain: number;
  lt3MiniArrowGain: number;
  lt3MainArrowGain: number;
  bubbles: boolean;
}
const LT_VIZ_DEFAULTS: LtVizState = {
  glowGain: 1.2,
  lt2PriceBins: 31,
  lt2TimeBins: 12,
  lt2OpacityGain: 1.0,
  lt3MiniArrowGain: 1.0,
  lt3MainArrowGain: 1.2,
  bubbles: false,
}

function loadSoloDock(): SoloDockState {
  try { const j = JSON.parse(localStorage.getItem(SOLO_DOCK_KEY) ?? '{}') as Partial<SoloDockState>; return { side: j.side === 'left' ? 'left' : 'right', tier: j.tier === 0 || j.tier === 1 || j.tier === 2 ? j.tier : 1, visible: j.visible !== false } } catch { return { side: 'right', tier: 1, visible: true } }
}
function saveSoloDock(s: SoloDockState) { try { localStorage.setItem(SOLO_DOCK_KEY, JSON.stringify(s)) } catch {} }
const LT_VIZ_KEY = 'm5d.obi.ltViz'
function loadLtViz(): LtVizState {
  try {
    const raw = localStorage.getItem(LT_VIZ_KEY)
    if (!raw) return LT_VIZ_DEFAULTS
    const j = JSON.parse(raw) as Partial<LtVizState>
    return {
      glowGain: typeof j.glowGain === 'number' ? Math.max(0.2, Math.min(2.5, j.glowGain)) : LT_VIZ_DEFAULTS.glowGain,
      lt2PriceBins: typeof j.lt2PriceBins === 'number' ? Math.max(12, Math.min(72, Math.round(j.lt2PriceBins))) : LT_VIZ_DEFAULTS.lt2PriceBins,
      lt2TimeBins: typeof j.lt2TimeBins === 'number' ? Math.max(4, Math.min(32, Math.round(j.lt2TimeBins))) : LT_VIZ_DEFAULTS.lt2TimeBins,
      lt2OpacityGain: typeof j.lt2OpacityGain === 'number' ? Math.max(0.35, Math.min(2.5, j.lt2OpacityGain)) : LT_VIZ_DEFAULTS.lt2OpacityGain,
      lt3MiniArrowGain: typeof j.lt3MiniArrowGain === 'number' ? Math.max(0.5, Math.min(2.5, j.lt3MiniArrowGain)) : LT_VIZ_DEFAULTS.lt3MiniArrowGain,
      lt3MainArrowGain: typeof j.lt3MainArrowGain === 'number' ? Math.max(0.5, Math.min(3.0, j.lt3MainArrowGain)) : LT_VIZ_DEFAULTS.lt3MainArrowGain,
      bubbles: j.bubbles === true,
    }
  } catch {
    return LT_VIZ_DEFAULTS
  }
}

function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return []
  const out = new Array<number>(values.length)
  const k = 2 / (period + 1)
  out[0] = values[0]!
  for (let i = 1; i < values.length; i++) out[i] = values[i]! * k + out[i - 1]! * (1 - k)
  return out
}

/** Mirrors TradeLab trade sentiment slice used for XAI gate. */
function sentimentFromBars(detBars: Bar[]): number {
  if (detBars.length < 20) return 0
  const sl = detBars.slice(-50)
  const hi = Math.max(...sl.map((b) => b.high))
  const lo = Math.min(...sl.map((b) => b.low))
  const rng = hi - lo
  if (!rng) return 0
  const wr = (hi - detBars[detBars.length - 1]!.close) / rng
  return (0.5 - wr) * 1.4
}

function emaTrendSignal(detBars: Bar[]): 'LONG' | 'SHORT' | 'FLAT' {
  if (detBars.length < 30) return 'FLAT'
  const closes = detBars.map((b) => b.close)
  const f = emaSeries(closes, 9)
  const s = emaSeries(closes, 21)
  const a = f[f.length - 1] ?? 0
  const b = s[s.length - 1] ?? 0
  if (!isFinite(a) || !isFinite(b)) return 'FLAT'
  return a >= b ? 'LONG' : 'SHORT'
}

interface SimAlgoDecisionCtx {
  tradeMode: TradeMode
  councilScore: number
  jediScore: number
  killzoneOnly: boolean
  proStrongBias: boolean
  useT1?: boolean
  retestMode?: 'loose' | 'strict'
  exitMaxHoldBars?: number
  /** JEDI_MASTER: computeObiJediGate(...).whackReady — KZ + OB/FVG/ORB + momentum */
  jediWhackReady?: boolean
  /** JEDI_MASTER: T1 (DOL) tags PDH/PDL/… institutional level */
  ictT1IsLevel?: boolean
  /** JEDI_MASTER: bar in A/B quality session (goldLqSessionOk) */
  goldLqSession?: boolean
}

/**
 * When the user turns on "killzone only" in the layout panel, that gate applies
 * to **ICT** sim mode only. Other trade modes (COUNCIL, JEDI, BOOM, …) ignore it
 * so multi-algo / BOOM / council sim is not KZ-cuffed.
 */
function ictModeKillzoneSatisfied(
  mode: TradeMode,
  killzoneOnly: boolean,
  killzoneOk: boolean,
): boolean {
  if (!killzoneOnly) return true
  if (mode === 'ICT') return killzoneOk
  return true
}

/** Pure TradeLab trade gate — must stay aligned with page `tradeDecision` memo. */
function computeSimAlgoDecisionRaw(
  ctx: SimAlgoDecisionCtx,
  tradeObiResult: NonNullable<ReturnType<typeof computeOBI>> | null,
  tradeIctBrain: ICTBrain | null,
  tradeXaiSentiment: number,
  tradeEmaSignal: 'LONG' | 'SHORT' | 'FLAT',
): { dir: 'LONG' | 'SHORT' | 'FLAT'; allowed: boolean; reason: string } {
  if (ctx.tradeMode === 'ALL') {
    const order: TradeMode[] = ['JEDI_MASTER', 'JEDI', 'BOTH', 'ICT', 'COUNCIL']
    for (const mode of order) {
      const r = computeSimAlgoDecisionRaw(
        { ...ctx, tradeMode: mode },
        tradeObiResult,
        tradeIctBrain,
        tradeXaiSentiment,
        tradeEmaSignal,
      )
      if (r.allowed && r.dir !== 'FLAT') return { ...r, reason: `all/${mode.toLowerCase()}: ${r.reason}` }
    }
    return { dir: 'FLAT', allowed: false, reason: 'all modes blocked' }
  }
  const councilBias: 'LONG' | 'SHORT' | 'FLAT' =
    ctx.councilScore >= 45 ? (ctx.jediScore >= 0 ? 'LONG' : 'SHORT') : 'FLAT'
  const ictBias: 'LONG' | 'SHORT' | 'FLAT' = tradeEmaSignal
  const mtfOk = !!tradeObiResult && Math.abs(tradeObiResult.composite - 50) >= 5
  const xaiOk = Math.abs(tradeXaiSentiment) >= 0.08
  const strictRetest = ctx.retestMode === 'strict'
  const ictStructOk =
    !!tradeIctBrain &&
    (strictRetest
      ? tradeIctBrain.entryZone?.type === 'OB'
      : (!!tradeIctBrain.entryZone || tradeIctBrain.orbBreakout || tradeIctBrain.rapidExpansion))
  const t1Ok = !ctx.useT1 || !!tradeIctBrain?.t1IsICTLevel
  const killzoneOk = !!tradeIctBrain?.killzoneNow
  const align = councilBias !== 'FLAT' && councilBias === ictBias
  const proOk = !ctx.proStrongBias || !!tradeObiResult?.biasStrong
  const proBlock = ctx.proStrongBias && !tradeObiResult?.biasStrong
  const jediKz = ictModeKillzoneSatisfied(ctx.tradeMode, ctx.killzoneOnly, killzoneOk)
  const jediOk =
    align &&
    mtfOk &&
    xaiOk &&
    ictStructOk &&
    Math.abs(ctx.jediScore) >= 5 &&
    ctx.councilScore >= 50 &&
    jediKz &&
    proOk

  if (ctx.tradeMode === 'COUNCIL') {
    const allowed = councilBias !== 'FLAT' && ictModeKillzoneSatisfied('COUNCIL', ctx.killzoneOnly, killzoneOk) && proOk
    let reason = 'no-trade'
    if (allowed) reason = `council ${ctx.councilScore}`
    else if (councilBias === 'FLAT') reason = `council < 45`
    else if (proBlock) reason = 'PRO needs STRONG bias'
    return { dir: councilBias, allowed, reason }
  }
  if (ctx.tradeMode === 'ICT') {
    const kzIct = !ctx.killzoneOnly || killzoneOk
    const allowed = ictBias !== 'FLAT' && ictStructOk && kzIct && t1Ok && proOk
    let reason = 'ict structure weak'
    if (allowed) reason = 'ict structure ok'
    else if (proBlock) reason = 'PRO needs STRONG bias'
    else if (!t1Ok) reason = 'T1 level required'
    else if (ctx.killzoneOnly && !killzoneOk) reason = 'outside killzone (ICT only)'
    return { dir: ictBias, allowed, reason }
  }
  if (ctx.tradeMode === 'BOTH') {
    const allowed = align && ictStructOk && t1Ok && ictModeKillzoneSatisfied('BOTH', ctx.killzoneOnly, killzoneOk) && proOk
    let reason = 'bias not aligned'
    if (allowed) reason = 'aligned + ict ok'
    else if (proBlock) reason = 'PRO needs STRONG bias'
    else if (!t1Ok) reason = 'T1 level required'
    else if (!align) reason = 'bias not aligned'
    else reason = 'aligned but ict weak'
    return { dir: align ? councilBias : ('FLAT' as const), allowed, reason }
  }
  if (ctx.tradeMode === 'JEDI_MASTER') {
    const whack = ctx.jediWhackReady === true
    const t1Lq = ctx.ictT1IsLevel === true
    const sess = ctx.goldLqSession === true
    const masterOk =
      jediOk && whack && t1Lq && sess && t1Ok
    let reason = 'jedi+ictsmc master gates not met'
    if (masterOk) reason = 'jedi master · ictsmc whack + LQ T1 + A/B session'
    else if (proBlock) reason = 'PRO needs STRONG bias'
    else if (!t1Ok) reason = 'T1 level required'
    else if (!jediOk) reason = 'jedi base gates not met'
    else if (!whack) reason = 'need ict whack (KZ+OB/FVG/ORB+disp)'
    else if (!t1Lq) reason = 'T1 not on PDH/PDL/inst level'
    else if (!sess) reason = 'outside A/B session (LQ)'
    return {
      dir: masterOk ? councilBias : ('FLAT' as const),
      allowed: masterOk,
      reason,
    }
  }
  return {
    dir: jediOk ? councilBias : ('FLAT' as const),
    allowed: jediOk,
    reason: jediOk ? 'jedi stack aligned' : proBlock ? 'PRO needs STRONG bias' : 'jedi gates not met',
  }
}

function applyGoldEdgeFloor(
  desired: 'LONG' | 'SHORT' | 'FLAT',
  edgeEst: number | null,
  requireGoldEdge70: boolean,
): 'LONG' | 'SHORT' | 'FLAT' {
  if (!requireGoldEdge70 || edgeEst === null) return desired
  if (edgeEst < 70) return 'FLAT'
  return desired
}

function buildClaudeExitLeg(
  side: 'LONG' | 'SHORT',
  entryPx: number,
  atrEntry: number,
  maxHoldBars: number,
  stopAtr: number,
  takeProfitAtr: number,
): Pick<SimAlgoOpenLeg, 'stopPx' | 'tp1Px' | 'tp2Px' | 'tp1Hit' | 'trailPx' | 'peakPx' | 'atrEntry'> & { maxHoldBars: number } {
  const atr = Math.max(1e-9, atrEntry)
  const tp2Dist = takeProfitAtr * atr
  const tp1Dist = tp2Dist * 0.6
  const stopDist = stopAtr * atr
  if (side === 'LONG') {
    const stop = entryPx - stopDist
    return {
      stopPx: stop,
      tp1Px: entryPx + tp1Dist,
      tp2Px: entryPx + tp2Dist,
      tp1Hit: false,
      trailPx: stop,
      peakPx: entryPx,
      atrEntry: atr,
      maxHoldBars,
    }
  }
  const stop = entryPx + stopDist
  return {
    stopPx: stop,
    tp1Px: entryPx - tp1Dist,
    tp2Px: entryPx - tp2Dist,
    tp1Hit: false,
    trailPx: stop,
    peakPx: entryPx,
    atrEntry: atr,
    maxHoldBars,
  }
}

function evaluatePaperTrades(bars: Bar[]): PaperTrade[] {
  if (bars.length < 40) return []
  const closes = bars.map((b) => b.close)
  const eFast = emaSeries(closes, 9)
  const eSlow = emaSeries(closes, 21)
  const out: PaperTrade[] = []
  let side: 1 | -1 | 0 = 0
  let entry = 0
  let entryTime = 0
  for (let i = 22; i < bars.length; i++) {
    const sig: 1 | -1 = eFast[i]! >= eSlow[i]! ? 1 : -1
    const px = closes[i]!
    const t = bars[i]!.time
    if (side === 0) {
      side = sig
      entry = px
      entryTime = t
      continue
    }
    if (sig !== side) {
      const ret = ((px - entry) / Math.max(1e-9, entry)) * side
      out.push({ side: side > 0 ? 'LONG' : 'SHORT', entryTime, exitTime: t, entry, exit: px, ret })
      side = sig
      entry = px
      entryTime = t
    }
  }
  if (side !== 0) {
    const last = bars[bars.length - 1]!
    const ret = ((last.close - entry) / Math.max(1e-9, entry)) * side
    out.push({ side: side > 0 ? 'LONG' : 'SHORT', entryTime, exitTime: last.time, entry, exit: last.close, ret })
  }
  return out
}

type ObiChartLines = { show: boolean; density: ObiLineDensity; spread: ObiLineSpread }
function loadObiChartLines(): ObiChartLines {
  try {
    const raw = localStorage.getItem(OBI_CHART_LINES_KEY)
    if (!raw) return { show: true, density: 'multi', spread: 'normal' }
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
    return { show, density: 'multi', spread: j.spread === 'wide' ? 'wide' : 'normal' }
  } catch { return { show: true, density: 'multi', spread: 'normal' } }
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

export default function TradeLabPage() {
  const council = useCouncil()
  const jediScore = council?.jedi_score ?? 0
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
  const [obiVisible, setObiVisible] = useState(false)
  const [obiChartLines, setObiChartLines] = useState<ObiChartLines>(() => loadObiChartLines())
  const [showObiTargets, setShowObiTargets] = useState(true)  // ◎ ranked T1–T4 lines on chart
  const [obiBoomMinimal, setObiBoomMinimal] = useState<boolean>(() => loadObiBoomMinimal())
  const [soloDock, setSoloDock] = useState<SoloDockState>(() => loadSoloDock())
  const [ltViz, setLtViz] = useState<LtVizState>(() => loadLtViz())
  const [ltPanelOpen, setLtPanelOpen] = useState(false)
  const [mainChartHeightVh, setMainChartHeightVh] = useState<number>(() =>
    loadTradeLabInt(TRADELAB_MAIN_HEIGHT_KEY, 50, 25, 75),
  )
  const [stackHeightPct, setStackHeightPct] = useState<number>(() =>
    loadTradeLabInt(TRADELAB_STACK_HEIGHT_KEY, 100, 45, 100),
  )
  const [layoutPanelOpen, setLayoutPanelOpen] = useState<boolean>(() => localStorage.getItem(TRADELAB_LAYOUT_PANEL_KEY) !== '0')
  const [simSpeed, setSimSpeed] = useState<number>(10)
  const [simCandleWindow, setSimCandleWindow] = useState<number>(() => {
    const raw = Number.parseInt(localStorage.getItem(TRADELAB_SIM_CANDLE_WINDOW_KEY) ?? '220', 10)
    return Number.isFinite(raw) ? clamp(raw, 80, 700) : 220
  })
  const [allAlgosSimBusy, setAllAlgosSimBusy] = useState(false)
  const [allAlgosSimOn, setAllAlgosSimOn] = useState(false)
  const [liveTradeArmed, setLiveTradeArmed] = useState<boolean>(() => localStorage.getItem(TRADELAB_LIVE_TRADE_KEY) === '1')
  const [killzoneOnly, setKillzoneOnly] = useState<boolean>(() => localStorage.getItem(TRADELAB_KZ_ONLY_KEY) !== '0')
  /** PRO / Gold starter: when ON, sim fires require weekly+daily STRONG bias (same gate as OBI STRONG chip). */
  const [proStrongBias, setProStrongBias] = useState<boolean>(() => localStorage.getItem(TRADELAB_PRO_KEY) === '1')
  /** Gold doc: high-conviction entries when edge ≥ 70; when ON, flatten sim entries under the floor. */
  const [requireGoldEdge70, setRequireGoldEdge70] = useState<boolean>(() => localStorage.getItem(TRADELAB_EDGE70_KEY) === '1')
  const [tradeMode, setTradeMode] = useState<TradeMode>('ALL')
  const [simRunning, setSimRunning] = useState(true)
  const [simProgress, setSimProgress] = useState(220)
  const [simFireEvents, setSimFireEvents] = useState<AlgoFireEvent[]>([])
  const [ictPreset, setIctPreset] = useState<IctSymbolPreset>(() => ICT_SYMBOL_PRESETS.BTC)
  const setObiChartLinesPatch = useCallback((patch: Partial<ObiChartLines> | ((p: ObiChartLines) => ObiChartLines)) => {
    setObiChartLines(prev => {
      const n = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
      saveObiChartLines(n)
      return n
    })
  }, [])
  const setObiBoomMinimalPatch = useCallback((v: boolean) => { setObiBoomMinimal(v); saveObiBoomMinimal(v) }, [])
  // MIN is a one-shot preset — no interception of other controls
  const preSafetySigRef = useRef<{ sigMode: ChartControls['sigMode']; sigRvolMin: number; sigAtrExpandMin: number; sigBreakAtrFrac: number } | null>(null)
  const chartStackRef = useRef<HTMLDivElement | null>(null)
  const simFireEventBarTimeRef = useRef<number>(0)
  const simFireEventIdsOnBarRef = useRef<Set<string>>(new Set())
  const lastSignalRef = useRef<'LONG' | 'SHORT' | 'FLAT'>('FLAT')
  const lastEntryBarTimeRef = useRef<number>(0)
  const simPosRef = useRef<'LONG' | 'SHORT' | 'FLAT'>('FLAT')
  const simHeldBarsRef = useRef<number>(0)
  const [availableChartStackPx, setAvailableChartStackPx] = useState<number>(560)

  const TOP_STOCKS = ['ES','SPY','QQQ','EURUSD','XAUUSD','BTC','NVDA','AAPL','MSFT','TSLA','AMZN','META','GOOGL'] as const
  const obPressure = useObPressureStream(sym, vitePolygonKey)

  const runAllAlgosSimDs = useCallback(async () => {
    const base = (import.meta.env.VITE_DS_URL as string | undefined) || 'http://127.0.0.1:8000'
    const raw = String(sym).toUpperCase().split(/[\/\-]/)[0] ?? 'BTC'
    const knownCrypto = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'AVAX', 'DOT', 'LINK', 'MATIC', 'LTC'])
    const asset = knownCrypto.has(raw) ? raw : 'BTC'
    setAllAlgosSimBusy(true)
    try {
      const end = new Date()
      const start = new Date()
      start.setFullYear(end.getFullYear() - 3)
      const q = new URLSearchParams({
        asset,
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        interval: '1d',
        all_algos: '1',
        trades_list: 'off',
        min_trades: '2',
      })
      const r = await fetch(`${base}/v1/sim/universe/?${q.toString()}`)
      const j = (await r.json()) as { error?: string; algorithms_ranked?: { algo_id: string }[]; trades_total?: number }
      if (!r.ok) throw new Error(j.error || r.statusText)
      setAllAlgosSimOn(true)
      setErr('')
      console.info('[ALL 30 ALGOS] OK', {
        asset,
        trades_total: j.trades_total,
        top_algo: j.algorithms_ranked?.[0]?.algo_id ?? null,
      })
      console.log('[DS /v1/sim/universe?all_algos=1]', j)
    } catch (e) {
      setAllAlgosSimOn(false)
      setErr(`ALL 30 ALGOS: ${e instanceof Error ? e.message : String(e)} (is DS on :8000?)`)
    } finally {
      setAllAlgosSimBusy(false)
    }
  }, [sym])

  const toggleAllAlgosSim = useCallback(() => {
    if (allAlgosSimBusy) return
    if (allAlgosSimOn) {
      setAllAlgosSimOn(false)
      setErr('')
      return
    }
    void runAllAlgosSimDs()
  }, [allAlgosSimBusy, allAlgosSimOn, runAllAlgosSimDs])

  const persist = useCallback((next: ChartControls) => { setControls(next); saveControls(next) }, [])
  const setSoloDockPatch = useCallback((patch: Partial<SoloDockState> | ((p: SoloDockState) => Partial<SoloDockState>)) => {
    setSoloDock(prev => { const delta = typeof patch === 'function' ? patch(prev) : patch; const next = { ...prev, ...delta }; saveSoloDock(next); return next })
  }, [])
  useEffect(() => {
    // Trade Lab default: keep live trade arrows visible on both top/sim charts.
    persist({
      ...controls,
      showCouncilArrows: true,
      sigMode: 'balanced',
      showSqueeze: false,
      squeezePurpleBg: false,
      showBB: false,
      showKC: false,
      showSwingRays: false,
    })
    // Keep replay baseline at 10x unless user changes it.
    setSimSpeed(10)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    try { localStorage.setItem(LT_VIZ_KEY, JSON.stringify(ltViz)) } catch {}
  }, [ltViz])
  useEffect(() => {
    const key = presetKeyForSymbol(String(sym))
    const p = ICT_SYMBOL_PRESETS[key]
    setIctPreset(p)
    setKillzoneOnly(p.entry.use_killzone)
  }, [sym])
  useEffect(() => {
    try {
      localStorage.setItem(TRADELAB_SIM_SPEED_KEY, String(simSpeed))
      localStorage.setItem(TRADELAB_SIM_CANDLE_WINDOW_KEY, String(simCandleWindow))
      localStorage.setItem(TRADELAB_LAYOUT_PANEL_KEY, layoutPanelOpen ? '1' : '0')
      localStorage.setItem(TRADELAB_LIVE_TRADE_KEY, liveTradeArmed ? '1' : '0')
      localStorage.setItem(TRADELAB_MODE_KEY, tradeMode)
      localStorage.setItem(TRADELAB_KZ_ONLY_KEY, killzoneOnly ? '1' : '0')
      localStorage.setItem(TRADELAB_PRO_KEY, proStrongBias ? '1' : '0')
      localStorage.setItem(TRADELAB_EDGE70_KEY, requireGoldEdge70 ? '1' : '0')
      localStorage.setItem(TRADELAB_MAIN_HEIGHT_KEY, String(mainChartHeightVh))
      localStorage.setItem(TRADELAB_STACK_HEIGHT_KEY, String(stackHeightPct))
    } catch {
      // ignore localStorage failures
    }
  }, [simSpeed, simCandleWindow, layoutPanelOpen, liveTradeArmed, tradeMode, killzoneOnly, proStrongBias, requireGoldEdge70, mainChartHeightVh, stackHeightPct])
  useEffect(() => {
    if (!liveTradeArmed) return
    // Standardized live trade profile (red button arming).
    persist({
      ...controls,
      showCouncilArrows: true,
      sigMode: 'strict',
      sigRvolMin: Math.max(1.8, controls.sigRvolMin),
      sigAtrExpandMin: Math.max(1.25, controls.sigAtrExpandMin),
      sigBreakAtrFrac: Math.max(0.06, controls.sigBreakAtrFrac),
      showSqueeze: false,
      squeezePurpleBg: false,
      showBB: false,
      showKC: false,
      showSwingRays: false,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTradeArmed])

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
    const seeded = Math.min(Math.max(simCandleWindow, 80), Math.max(80, bars.length - 2))
    setSimProgress(seeded)
    setSimRunning(true)
    setSimFireEvents([])
    simFireEventBarTimeRef.current = 0
    simFireEventIdsOnBarRef.current = new Set()
    lastSignalRef.current = 'FLAT'
    lastEntryBarTimeRef.current = 0
    simPosRef.current = 'FLAT'
    simHeldBarsRef.current = 0
  }, [bars.length, sym, tf, simCandleWindow])
  useEffect(() => {
    if (!simRunning || bars.length < 5) return
    const id = window.setInterval(() => {
      setSimProgress((p) => {
        // True rolling replay: small bounded step so progress is readable.
        const step = Math.max(1, Math.min(4, Math.round(simSpeed / 250)))
        return Math.min(bars.length - 1, p + step)
      })
    }, 240)
    return () => window.clearInterval(id)
  }, [simRunning, simSpeed, bars.length])
  useEffect(() => {
    if (simProgress >= Math.max(0, bars.length - 1)) setSimRunning(false)
  }, [simProgress, bars.length])
  useEffect(() => {
    const calcAvailableChartSpace = () => {
      const host = chartStackRef.current
      if (!host) return
      const top = host.getBoundingClientRect().top
      const available = Math.floor(window.innerHeight - top - 12)
      setAvailableChartStackPx(clamp(available, 320, 1200))
    }
    calcAvailableChartSpace()
    window.addEventListener('resize', calcAvailableChartSpace)
    return () => window.removeEventListener('resize', calcAvailableChartSpace)
  }, [])
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
    controls.showLt2 &&
    controls.showLt3 &&
    controls.showVwap &&
    controls.showCouncilArrows &&
    controls.showIchimoku &&
    controls.showMas &&
    controls.showFvg &&
    controls.squeezePurpleBg &&
    controls.showOrderBlocks &&
    controls.showSessionLevels
  const safetySummary = `RV ${controls.sigRvolMin.toFixed(2)}x · ATR ${controls.sigAtrExpandMin.toFixed(2)}x · BRK ${(controls.sigBreakAtrFrac * 100).toFixed(0)}% · ${controls.sigMode === 'strict' ? 'STR' : 'BAL'}`

  // ICT master: masterOn tracks whether user explicitly activated the ICT clean preset.
  // defaultControls.masterOn=true, so we DON'T use it to drive the toggle — instead
  // we track whether the pack is currently in “ICT clean state” by checking all 7 keys.
  const ict7Keys: (keyof ChartControls)[] = [
    'showOrderBlocks', 'showFvg', 'showPoc', 'showLt', 'showLt2', 'showLt3', 'showVwap', 'showSessionLevels',
  ]
  // “ICT mode” = all 7 are on AND the noisy layers are off
  const ictModeOn =
    ict7Keys.every((k) => controls[k] === true) &&
    !controls.showBB && !controls.showKC && !controls.showSqueeze && !controls.showCouncilArrows

  const applyIctPack = useCallback((on: boolean) => {
    if (on) {
      setObiBoomMinimalPatch(false)   // MIN locks the chart — ICT knock-on always clears it
      persist({
        ...controls,
        showBB: false, showKC: false, showSar: false,
        showSqueeze: false, squeezeLinesGreen: false, squeezePurpleBg: false,
        showDarvas: false, showCouncilArrows: false, showVoteDots: false,
        showLt: true, showLt2: true, showLt3: true, showKillzones: false, showEqualLevels: false,
        showBreakerBlocks: false, showVolBubbles: false, showMmBrain: false,
        showOrderBlocks: true, showFvg: true, showPoc: true, showVwap: true,
        showSwingRays: false, showSessionLevels: true,
        showIchimoku: false, showMas: false,
        masterOn: true,
      })
    } else {
      persist({ ...controls, showOrderBlocks: false, showFvg: false, showPoc: false, showLt: false, showLt2: false, showLt3: false, showVwap: false, showSessionLevels: false, masterOn: false })
    }
  }, [controls, persist, setObiBoomMinimalPatch])

  // ICT = knock-on only. Always applies the clean preset. No toggle-off, no lock.
  // Individual sub-buttons handle their own off state.
  const toggleIctMaster = useCallback(() => {
    applyIctPack(true)
  }, [applyIctPack])

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
  const fmtUsd = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(n)
  const chartKey = bars.length > 0 ? `${sym}-${tf}-${bars[0]!.time}-${bars[bars.length-1]!.time}-${bars.length}` : ''
  const simIndex = Math.max(0, Math.floor(simProgress))
  const simStart = Math.max(0, simIndex - simCandleWindow + 1)
  const simBars = useMemo(() => bars.slice(simStart, simIndex + 1), [bars, simStart, simIndex])
  const chartStackPx = Math.floor(availableChartStackPx * (stackHeightPct / 100))
  const mainRowPct = clamp(mainChartHeightVh, 25, 75)
  const simRowPct = 100 - mainRowPct
  const chartLayoutKey = `${chartStackPx}-${mainRowPct}-${simRowPct}`
  const simChartKey = simBars.length > 0 ? `${sym}-${tf}-sim-${chartLayoutKey}` : ''
  const simPrice = simBars.length > 0 ? simBars[simBars.length - 1]!.close : null
  const applyFullHeightLayout = useCallback(() => {
    setMainChartHeightVh(75)
    setStackHeightPct(100)
  }, [])
  const applySplit50Layout = useCallback(() => {
    setMainChartHeightVh(50)
    setStackHeightPct(100)
  }, [])
  const mainChartRenderKey = chartKey ? `${chartKey}-${chartLayoutKey}` : ''
  const targetPack = useMemo(() => computePriceTargets(bars), [bars])
  const lt: LiquidityThermalResult | null = targetPack.lt

  // OBI engine — lifted to page level so both the panel and chart lines share one computation
  const obiResult = useMemo(() => computeOBI(bars), [bars])

  // ICT Brain: killzone, DOL, entry zone, invalidation
  const ictBrain = useMemo(() => obiResult ? computeICTBrain(bars, obiResult) : null, [bars, obiResult])

  // Whacker gate: KZ hard gate + displacement + Kelly multiplier
  const obiJediGate = useMemo(
    () => obiResult && ictBrain ? computeObiJediGate(obiResult, ictBrain, jediScore) : null,
    [obiResult, ictBrain, jediScore],
  )

  const councilConfluence = useMemo(() => {
    const factors: Array<{ k: string; pass: boolean; note: string; w: number }> = []
    if (!obiResult || !ictBrain || !obiJediGate) {
      return { score: 0, factors, iterOpt: ['Load bars and wait for OBI + ICT state.'] }
    }
    factors.push({ k: 'BIAS', pass: obiResult.dir !== 'NEUTRAL', note: obiResult.dir, w: 0.2 })
    factors.push({ k: 'KZ', pass: ictBrain.killzoneNow, note: ictBrain.killzone, w: 0.22 })
    factors.push({ k: 'DISP', pass: ictBrain.rapidExpansion, note: `${ictBrain.expansionRatio.toFixed(2)}x ATR`, w: 0.16 })
    factors.push({ k: 'ENTRY', pass: !!ictBrain.entryZone || ictBrain.orbBreakout, note: ictBrain.entryZone ? ictBrain.entryZone.type : (ictBrain.orbBreakout ? 'ORB' : 'none'), w: 0.16 })
    factors.push({ k: 'RR', pass: obiResult.rr >= 2.0, note: `1:${obiResult.rr}`, w: 0.16 })
    factors.push({ k: 'JEDI', pass: Math.abs(jediScore) >= 8, note: `${jediScore > 0 ? '+' : ''}${Math.round(jediScore)}`, w: 0.1 })
    const score = Math.round(factors.reduce((s, f) => s + (f.pass ? f.w : 0), 0) * 100)

    const iterOpt: string[] = []
    if (!ictBrain.killzoneNow) iterOpt.push('Wait for London/NY killzone before aggressive entries.')
    if (!ictBrain.rapidExpansion) iterOpt.push('Raise displacement quality: require >=0.6x ATR for next run.')
    if (!(!!ictBrain.entryZone || ictBrain.orbBreakout)) iterOpt.push('No OB/FVG/ORB trigger: reduce size to scout only.')
    if (obiResult.rr < 2.0) iterOpt.push('R:R below 2.0; adjust entry closer to OB/FVG mean threshold.')
    if (!iterOpt.length) iterOpt.push('Confluence aligned: keep quarter-Kelly and monitor divergence drift.')
    return { score, factors, iterOpt }
  }, [obiResult, ictBrain, obiJediGate, jediScore])

  // OBI → orb: jediAlign scaled by Kelly multiplier when whack is ready
  const obiJediAlign = obiResult
    ? (obiJediGate?.whackReady
        ? (obiResult.dir === 'BULL' ? 1.2 : -1.2)
        : (obiResult.dir === 'BULL' ? 0.85 : obiResult.dir === 'BEAR' ? -0.85 : 0))
    : null

  // Williams %R → xaiSentiment arc on orb (price near range top = bearish = negative)
  const williamsXai = useMemo(() => {
    if (bars.length < 20) return null
    const sl = bars.slice(-50)
    const hi = Math.max(...sl.map(b => b.high)), lo = Math.min(...sl.map(b => b.low)), rng = hi - lo
    if (!rng) return 0
    const wr = (hi - bars[bars.length - 1]!.close) / rng  // 0=top 1=bottom
    return parseFloat(((0.5 - wr) * 1.4).toFixed(2))       // top→-0.7, mid→0, bottom→+0.7
  }, [bars])

  // Combined angle for big orb arrow: OBI bias (55%) + SOLO (30%) + Williams (15%)
  const compositeAngleDeg = useMemo(() => {
    const obiScore  = obiResult ? (obiResult.composite - 50) / 50 : 0   // -1..+1
    const soloScore = solo.biasScore / 27                                 // -1..+1
    const wScore    = williamsXai ?? 0
    const raw = obiScore * 0.55 + soloScore * 0.30 + wScore * 0.15
    return Math.round(Math.max(-90, Math.min(90, raw * 90)))
  }, [obiResult, solo.biasScore, williamsXai])

  const decisionBars = simBars.length >= 60 ? simBars : bars
  const tradeObiResult = useMemo(() => computeOBI(decisionBars), [decisionBars])
  const tradeIctBrain = useMemo(() => tradeObiResult ? computeICTBrain(decisionBars, tradeObiResult) : null, [decisionBars, tradeObiResult])
  const tradeObiJediGate = useMemo(
    () => tradeObiResult && tradeIctBrain ? computeObiJediGate(tradeObiResult, tradeIctBrain, jediScore) : null,
    [tradeObiResult, tradeIctBrain, jediScore],
  )
  const tradeXaiSentiment = useMemo(() => {
    if (decisionBars.length < 20) return 0
    const sl = decisionBars.slice(-50)
    const hi = Math.max(...sl.map(b => b.high))
    const lo = Math.min(...sl.map(b => b.low))
    const rng = hi - lo
    if (!rng) return 0
    const wr = (hi - decisionBars[decisionBars.length - 1]!.close) / rng
    return (0.5 - wr) * 1.4
  }, [decisionBars])
  const tradeEmaSignal = useMemo<'LONG' | 'SHORT' | 'FLAT'>(() => {
    if (decisionBars.length < 30) return 'FLAT'
    const closes = decisionBars.map((b) => b.close)
    const f = emaSeries(closes, 9)
    const s = emaSeries(closes, 21)
    const a = f[f.length - 1] ?? 0
    const b = s[s.length - 1] ?? 0
    if (!isFinite(a) || !isFinite(b)) return 'FLAT'
    return a >= b ? 'LONG' : 'SHORT'
  }, [decisionBars])

  const boom3dOut = useMemo((): Boom3dBarOut[] => (bars.length >= 20 ? computeBoom3dTech(bars) : []), [bars])
  const sigBoomPre = useMemo(() => precomputeSigBoomVolumeAtr(bars), [bars])

  const simBarForLq = simBars.length ? simBars[simBars.length - 1]! : null
  const allModesActive = tradeMode === 'ALL'
  const proStrongBiasActive = allModesActive ? false : proStrongBias
  const edge70GateActive = allModesActive ? false : requireGoldEdge70
  const tradeDecision = useMemo(() => {
    if (tradeMode === 'ALL') {
      const core = computeSimAlgoDecisionRaw(
        {
          tradeMode: 'ALL',
          councilScore: councilConfluence.score,
          jediScore,
          killzoneOnly,
          proStrongBias: false,
          useT1: ictPreset.entry.use_t1,
          retestMode: ictPreset.retest.mode,
          exitMaxHoldBars: ictPreset.exit.max_hold_bars,
          jediWhackReady: tradeObiJediGate?.whackReady,
          ictT1IsLevel: tradeIctBrain?.t1IsICTLevel,
          goldLqSession: simBarForLq ? goldLqSessionOk(simBarForLq.time) : false,
        },
        tradeObiResult,
        tradeIctBrain,
        tradeXaiSentiment,
        tradeEmaSignal,
      )
      if (core.allowed) return core
      const boom = evalSigBoomAtIndex(bars, boom3dOut, simIndex, controls, sigBoomPre)
      if (boom.allowed) return { ...boom, reason: `all/boom: ${boom.reason}` }
      return core
    }
    if (tradeMode === 'BOOM') {
      return evalSigBoomAtIndex(bars, boom3dOut, simIndex, controls, sigBoomPre)
    }
    return computeSimAlgoDecisionRaw(
      {
        tradeMode,
        councilScore: councilConfluence.score,
        jediScore,
        killzoneOnly,
          proStrongBias: proStrongBiasActive,
          useT1: ictPreset.entry.use_t1,
          retestMode: ictPreset.retest.mode,
          exitMaxHoldBars: ictPreset.exit.max_hold_bars,
        jediWhackReady: tradeObiJediGate?.whackReady,
        ictT1IsLevel: tradeIctBrain?.t1IsICTLevel,
        goldLqSession: simBarForLq ? goldLqSessionOk(simBarForLq.time) : false,
      },
      tradeObiResult,
      tradeIctBrain,
      tradeXaiSentiment,
      tradeEmaSignal,
    )
  }, [
    tradeMode,
    simIndex,
    bars,
    boom3dOut,
    sigBoomPre,
    controls,
    councilConfluence.score,
    jediScore,
    tradeEmaSignal,
    tradeObiResult,
    tradeXaiSentiment,
    tradeIctBrain,
    tradeObiJediGate?.whackReady,
    simBarForLq,
    killzoneOnly,
    proStrongBiasActive,
    ictPreset,
  ])

  const paperTradesAll = useMemo(() => evaluatePaperTrades(bars), [bars])
  const simLastTime = simBars.length ? simBars[simBars.length - 1]!.time : 0
  const paperTradesVisible = useMemo(
    () => paperTradesAll.filter((t) => t.exitTime <= simLastTime),
    [paperTradesAll, simLastTime],
  )

  const simGoldUtc = useMemo(() => {
    const t = simBars[simBars.length - 1]?.time
    if (!t) return null
    return goldSessionUtc(t)
  }, [simBars])

  const goldEdgeEstimate = useMemo(() => {
    if (!simGoldUtc) return null
    const bs = tradeObiResult?.biasStrong ? 1.08 : 0.92
    return Math.round(Math.min(100, councilConfluence.score * simGoldUtc.mult * bs))
  }, [simGoldUtc, councilConfluence.score, tradeObiResult?.biasStrong])

  /** Gated direction for sim marks + replay: raw decision + optional Gold edge floor (≥70). */
  const algoSimDesired = useMemo(() => {
    const raw: 'LONG' | 'SHORT' | 'FLAT' =
      tradeDecision.allowed && (tradeDecision.dir === 'LONG' || tradeDecision.dir === 'SHORT')
        ? tradeDecision.dir
        : 'FLAT'
    return applyGoldEdgeFloor(raw, goldEdgeEstimate, edge70GateActive)
  }, [tradeDecision.allowed, tradeDecision.dir, goldEdgeEstimate, edge70GateActive])

  useEffect(() => {
    if (!simBars.length || !simRunning) return
    const last = simBars[simBars.length - 1]!
    if (!last?.time) return
    const t = last.time
    if (t !== simFireEventBarTimeRef.current) {
      simFireEventBarTimeRef.current = t
      simFireEventIdsOnBarRef.current = new Set()
    }
    const used = simFireEventIdsOnBarRef.current
    const desired: 'LONG' | 'SHORT' | 'FLAT' = algoSimDesired
    let signal: 'LONG' | 'SHORT' | 'FLAT' = simPosRef.current
    const prev = simPosRef.current
    const maxHold = Math.max(SIM_MIN_HOLD_BARS, ictPreset.exit.max_hold_bars || SIM_MIN_HOLD_BARS)
    if (prev !== 'FLAT') {
      simHeldBarsRef.current += 1
      // Hard policy: ignore gate/flip exits; only close on hold timeout.
      if (simHeldBarsRef.current >= maxHold) signal = 'FLAT'
    } else if (desired === 'LONG' || desired === 'SHORT') {
      signal = desired
    }
    if (prev === signal) return

    const toAdd: AlgoFireEvent[] = []
    const add = (e: AlgoFireEvent) => {
      const k = `${e.kind}|${e.dir}`
      if (used.has(k)) return
      used.add(k)
      toAdd.push(e)
    }

    if (prev === 'LONG' && signal === 'FLAT') {
      add({ time: t, price: last.close, dir: 'LONG', kind: 'exit', mode: tradeMode })
    }
    if (prev === 'SHORT' && signal === 'FLAT') {
      add({ time: t, price: last.close, dir: 'SHORT', kind: 'exit', mode: tradeMode })
    }
    if ((signal === 'LONG' || signal === 'SHORT') && prev === 'FLAT') {
      add({ time: t, price: last.close, dir: signal, kind: 'entry', mode: tradeMode })
      lastEntryBarTimeRef.current = t
      simHeldBarsRef.current = 0
    }
    if (toAdd.length) {
      setSimFireEvents((p) => [...p, ...toAdd].slice(-300))
    }
    simPosRef.current = signal
    lastSignalRef.current = signal
  }, [simBars, simRunning, algoSimDesired, tradeMode, ictPreset.exit.max_hold_bars])

  const simAlgoTape = useMemo(() => {
    const councilScore = councilConfluence.score
    const ctxBase: SimAlgoDecisionCtx = {
      tradeMode,
      councilScore,
      jediScore,
      killzoneOnly,
      proStrongBias: proStrongBiasActive,
      useT1: ictPreset.entry.use_t1,
      retestMode: ictPreset.retest.mode,
      exitMaxHoldBars: ictPreset.exit.max_hold_bars,
    }
    const closed: SimAlgoClosedTrade[] = []
    let openLeg: SimAlgoOpenLeg | null = null
    let nextId = 1

    const pushClose = (
      side: 'LONG' | 'SHORT',
      entryIdx: number,
      exitIdx: number,
      entryPx: number,
      exitPx: number,
      edgeEntry: number | null,
      exitReason: SimExitReason = 'STOP',
    ) => {
      const pnlPct =
        side === 'LONG'
          ? ((exitPx - entryPx) / Math.max(1e-12, entryPx)) * 100
          : ((entryPx - exitPx) / Math.max(1e-12, entryPx)) * 100
      const entT = bars[entryIdx]!.time
      const sess = goldSessionUtc(entT)
      closed.push({
        id: nextId++,
        side,
        entryIdx,
        exitIdx,
        entryTime: entT,
        exitTime: bars[exitIdx]!.time,
        entryPx,
        exitPx,
        pnlPct,
        edgeEntry,
        sessionUtcLabel: sess.label,
        mode: tradeMode,
        holdBars: exitIdx - entryIdx,
        exitReason,
      })
    }

    const startIdx = 49
    if (!bars.length || simIndex < startIdx) {
      return {
        closed,
        openLeg: null as SimAlgoOpenLeg | null,
        unrealPnLPct: null as number | null,
        wins: 0,
        losses: 0,
        netPct: 0,
        pf: 0 as number,
        closedCount: 0,
        equityStart: SIM_PAPER_NOTIONAL_USD,
        equityAfterClosed: SIM_PAPER_NOTIONAL_USD,
        equityMark: SIM_PAPER_NOTIONAL_USD,
        dollarPnlNet: 0,
        retPctOn10k: 0,
      }
    }

    for (let i = startIdx; i <= simIndex; i++) {
      const barT = bars[i]!.time
      const slice = bars.slice(Math.max(0, i - simCandleWindow + 1), i + 1)
      const tro = computeOBI(slice)
      const tib = tro ? computeICTBrain(slice, tro) : null
      const tjg = tro && tib ? computeObiJediGate(tro, tib, jediScore) : null
      const txs = sentimentFromBars(slice)
      const tes = emaTrendSignal(slice)
      const td =
        tradeMode === 'BOOM'
          ? evalSigBoomAtIndex(bars, boom3dOut, i, controls, sigBoomPre)
          : computeSimAlgoDecisionRaw(
        {
          ...ctxBase,
          jediWhackReady: tjg?.whackReady,
          ictT1IsLevel: tib?.t1IsICTLevel,
          goldLqSession: goldLqSessionOk(barT),
        },
        tro,
        tib,
        txs,
        tes,
      )
      const sess = goldSessionUtc(barT)
      const edgeEst = tro
        ? Math.round(Math.min(100, councilScore * sess.mult * (tro.biasStrong ? 1.08 : 0.92)))
        : null
      const rawWant: 'LONG' | 'SHORT' | 'FLAT' =
        td.allowed && (td.dir === 'LONG' || td.dir === 'SHORT') ? td.dir : 'FLAT'
      const want = applyGoldEdgeFloor(rawWant, edgeEst, edge70GateActive)
      const barNow = bars[i]!
      const px = barNow.close
      const atrNow = Math.max(1e-9, tro?.atrVal ?? (px * 0.005))
      const held = openLeg?.side ?? 'FLAT'
      const heldBars = openLeg ? (i - openLeg.entryIdx) : 0
      if (held !== 'FLAT' && openLeg) {
        // Phase 1: in-play window — hard gap-stop only, no normal exits
        if (heldBars < SIM_IN_PLAY_BARS) {
          const gapAgainst = openLeg.side === 'LONG'
            ? barNow.close < openLeg.entryPx - openLeg.atrEntry * 2.0
            : barNow.close > openLeg.entryPx + openLeg.atrEntry * 2.0
          if (gapAgainst) {
            pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, barNow.close, openLeg.edgeEntry, 'GAP_STOP')
            openLeg = null
          }
          continue
        }
        // Phase 2: in-play confirmation — must show minimum progress toward target
        if (heldBars === SIM_IN_PLAY_BARS) {
          const progress = openLeg.side === 'LONG'
            ? barNow.close - openLeg.entryPx
            : openLeg.entryPx - barNow.close
          if (progress < SIM_IN_PLAY_MIN_ATR * openLeg.atrEntry) {
            pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, barNow.close, openLeg.edgeEntry, 'NOT_IN_PLAY')
            openLeg = null
            continue
          }
        }
        const maxHold = Math.max(SIM_IN_PLAY_BARS + 1, ctxBase.exitMaxHoldBars ?? SIM_MIN_HOLD_BARS)
        // Climax exit: after TP1 hit, volume spike + full-body candle → exit at peak
        if (openLeg.tp1Hit) {
          const volAvg = slice.slice(-21, -1).reduce((s, b) => s + (b.volume ?? 0), 0) / 20
          const volSpike = volAvg > 0 ? (barNow.volume ?? 0) / volAvg : 0
          const range = Math.max(1e-9, barNow.high - barNow.low)
          const bodyFrac = Math.abs(barNow.close - barNow.open) / range
          if (volSpike > 2.3 && bodyFrac > 0.70) {
            pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, barNow.close, openLeg.edgeEntry, 'CLIMAX')
            openLeg = null
            continue
          }
        }
        if (openLeg.side === 'LONG') {
          openLeg.peakPx = Math.max(openLeg.peakPx, barNow.high)
          openLeg.trailPx = Math.max(openLeg.trailPx, openLeg.peakPx - atrNow * 1.5)
          if (!openLeg.tp1Hit && barNow.high >= openLeg.tp1Px) {
            openLeg.tp1Hit = true
            openLeg.trailPx = Math.max(openLeg.trailPx, openLeg.entryPx)
          }
          if (barNow.low <= Math.max(openLeg.stopPx, openLeg.trailPx)) {
            pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, Math.max(openLeg.stopPx, openLeg.trailPx), openLeg.edgeEntry, openLeg.tp1Hit ? 'TRAIL' : 'STOP')
            openLeg = null; continue
          }
          if (barNow.high >= openLeg.tp2Px) {
            pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, openLeg.tp2Px, openLeg.edgeEntry, 'TP')
            openLeg = null; continue
          }
        } else {
          openLeg.peakPx = Math.min(openLeg.peakPx, barNow.low)
          openLeg.trailPx = Math.min(openLeg.trailPx, openLeg.peakPx + atrNow * 1.5)
          if (!openLeg.tp1Hit && barNow.low <= openLeg.tp1Px) {
            openLeg.tp1Hit = true
            openLeg.trailPx = Math.min(openLeg.trailPx, openLeg.entryPx)
          }
          if (barNow.high >= Math.min(openLeg.stopPx, openLeg.trailPx)) {
            pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, Math.min(openLeg.stopPx, openLeg.trailPx), openLeg.edgeEntry, openLeg.tp1Hit ? 'TRAIL' : 'STOP')
            openLeg = null; continue
          }
          if (barNow.low <= openLeg.tp2Px) {
            pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, openLeg.tp2Px, openLeg.edgeEntry, 'TP')
            openLeg = null; continue
          }
        }
        if (i - openLeg.entryIdx >= maxHold) {
          pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, px, openLeg.edgeEntry, 'TIMEOUT')
          openLeg = null
        }
        continue
      }
      if (want !== 'FLAT') {
        const maxHold = Math.max(SIM_MIN_HOLD_BARS, ctxBase.exitMaxHoldBars ?? SIM_MIN_HOLD_BARS)
        const ex = buildClaudeExitLeg(want, px, atrNow, maxHold, ictPreset.exit.stop_atr, ictPreset.exit.take_profit_atr)
        openLeg = {
          side: want,
          entryIdx: i,
          entryTime: barT,
          entryPx: px,
          edgeEntry: edgeEst,
          stopPx: ex.stopPx,
          tp1Px: ex.tp1Px,
          tp2Px: ex.tp2Px,
          tp1Hit: ex.tp1Hit,
          trailPx: ex.trailPx,
          peakPx: ex.peakPx,
          atrEntry: ex.atrEntry,
        }
      }
    }

    let wins = 0
    let losses = 0
    let gw = 0
    let gl = 0
    let netPct = 0
    let notInPlayCount = 0
    for (const t of closed) {
      netPct += t.pnlPct
      if (t.exitReason === 'NOT_IN_PLAY') { notInPlayCount++; continue }
      if (t.pnlPct >= 0) {
        wins++
        gw += t.pnlPct
      } else {
        losses++
        gl -= t.pnlPct
      }
    }
    const pf = gl > 1e-9 ? gw / gl : wins > 0 ? 99 : 0

    let unrealPnLPct: number | null = null
    if (openLeg && bars[simIndex]) {
      const px = bars[simIndex]!.close
      unrealPnLPct =
        openLeg.side === 'LONG'
          ? ((px - openLeg.entryPx) / Math.max(1e-12, openLeg.entryPx)) * 100
          : ((openLeg.entryPx - px) / Math.max(1e-12, openLeg.entryPx)) * 100
    }

    let equityAfterClosed = SIM_PAPER_NOTIONAL_USD
    for (const t of closed) {
      equityAfterClosed *= 1 + t.pnlPct / 100
    }
    const equityMark =
      openLeg && unrealPnLPct !== null ? equityAfterClosed * (1 + unrealPnLPct / 100) : equityAfterClosed
    const dollarPnlNet = equityMark - SIM_PAPER_NOTIONAL_USD
    const retPctOn10k = (equityMark / SIM_PAPER_NOTIONAL_USD - 1) * 100

    return {
      closed,
      openLeg,
      unrealPnLPct,
      wins,
      losses,
      notInPlayCount,
      netPct,
      pf,
      closedCount: closed.length,
      equityStart: SIM_PAPER_NOTIONAL_USD,
      equityAfterClosed,
      equityMark,
      dollarPnlNet,
      retPctOn10k,
    }
  }, [
    bars,
    simIndex,
    simCandleWindow,
    tradeMode,
    councilConfluence.score,
    jediScore,
    killzoneOnly,
    proStrongBiasActive,
    ictPreset,
    edge70GateActive,
    controls,
    boom3dOut,
    sigBoomPre,
  ])

  const simModeBooks = useMemo(() => {
    const out: Record<Exclude<TradeMode, 'ALL'>, {
      closed: SimAlgoClosedTrade[]
      openLeg: SimAlgoOpenLeg | null
      unrealPnLPct: number | null
      wins: number
      losses: number
      netPct: number
      pf: number
      closedCount: number
      equityMark: number
      retPctOn10k: number
    }> = {
      COUNCIL: { closed: [], openLeg: null, unrealPnLPct: null, wins: 0, losses: 0, netPct: 0, pf: 0, closedCount: 0, equityMark: SIM_PAPER_NOTIONAL_USD, retPctOn10k: 0 },
      ICT: { closed: [], openLeg: null, unrealPnLPct: null, wins: 0, losses: 0, netPct: 0, pf: 0, closedCount: 0, equityMark: SIM_PAPER_NOTIONAL_USD, retPctOn10k: 0 },
      BOTH: { closed: [], openLeg: null, unrealPnLPct: null, wins: 0, losses: 0, netPct: 0, pf: 0, closedCount: 0, equityMark: SIM_PAPER_NOTIONAL_USD, retPctOn10k: 0 },
      JEDI: { closed: [], openLeg: null, unrealPnLPct: null, wins: 0, losses: 0, netPct: 0, pf: 0, closedCount: 0, equityMark: SIM_PAPER_NOTIONAL_USD, retPctOn10k: 0 },
      JEDI_MASTER: { closed: [], openLeg: null, unrealPnLPct: null, wins: 0, losses: 0, netPct: 0, pf: 0, closedCount: 0, equityMark: SIM_PAPER_NOTIONAL_USD, retPctOn10k: 0 },
      BOOM: { closed: [], openLeg: null, unrealPnLPct: null, wins: 0, losses: 0, netPct: 0, pf: 0, closedCount: 0, equityMark: SIM_PAPER_NOTIONAL_USD, retPctOn10k: 0 },
    }
    const councilScore = councilConfluence.score
    const startIdx = 49
    if (!bars.length || simIndex < startIdx) return out

    for (const mode of SIM_TUNE_MODES) {
      const ctxBase: SimAlgoDecisionCtx = {
        tradeMode: mode,
        councilScore,
        jediScore,
        killzoneOnly,
        proStrongBias: proStrongBiasActive,
      }
      const closed: SimAlgoClosedTrade[] = []
      let openLeg: SimAlgoOpenLeg | null = null
      let nextId = 1
      const pushClose = (side: 'LONG' | 'SHORT', entryIdx: number, exitIdx: number, entryPx: number, exitPx: number, edgeEntry: number | null, exitReason: SimExitReason = 'STOP') => {
        const pnlPct =
          side === 'LONG'
            ? ((exitPx - entryPx) / Math.max(1e-12, entryPx)) * 100
            : ((entryPx - exitPx) / Math.max(1e-12, entryPx)) * 100
        const entT = bars[entryIdx]!.time
        closed.push({
          id: nextId++,
          side,
          entryIdx,
          exitIdx,
          entryTime: entT,
          exitTime: bars[exitIdx]!.time,
          entryPx,
          exitPx,
          pnlPct,
          edgeEntry,
          sessionUtcLabel: goldSessionUtc(entT).label,
          mode,
          holdBars: exitIdx - entryIdx,
          exitReason,
        })
      }

      for (let i = startIdx; i <= simIndex; i++) {
        const barT = bars[i]!.time
        const slice = bars.slice(Math.max(0, i - simCandleWindow + 1), i + 1)
        const tro = computeOBI(slice)
        const tib = tro ? computeICTBrain(slice, tro) : null
        const tjg = tro && tib ? computeObiJediGate(tro, tib, jediScore) : null
        const txs = sentimentFromBars(slice)
        const tes = emaTrendSignal(slice)
        const td =
          mode === 'BOOM'
            ? evalSigBoomAtIndex(bars, boom3dOut, i, controls, sigBoomPre)
            : computeSimAlgoDecisionRaw(
              {
                ...ctxBase,
                jediWhackReady: tjg?.whackReady,
                ictT1IsLevel: tib?.t1IsICTLevel,
                goldLqSession: goldLqSessionOk(barT),
              },
              tro,
              tib,
              txs,
              tes,
            )
        const sess = goldSessionUtc(barT)
        const edgeEst = tro ? Math.round(Math.min(100, councilScore * sess.mult * (tro.biasStrong ? 1.08 : 0.92))) : null
        const rawWant: 'LONG' | 'SHORT' | 'FLAT' = td.allowed && (td.dir === 'LONG' || td.dir === 'SHORT') ? td.dir : 'FLAT'
        const want = applyGoldEdgeFloor(rawWant, edgeEst, edge70GateActive)
        const barNow = bars[i]!
        const px = barNow.close
        const atrNow = Math.max(1e-9, tro?.atrVal ?? (px * 0.005))
        const held = openLeg?.side ?? 'FLAT'
        const heldBars = openLeg ? (i - openLeg.entryIdx) : 0

        if (want === held && want !== 'FLAT') continue
        if (held !== 'FLAT' && openLeg) {
          if (heldBars < SIM_IN_PLAY_BARS) {
            const gapAgainst = openLeg.side === 'LONG'
              ? barNow.close < openLeg.entryPx - openLeg.atrEntry * 2.0
              : barNow.close > openLeg.entryPx + openLeg.atrEntry * 2.0
            if (gapAgainst) {
              pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, barNow.close, openLeg.edgeEntry, 'GAP_STOP')
              openLeg = null
            }
            continue
          }
          if (heldBars === SIM_IN_PLAY_BARS) {
            const progress = openLeg.side === 'LONG'
              ? barNow.close - openLeg.entryPx
              : openLeg.entryPx - barNow.close
            if (progress < SIM_IN_PLAY_MIN_ATR * openLeg.atrEntry) {
              pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, barNow.close, openLeg.edgeEntry, 'NOT_IN_PLAY')
              openLeg = null
              continue
            }
          }
          const maxHold = Math.max(SIM_IN_PLAY_BARS + 1, ctxBase.exitMaxHoldBars ?? SIM_MIN_HOLD_BARS)
          if (openLeg.side === 'LONG') {
            openLeg.peakPx = Math.max(openLeg.peakPx, barNow.high)
            openLeg.trailPx = Math.max(openLeg.trailPx, openLeg.peakPx - atrNow * 1.5)
            if (!openLeg.tp1Hit && barNow.high >= openLeg.tp1Px) {
              openLeg.tp1Hit = true
              openLeg.trailPx = Math.max(openLeg.trailPx, openLeg.entryPx)
            }
            if (barNow.low <= Math.max(openLeg.stopPx, openLeg.trailPx)) {
              pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, Math.max(openLeg.stopPx, openLeg.trailPx), openLeg.edgeEntry, openLeg.tp1Hit ? 'TRAIL' : 'STOP')
              openLeg = null
            } else if (barNow.high >= openLeg.tp2Px) {
              pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, openLeg.tp2Px, openLeg.edgeEntry, 'TP')
              openLeg = null
            } else if (i - openLeg.entryIdx >= maxHold) {
              pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, px, openLeg.edgeEntry, 'TIMEOUT')
              openLeg = null
            } else {
              continue
            }
          } else {
            openLeg.peakPx = Math.min(openLeg.peakPx, barNow.low)
            openLeg.trailPx = Math.min(openLeg.trailPx, openLeg.peakPx + atrNow * 1.5)
            if (!openLeg.tp1Hit && barNow.low <= openLeg.tp1Px) {
              openLeg.tp1Hit = true
              openLeg.trailPx = Math.min(openLeg.trailPx, openLeg.entryPx)
            }
            if (barNow.high >= Math.min(openLeg.stopPx, openLeg.trailPx)) {
              pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, Math.min(openLeg.stopPx, openLeg.trailPx), openLeg.edgeEntry, openLeg.tp1Hit ? 'TRAIL' : 'STOP')
              openLeg = null
            } else if (barNow.low <= openLeg.tp2Px) {
              pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, openLeg.tp2Px, openLeg.edgeEntry, 'TP')
              openLeg = null
            } else if (i - openLeg.entryIdx >= maxHold) {
              pushClose(held, openLeg.entryIdx, i, openLeg.entryPx, px, openLeg.edgeEntry, 'TIMEOUT')
              openLeg = null
            } else {
              continue
            }
          }
        }
        if (want !== 'FLAT') {
          const maxHold = Math.max(SIM_MIN_HOLD_BARS, ctxBase.exitMaxHoldBars ?? SIM_MIN_HOLD_BARS)
          const ex = buildClaudeExitLeg(want, px, atrNow, maxHold, ictPreset.exit.stop_atr, ictPreset.exit.take_profit_atr)
          openLeg = {
            side: want,
            entryIdx: i,
            entryTime: barT,
            entryPx: px,
            edgeEntry: edgeEst,
            stopPx: ex.stopPx,
            tp1Px: ex.tp1Px,
            tp2Px: ex.tp2Px,
            tp1Hit: ex.tp1Hit,
            trailPx: ex.trailPx,
            peakPx: ex.peakPx,
            atrEntry: ex.atrEntry,
          }
        }
      }

      let wins = 0
      let losses = 0
      let gw = 0
      let gl = 0
      let netPct = 0
      for (const t of closed) {
        netPct += t.pnlPct
        if (t.pnlPct >= 0) { wins++; gw += t.pnlPct } else { losses++; gl -= t.pnlPct }
      }
      const pf = gl > 1e-9 ? gw / gl : wins > 0 ? 99 : 0
      let equityAfterClosed = SIM_PAPER_NOTIONAL_USD
      for (const t of closed) equityAfterClosed *= 1 + t.pnlPct / 100
      let unrealPnLPct: number | null = null
      if (openLeg && bars[simIndex]) {
        const px = bars[simIndex]!.close
        unrealPnLPct =
          openLeg.side === 'LONG'
            ? ((px - openLeg.entryPx) / Math.max(1e-12, openLeg.entryPx)) * 100
            : ((openLeg.entryPx - px) / Math.max(1e-12, openLeg.entryPx)) * 100
      }
      const equityMark = openLeg && unrealPnLPct !== null ? equityAfterClosed * (1 + unrealPnLPct / 100) : equityAfterClosed
      out[mode] = {
        closed,
        openLeg,
        unrealPnLPct,
        wins,
        losses,
        netPct,
        pf,
        closedCount: closed.length,
        equityMark,
        retPctOn10k: (equityMark / SIM_PAPER_NOTIONAL_USD - 1) * 100,
      }
    }
    return out
  }, [
    bars,
    simIndex,
    simCandleWindow,
    councilConfluence.score,
    jediScore,
    killzoneOnly,
    proStrongBiasActive,
    edge70GateActive,
    controls,
    boom3dOut,
    sigBoomPre,
  ])

  const simModeLeaderboard = useMemo(
    () =>
      SIM_TUNE_MODES.map((mode) => {
        const s = simModeBooks[mode]
        return { mode, ...s }
      }).sort((a, b) => b.retPctOn10k - a.retPctOn10k),
    [simModeBooks],
  )

  const replayPaperStats = useMemo(() => {
    const pt = paperTradesVisible
    if (!pt.length) return null
    let wins = 0
    let gw = 0
    let gl = 0
    let net = 0
    for (const t of pt) {
      net += t.ret
      if (t.ret >= 0) {
        wins++
        gw += t.ret
      } else gl -= t.ret
    }
    const pf = gl > 1e-12 ? gw / gl : gw > 0 ? 999 : 0
    return {
      n: pt.length,
      wr: Math.round((100 * wins) / pt.length),
      pf,
      netPct: net * 100,
    }
  }, [paperTradesVisible])

  const simUtcClock = useMemo(() => {
    const t = simBars[simBars.length - 1]?.time
    if (!t) return '—'
    const d = new Date(t * 1000)
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
  }, [simBars])

  const paperTradeTargets = useMemo((): HeatTarget[] => {
    const recent = paperTradesVisible.slice(-18)
    const out: HeatTarget[] = []
    recent.forEach((t, i) => {
      const idx = recent.length - i
      const inColor = t.side === 'LONG' ? '#22c55e' : '#ef4444'
      const outColor = t.ret >= 0 ? '#38bdf8' : '#f59e0b'
      out.push({ price: t.entry, tier: `${t.side === 'LONG' ? 'BUY' : 'SELL'}#${idx}`, color: inColor, opacity: 0.55, lineWidth: 1, lineStyle: 1 })
      out.push({ price: t.exit, tier: `${t.ret >= 0 ? 'TP' : 'SL'}#${idx}`, color: outColor, opacity: 0.45, lineWidth: 1, lineStyle: 2 })
    })
    return out
  }, [paperTradesVisible])


  // Sound — chirp on new FIRE signal
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lastFireKeyRef = useRef('')
  useEffect(() => {
    if (!obiResult?.biasStrong || !obiResult.targets.length) return
    const t1 = obiResult.targets[0]!
    if (t1.heat !== 'FIRE') return
    const key = `${obiResult.dir}-${t1.price.toFixed(2)}`
    if (key === lastFireKeyRef.current) return
    lastFireKeyRef.current = key
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      const base = obiResult.dir === 'BULL' ? 528 : 396
      osc.frequency.setValueAtTime(base, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(base * (obiResult.dir === 'BULL' ? 1.45 : 0.72), ctx.currentTime + 0.14)
      gain.gain.setValueAtTime(0.10, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.42)
    } catch { /* audio blocked */ }
  }, [obiResult])

  // Chart line colours
  const T_LINE_COLORS = ['#ff6b00','#00d4ff','#a78bfa','#4ade80'] as const
  const STRUCT_COLOR   = '#fbbf24'  // gold — PD/PW/AH/AL/EQH/EQL/MNO

  // LINES = LT-based R1/R2/S1/S2 predictive S&R (original buildObiChartHeatTargets — proven)
  // ◎    = ICT ranked targets T1–T4 with opacity hierarchy, in front of candles
  // ▦    = Liquidity walls (VAP/HVN) + EQH/EQL pools

  // Local VAP walls (from loaded bars)
  const liquidityWalls = useMemo(
    () => controls.showVolBubbles ? computeLiquidityWalls(bars) : [],
    [bars, controls.showVolBubbles],
  )

  // DS backend walls (500-bar history, VAP + EQ pools + P/D zone)
  const dsWalls = usePoll<{
    ok: boolean; cur: number; atr: number
    walls: { price: number; vol_rel: number; type: string; side: string; systems: string[] }[]
    eq_pools: { price: number; count: number; side: string; label: string }[]
    pd_zone:  { mid: number; cur_zone: string; pct_of_range: number }
  }>(`/ds/v1/liquidity/walls/?symbol=${encodeURIComponent(sym)}&bars=500`, 120_000)

  const liquidityGlow = useMemo(
    () => computeLiquidityGlowState(bars, obiResult, liquidityWalls),
    [bars, obiResult, liquidityWalls],
  )

  const ictLevels = useMemo(
    () => controls.showEqualLevels ? bICTLevels(bars, bATR(bars)) : null,
    [bars, controls.showEqualLevels],
  )

  const chartLtHeatTargets = useMemo((): HeatTarget[] => {
    const lines: HeatTarget[] = []

    // ── LINES: Liquidity Thermal S/R levels ───────────────────────────────────
    const ltRaw = buildObiChartHeatTargets(bars, lt, targetPack.targets, targetPack.atr, {
      show: obiChartLines.show,
      density: obiChartLines.density,
      spread: obiChartLines.spread,
    })
    for (const l of ltRaw) lines.push(l)

    // ── ▦: DS backend walls (500-bar VAP — deeper history) ──────────────────
    if (dsWalls?.ok) {
      for (const w of dsWalls.walls) {
        if (w.type === 'HVN') {
          const strength = Math.min(w.vol_rel / 4, 1)
          lines.push({
            price:     w.price,
            tier:      w.systems.length ? `LIQ-${w.systems[0]}` : `LIQ-${w.side}`,
            color:     w.side === 'ABOVE' ? '#00ff88' : '#ff5c5c',
            opacity:   0.3 + strength * 0.45,
            lineWidth: w.vol_rel >= 3 ? 2 : 1,
            lineStyle: 1,
          })
        }
      }
    }

    // ── ▦: Liquidity Walls (VAP/HVN) — institutional order clusters ──────────
    for (const wall of liquidityWalls) {
      if (wall.type === 'WALL') {
        const strength = Math.min(wall.relVol / 4, 1)   // normalise opacity
        lines.push({
          price:     wall.price,
          tier:      `LIQ-${wall.side}`,
          color:     wall.side === 'ABOVE' ? '#4ade80' : '#f43f5e',
          opacity:   0.25 + strength * 0.45,
          lineWidth: wall.relVol >= 3 ? 2 : 1,
          lineStyle: 1,  // dashed
        })
      } else {
        // LVN: thin dotted line — price vacuum, fast-travel zone
        lines.push({
          price:     wall.price,
          tier:      'LVN',
          color:     '#94a3b8',
          opacity:   0.18,
          lineWidth: 1,
          lineStyle: 2,
        })
      }
    }

    // ── ═══: EQH/EQL — buyside/sellside liquidity pool rails ─────────────────
    if (ictLevels) {
      for (const p of ictLevels.eqh) {
        lines.push({ price: p, tier: 'EQH', color: '#4ade80', opacity: 0.55, lineWidth: 1, lineStyle: 1 })
      }
      for (const p of ictLevels.eql) {
        lines.push({ price: p, tier: 'EQL', color: '#f43f5e', opacity: 0.55, lineWidth: 1, lineStyle: 1 })
      }
    }

    // ── ◎: ICT ranked targets — solid, opacity by rank, in front ─────────────
    if (showObiTargets && obiResult) {
      obiResult.targets.forEach((t, i) => {
        lines.push({
          price:     t.price,
          tier:      t.label,
          color:     T_LINE_COLORS[i] ?? '#94a3b8',
          opacity:   i === 0 ? 0.8 : 0.65,
          lineWidth: i === 0 ? 2 : 1,
          lineStyle: 0,
        })
      })
    }

    const lineRelevance = (tier: string): number => {
      if (tier.startsWith('LIQ-')) return 1
      if (tier === 'EQH' || tier === 'EQL') return 0.9
      if (tier === 'VWAP' || tier === 'VOL') return 0.75
      if (tier === 'PDH' || tier === 'PDL' || tier === 'PWH' || tier === 'PWL' || tier === 'AH' || tier === 'AL' || tier === 'LH' || tier === 'LL' || tier === 'MNO') return 0.95
      if (tier === 'LVN') return 0.5
      if (tier === 'T1' || tier === 'T2' || tier === 'T3' || tier === 'T4') return 0.85
      return 0.65
    }

    const glow = liquidityGlow.total
    return lines.map(line => {
      const relevance = lineRelevance(line.tier)
      const boost = glow * (0.25 + 0.75 * relevance)
      const baseLw = line.lineWidth ?? 1
      return {
        ...line,
        opacity: Math.min(0.95, line.opacity + boost * 0.38),
        lineWidth: clampHeatLineWidth(Math.min(3, baseLw + (boost >= 0.4 ? 1 : 0))),
      }
    })
  }, [bars, lt, targetPack.targets, targetPack.atr, obiChartLines, showObiTargets, obiResult, liquidityWalls, ictLevels, dsWalls, liquidityGlow.total])

  const chartTradeTargets = useMemo(
    () => [...chartLtHeatTargets, ...paperTradeTargets],
    [chartLtHeatTargets, paperTradeTargets],
  )
  const simFireTargets = useMemo((): HeatTarget[] => {
    if (!simFireEvents.length) return []
    return simFireEvents.map((e, i) => {
      const isEx = e.kind === 'exit'
      return {
        price: e.price,
        tier: isEx
          ? `EXIT ${e.dir}#${i + 1}`
          : `${e.dir === 'LONG' ? 'FIRE BUY' : 'FIRE SELL'}#${i + 1}`,
        color: isEx
          ? (e.dir === 'LONG' ? '#fbbf24' : '#22d3ee')
          : (e.dir === 'LONG' ? '#22c55e' : '#ef4444'),
        opacity: 0.75,
        lineWidth: 2,
        lineStyle: isEx ? 2 : 0,
      }
    })
  }, [simFireEvents])
  const simLiveTradeTargets = useMemo((): HeatTarget[] => {
    if (!simBars.length) return []
    if (!tradeDecision.allowed || (tradeDecision.dir !== 'LONG' && tradeDecision.dir !== 'SHORT')) return []
    const last = simBars[simBars.length - 1]!
    const entry = last.close
    const stop = tradeObiResult?.stop ?? (tradeDecision.dir === 'LONG' ? entry * 0.995 : entry * 1.005)
    const t1 = tradeObiResult?.targets?.[0]?.price ?? (tradeDecision.dir === 'LONG' ? entry * 1.005 : entry * 0.995)
    const ec = tradeDecision.dir === 'LONG' ? '#22c55e' : '#ef4444'
    const tc = tradeDecision.dir === 'LONG' ? '#38bdf8' : '#f59e0b'
    return [
      { price: entry, tier: 'LIVE ENTRY', color: ec, opacity: 0.82, lineWidth: 2, lineStyle: 0 },
      { price: stop, tier: 'LIVE STOP', color: '#f43f5e', opacity: 0.72, lineWidth: 1, lineStyle: 2 },
      { price: t1, tier: 'LIVE T1', color: tc, opacity: 0.72, lineWidth: 1, lineStyle: 1 },
    ]
  }, [simBars, tradeDecision.allowed, tradeDecision.dir, tradeObiResult])
  const simTradeMarkers = useMemo(
    () =>
      simFireEvents.map((e) => ({
        time: e.time,
        side: e.dir,
        kind: e.kind,
        text: e.kind === 'exit' ? 'OUT' : e.mode,
      })),
    [simFireEvents],
  )
  /** Fires on the rolling sim window: marker times must exist in `simBars` for the bottom chart. */
  const simTradeMarkersOnSimChart = useMemo(() => {
    if (!simBars.length) return []
    const tset = new Set(simBars.map((b) => b.time))
    return simTradeMarkers.filter((m) => tset.has(m.time))
  }, [simTradeMarkers, simBars])

  return (
    <div className="tv-lw-page">
      {/* SOLO orb dock */}
      <div className={`tv-lw-solo-dock tv-lw-solo-dock--${soloDock.side} tv-lw-solo-dock--tier-${soloDock.tier} ${soloDock.visible ? '' : 'tv-lw-solo-dock--collapsed'}`}>
        {soloDock.visible ? (
          <>
            <div className={['tv-lw-solo-dock__orb', soloOnMove && soloOrbDir === 'LONG' ? 'tv-lw-solo-dock__orb--move-long' : '', soloOnMove && soloOrbDir === 'SHORT' ? 'tv-lw-solo-dock__orb--move-short' : ''].filter(Boolean).join(' ')}>
              <SoloMasterOrb direction={soloOrbDir} score={soloOrbScore} conviction={soloOrbConv} strengthPct={solo.strength} onMoveStrengthPct={50} rvolRatio={solo.rvolRatio} density="rich" jediAlign={obiJediAlign} xaiSentiment={williamsXai} bigArrowAngleDeg={compositeAngleDeg} signalArrows={obiResult?.preds} />
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

          <div className="tv-lw-masters-seg" role="group" aria-label="DS all-algo sim" style={{ flexShrink: 0, borderLeft: '1px solid rgba(45,212,191,0.25)', borderRight: '1px solid rgba(45,212,191,0.25)', padding: '0 4px' }}>
            <button
              type="button"
              className={allAlgosSimOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              style={{
                fontSize: 9,
                fontWeight: 800,
                padding: '2px 10px',
                border: allAlgosSimOn ? '1px solid rgba(74, 222, 128, 0.95)' : '1px solid rgba(45, 212, 191, 0.85)',
                color: allAlgosSimOn ? '#dcfce7' : '#99f6e4',
                background: allAlgosSimOn
                  ? 'linear-gradient(180deg, rgba(22, 101, 52, 0.92), rgba(21, 128, 61, 0.95))'
                  : 'linear-gradient(180deg, rgba(6, 78, 59, 0.85), rgba(4, 47, 46, 0.95))',
                boxShadow: allAlgosSimOn ? '0 0 14px rgba(74, 222, 128, 0.34)' : '0 0 12px rgba(45, 212, 191, 0.25)',
                letterSpacing: 0.5,
              }}
              disabled={allAlgosSimBusy}
              onClick={toggleAllAlgosSim}
              title="Calls Django GET /v1/sim/universe/?all_algos=1 — all 30 crypto strategies (VITE_DS_URL or :8000). Non-crypto tickers use BTC.">
              {allAlgosSimBusy ? '…' : allAlgosSimOn ? 'ALL 30 ALGOS ON' : 'ALL 30 ALGOS'}
            </button>
          </div>

          <div
            className="tv-lw-masters-seg"
            role="group"
            aria-label="Stack layout — also in LAYOUT panel"
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              padding: '0 4px',
              borderLeft: '1px solid rgba(148,163,184,0.22)',
              borderRight: '1px solid rgba(148,163,184,0.22)',
            }}
          >
            <button
              type="button"
              className={mainRowPct >= 70 ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              style={{ fontSize: 8, fontWeight: 800, padding: '1px 5px' }}
              onClick={() => { applyFullHeightLayout() }}
              title="Main 75% · sim 25% · stack height 100%. Same as LAYOUT → 75/25."
            >
              75/25
            </button>
            <button
              type="button"
              className={mainRowPct === 50 ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              style={{ fontSize: 8, fontWeight: 800, padding: '1px 5px' }}
              onClick={() => { applySplit50Layout() }}
              title="Main 50% · sim 50% · stack height 100%."
            >
              50/50
            </button>
            <span
              style={{ fontSize: 7, color: '#94a3b8', fontFamily: 'monospace', whiteSpace: 'nowrap' }}
              title="Stack H% of available chart area · split top/bottom"
            >
              H{stackHeightPct}% {mainRowPct}/{simRowPct}
            </span>
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

          {/* LINES group — sits LEFT of ICT. LINES=structural levels, ◎=ranked targets, 3/7=scope */}
          <div className="tv-lw-masters-seg" role="group" aria-label="OBI chart lines" style={{ borderRight: '1px solid rgba(255,255,255,0.08)', paddingRight: 6, marginRight: 2, gap: 3 }}>
            <button type="button"
              className={obiChartLines.show ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => setObiChartLinesPatch(s => ({ ...s, show: !s.show }))}
              title="LINES: structural ICT levels on chart — PDH/PDL (3) + PW/AH/AL/EQH/EQL (7). Dashed, 50% opacity.">LINES</button>
            <button type="button"
              className={showObiTargets ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              onClick={() => setShowObiTargets(v => !v)}
              style={{ fontSize: 11 }}
              title="◎ Ranked targets (T1–T4): solid lines, 80%/65% opacity — in front of candles">◎</button>
            <button type="button"
              className={obiChartLines.show ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              style={{ fontSize: 9, padding: '1px 5px', opacity: obiChartLines.show ? 1 : 0.4 }}
              onClick={() => setObiChartLinesPatch(s => ({ ...s, density: s.density === 3 ? 7 : s.density === 7 ? 'multi' : 3 }))}
              title="3 = LT core (POC+R1+S1) · 7 = extended LT rungs · M = ICT multi-source">
              {obiChartLines.density === 3 ? '3' : obiChartLines.density === 7 ? '7' : 'M'}
            </button>
          </div>

          <div className="tv-lw-masters-seg tv-lw-masters-seg--ict-master" role="group" aria-label="ICT-6 master">
            <button type="button" className={ictModeOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={toggleIctMaster} title="ICT: turns on OB·FVG·HEAT·VP·VWAP·SESS — knocks on, doesn't lock. Each still toggles independently.">ICT</button>
          </div>
          {/* ICT-7: the 7 structural layers — ICT master lights all of these */}
          <div className="tv-lw-masters-seg tv-lw-masters-seg--ict" role="group" aria-label="ICT structural layers" style={{ gap: 2 }}>
            {([
              ['showOrderBlocks','OB','Order blocks'],
              ['showFvg','FVG','Fair value gaps'],
              ['showPoc','HEAT','Predictive ICT heat layer'],
              ['showLt','VP','Volume profile (liquidity profile)'],
              ['showLt2','LT2','Liquidity thermal time-binned walls (start/stop by time bucket)'],
              ['showLt3','LT3','Liquidity thermal every-interval dense heatmap (all intervals)'],
              ['showVwap','VWAP','VWAP ±1σ/2σ'],
              ['showSessionLevels','SESS','Session levels: OR / PDH / PDL'],
              ['showVolBubbles','WALLS','Liquidity walls — VAP/HVN institutional clusters (green=buy-side, red=sell-side)'],
              ['showEqualLevels','EQ HL','Equal Highs/Lows — buyside/sellside liquidity pools (ICT)'],
            ] as [keyof typeof controls, string, string][]).map(([key, label, tip]) => (
              <button key={key} type="button"
                className={controls[key] ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
                style={{ fontSize: 8, padding: '1px 4px' }}
                onClick={() => persist({ ...controls, [key]: !controls[key] })}
                title={tip}>{label}</button>
            ))}
            <button
              type="button"
              className={ltViz.bubbles ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              style={{ fontSize: 8, padding: '1px 4px' }}
              onClick={() => setLtViz((s) => ({ ...s, bubbles: !s.bubbles }))}
              title="BU: pressure bubbles on LT layers"
            >
              BU
            </button>
          </div>

          {/* Secondary — structural context, dimmed */}
          <div className="tv-lw-masters-seg" role="group" aria-label="Secondary overlays" style={{ opacity: 0.6, gap: 2 }}>
            <button type="button" className={controls.showIchimoku ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} style={{ fontSize: 8, padding: '1px 5px' }} onClick={() => persist({ ...controls, showIchimoku: !controls.showIchimoku })} title="Ichimoku cloud (HTF structure)">ICHI</button>
            <button type="button" className={controls.showMas ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} style={{ fontSize: 8, padding: '1px 5px' }} onClick={() => persist(setMasLayer(controls, !controls.showMas))} title="EMA ribbon">MAs</button>
          </div>

          {/* BOOM = squeeze momentum system (no KC). SIG = entry signal arrows. */}
          <div className="tv-lw-masters-seg tv-lw-masters-seg--boom" role="group" aria-label="BOOM signals" style={{ borderLeft: '1px solid rgba(167,139,250,0.2)', paddingLeft: 6, marginLeft: 2 }}>
            <button type="button"
              className={controls.squeezePurpleBg && controls.showSqueeze && controls.showCouncilArrows ? 'tv-lw-pill tv-lw-pill--purple-on' : 'tv-lw-pill tv-lw-pill--purple-off'}
              onClick={() => {
                const next = !(controls.squeezePurpleBg && controls.showSqueeze && controls.showCouncilArrows)
                persist({ ...controls, squeezePurpleBg: next, showSqueeze: next, showCouncilArrows: next, showBB: false, showKC: false })
              }}
              title="BOOM: squeeze momentum + signal arrows + purple tint. KC always off.">BOOM</button>
            <button type="button" className={controls.showCouncilArrows ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} style={{ fontSize: 8, padding: '1px 5px' }} onClick={() => persist({ ...controls, showCouncilArrows: !controls.showCouncilArrows })} title="SIG entry arrows">SIG</button>
            <button type="button" className={controls.sigMode === 'strict' ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} style={{ fontSize: 8, padding: '1px 5px' }}
              onClick={() => persist({ ...controls, sigMode: controls.sigMode === 'strict' ? 'balanced' : 'strict' })}
              title="SIG filter: STR = strict, BAL = balanced">{controls.sigMode === 'strict' ? 'STR' : 'BAL'}</button>
          </div>

          {/* PAGE OVERLAYS + TOOLS */}
          <div className="tv-lw-masters-seg tv-lw-masters-seg--tail" role="group" aria-label="Page overlays · tools" style={{ marginLeft: 4, gap: 3 }}>
            <button type="button" className={obiBoomMinimal ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} style={{ fontSize: 8, padding: '1px 5px' }}
              onClick={() => {
                const next = !obiBoomMinimal
                setObiBoomMinimalPatch(next)
                if (next) persist({ ...controls, showBB: false, showKC: false, showSqueeze: false, squeezePurpleBg: false, showSar: false, showDarvas: false, showCouncilArrows: false, showVoteDots: false, showLt: false, showLt2: false, showLt3: false, showOrderBlocks: false, showFvg: false, showPoc: false, showVwap: false, showSwingRays: false, showSessionLevels: false, showIchimoku: false, showMas: false })
              }}
              title="MIN: strip overlays to clean candles. Other buttons still work.">MIN</button>
            <button type="button" className={obiVisible ? 'tv-lw-pill tv-lw-pill--purple-on' : 'tv-lw-pill tv-lw-pill--purple-off'} style={{ fontSize: 8, padding: '1px 5px' }} onClick={() => setObiVisible(v => !v)} title="OBI targets panel">OBI</button>
            <button type="button" className={controls.safetyDefenseOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} style={{ fontSize: 8, padding: '1px 5px' }} onClick={toggleSafetyDefense} title="DEF: strict SIG filters">DEF</button>
            <button type="button" className={settingsOpen ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} style={{ fontSize: 8, padding: '1px 5px' }} onClick={() => setSettingsOpen(v => !v)} title="SIG sliders">⚙</button>
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
          <label className="tv-lw-opacity" dir="ltr" title="Simulation playback speed (linear)">
            <span className="tv-lw-opacity__val">SIM SPD {simSpeed}x</span>
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--lo" aria-hidden>1</span>
            <input type="range" min={1} max={1000} step={1} value={simSpeed} aria-label="Simulation playback speed"
              onChange={(e) => setSimSpeed(clamp(Number.parseInt(e.target.value, 10) || 10, 1, 1000))} />
            <span className="tv-lw-opacity__tick tv-lw-opacity__tick--hi" aria-hidden>1000</span>
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

      <div style={{ position: 'fixed', right: 12, top: 120, zIndex: 70, width: layoutPanelOpen ? 162 : 'auto' }}>
        {layoutPanelOpen ? (
          <div style={{ border: '1px solid rgba(148,163,184,0.32)', borderRadius: 6, background: 'rgba(2,6,16,0.94)', padding: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 6, color: '#7dd3fc', fontFamily: 'monospace', letterSpacing: 0.4 }}>LAYOUT PANEL</span>
              <button type="button" className="tv-lw-pill" style={{ fontSize: 5, padding: '0 3px' }} onClick={() => setLayoutPanelOpen(false)}>HIDE</button>
            </div>
            <button
              type="button"
              className={allAlgosSimOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
              style={{
                width: '100%',
                fontSize: 6,
                fontWeight: 800,
                padding: '1px 4px',
                marginBottom: 6,
                borderColor: allAlgosSimOn ? 'rgba(74, 222, 128, 0.95)' : 'rgba(45, 212, 191, 0.85)',
                color: allAlgosSimOn ? '#dcfce7' : '#99f6e4',
                background: allAlgosSimOn
                  ? 'linear-gradient(180deg, rgba(22,101,52,0.9), rgba(20,83,45,0.95))'
                  : 'linear-gradient(180deg, rgba(6, 78, 59, 0.85), rgba(4, 47, 46, 0.95))',
                boxShadow: allAlgosSimOn ? '0 0 12px rgba(74,222,128,0.3)' : '0 0 10px rgba(45, 212, 191, 0.2)',
              }}
              disabled={allAlgosSimBusy}
              onClick={toggleAllAlgosSim}
              title="Run DS /v1/sim/universe/?all_algos=1 for all 30 strategies."
            >
              {allAlgosSimBusy ? 'RUNNING…' : allAlgosSimOn ? 'ALL 30 ALGOS ON' : 'ALL 30 ALGOS'}
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
              <button type="button" className="tv-lw-pill tv-lw-pill--on" style={{ fontSize: 5, padding: '0 3px' }} onClick={applyFullHeightLayout} title="Main row 75% of stack, sim 25% (max split). Not browser full-screen.">
                75/25
              </button>
              <button type="button" className="tv-lw-pill" style={{ fontSize: 5, padding: '0 3px' }} onClick={applySplit50Layout} title="Main and sim rows 50% / 50% of the stack.">
                50 / 50
              </button>
            </div>
            <label style={{ display: 'block', marginBottom: 6 }}>
              <div style={{ fontSize: 5, color: '#cbd5e1', fontFamily: 'monospace', marginBottom: 1 }}>STACK H {stackHeightPct}%</div>
              <input type="range" min={45} max={100} step={1} value={stackHeightPct} onChange={(e) => {
                const next = clamp(Number.parseInt(e.target.value, 10) || 100, 45, 100)
                setStackHeightPct(next)
              }} style={{ width: '100%' }} />
            </label>
            <label style={{ display: 'block', marginBottom: 2 }}>
              <div style={{ fontSize: 5, color: '#cbd5e1', fontFamily: 'monospace', marginBottom: 1 }}>SPLIT TOP/BOTTOM {mainRowPct}/{simRowPct}</div>
              <input type="range" min={25} max={75} step={1} value={mainRowPct} onChange={(e) => {
                const nextMain = clamp(Number.parseInt(e.target.value, 10) || 50, 25, 75)
                setMainChartHeightVh(nextMain)
              }} style={{ width: '100%' }} />
            </label>
            <div style={{ marginTop: 6, borderTop: '1px solid rgba(148,163,184,0.18)', paddingTop: 5 }}>
              <div style={{ fontSize: 5, color: '#fbbf24', fontFamily: 'monospace', marginBottom: 3 }}>SIM CONTROL</div>
              <button
                type="button"
                className={tradeMode === 'ALL' ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
                style={{
                  width: '100%',
                  fontSize: 5,
                  fontWeight: 800,
                  padding: '0 3px',
                  marginBottom: 4,
                  borderColor: tradeMode === 'ALL' ? 'rgba(74, 222, 128, 0.92)' : undefined,
                  color: tradeMode === 'ALL' ? '#dcfce7' : undefined,
                  background: tradeMode === 'ALL' ? 'linear-gradient(180deg, rgba(22,101,52,0.9), rgba(20,83,45,0.95))' : undefined,
                  boxShadow: tradeMode === 'ALL' ? '0 0 10px rgba(74, 222, 128, 0.34)' : undefined,
                }}
                onClick={() => setTradeMode((m) => (m === 'ALL' ? 'JEDI_MASTER' : 'ALL'))}
                title="ALL = run independent books for all six modes. Click again to go back to MASTER."
              >
                {tradeMode === 'ALL' ? 'ALL MODES ON' : 'ALL MODES OFF'}
              </button>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, marginBottom: 4 }}>
                {(['COUNCIL', 'ICT', 'BOTH', 'JEDI', 'JEDI_MASTER', 'BOOM'] as TradeMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={tradeMode === m ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'}
                    style={{
                      fontSize: 5,
                      fontWeight: tradeMode === m ? 800 : 600,
                      padding: '0 2px',
                      borderColor: tradeMode === m ? 'rgba(74, 222, 128, 0.92)' : undefined,
                      color: tradeMode === m ? '#dcfce7' : undefined,
                      background: tradeMode === m ? 'linear-gradient(180deg, rgba(22,101,52,0.9), rgba(20,83,45,0.95))' : undefined,
                      boxShadow: tradeMode === m ? '0 0 10px rgba(74, 222, 128, 0.34)' : undefined,
                    }}
                    onClick={() => setTradeMode(m)}
                    title={
                      m === 'JEDI_MASTER'
                        ? 'JEDI Master: full JEDI stack + ICT whack (KZ+OB/FVG/ORB+disp) + T1 on inst level + A/B session (LQ)'
                        : m === 'BOOM'
                          ? 'BOOM: same as chart SIG (squeeze+box+RVOL) — not API council. Uses strip RV/ATR/BRK. Turn SIG on.'
                        : m === 'ICT'
                          ? 'ICT: EMA9/21 direction + structure (OB/FVG/ORB/disp). Trades more than JEDI; no jedi/council/MTF/XAI gates.'
                        : m === 'JEDI'
                          ? 'JEDI: confluence+MTF+sentiment+jedi+ict — fewer trades, higher bar than ICT.'
                        : `Trade mode ${m}`
                    }
                  >
                    {`${m === 'JEDI_MASTER' ? 'MASTER' : m}${tradeMode === m ? ' ON' : ''}`}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="tv-lw-pill"
                style={{
                  width: '100%',
                  fontSize: 5,
                  padding: '0 3px',
                  marginBottom: 3,
                  borderColor: killzoneOnly ? 'rgba(251,191,36,0.85)' : undefined,
                  color: killzoneOnly ? '#fde68a' : undefined,
                  background: killzoneOnly ? 'rgba(120,53,15,0.56)' : undefined,
                }}
                onClick={() => setKillzoneOnly(v => !v)}
                title="When ON, only ICT sim is blocked outside London/NY KZ. COUNCIL / JEDI / BOOM / … ignore this toggle."
              >
                {killzoneOnly ? 'ICT·KZ ONLY' : 'KZ OFF'}
              </button>
              <button
                type="button"
                className="tv-lw-pill"
                style={{
                  width: '100%',
                  fontSize: 5,
                  padding: '0 3px',
                  marginBottom: 3,
                  borderColor: proStrongBias ? 'rgba(74,222,128,0.75)' : undefined,
                  color: proStrongBias ? '#bbf7d0' : undefined,
                  background: proStrongBias ? 'rgba(22,101,52,0.45)' : undefined,
                }}
                onClick={() => setProStrongBias(v => !v)}
                title="PRO: require weekly+daily STRONG bias before sim fires (Gold-standard gate)"
              >
                {proStrongBias ? 'PRO · STRONG BIAS ON' : 'STARTER · STRONG OFF'}
              </button>
              <button
                type="button"
                className="tv-lw-pill"
                style={{
                  width: '100%',
                  fontSize: 5,
                  padding: '0 3px',
                  marginBottom: 3,
                  borderColor: requireGoldEdge70 ? 'rgba(251,146,60,0.82)' : undefined,
                  color: requireGoldEdge70 ? '#fed7aa' : undefined,
                  background: requireGoldEdge70 ? 'rgba(154,52,18,0.52)' : undefined,
                }}
                onClick={() => setRequireGoldEdge70((v) => !v)}
                title="Gold-style floor (ITER-2 doc): flatten sim entries when EDGE est falls below 70"
              >
                {requireGoldEdge70 ? 'EDGE≥70 GATE ON' : 'EDGE GATE OFF'}
              </button>
              {simGoldUtc && (
                <div style={{ fontSize: 5, color: '#a7f3d0', fontFamily: 'monospace', marginBottom: 3, lineHeight: 1.35 }}>
                  GOLD UTC · {simGoldUtc.label} ({simGoldUtc.quality}) ×{simGoldUtc.mult.toFixed(2)}
                  <br />
                  EDGE est {goldEdgeEstimate ?? '—'} · SIM {simUtcClock}
                  <br />
                  DECISION STRONG {tradeObiResult?.biasStrong ? 'YES' : 'NO'}
                </div>
              )}
              <div style={{ fontSize: 5, color: algoSimDesired !== 'FLAT' ? '#4ade80' : '#93c5fd', fontFamily: 'monospace', marginBottom: 3 }}>
                SIM GATE {algoSimDesired !== 'FLAT' ? 'ACTIVE' : 'WAIT'} · {algoSimDesired} ·{' '}
                <span style={{ opacity: 0.85 }}>
                  raw {tradeDecision.allowed ? tradeDecision.dir : 'FLAT'} — {tradeDecision.reason}
                </span>
              </div>
              <div style={{ fontSize: 5, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 3 }}>
                idx {simIndex}/{Math.max(0, bars.length - 1)}
              </div>
              <div style={{ fontSize: 5, color: '#86efac', fontFamily: 'monospace', marginBottom: 3 }}>
                PAPER TRADES {paperTradesVisible.length}/{paperTradesAll.length}
              </div>
              <div style={{ fontSize: 5, color: '#fca5a5', fontFamily: 'monospace', marginBottom: 3 }}>
                DB TEST FIRES {simFireEvents.length}
              </div>
              <div style={{ fontSize: 5, color: simRunning ? '#4ade80' : '#f59e0b', fontFamily: 'monospace', marginBottom: 4 }}>
                {simRunning ? 'RUNNING' : 'PAUSED'}{simPrice !== null ? ` · ${fmtPrice(simPrice)}` : ''}
              </div>
              <label style={{ display: 'block', marginBottom: 4 }}>
                <div style={{ fontSize: 5, color: '#93c5fd', fontFamily: 'monospace', marginBottom: 1 }}>SPEED {simSpeed}x</div>
                <input
                  type="range"
                  min={1}
                  max={1000}
                  step={1}
                  value={simSpeed}
                  onChange={(e) => setSimSpeed(clamp(Number.parseInt(e.target.value, 10) || 10, 1, 1000))}
                  style={{ width: '100%' }}
                  aria-label="Simulation speed control panel"
                />
              </label>
              <label style={{ display: 'block', marginBottom: 4 }}>
                <div style={{ fontSize: 5, color: '#fbbf24', fontFamily: 'monospace', marginBottom: 1 }}>CANDLE SCALE {simCandleWindow} bars</div>
                <input
                  type="range"
                  min={80}
                  max={700}
                  step={10}
                  value={simCandleWindow}
                  onChange={(e) => setSimCandleWindow(clamp(Number.parseInt(e.target.value, 10) || 220, 80, 700))}
                  style={{ width: '100%' }}
                  aria-label="Simulation candle scale"
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                <button
                  type="button"
                  className="tv-lw-pill"
                  style={{
                    gridColumn: '1 / span 3',
                    fontSize: 5,
                    padding: '1px 4px',
                    borderColor: 'rgba(239,68,68,0.85)',
                    color: liveTradeArmed ? '#fee2e2' : '#fecaca',
                    background: liveTradeArmed ? 'rgba(153,27,27,0.92)' : 'rgba(69,10,10,0.72)',
                  }}
                  onClick={() => setLiveTradeArmed(v => !v)}
                  title="Standardized live trade profile"
                >
                  {liveTradeArmed ? 'LIVE TRADE ARMED' : 'LIVE TRADE'}
                </button>
                <button type="button" className="tv-lw-pill" style={{ fontSize: 5, padding: '0 3px' }} onClick={() => setSimRunning(v => !v)}>
                  {simRunning ? 'PAUSE' : 'PLAY'}
                </button>
                <button type="button" className="tv-lw-pill" style={{ fontSize: 5, padding: '0 3px' }} onClick={() => setSimProgress(p => Math.min(bars.length - 1, p + 1))}>
                  STEP
                </button>
                <button
                  type="button"
                  className="tv-lw-pill"
                  style={{ fontSize: 5, padding: '0 3px' }}
                  onClick={() => {
                    setSimSpeed(10)
                    const next = Math.min(Math.max(simCandleWindow, 80), Math.max(80, bars.length - 2))
                    setSimProgress(next)
                    setSimRunning(true)
                  }}
                >
                  RESET
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button type="button" className="tv-lw-pill tv-lw-pill--on" style={{ fontSize: 5, padding: '0 4px' }} onClick={() => setLayoutPanelOpen(true)}>
            LAYOUT
          </button>
        )}
      </div>

      {/* Stacked chart lanes (top live + bottom sim) */}
      <div ref={chartStackRef} style={{ display: 'grid', gridTemplateRows: `${mainRowPct}fr ${simRowPct}fr`, rowGap: 8, margin: '0 8px 8px', height: chartStackPx, maxHeight: chartStackPx }}>
      {/* Chart stage — flex row: chart left, OBI panel right */}
      <div style={{ display: 'flex', flexDirection: 'row', height: '100%', minHeight: 280, position: 'relative', zIndex: 2, overflow: 'hidden', isolation: 'isolate', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 4 }}>
        {/* Chart column */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div className="tv-lw-chart-overlay">
            <span className="tv-lw-overlay-sym">{sym}</span>
            {lastPrice !== null && <span className="tv-lw-overlay-price">{fmtPrice(lastPrice)}</span>}
            {priceChgPct !== null && <span className={`tv-lw-overlay-chg ${priceChgPct >= 0 ? 'pos' : 'neg'}`}>{priceChgPct >= 0 ? '+' : ''}{priceChgPct.toFixed(2)}%</span>}
            {obiBoomMinimal && <span className="tv-lw-overlay-heat" style={{ color: '#38bdf8', textShadow: '0 0 6px #38bdf8' }}>MIN</span>}
            <span
              style={{
                position: 'absolute',
                top: 34,
                right: obiVisible ? 220 : 24,
                fontSize: 8,
                fontFamily: 'monospace',
                letterSpacing: 0.7,
                color: '#f43f5e',
                textShadow: `0 0 ${8 + Math.round(liquidityGlow.total * 14)}px rgba(244,63,94,0.95)`,
                opacity: 0.8 + liquidityGlow.total * 0.2,
                pointerEvents: 'none',
              }}
              title="Liquidity glow fusion: Compression/Expansion · Liquidity Interaction · Aggression Spike · Structural Break"
            >
              LIQ GLOW {Math.round(liquidityGlow.total * 100)}% · C{Math.round(liquidityGlow.compressionExpansion * 100)} L{Math.round(liquidityGlow.liquidityInteraction * 100)} A{Math.round(liquidityGlow.aggressionSpike * 100)} S{Math.round(liquidityGlow.structuralBreak * 100)}
            </span>
            <span
              style={{
                position: 'absolute',
                top: 48,
                right: obiVisible ? 220 : 24,
                fontSize: 7,
                fontFamily: 'monospace',
                letterSpacing: 0.5,
                color: '#94a3b8',
                opacity: 0.8,
                pointerEvents: 'none',
              }}
              title="Energy inputs powering LIQ GLOW"
            >
              ENERGY INPUTS: COMPRESSION→EXPANSION · LIQUIDITY LEVEL INTERACTION · AGGRESSION SPIKE · STRUCTURAL BREAK
            </span>
            {obiResult && obiResult.targets.length > 0 && obiResult.dir !== 'NEUTRAL' && (() => {
              const t1 = obiResult.targets[0]!
              const cur = obiResult.entry
              const fmt = (p: number) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 1 }) : p < 10 ? p.toFixed(5) : p.toFixed(2)
              const isAbove = t1.price > cur
              const c = isAbove ? '#4ade80' : '#f43f5e'
              return (
                <span style={{
                  position: 'absolute', top: 64, right: obiVisible ? 260 : 64,
                  fontSize: 9, fontFamily: 'monospace', fontWeight: 800,
                  background: 'rgba(2,6,12,0.55)', padding: '1px 5px', borderRadius: 3,
                  color: c, textShadow: `0 0 8px ${c}`, letterSpacing: 1, pointerEvents: 'none',
                }}>
                  {isAbove ? '▲' : '▼'} T1 {fmt(t1.price)}
                </span>
              )
            })()}
          </div>
          {loading && <p className="muted">Loading…</p>}
          {!loading && bars.length > 0 && mainChartRenderKey && (
            <BoomLwChart
              key={mainChartRenderKey}
              bars={bars}
              controls={controls}
              fitContainer
              compactUi
              symbol={sym}
              obiConfirmTargets
              heatTargets={chartLtHeatTargets}
              tradeMarkers={simTradeMarkers}
              ltViz={{
                actionGlowGain: ltViz.glowGain,
                showActionBubbles: ltViz.bubbles,
                bubbleThreshold: 1,
                obPressure: obPressure.pressure,
                obConfidence: obPressure.confidence,
                lt2PriceBins: ltViz.lt2PriceBins,
                lt2TimeBins: ltViz.lt2TimeBins,
                lt2OpacityGain: ltViz.lt2OpacityGain,
                lt3MiniArrowGain: ltViz.lt3MiniArrowGain,
                lt3MainArrowGain: ltViz.lt3MainArrowGain,
              }}
            />
          )}
          <div style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            width: ltPanelOpen ? 188 : 112,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(4,10,18,0.22)',
            backdropFilter: 'blur(2px)',
            borderRadius: 4,
            padding: '5px 7px',
            zIndex: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ltPanelOpen ? 4 : 0 }}>
              <div style={{ fontSize: 8, color: '#22d3ee', fontFamily: 'monospace', letterSpacing: 1 }}>
                LT CONTEXT
              </div>
              <button
                type="button"
                className="tv-lw-pill"
                style={{ fontSize: 8, padding: '1px 6px' }}
                onClick={() => setLtPanelOpen((v) => !v)}
                title={ltPanelOpen ? 'Collapse LT panel' : 'Expand LT panel'}
              >
                {ltPanelOpen ? 'HIDE' : 'SHOW'}
              </button>
            </div>
            {ltPanelOpen ? (
              <>
                <div style={{ fontSize: 8, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 6 }}>
                  LT2 context menu
                </div>
                <label style={{ display: 'block', marginBottom: 6 }}>
                  <div style={{ fontSize: 8, color: '#e2e8f0', fontFamily: 'monospace', marginBottom: 2 }}>
                    Pressure {ltViz.glowGain.toFixed(2)}x
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={2.5}
                    step={0.05}
                    value={ltViz.glowGain}
                    onChange={(e) => setLtViz((s) => ({ ...s, glowGain: Number.parseFloat(e.target.value) || 1 }))}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 6 }}>
                  <div style={{ fontSize: 8, color: '#e2e8f0', fontFamily: 'monospace', marginBottom: 2 }}>
                    LT2 Price Bins {ltViz.lt2PriceBins}
                  </div>
                  <input
                    type="range"
                    min={12}
                    max={72}
                    step={1}
                    value={ltViz.lt2PriceBins}
                    onChange={(e) => setLtViz((s) => ({ ...s, lt2PriceBins: Number.parseInt(e.target.value, 10) || 31 }))}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 6 }}>
                  <div style={{ fontSize: 8, color: '#e2e8f0', fontFamily: 'monospace', marginBottom: 2 }}>
                    LT2 Time Bins {ltViz.lt2TimeBins}
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={32}
                    step={1}
                    value={ltViz.lt2TimeBins}
                    onChange={(e) => setLtViz((s) => ({ ...s, lt2TimeBins: Number.parseInt(e.target.value, 10) || 12 }))}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 6 }}>
                  <div style={{ fontSize: 8, color: '#e2e8f0', fontFamily: 'monospace', marginBottom: 2 }}>
                    LT2 Opacity {ltViz.lt2OpacityGain.toFixed(2)}x
                  </div>
                  <input
                    type="range"
                    min={0.35}
                    max={2.5}
                    step={0.05}
                    value={ltViz.lt2OpacityGain}
                    onChange={(e) => setLtViz((s) => ({ ...s, lt2OpacityGain: Number.parseFloat(e.target.value) || 1 }))}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 6 }}>
                  <div style={{ fontSize: 8, color: '#e2e8f0', fontFamily: 'monospace', marginBottom: 2 }}>
                    LT3 Mini Arrows {ltViz.lt3MiniArrowGain.toFixed(2)}x
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.5}
                    step={0.05}
                    value={ltViz.lt3MiniArrowGain}
                    onChange={(e) => setLtViz((s) => ({ ...s, lt3MiniArrowGain: Number.parseFloat(e.target.value) || 1 }))}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 6 }}>
                  <div style={{ fontSize: 8, color: '#e2e8f0', fontFamily: 'monospace', marginBottom: 2 }}>
                    LT3 Main Arrow {ltViz.lt3MainArrowGain.toFixed(2)}x
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={3.0}
                    step={0.05}
                    value={ltViz.lt3MainArrowGain}
                    onChange={(e) => setLtViz((s) => ({ ...s, lt3MainArrowGain: Number.parseFloat(e.target.value) || 1.2 }))}
                    style={{ width: '100%' }}
                  />
                </label>
                <div style={{ marginTop: 6, fontSize: 8, color: '#94a3b8', fontFamily: 'monospace' }}>
                  OB {obPressure.status.toUpperCase()} {obPressure.pressure >= 0 ? 'UP' : 'DN'} {(Math.abs(obPressure.pressure) * 100).toFixed(0)}%
                </div>
                <button
                  type="button"
                  className="tv-lw-pill"
                  style={{ marginTop: 6, fontSize: 8, padding: '1px 8px' }}
                  onClick={() => setLtViz(LT_VIZ_DEFAULTS)}
                  title="Reset LT controls to defaults"
                >
                  RESET
                </button>
              </>
            ) : (
              <div style={{ fontSize: 8, color: '#94a3b8', fontFamily: 'monospace', marginTop: 3 }}>
                LT2 {ltViz.lt2PriceBins}/{ltViz.lt2TimeBins} · A {ltViz.lt3MainArrowGain.toFixed(2)}x
              </div>
            )}
          </div>
          {!loading && obiResult && <ObiDirectionArrow obi={obiResult} rightOffset={obiVisible ? 266 : 70} />}
        </div>
        {/* OBI panel — fixed width, full height */}
        {obiVisible && obiResult && obiJediGate && (
          <ObiPanel
            obi={obiResult}
            gate={obiJediGate}
            walls={liquidityWalls}
            pdZone={dsWalls?.pd_zone ?? null}
          />
        )}
      </div>

      {/* Simulation chart stage (below primary OBI chart) */}
      <div style={{ border: '1px solid rgba(251,191,36,0.18)', background: 'rgba(3,8,16,0.86)', borderRadius: 4, minHeight: 220, height: '100%', position: 'relative', zIndex: 1, overflow: 'hidden', isolation: 'isolate' }}>
        <div style={{ height: '100%' }}>
          {!loading && simBars.length > 0 && simChartKey && (
            <BoomLwChart
              key={simChartKey}
              bars={simBars}
              controls={controls}
              fitContainer
              compactUi
              symbol={sym}
              obiConfirmTargets
              heatTargets={[...chartLtHeatTargets, ...simLiveTradeTargets]}
              tradeMarkers={simTradeMarkersOnSimChart}
              ltViz={{
                actionGlowGain: ltViz.glowGain,
                showActionBubbles: ltViz.bubbles,
                bubbleThreshold: 1,
                obPressure: obPressure.pressure,
                obConfidence: obPressure.confidence,
                lt2PriceBins: ltViz.lt2PriceBins,
                lt2TimeBins: ltViz.lt2TimeBins,
                lt2OpacityGain: ltViz.lt2OpacityGain,
                lt3MiniArrowGain: ltViz.lt3MiniArrowGain,
                lt3MainArrowGain: ltViz.lt3MainArrowGain,
              }}
            />
          )}
        </div>
      </div>
      </div>

      {/* Bottom panels: council strip + replay stats (page chrome — no chart edits) */}
      <div style={{ margin: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{
          border: '1px solid rgba(58,143,255,0.24)',
          background: 'rgba(3,8,16,0.94)',
          borderRadius: 4,
          padding: '5px 8px',
          display: 'grid',
          gridTemplateColumns: '190px 1fr 1fr 190px',
          gap: 8,
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#38bdf8', letterSpacing: 1 }}>COUNCIL CONFLUENCE</span>
            <span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: councilConfluence.score >= 70 ? '#4ade80' : councilConfluence.score >= 50 ? '#fbbf24' : '#f43f5e' }}>
              {councilConfluence.score}
            </span>
            <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#64748b' }}>/100</span>
          </div>

          <div style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: 8, fontFamily: 'monospace', color: '#94a3b8' }}>
            FACTORS: {councilConfluence.factors.map(f => `${f.k}:${f.pass ? '✓' : '○'} ${f.note}`).join(' · ')}
          </div>

          <div style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: 8, fontFamily: 'monospace', color: '#fbbf24' }}>
            ITER-OPT NEXT: {councilConfluence.iterOpt[0] ?? '—'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 8, color: '#64748b', fontFamily: 'monospace' }}>CTX TICKER</span>
            <select
              value={sym}
              onChange={(e) => { void selectTicker(e.target.value) }}
              style={{
                height: 20,
                background: 'rgba(15,23,42,0.9)',
                border: '1px solid rgba(148,163,184,0.3)',
                color: '#cbd5e1',
                fontSize: 8,
                fontFamily: 'monospace',
                padding: '0 4px',
              }}
            >
              {[sym, ...TOP_STOCKS.filter(s => s !== sym)].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{
          border: '1px solid rgba(34,197,94,0.22)',
          background: 'rgba(3,16,12,0.92)',
          borderRadius: 4,
          padding: '6px 8px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 10,
          alignItems: 'start',
          fontSize: 8,
          fontFamily: 'monospace',
          color: '#94a3b8',
        }}>
          <div style={{ color: '#a7f3d0' }}>
            <span style={{ color: '#6ee7b7', letterSpacing: 0.6 }}>GOLD ENVELOPE · SIM BAR</span>
            <div style={{ marginTop: 3 }}>
              {simGoldUtc ? `${simGoldUtc.label} · tier ${simGoldUtc.quality} · ×${simGoldUtc.mult.toFixed(2)}` : '—'}
            </div>
            <div style={{ marginTop: 2 }}>EDGE est {goldEdgeEstimate ?? '—'} · clock {simUtcClock}</div>
            <div style={{ marginTop: 2 }}>
              ICT KZ {tradeIctBrain?.killzone ?? '—'} · PRO {proStrongBiasActive ? 'ON' : allModesActive ? 'BYPASS' : 'OFF'} · EDGE {edge70GateActive ? '≥70' : allModesActive ? 'BYPASS' : 'OFF'}
            </div>
          </div>
          <div style={{ color: '#fde68a' }}>
            <span style={{ color: '#fcd34d', letterSpacing: 0.6 }}>EMA REPLAY STATS</span>
            <div style={{ marginTop: 3 }}>
              {replayPaperStats
                ? `Closed ${replayPaperStats.n} · WR ${replayPaperStats.wr}% · PF ${replayPaperStats.pf >= 99 ? '∞' : replayPaperStats.pf.toFixed(2)} · NET ${replayPaperStats.netPct >= 0 ? '+' : ''}${replayPaperStats.netPct.toFixed(2)}%`
                : 'No closed trades in replay window'}
            </div>
          </div>
          <div style={{ color: '#bae6fd', textAlign: 'right' }}>
            <span style={{ color: '#38bdf8', letterSpacing: 0.6 }}>SIM CONTEXT</span>
            <div style={{ marginTop: 3 }}>idx {simIndex}/{Math.max(0, bars.length - 1)}</div>
            <div style={{ marginTop: 2 }}>fires {simFireEvents.length} · mode {tradeMode}</div>
            {allModesActive && (
              <div style={{ marginTop: 4, textAlign: 'left', fontSize: 7, color: '#86efac', lineHeight: 1.35 }}>
                {simModeLeaderboard.map((r) => `${r.mode === 'JEDI_MASTER' ? 'MASTER' : r.mode}:${r.retPctOn10k >= 0 ? '+' : ''}${r.retPctOn10k.toFixed(2)}% n${r.closedCount}`).join(' · ')}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            border: '1px solid rgba(129,140,248,0.35)',
            background: 'rgba(15,23,42,0.96)',
            borderRadius: 4,
            padding: '8px 10px',
            fontSize: 8,
            fontFamily: 'monospace',
            color: '#cbd5e1',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: '#a5b4fc', letterSpacing: 1, fontSize: 9 }}>SIM ALGO REPLAY · ICTSMC (signal in / out)</span>
              <span style={{ color: '#94a3b8' }}>same gate as chart marks + optional EDGE≥70</span>
            </div>
            <div style={{ color: '#94a3b8', fontSize: 7, lineHeight: 1.35, maxWidth: 720 }}>
              Not live trading: no orders, no broker, no real money. Sim replays the same OHLCV array as the chart from <code>fetchBarsForSymbol</code> (Polygon / Binance / in-app cache) — not an order or SQL trade log. Current baseline exits at bar close on gate flip/flat.
            </div>
            <div style={{ color: '#fca5a5', fontSize: 7, lineHeight: 1.35, maxWidth: 720 }}>
              Exit-policy note: CIS-style early flip exits are flagged for replacement. Target model should prioritize liquidity targets, 13 EMA safety, and optimized trailing ATR / anchored VWAP exits (quant optimization pending).
            </div>
            <div style={{ color: '#64748b', fontSize: 7, lineHeight: 1.35, maxWidth: 720 }}>
              ITER-2 HMM / macro regime routing is not in this sim; gates here are the on-chart stack (council, ICT slice, KZ, optional EDGE). Any regime is a design goal for the full system, not proven by this panel alone.
            </div>
          </div>
          <div
            style={{
              border: '1px solid rgba(52,211,153,0.32)',
              borderRadius: 4,
              padding: 6,
              marginBottom: 8,
              background: 'rgba(6,40,32,0.28)',
            }}
          >
            <div style={{ color: '#6ee7b7', fontSize: 8, marginBottom: 3, letterSpacing: 0.5 }}>PAPER $10K SIM (compound per closed leg, mark includes open uPnL)</div>
            <div style={{ color: '#e2e8f0', fontSize: 8, lineHeight: 1.5 }}>
              {fmtUsd(simAlgoTape.equityStart)} → <strong style={{ color: simAlgoTape.equityMark >= simAlgoTape.equityStart ? '#86efac' : '#fecaca' }}>{fmtUsd(simAlgoTape.equityMark)}</strong>
              {' · '}
              Δ {simAlgoTape.dollarPnlNet >= 0 ? '+' : ''}
              {fmtUsd(simAlgoTape.dollarPnlNet)} ({simAlgoTape.retPctOn10k >= 0 ? '+' : ''}
              {simAlgoTape.retPctOn10k.toFixed(2)}% on notional)
            </div>
            {simAlgoTape.openLeg && simAlgoTape.unrealPnLPct !== null ? (
              <div style={{ color: '#94a3b8', fontSize: 7, marginTop: 4 }}>
                Settled after closes only: {fmtUsd(simAlgoTape.equityAfterClosed)} · then open uPnL {simAlgoTape.unrealPnLPct >= 0 ? '+' : ''}
                {simAlgoTape.unrealPnLPct.toFixed(2)}% on that balance → mark above
              </div>
            ) : null}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 10, marginBottom: 8 }}>
            <div style={{ border: '1px solid rgba(56,189,248,0.25)', borderRadius: 4, padding: 6 }}>
              <div style={{ color: '#38bdf8', marginBottom: 4 }}>OPEN (UNREAL)</div>
              {simAlgoTape.openLeg ? (
                <div style={{ lineHeight: 1.45 }}>
                  {simAlgoTape.openLeg.side} @ {fmtPrice(simAlgoTape.openLeg.entryPx)} · edge {simAlgoTape.openLeg.edgeEntry ?? '—'} ·{' '}
                  {goldSessionUtc(simAlgoTape.openLeg.entryTime).label}
                  <br />
                  <span style={{ color: simAlgoTape.unrealPnLPct !== null && simAlgoTape.unrealPnLPct >= 0 ? '#4ade80' : '#f87171' }}>
                    uPnL {simAlgoTape.unrealPnLPct !== null ? `${simAlgoTape.unrealPnLPct >= 0 ? '+' : ''}${simAlgoTape.unrealPnLPct.toFixed(2)}%` : '—'}
                  </span>
                </div>
              ) : (
                <div style={{ color: '#64748b' }}>Flat — waiting for gated entry</div>
              )}
            </div>
            <div style={{ border: '1px solid rgba(167,139,250,0.28)', borderRadius: 4, padding: 6 }}>
              <div style={{ color: '#c4b5fd', marginBottom: 4 }}>CLOSED (paper PnL)</div>
              <div style={{ lineHeight: 1.45, color: '#e2e8f0' }}>
                n {simAlgoTape.closedCount} · W {simAlgoTape.wins} · L {simAlgoTape.losses}
                {simAlgoTape.notInPlayCount > 0 && <span style={{ color: '#fbbf24' }}> · NIP {simAlgoTape.notInPlayCount}</span>}
                {' '}· PF {simAlgoTape.pf >= 99 ? '∞' : simAlgoTape.pf.toFixed(2)} · NET {simAlgoTape.netPct >= 0 ? '+' : ''}
                {simAlgoTape.netPct.toFixed(2)}%
              </div>
            </div>
          </div>
          <div style={{ color: '#64748b', fontSize: 7, marginBottom: 4 }}>
            Exits are on strategy flat/flip (not hard stop). ITER-2: L2 killzone lift; L4 OB-only as confirm (use entry validation, not hard filter).
          </div>
          <div style={{ maxHeight: 140, overflow: 'auto', border: '1px solid rgba(51,65,85,0.6)', borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 7 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#94a3b8', borderBottom: '1px solid rgba(51,65,85,0.8)' }}>
                  <th style={{ padding: '4px 6px' }}>#</th>
                  <th style={{ padding: '4px 6px' }}>side</th>
                  <th style={{ padding: '4px 6px' }}>entry</th>
                  <th style={{ padding: '4px 6px' }}>exit</th>
                  <th style={{ padding: '4px 6px' }}>PnL%</th>
                  <th style={{ padding: '4px 6px' }}>bars</th>
                  <th style={{ padding: '4px 6px' }}>why</th>
                  <th style={{ padding: '4px 6px' }}>sess</th>
                </tr>
              </thead>
              <tbody>
                {simAlgoTape.closed
                  .slice(-18)
                  .reverse()
                  .map((t) => {
                    const nipRow = t.exitReason === 'NOT_IN_PLAY' || t.exitReason === 'GAP_STOP'
                    return (
                    <tr
                      key={t.id}
                      style={{
                        borderBottom: '1px solid rgba(30,41,59,0.7)',
                        color: nipRow ? '#fbbf24' : t.pnlPct >= 0 ? '#bbf7d0' : '#fecaca',
                        opacity: nipRow ? 0.7 : 1,
                      }}
                    >
                      <td style={{ padding: '3px 6px' }}>{t.id}</td>
                      <td style={{ padding: '3px 6px' }}>{t.side}</td>
                      <td style={{ padding: '3px 6px' }}>
                        {new Date(t.entryTime * 1000).toISOString().slice(11, 16)}z
                      </td>
                      <td style={{ padding: '3px 6px' }}>
                        {new Date(t.exitTime * 1000).toISOString().slice(11, 16)}z
                      </td>
                      <td style={{ padding: '3px 6px' }}>{t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%</td>
                      <td style={{ padding: '3px 6px' }}>{t.holdBars}</td>
                      <td style={{ padding: '3px 6px', fontSize: 6, letterSpacing: 0.5 }}>{t.exitReason}</td>
                      <td style={{ padding: '3px 6px' }}>{t.sessionUtcLabel}</td>
                    </tr>
                    )
                  })}
                {simAlgoTape.closed.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 8, color: '#64748b' }}>
                      No closed sim legs yet — roll replay past bar 50+ to populate.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
