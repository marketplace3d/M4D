import type { Bar } from '../../../indicators/boom3d-tech';
import type { LiquidityThermalResult } from './liquidityThermal';
import type { PriceTargetRow, TargetBucket } from './computePriceTargets';

export type ObiLineDensity = 3 | 7 | 'multi'
export type ObiLineSpread = 'normal' | 'wide'

export type ObiLineOpts = { show: boolean; density: ObiLineDensity; spread: ObiLineSpread }

export type HeatTargetLite = { price: number; tier: string }

/** Min gap between lines: ATR fraction (ICT-style magnets, not micro-structure). */
const SPREAD_MIN_ATR: Record<ObiLineSpread, number> = {
  normal: 0.62,
  wide: 1.15,
}
/** Also enforce a %-of-price floor so tight ATR regimes still space lines. */
const SPREAD_MIN_PRICE_FRAC: Record<ObiLineSpread, number> = {
  normal: 0.0015,
  wide: 0.0026,
}

const CAP_BY_DENSITY: Record<ObiLineDensity, number> = {
  3: 3,
  7: 4,
  multi: 4,
}

const BUCKET_ICT_BOOST: Record<TargetBucket, number> = {
  ob: 32,
  sess: 24,
  vp: 12,
  liq: 4,
}

function atrWilder14(bars: Bar[]): number {
  if (bars.length < 2) return 0
  const n = 14
  let prevC = bars[0]!.close
  const tr: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - prevC), Math.abs(b.low - prevC)))
    prevC = b.close
  }
  if (tr.length < n) return tr.reduce((a, x) => a + x, 0) / tr.length
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n
  for (let i = n; i < tr.length; i++) a += (tr[i]! - a) / n
  return a
}

function ltR1FromLt(lt: LiquidityThermalResult, lastClose: number): number | null {
  if (lt.hvnsAbove[0] != null) return lt.hvnsAbove[0]!
  const { levels, volBins, pocIdx, rangeHigh } = lt
  if (levels.length < 2) {
    if (rangeHigh > lastClose) return rangeHigh
    return null
  }
  const step = levels[1]! - levels[0]!
  let bestI = -1
  let bestV = 0
  for (let i = 0; i < volBins.length; i++) {
    if (i === pocIdx) continue
    const mid = levels[i]! + step / 2
    if (mid <= lastClose) continue
    const v = volBins[i]!
    if (v > bestV) {
      bestV = v
      bestI = i
    }
  }
  if (bestI >= 0) return levels[bestI]! + step / 2
  if (rangeHigh > lastClose) return rangeHigh
  return null
}

function ltS1FromLt(lt: LiquidityThermalResult, lastClose: number): number | null {
  if (lt.hvnsBelow[0] != null) return lt.hvnsBelow[0]!
  const { levels, volBins, pocIdx, rangeLow } = lt
  if (levels.length < 2) {
    if (rangeLow < lastClose) return rangeLow
    return null
  }
  const step = levels[1]! - levels[0]!
  let bestI = -1
  let bestV = 0
  for (let i = 0; i < volBins.length; i++) {
    if (i === pocIdx) continue
    const mid = levels[i]! + step / 2
    if (mid >= lastClose) continue
    const v = volBins[i]!
    if (v > bestV) {
      bestV = v
      bestI = i
    }
  }
  if (bestI >= 0) return levels[bestI]! + step / 2
  if (rangeLow < lastClose) return rangeLow
  return null
}

function tierForRow(t: PriceTargetRow): string {
  return t.label.length > 14 ? `${t.label.slice(0, 12)}…` : t.label
}

function rowIctScore(t: PriceTargetRow): number {
  return t.rating + BUCKET_ICT_BOOST[t.bucket]
}

/**
 * Farther-from-price first, then cap — favors a few real objectives, not a band of noise.
 */
function pickSpacedRungs(
  cands: HeatTargetLite[],
  minDist: number,
  cap: number,
  last: number,
): HeatTargetLite[] {
  if (cands.length === 0) return []
  const sorted = [...cands]
    .filter((c) => Number.isFinite(c.price))
    .sort((a, b) => Math.abs(b.price - last) - Math.abs(a.price - last))
  const out: HeatTargetLite[] = []
  for (const c of sorted) {
    if (out.length >= cap) break
    if (out.some((x) => Math.abs(x.price - c.price) < minDist)) continue
    out.push(c)
  }
  return out.sort((a, b) => a.price - b.price)
}

/** 3-bar fractal pivots, only after confirmation (not the last few bars). */
function fractalSwingLevels(bars: Bar[], lastC: number, atr: number): HeatTargetLite[] {
  const n = bars.length
  if (n < 22 || atr <= 0) return []
  const minAway = Math.max(atr * 0.55, lastC * SPREAD_MIN_PRICE_FRAC.normal)
  const out: HeatTargetLite[] = []
  for (let i = 3; i < n - 6; i++) {
    const h = bars[i]!.high
    const l = bars[i]!.low
    let isPH = true
    let isPL = true
    for (let w = 1; w <= 3; w++) {
      if (bars[i - w]!.high >= h || bars[i + w]!.high >= h) isPH = false
      if (bars[i - w]!.low <= l || bars[i + w]!.low <= l) isPL = false
    }
    const barsAgo = n - 1 - i
    if (barsAgo < 10) continue
    if (isPH && h > lastC + minAway * 0.2) out.push({ price: h, tier: 'SW·H' })
    if (isPL && l < lastC - minAway * 0.2) out.push({ price: l, tier: 'SW·L' })
  }
  return out
}

