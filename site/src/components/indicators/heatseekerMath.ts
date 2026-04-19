/**
 * HeatSeeker v2 — Composite Score Engine
 * Ported from APP-DOC/HEATSEEKER-V2/HeatSeekerV2.tsx
 * Uses Bar[] from indicatorMath.ts
 */
import { ema, sma } from './indicatorMath'
import type { Bar } from './indicatorMath'

export interface HeatConfig {
  atrLen: number
  emaFast: number
  emaSlow: number
  stFactor: number
  stLen: number
  tgtMult: number
  extMult: number
  stopMult: number
  adxMin: number
  rvolMin: number
  minScore: number
  cvdLen: number
  vwapDev: number
  imbRatioThresh: number
  hurstLen: number
  volPctLen: number
  idrStd: number
  orBars: number
}

export const DEFAULT_CFG: HeatConfig = {
  atrLen: 14, emaFast: 21, emaSlow: 55,
  stFactor: 3.0, stLen: 10,
  tgtMult: 1.5, extMult: 3.0, stopMult: 1.0,
  adxMin: 20, rvolMin: 1.2, minScore: 40,
  cvdLen: 10, vwapDev: 2.0, imbRatioThresh: 1.5,
  hurstLen: 100, volPctLen: 20, idrStd: 1.0, orBars: 12,
}

export type TargetHeat = 'FIRE' | 'GAS' | 'CALM'

export interface HeatState {
  direction: 'BULL' | 'BEAR' | 'NEUTRAL'
  composite: number
  score: number       // alias for composite, capped 0–90
  targetHeat: TargetHeat
  energyPts: number
  confPts: number
  bullVotes: number
  bearVotes: number
  dirBiasRaw: number
  entry: number
  tgt1: number
  tgt2: number
  stop: number
  rrRatio: number
  atr: number
  // context
  rsi: number
  rvol: number
  adxVal: number
  macdHist: number
  superTrendDir: 'BULL' | 'BEAR'
  vwap: number
  // individual signal votes for the signal rail
  signals: Array<{ id: string; label: string; dir: 'bull' | 'bear' | 'neutral' }>
}

// ── Private math ──────────────────────────────────────────────────────────────

function atrArr(bars: Bar[], len: number): number[] {
  const n = bars.length
  const tr = new Array<number>(n)
  tr[0] = bars[0]!.high - bars[0]!.low
  for (let i = 1; i < n; i++) {
    const b = bars[i]!, prev = bars[i - 1]!
    tr[i] = Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close))
  }
  // Wilder smooth: SMA seed then EMA-like
  const out = new Array<number>(n).fill(NaN)
  let sum = 0
  for (let i = 0; i < len && i < n; i++) sum += tr[i]!
  if (n >= len) out[len - 1] = sum / len
  for (let i = len; i < n; i++) out[i] = (out[i - 1]! * (len - 1) + tr[i]!) / len
  return out
}

function rsiArr(closes: number[], len = 14): number[] {
  const n = closes.length
  const out = new Array<number>(n).fill(NaN)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= len && i < n; i++) {
    const d = closes[i]! - closes[i - 1]!
    if (d > 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= len; avgLoss /= len
  if (len < n) out[len] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss))
  for (let i = len + 1; i < n; i++) {
    const d = closes[i]! - closes[i - 1]!
    avgGain = (avgGain * (len - 1) + Math.max(d, 0)) / len
    avgLoss = (avgLoss * (len - 1) + Math.max(-d, 0)) / len
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss))
  }
  return out
}

function adxCalc(bars: Bar[], len = 14): { adx: number[]; diPlus: number[]; diMinus: number[] } {
  const n = bars.length
  const atrs = atrArr(bars, len)
  const dpArr: number[] = [], dmArr: number[] = []
  for (let i = 1; i < n; i++) {
    const up = bars[i]!.high - bars[i - 1]!.high
    const dn = bars[i - 1]!.low - bars[i]!.low
    const a = atrs[i] || 1
    dpArr.push(up > dn && up > 0 ? (up / a) * 100 : 0)
    dmArr.push(dn > up && dn > 0 ? (dn / a) * 100 : 0)
  }
  const dpSmooth = sma(dpArr, len)
  const dmSmooth = sma(dmArr, len)
  const dxArr: number[] = []
  for (let i = 0; i < dpSmooth.length; i++) {
    const s = (dpSmooth[i]! + dmSmooth[i]!) || 1
    dxArr.push(Math.abs(dpSmooth[i]! - dmSmooth[i]!) / s * 100)
  }
  const adxSmooth = sma(dxArr, len)
  return {
    adx:     adxSmooth.map(v => isNaN(v) ? 0 : v),
    diPlus:  dpSmooth.map(v  => isNaN(v) ? 0 : v),
    diMinus: dmSmooth.map(v  => isNaN(v) ? 0 : v),
  }
}

