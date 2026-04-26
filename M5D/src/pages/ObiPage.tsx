import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCouncil, usePoll } from '../api/client';
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
      position: 'absolute', bottom: 48, right: rightOffset, zIndex: 12,
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
  const [obiVisible, setObiVisible] = useState(true)
  const [obiChartLines, setObiChartLines] = useState<ObiChartLines>(() => loadObiChartLines())
  const [showObiTargets, setShowObiTargets] = useState(true)  // ◎ ranked T1–T4 lines on chart
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
  // MIN is a one-shot preset — no interception of other controls
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
      setObiBoomMinimalPatch(false)   // MIN locks the chart — ICT knock-on always clears it
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
  const chartKey = bars.length > 0 ? `${sym}-${tf}-${bars[0]!.time}-${bars[bars.length-1]!.time}-${bars.length}` : ''
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
      return {
        ...line,
        opacity: Math.min(0.95, line.opacity + boost * 0.38),
        lineWidth: Math.min(3, line.lineWidth + (boost >= 0.4 ? 1 : 0)),
      }
    })
  }, [bars, lt, targetPack.targets, targetPack.atr, obiChartLines, showObiTargets, obiResult, liquidityWalls, ictLevels, dsWalls, liquidityGlow.total])


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
            <button type="button" className={ictModeOn ? 'tv-lw-pill tv-lw-pill--on' : 'tv-lw-pill'} onClick={toggleIctMaster} title="ICT: turns on OB·FVG·VP·LT·VWAP·SWG·SESS — knocks on, doesn't lock. Each still toggles independently.">ICT</button>
          </div>
          {/* ICT-7: the 7 structural layers — ICT master lights all of these */}
          <div className="tv-lw-masters-seg tv-lw-masters-seg--ict" role="group" aria-label="ICT structural layers" style={{ gap: 2 }}>
            {([
              ['showOrderBlocks','OB','Order blocks'],
              ['showFvg','FVG','Fair value gaps'],
              ['showPoc','VP','Volume profile'],
              ['showLt','LT','Liquidity thermal heatmap'],
              ['showVwap','VWAP','VWAP ±1σ/2σ'],
              ['showSwingRays','SWG','Swing rays'],
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
                if (next) persist({ ...controls, showBB: false, showKC: false, showSqueeze: false, squeezePurpleBg: false, showSar: false, showDarvas: false, showCouncilArrows: false, showVoteDots: false, showLt: false, showOrderBlocks: false, showFvg: false, showPoc: false, showVwap: false, showSwingRays: false, showSessionLevels: false, showIchimoku: false, showMas: false })
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
            {obiBoomMinimal && <span className="tv-lw-overlay-heat" style={{ color: '#38bdf8', textShadow: '0 0 6px #38bdf8' }}>MIN</span>}
            <span
              style={{
                position: 'absolute',
                top: 6,
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
                top: 20,
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
                  position: 'absolute', [isAbove ? 'top' : 'bottom']: 6, right: obiVisible ? 220 : 24,
                  fontSize: 9, fontFamily: 'monospace', fontWeight: 800,
                  color: c, textShadow: `0 0 8px ${c}`, letterSpacing: 1, pointerEvents: 'none',
                }}>
                  {isAbove ? '▲' : '▼'} T1 {fmt(t1.price)}
                </span>
              )
            })()}
          </div>
          {loading && <p className="muted">Loading…</p>}
          {!loading && bars.length > 0 && chartKey && (
            <BoomLwChart
              key={chartKey}
              bars={bars}
              controls={controls}
              symbol={sym}
              obiConfirmTargets
              heatTargets={chartLtHeatTargets}
            />
          )}
          {!loading && obiResult && <ObiDirectionArrow obi={obiResult} rightOffset={obiVisible ? 216 : 20} />}
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

      {/* Bottom tight info panel: council confluence + ticker context */}
      <div style={{
        margin: '0 8px 8px',
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
    </div>
  )
}