function swingScore(price: number, lastC: number, atr: number): number {
  const d = Math.abs(price - lastC) / Math.max(atr, 1e-9)
  return 46 + Math.min(28, d * 5)
}

type Scored = { price: number; tier: string; score: number }

function greedyByScore(scored: Scored[], minDist: number, cap: number): HeatTargetLite[] {
  const sorted = [...scored].filter((s) => Number.isFinite(s.price)).sort((a, b) => b.score - a.score)
  const out: HeatTargetLite[] = []
  for (const s of sorted) {
    if (out.length >= cap) break
    if (out.some((x) => Math.abs(x.price - s.price) < minDist)) continue
    out.push({ price: s.price, tier: s.tier })
  }
  return out.sort((a, b) => a.price - b.price)
}

function buildMultiIct(
  bars: Bar[],
  lt: LiquidityThermalResult,
  targetRows: PriceTargetRow[],
  lastC: number,
  atr: number,
  minDist: number,
  cap: number,
): HeatTargetLite[] {
  const scored: Scored[] = []

  for (const t of targetRows) {
    scored.push({ price: t.price, tier: tierForRow(t), score: rowIctScore(t) })
  }

  for (const sw of fractalSwingLevels(bars, lastC, atr)) {
    scored.push({ price: sw.price, tier: sw.tier, score: swingScore(sw.price, lastC, atr) })
  }

  // One structural anchor from LT if nothing else filled the chart (bias OB/sess already in rows).
  const hasNearPoc = scored.some((s) => Math.abs(s.price - lt.poc) < minDist * 0.85)
  if (!hasNearPoc) {
    scored.push({ price: lt.poc, tier: 'LT·POC', score: 72 })
  }

  return greedyByScore(scored, minDist, cap)
}

function buildLtOnlyFallback(
  lt: LiquidityThermalResult,
  lastC: number,
  atr: number,
  minDist: number,
  cap: number,
  mode: 'sparse3' | 'sparse7',
): HeatTargetLite[] {
  const nearEps = Math.max(lastC * 2e-5, atr * 0.07, 1e-9)
  const raw: HeatTargetLite[] = [{ price: lt.poc, tier: 'POC' }]
  if (lt.rangeHigh > lastC + nearEps) raw.push({ price: lt.rangeHigh, tier: 'RgH' })
  if (lt.rangeLow < lastC - nearEps) raw.push({ price: lt.rangeLow, tier: 'RgL' })
  const r1 = ltR1FromLt(lt, lastC)
  if (r1 != null && Math.abs(r1 - lt.poc) > nearEps) raw.push({ price: r1, tier: 'R1' })
  const s1 = ltS1FromLt(lt, lastC)
  if (s1 != null && Math.abs(s1 - lt.poc) > nearEps && (r1 == null || Math.abs(s1 - r1) > nearEps)) {
    raw.push({ price: s1, tier: 'S1' })
  }
  if (mode === 'sparse7') {
    lt.hvnsAbove.slice(0, 2).forEach((p, i) => raw.push({ price: p, tier: `R${i + 1}` }))
    lt.hvnsBelow.slice(0, 2).forEach((p, i) => raw.push({ price: p, tier: `S${i + 1}` }))
  }
  return pickSpacedRungs(raw, minDist, cap, lastC)
}

/**
 * LINES: few spaced magnets — OB / session / VP / swings / LT, not a tight ATR cluster.
 */
export function buildObiChartHeatTargets(
  bars: Bar[],
  lt: LiquidityThermalResult | null,
  targetRows: PriceTargetRow[],
  packAtr: number,
  opts: ObiLineOpts,
): HeatTargetLite[] {
  if (!opts.show || !lt || bars.length === 0) return []
  const lastC = bars[bars.length - 1]!.close
  const atr = packAtr > 0 ? packAtr : atrWilder14(bars)
  const minDist = Math.max(
    1e-9,
    lastC * SPREAD_MIN_PRICE_FRAC[opts.spread],
    atr * SPREAD_MIN_ATR[opts.spread],
  )
  const cap = CAP_BY_DENSITY[opts.density]
  const nearEps = Math.max(lastC * 2e-5, atr * 0.07, 1e-9)

  if (opts.density === 'multi') {
    if (targetRows.length > 0) {
      return buildMultiIct(bars, lt, targetRows, lastC, atr, minDist, cap)
    }
    return buildLtOnlyFallback(lt, lastC, atr, minDist, cap, 'sparse7')
  }

  if (opts.density === 3) {
    const raw: HeatTargetLite[] = [{ price: lt.poc, tier: 'POC' }]
    const r1 = ltR1FromLt(lt, lastC)
    if (r1 != null && Math.abs(r1 - lt.poc) > nearEps) raw.push({ price: r1, tier: 'R1' })
    const s1 = ltS1FromLt(lt, lastC)
    if (s1 != null && Math.abs(s1 - lt.poc) > nearEps && (r1 == null || Math.abs(s1 - r1) > nearEps)) {
      raw.push({ price: s1, tier: 'S1' })
    }
    return pickSpacedRungs(raw, minDist, Math.min(3, cap), lastC)
  }

  // 7 → at most 4 LT-based rungs, widely spaced
  const raw: HeatTargetLite[] = [{ price: lt.poc, tier: 'POC' }]
  lt.hvnsAbove.slice(0, 3).forEach((p, i) => raw.push({ price: p, tier: `R${i + 1}` }))
  lt.hvnsBelow.slice(0, 3).forEach((p, i) => raw.push({ price: p, tier: `S${i + 1}` }))
  return pickSpacedRungs(raw, minDist, cap, lastC)
}