function supertrend(bars: Bar[], factor: number, len: number): { val: number[]; dir: number[] } {
  const atrs = atrArr(bars, len)
  const vals: number[] = [], dirs: number[] = []
  let prev = 0, prevDir = 1
  for (let i = 0; i < bars.length; i++) {
    const hl2 = (bars[i]!.high + bars[i]!.low) / 2
    const a = atrs[i] || 0
    let dir = prevDir
    if (bars[i]!.close > prev) dir = -1
    else if (bars[i]!.close < prev) dir = 1
    const val = dir === -1 ? hl2 - factor * a : hl2 + factor * a
    vals.push(val); dirs.push(dir)
    prev = val; prevDir = dir
  }
  return { val: vals, dir: dirs }
}

function vwapCalc(bars: Bar[]): number[] {
  let cumPV = 0, cumV = 0
  return bars.map(b => {
    const hlc3 = (b.high + b.low + b.close) / 3
    const v = b.volume ?? 1
    cumPV += hlc3 * v; cumV += v
    return cumV > 0 ? cumPV / cumV : hlc3
  })
}

function cvdCalc(bars: Bar[]): number[] {
  let cum = 0
  return bars.map(b => {
    const ratio = b.close > b.open ? 1 : b.close < b.open ? 0 : 0.5
    cum += (b.volume ?? 1) * (ratio - 0.5) * 2
    return cum
  })
}

function rvolCalc(bars: Bar[], len = 20): number[] {
  const vols = bars.map(b => b.volume ?? 1)
  const avg = sma(vols, len)
  return vols.map((v, i) => (avg[i]! > 0 ? v / avg[i]! : 1))
}

function hurstEst(closes: number[], len: number): number {
  const n = Math.min(len, closes.length)
  const slice = closes.slice(-n)
  const rets = slice.map((v, i) => (i > 0 ? Math.log(v / slice[i - 1]!) : 0))
  const rng = Math.max(...rets) - Math.min(...rets)
  const std = Math.sqrt(rets.reduce((a, b) => a + b ** 2, 0) / n)
  if (std === 0) return 0.5
  return Math.log(rng / std) / Math.log(n)
}

// ── Public compute ─────────────────────────────────────────────────────────────

export function computeHeatSeeker(bars: Bar[], cfg: Partial<HeatConfig> = {}): HeatState {
  const c = { ...DEFAULT_CFG, ...cfg }
  const n = bars.length - 1
  const cur = bars[n]!

  const closes = bars.map(b => b.close)
  const highs  = bars.map(b => b.high)
  const lows   = bars.map(b => b.low)

  // ATR
  const atrs   = atrArr(bars, c.atrLen)
  const curAtr = atrs[n] || 1

  // EMAs
  const ema21 = ema(closes, c.emaFast)
  const ema55 = ema(closes, c.emaSlow)
  const emaSlope = ema21[n]! - ema21[Math.max(0, n - 3)]!
  const emaBull  = ema21[n]! > ema55[n]! && emaSlope > 0
  const emaBear  = ema21[n]! < ema55[n]! && emaSlope < 0

  // SuperTrend
  const st    = supertrend(bars, c.stFactor, c.stLen)
  const stDir: 'BULL' | 'BEAR' = st.dir[n]! < 0 ? 'BULL' : 'BEAR'

  // ADX
  const adx    = adxCalc(bars, 14)
  const adxVal = adx.adx[n - 1] ?? 0
  const diPlus = adx.diPlus[n - 1] ?? 0
  const diMin  = adx.diMinus[n - 1] ?? 0
  const adxOk  = adxVal > c.adxMin
  const diBull = diPlus > diMin && adxOk
  const diBear = diMin > diPlus && adxOk

  // RSI
  const rsiVals   = rsiArr(closes, 14)
  const rsiVal    = rsiVals[n] ?? 50
  const rsiBull   = rsiVal > 50 && rsiVal < 80
  const rsiBear   = rsiVal < 50 && rsiVal > 20
  const rsiExhaust = rsiVal > 80 || rsiVal < 20

  // MACD
  const m12 = ema(closes, 12)
  const m26 = ema(closes, 26)
  const mLine = m12.map((v, i) => v - m26[i]!)
  const mSig  = ema(mLine, 9)
  const macdHist = mLine[n]! - mSig[n]!
  const macdHistPrev = mLine[Math.max(0,n-5)]! - mSig[Math.max(0,n-5)]!
  const macdBull = macdHist > 0 && macdHist > (mLine[n-1]! - mSig[n-1]!)

  // VWAP
  const vwaps   = vwapCalc(bars)
  const vwapVal = vwaps[n]!
  const vwapAbove = cur.close > vwapVal

  // CVD
  const cvds   = cvdCalc(bars)
  const cvdRoc = cvds[n]! - cvds[Math.max(0, n - c.cvdLen)]!

  // RVOL
  const rvols   = rvolCalc(bars, 20)
  const rvolVal = rvols[n]!
  const rvolHigh = rvolVal > c.rvolMin

  // Imbalance
  const upVol = (cur.volume ?? 1) * (cur.close > cur.open ? 1 : 0.5)
  const dnVol = (cur.volume ?? 1) * (cur.close < cur.open ? 1 : 0.5)
  const imbRatio = upVol / Math.max(dnVol, 1)
  const imbBull = imbRatio > c.imbRatioThresh
  const imbBear = (1 / Math.max(imbRatio, 0.001)) > c.imbRatioThresh

  // Sweep
  const wickDn = Math.min(cur.open, cur.close) - cur.low
  const wickUp = cur.high - Math.max(cur.open, cur.close)
  const sweepBull = wickDn > curAtr * 0.6 && cur.close > cur.low + (cur.high - cur.low) * 0.6
  const sweepBear = wickUp > curAtr * 0.6 && cur.close < cur.low + (cur.high - cur.low) * 0.4
  const sweepBullCVD = sweepBull && cvds[n]! > cvds[n - 1]!
  const sweepBearCVD = sweepBear && cvds[n]! < cvds[n - 1]!

  // FVG
  const fvgBull = bars[n]!.low > bars[n - 2]!.high
  const fvgBear = bars[n]!.high < bars[n - 2]!.low
  const fvgWithVol = (fvgBull || fvgBear) && rvolHigh

  // MTF (EMA surrogates)
  const htf1 = ema(closes.slice(-50), 20); const htf1Bull = cur.close > htf1[htf1.length-1]!
  const htf2 = ema(closes.slice(-30), 10); const htf2Bull = cur.close > htf2[htf2.length-1]!
  const htf3 = ema(closes.slice(-15),  5); const htf3Bull = cur.close > htf3[htf3.length-1]!
  const mtfBullCount = (htf1Bull?1:0)+(htf2Bull?1:0)+(htf3Bull?1:0)
  const mtfBearCount = 3 - mtfBullCount
  const mtfAlignedBull = mtfBullCount >= 2
  const mtfAlignedBear = mtfBearCount >= 2

  // Vol pct rank
  const atrWindow = atrs.slice(Math.max(0, n - c.volPctLen), n).filter(v => !isNaN(v))
  const atrMax = Math.max(...atrWindow), atrMin = Math.min(...atrWindow)
  const volPctRank = atrMax > atrMin ? ((curAtr - atrMin)/(atrMax - atrMin))*100 : 50

  // VPOC proxy
  const volWindow = bars.slice(-20)
  const maxVolBar = volWindow.reduce((a, b) => (b.volume??0) > (a.volume??0) ? b : a)
  const vpocVal = maxVolBar.close

  // Range exp
  const range5   = Math.max(...highs.slice(-5)) - Math.min(...lows.slice(-5))
  const rangeAvg = sma(bars.slice(-25).map(b => b.high - b.low), 5)[4] || 1
  const rangeExp = range5 / rangeAvg > 1.0

  // Hurst
  const trendingRegime = hurstEst(closes, c.hurstLen) > 0.55

  // IDR
  const idrStdVal = (() => {
    const ranges = bars.map(b => b.high - b.low)
    const sl = ranges.slice(Math.max(0, n-20), n+1)
    const m = sl.reduce((a,b)=>a+b,0)/sl.length
    return Math.sqrt(sl.reduce((a,b)=>a+(b-m)**2,0)/sl.length) || 0.00001
  })()
  const dailyRangeAvg = sma(bars.slice(-20).map(b=>b.high-b.low),10)[9] || 1
  const idrZ = ((cur.high-cur.low)-dailyRangeAvg)/idrStdVal
  const idrOk = idrZ > -c.idrStd

  // Time-of-day
  const h = new Date(cur.time * 1000).getUTCHours()
  const hhmm = h * 100
  const isPowerHour = hhmm >= 930 && hhmm <= 1100
  const isLateSess  = hhmm > 1500
  const todBoost = isPowerHour ? 1.25 : isLateSess ? 0.75 : 1.0

  // Decay
  const touchCount   = bars.slice(-5).filter(b => Math.abs(b.close - vpocVal) < curAtr * 0.75).length
  const decayPenalty = Math.min(touchCount / 5, 1.0)

  // ── VOTES ──────────────────────────────────────────────────────────────────
  const bullVotes =
    (mtfAlignedBull ? 1:0) + (vwapAbove ? 1:0) + (emaBull ? 1:0) +
    (stDir==='BULL' ? 1:0) + (diBull ? 1:0) + (macdBull ? 1:0) +
    (rsiBull ? 1:0) + (cvdRoc>0 ? 1:0) + (imbBull ? 1:0) + (sweepBullCVD ? 1:0)

  const bearVotes =
    (mtfAlignedBear ? 1:0) + (!vwapAbove ? 1:0) + (emaBear ? 1:0) +
    (stDir==='BEAR' ? 1:0) + (diBear ? 1:0) + (!macdBull ? 1:0) +
    (rsiBear ? 1:0) + (cvdRoc<0 ? 1:0) + (imbBear ? 1:0) + (sweepBearCVD ? 1:0)

  const dirBiasRaw = bullVotes - bearVotes

  // ── ENERGY (0–40) ──────────────────────────────────────────────────────────
  let energyPts = 0
  energyPts += Math.min(rvolVal / c.rvolMin, 3.0) * 6
  energyPts += (volPctRank / 100) * 8
  energyPts += Math.min(Math.abs(cvdRoc) / 1e6 * 5, 5)
  energyPts += trendingRegime ? 5 : 0
  energyPts += fvgWithVol ? 4 : 0
  energyPts = Math.min(energyPts, 40)

  // ── CONFLUENCE (0–35) ──────────────────────────────────────────────────────
  let confPts = 0
  confPts += Math.max(mtfBullCount, mtfBearCount) * 5
  if (Math.abs(dirBiasRaw) < 3) confPts -= 5
  confPts += (Math.abs(cur.close - vpocVal) < curAtr * 0.75) ? 5 : 0
  const pdh = Math.max(...highs.slice(-48, -24)); const pdl = Math.min(...lows.slice(-48,-24))
  confPts += (Math.abs(cur.close - pdh) < curAtr || Math.abs(cur.close - pdl) < curAtr) ? 5 : 0
  confPts += adxOk ? 5 : 0
  confPts += rangeExp ? 5 : 0
  confPts = Math.max(0, Math.min(confPts, 35))

  // ── QUALITY ────────────────────────────────────────────────────────────────
  let qualMult = 1.0
  qualMult *= todBoost
  qualMult *= (1 - decayPenalty * 0.3)
  qualMult *= rsiExhaust ? 0.5 : 1.0
  qualMult *= (mtfBullCount === 3 || mtfBearCount === 3) ? 1.2 : 1.0
  qualMult *= idrOk ? 1.0 : 0.7

  // ── COMPOSITE ──────────────────────────────────────────────────────────────
  const dirScore = (Math.abs(dirBiasRaw) / 10) * 25
  const composite = Math.min(Math.max((energyPts + confPts + dirScore) * qualMult, 0), 100)

  const direction: 'BULL' | 'BEAR' | 'NEUTRAL' =
    dirBiasRaw > 2 ? 'BULL' : dirBiasRaw < -2 ? 'BEAR' : 'NEUTRAL'

  // ── TARGETS ────────────────────────────────────────────────────────────────
  const isBull = direction === 'BULL'
  const isBear = direction === 'BEAR'
  const entry  = cur.close
  const tgt1   = isBull ? entry + curAtr * c.tgtMult : isBear ? entry - curAtr * c.tgtMult : entry + curAtr * c.tgtMult
  const tgt2   = isBull ? entry + curAtr * c.extMult  : isBear ? entry - curAtr * c.extMult  : entry + curAtr * c.extMult
  const stop   = isBull ? entry - curAtr * c.stopMult : isBear ? entry + curAtr * c.stopMult : entry - curAtr * c.stopMult

  // ── Alpha patches (user spec) ────────────────────────────────────────────────
  // 15% over-EMA boost: if price > 15% from EMA21 → 1.2x multiplier
  const overEmaThreshold = ema21[n]! > 0 ? (cur.close - ema21[n]!) / ema21[n]! : 0
  const overEmaBoost     = Math.abs(overEmaThreshold) > 0.15 ? 1.2 : 1.0

  // Simplified alpha composite (per user patch)
  const aiVoteAlpha  = mtfBullCount === 3 ? 30 : mtfBearCount === 3 ? -30 : 0
  const imbAlpha     = imbBull ? 15 : imbBear ? -15 : 0
  const energyAlpha  = (cvdRoc / 1_000_000) * 10
  const rawAlpha     = (aiVoteAlpha + imbAlpha + energyAlpha) * overEmaBoost * todBoost
  // Blend: 60% full composite + 40% alpha
  const blendedRaw   = composite * 0.6 + Math.abs(rawAlpha) * 0.4
  // Cap at 90 — user spec: "MAX AT 90%"
  const finalScore   = Math.min(Math.max(blendedRaw * (1 - decayPenalty), 0), 90)

  // Direction from alpha sign (rawAlpha) if strong, else from vote-based direction
  const alphaDir: 'BULL' | 'BEAR' | 'NEUTRAL' =
    rawAlpha > 5 ? 'BULL' : rawAlpha < -5 ? 'BEAR' : direction
  const finalDir = finalScore < 10 ? 'NEUTRAL' : alphaDir

  // targetHeat drives color palette on chart levels
  const targetHeat: TargetHeat = finalScore > 75 ? 'FIRE' : finalScore > 50 ? 'GAS' : 'CALM'

  // Final targets (use finalDir)
  const isBullF = finalDir === 'BULL'
  const isBearF = finalDir === 'BEAR'
  const entryF  = cur.close
  const tgt1F   = isBullF ? entryF + curAtr * c.tgtMult  : isBearF ? entryF - curAtr * c.tgtMult  : entryF + curAtr * c.tgtMult
  const tgt2F   = isBullF ? entryF + curAtr * c.extMult   : isBearF ? entryF - curAtr * c.extMult   : entryF + curAtr * c.extMult
  const stopF   = isBullF ? entryF - curAtr * c.stopMult  : isBearF ? entryF + curAtr * c.stopMult  : entryF - curAtr * c.stopMult

  const sig = (bull: boolean, bear: boolean): 'bull' | 'bear' | 'neutral' =>
    bull ? 'bull' : bear ? 'bear' : 'neutral'

  const signals: HeatState['signals'] = [
    { id: 'MTF',  label: 'MTF',  dir: sig(mtfBullCount >= 2, mtfBearCount >= 2) },
    { id: 'VWAP', label: 'VWAP', dir: sig(vwapAbove, !vwapAbove) },
    { id: 'EMA',  label: 'EMA',  dir: sig(emaBull, emaBear) },
    { id: 'ST',   label: 'ST',   dir: sig(stDir === 'BULL', stDir === 'BEAR') },
    { id: 'ADX',  label: 'ADX',  dir: sig(diBull, diBear) },
    { id: 'MACD', label: 'MACD', dir: sig(macdBull, !macdBull) },
    { id: 'RSI',  label: 'RSI',  dir: sig(rsiBull, rsiBear) },
    { id: 'CVD',  label: 'CVD',  dir: sig(cvdRoc > 0, cvdRoc < 0) },
    { id: 'IMB',  label: 'IMB',  dir: sig(imbBull, imbBear) },
    { id: 'SWP',  label: 'SWP',  dir: sig(sweepBullCVD, sweepBearCVD) },
  ]

  return {
    direction: finalDir, composite: finalScore, score: finalScore,
    targetHeat,
    energyPts, confPts, bullVotes, bearVotes, dirBiasRaw,
    entry: entryF, tgt1: tgt1F, tgt2: tgt2F, stop: stopF,
    rrRatio: c.tgtMult / c.stopMult, atr: curAtr,
    rsi: rsiVal, rvol: rvolVal, adxVal, macdHist, superTrendDir: stDir, vwap: vwapVal,
    signals,
  }
}
