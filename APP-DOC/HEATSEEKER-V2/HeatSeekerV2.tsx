// ============================================================
// HEATSEEKER v2 — React/TypeScript Trading Algo Dashboard
// Full Composite Score Engine + Target + Direction + Alignment
// Compatible: Next.js 13+ App Router, React 18, Vite
// Dependencies: react, recharts (or chart.js), tailwindcss
// ============================================================

"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ──────────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────────
interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface AlgoState {
  // Key Levels
  pdh: number;
  pdl: number;
  pdc: number;
  orHigh: number;
  orLow: number;
  vpoc: number;
  vwap: number;

  // Trend
  ema21: number;
  ema55: number;
  emaSlope: number;
  superTrendDir: "BULL" | "BEAR";
  superTrendVal: number;
  adxVal: number;
  diPlus: number;
  diMinus: number;

  // Momentum
  rsi: number;
  macdHist: number;
  macdBullHidDiv: boolean;
  macdBearHidDiv: boolean;

  // Volume
  cvd: number;
  cvdRoc: number;
  rvol: number;
  volPctRank: number;
  imbRatio: number;

  // Structure
  mtfBullCount: number;
  mtfBearCount: number;
  sweepBull: boolean;
  sweepBear: boolean;
  fvgBull: boolean;
  fvgBear: boolean;
  fvgWithVol: boolean;
  hurstEst: number;
  trendingRegime: boolean;

  // Regime
  idrOk: boolean;
  isPowerHour: boolean;
  isLateSess: boolean;
  touchCount: number;
  decayPenalty: number;
  rsiExhaust: boolean;
  vwapExtended: boolean;
  rangeExp: boolean;
  idOk: boolean;

  // Composite
  dirBiasRaw: number;
  bullVotes: number;
  bearVotes: number;
  energyPts: number;
  confPts: number;
  composite: number;
  direction: "BULL" | "BEAR" | "NEUTRAL";

  // Targets
  tgt1: number;
  tgt2: number;
  stop: number;
  rrRatio: number;
  atr: number;
}

interface Config {
  symbol: string;
  interval: string;
  adxMin: number;
  rvolMin: number;
  minScore: number;
  tgtMult: number;
  extMult: number;
  stopMult: number;
  emaSlow: number;
  emaFast: number;
  stFactor: number;
  stLen: number;
  cvdLen: number;
  vwapDev: number;
  imbRatioThresh: number;
  hurstLen: number;
  atrLen: number;
  volPctLen: number;
  decayLen: number;
  idrStd: number;
  orBars: number;
}

interface SignalLog {
  time: string;
  direction: "BULL" | "BEAR";
  score: number;
  price: number;
  tgt1: number;
  tgt2: number;
  stop: number;
  rrRatio: number;
  votes: string;
}

// ──────────────────────────────────────────────────
// BINANCE WS + REST HELPERS
// ──────────────────────────────────────────────────
const BINANCE_REST = "https://api.binance.com/api/v3";
const BINANCE_WS   = "wss://stream.binance.com:9443/ws";

async function fetchKlines(symbol: string, interval: string, limit = 200): Promise<OHLCV[]> {
  const sym = symbol.replace("/", "").toUpperCase();
  const r = await fetch(`${BINANCE_REST}/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);
  const d = await r.json();
  return d.map((k: string[]) => ({
    time:   parseInt(k[0]),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// ──────────────────────────────────────────────────
// MATH UTILITIES
// ──────────────────────────────────────────────────
function ema(data: number[], len: number): number[] {
  const k = 2 / (len + 1);
  const out: number[] = [];
  let prev = data[0];
  for (const v of data) {
    prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function sma(data: number[], len: number): number[] {
  return data.map((_, i) => {
    if (i < len - 1) return NaN;
    let s = 0; for (let j = 0; j < len; j++) s += data[i - j];
    return s / len;
  });
}

function stdev(data: number[], len: number, idx: number): number {
  if (idx < len - 1) return 0;
  const sl = data.slice(idx - len + 1, idx + 1);
  const m  = sl.reduce((a, b) => a + b, 0) / len;
  return Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / len);
}

function atr(bars: OHLCV[], len: number): number[] {
  const trs = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const prev = bars[i - 1];
    return Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close));
  });
  const k = 2 / (len + 1);
  let prev = trs.slice(0, len).reduce((a, b) => a + b, 0) / len;
  return trs.map((v, i) => {
    if (i < len) return NaN;
    prev = v * k + prev * (1 - k);
    return prev;
  });
}

function rsiCalc(closes: number[], len = 14): number[] {
  const out: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < len) { out.push(NaN); continue; }
    let gains = 0, losses = 0;
    for (let j = i - len + 1; j <= i; j++) {
      const d = closes[j] - closes[j - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    out.push(100 - 100 / (1 + rs));
  }
  return out;
}

function adxCalc(bars: OHLCV[], len = 14): { adx: number[]; diPlus: number[]; diMinus: number[] } {
  const diPlus: number[] = [];
  const diMinus: number[] = [];
  const adxOut: number[] = [];
  const atrArr = atr(bars, len);
  for (let i = 1; i < bars.length; i++) {
    const upMove   = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    const dmPlus  = upMove > downMove && upMove > 0 ? upMove : 0;
    const dmMinus = downMove > upMove && downMove > 0 ? downMove : 0;
    const atrVal  = atrArr[i] || 1;
    diPlus.push((dmPlus / atrVal) * 100);
    diMinus.push((dmMinus / atrVal) * 100);
  }
  const diPlusSm  = sma(diPlus, len);
  const diMinusSm = sma(diMinus, len);
  for (let i = 0; i < diPlusSm.length; i++) {
    const sum = diPlusSm[i] + diMinusSm[i];
    const dx  = sum > 0 ? Math.abs(diPlusSm[i] - diMinusSm[i]) / sum * 100 : 0;
    adxOut.push(dx);
  }
  const adxSmoothed = sma(adxOut, len);
  return {
    adx:     adxSmoothed.map((v, i) => (isNaN(v) ? 0 : v)),
    diPlus:  diPlusSm.map((v, i)   => (isNaN(v) ? 0 : v)),
    diMinus: diMinusSm.map((v, i)  => (isNaN(v) ? 0 : v)),
  };
}

function supertrend(bars: OHLCV[], factor: number, len: number): { val: number[]; dir: number[] } {
  const atrArr = atr(bars, len);
  const vals: number[] = [];
  const dirs: number[] = [];
  let prev = 0, prevDir = 1;
  for (let i = 0; i < bars.length; i++) {
    const hl2  = (bars[i].high + bars[i].low) / 2;
    const a    = atrArr[i] || 0;
    const ub   = hl2 + factor * a;
    const lb   = hl2 - factor * a;
    const close = bars[i].close;
    let dir = prevDir;
    if (close > prev) dir = -1;
    else if (close < prev) dir = 1;
    const val = dir === -1 ? lb : ub;
    vals.push(val);
    dirs.push(dir);
    prev = val;
    prevDir = dir;
  }
  return { val: vals, dir: dirs };
}

function vwapCalc(bars: OHLCV[]): number[] {
  let cumPV = 0, cumV = 0;
  return bars.map(b => {
    const hlc3 = (b.high + b.low + b.close) / 3;
    cumPV += hlc3 * b.volume;
    cumV  += b.volume;
    return cumV > 0 ? cumPV / cumV : hlc3;
  });
}

function cvdCalc(bars: OHLCV[]): number[] {
  let cum = 0;
  return bars.map(b => {
    const ratio = b.close > b.open ? 1.0 : b.close < b.open ? 0.0 : 0.5;
    cum += b.volume * (ratio - 0.5) * 2;
    return cum;
  });
}

function rvolCalc(bars: OHLCV[], len = 20): number[] {
  const avgVols = sma(bars.map(b => b.volume), len);
  return bars.map((b, i) => (avgVols[i] > 0 ? b.volume / avgVols[i] : 1));
}

function hurstEst(closes: number[], len = 100): number {
  const n = Math.min(len, closes.length);
  const slice = closes.slice(-n).map((v, i) => (i > 0 ? Math.log(v / closes[closes.length - n + i - 1]) : 0));
  const range = Math.max(...slice) - Math.min(...slice);
  const std   = Math.sqrt(slice.reduce((a, b) => a + b ** 2, 0) / n);
  if (std === 0) return 0.5;
  return Math.log(range / std) / Math.log(n);
}

// ──────────────────────────────────────────────────
// COMPOSITE SCORE ENGINE
// ──────────────────────────────────────────────────
function computeAlgo(bars: OHLCV[], cfg: Config): AlgoState {
  if (bars.length < 60) throw new Error("Need 60+ bars");

  const closes  = bars.map(b => b.close);
  const highs   = bars.map(b => b.high);
  const lows    = bars.map(b => b.low);
  const volumes = bars.map(b => b.volume);
  const n       = bars.length - 1;
  const cur     = bars[n];

  // ATR
  const atrArr  = atr(bars, cfg.atrLen);
  const curAtr  = atrArr[n] || 1;

  // EMAs
  const ema21Arr = ema(closes, cfg.emaFast);
  const ema55Arr = ema(closes, cfg.emaSlow);
  const ema21    = ema21Arr[n];
  const ema55    = ema55Arr[n];
  const emaSlope = ema21Arr[n] - ema21Arr[n - 3];

  // SuperTrend
  const st = supertrend(bars, cfg.stFactor, cfg.stLen);
  const stDir: "BULL" | "BEAR" = st.dir[n] < 0 ? "BULL" : "BEAR";
  const stVal = st.val[n];

  // ADX
  const adxData  = adxCalc(bars, 14);
  const adxVal   = adxData.adx[n - 1] || 0;
  const diPlus   = adxData.diPlus[n - 1] || 0;
  const diMinus  = adxData.diMinus[n - 1] || 0;
  const adxOk    = adxVal > cfg.adxMin;
  const diBull   = diPlus > diMinus && adxOk;
  const diBear   = diMinus > diPlus && adxOk;

  // RSI
  const rsiArr    = rsiCalc(closes, 14);
  const rsiVal    = rsiArr[n] || 50;
  const rsiExhaust = rsiVal > 80 || rsiVal < 20;
  const rsiBull   = rsiVal > 50 && rsiVal < 80;
  const rsiBear   = rsiVal < 50 && rsiVal > 20;

  // MACD
  const macd12 = ema(closes, 12);
  const macd26 = ema(closes, 26);
  const macdLine = macd12.map((v, i) => v - macd26[i]);
  const macdSig  = ema(macdLine, 9);
  const macdHist = macdLine[n] - macdSig[n];
  const macdHistPrev = macdLine[n - 5] - macdSig[n - 5];
  const macdBull = macdHist > 0 && macdHist > (macdLine[n - 1] - macdSig[n - 1]);
  const macdBullHidDiv = cur.close > bars[n - 5].close && macdHist < macdHistPrev && macdHist > 0;
  const macdBearHidDiv = cur.close < bars[n - 5].close && macdHist > macdHistPrev && macdHist < 0;

  // CVD
  const cvdArr  = cvdCalc(bars);
  const cvdVal  = cvdArr[n];
  const cvdLen  = cfg.cvdLen;
  const cvdRoc  = cvdArr[n] - cvdArr[n - cvdLen];
  const cvdStrength = Math.abs(cvdRoc) / 1e6;

  // RVOL
  const rvolArr     = rvolCalc(bars, 20);
  const rvolVal     = rvolArr[n];
  const rvolHigh    = rvolVal > cfg.rvolMin;
  const rvolScore   = Math.min(rvolVal / cfg.rvolMin, 3.0);

  // VWAP
  const vwapArr    = vwapCalc(bars);
  const vwapVal    = vwapArr[n];
  const vwapAbove  = cur.close > vwapVal;
  const vwapStdArr = closes.map((c, i) => c - vwapArr[i]);
  const vwapStd    = stdev(vwapStdArr, 20, n);
  const vwapExtended = Math.abs(cur.close - vwapVal) > cfg.vwapDev * vwapStd;

  // PDH/PDL — use 24h lookback proxy
  const pdh = Math.max(...highs.slice(-48, -24));
  const pdl = Math.min(...lows.slice(-48, -24));
  const pdc = closes[n - 24] || cur.close;
  const orHigh = Math.max(...highs.slice(-cfg.orBars));
  const orLow  = Math.min(...lows.slice(-cfg.orBars));

  // VPOC proxy
  const volWindow = bars.slice(-20);
  const maxVolBar = volWindow.reduce((a, b) => b.volume > a.volume ? b : a);
  const vpocVal   = maxVolBar.close;
  const vpocAccepted = Math.abs(cur.close - vpocVal) < curAtr * 0.75;

  // Imbalance
  const upVol  = volumes[n] * (cur.close > cur.open ? 1 : 0.5);
  const dnVol  = volumes[n] * (cur.close < cur.open ? 1 : 0.5);
  const imbRatioVal = upVol / Math.max(dnVol, 1);
  const imbBull = imbRatioVal > cfg.imbRatioThresh;
  const imbBear = (1 / Math.max(imbRatioVal, 0.001)) > cfg.imbRatioThresh;

  // Vol percentile
  const atrWindow = atrArr.slice(n - cfg.volPctLen, n).filter(v => !isNaN(v));
  const atrMax    = Math.max(...atrWindow);
  const atrMin    = Math.min(...atrWindow);
  const volPctRank = atrMax > atrMin ? ((curAtr - atrMin) / (atrMax - atrMin)) * 100 : 50;

  // Range expansion
  const range5    = Math.max(...highs.slice(-5)) - Math.min(...lows.slice(-5));
  const rangeAvg  = ema(
    bars.slice(-25).map((_, i) => Math.max(...highs.slice(-25 + i, -24 + i + 1)) - Math.min(...lows.slice(-25 + i, -24 + i + 1))),
    5
  )[4];
  const rangeExp  = range5 / Math.max(rangeAvg, 0.001) > 1.0;

  // Hurst
  const hurstVal       = hurstEst(closes.slice(-cfg.hurstLen), cfg.hurstLen);
  const trendingRegime = hurstVal > 0.55;

  // Sweeps
  const wickUp   = cur.high - Math.max(cur.open, cur.close);
  const wickDn   = Math.min(cur.open, cur.close) - cur.low;
  const sweepBull = wickDn > curAtr * 0.6 && cur.close > cur.low + (cur.high - cur.low) * 0.6;
  const sweepBear = wickUp > curAtr * 0.6 && cur.close < cur.low + (cur.high - cur.low) * 0.4;
  const sweepBullCVD = sweepBull && cvdArr[n] > cvdArr[n - 1];
  const sweepBearCVD = sweepBear && cvdArr[n] < cvdArr[n - 1];

  // FVG
  const fvgBull    = bars[n].low > bars[n - 2].high;
  const fvgBear    = bars[n].high < bars[n - 2].low;
  const fvgWithVol = (fvgBull || fvgBear) && rvolHigh;

  // MTF proxy (use different EMA spans as surrogate TF alignment)
  const htf1Ema = ema(closes.slice(-50), 20);
  const htf2Ema = ema(closes.slice(-30), 10);
  const htf3Ema = ema(closes.slice(-15), 5);
  const htf1Bull = cur.close > htf1Ema[htf1Ema.length - 1];
  const htf2Bull = cur.close > htf2Ema[htf2Ema.length - 1];
  const htf3Bull = cur.close > htf3Ema[htf3Ema.length - 1];
  const htf1Bear = !htf1Bull, htf2Bear = !htf2Bull, htf3Bear = !htf3Bull;
  const mtfBullCount = (htf1Bull ? 1 : 0) + (htf2Bull ? 1 : 0) + (htf3Bull ? 1 : 0);
  const mtfBearCount = (htf1Bear ? 1 : 0) + (htf2Bear ? 1 : 0) + (htf3Bear ? 1 : 0);
  const mtfAlignedBull = mtfBullCount >= 2;
  const mtfAlignedBear = mtfBearCount >= 2;

  // IDR
  const dailyRangeAvg = ema(bars.slice(-20).map(b => b.high - b.low), 10)[9];
  const idrStdVal     = stdev(bars.map(b => b.high - b.low), 20, n);
  const idrZ          = ((cur.high - cur.low) - dailyRangeAvg) / Math.max(idrStdVal, 0.00001);
  const idrOk         = idrZ > -cfg.idrStd;

  // Time (use unix ms → hour)
  const h = new Date(cur.time).getUTCHours();
  const m = new Date(cur.time).getUTCMinutes();
  const hhmm = h * 100 + m;
  const isPowerHour = hhmm >= 930 && hhmm <= 1100;
  const isLateSess  = hhmm > 1500;
  const todBoost    = isPowerHour ? 1.25 : isLateSess ? 0.75 : 1.0;

  // Touch decay proxy (times price has been near VPOC in last 5 bars)
  const touchCount   = bars.slice(-5).filter(b => Math.abs(b.close - vpocVal) < curAtr * 0.75).length;
  const decayPenalty = Math.min(touchCount / 5, 1.0);

  // ── VOTES ──
  const bullVotes =
    (mtfAlignedBull ? 1 : 0) +
    (vwapAbove      ? 1 : 0) +
    (ema21 > ema55 && emaSlope > 0 ? 1 : 0) +
    (stDir === "BULL" ? 1 : 0) +
    (diBull         ? 1 : 0) +
    (macdBull       ? 1 : 0) +
    (rsiBull        ? 1 : 0) +
    (cvdRoc > 0     ? 1 : 0) +
    (imbBull        ? 1 : 0) +
    (sweepBullCVD   ? 1 : 0);

  const bearVotes =
    (mtfAlignedBear ? 1 : 0) +
    (!vwapAbove     ? 1 : 0) +
    (ema21 < ema55 && emaSlope < 0 ? 1 : 0) +
    (stDir === "BEAR" ? 1 : 0) +
    (diBear         ? 1 : 0) +
    (!macdBull      ? 1 : 0) +
    (rsiBear        ? 1 : 0) +
    (cvdRoc < 0     ? 1 : 0) +
    (imbBear        ? 1 : 0) +
    (sweepBearCVD   ? 1 : 0);

  const dirBiasRaw = bullVotes - bearVotes;

  // ── ENERGY (0–40) ──
  let energyPts = 0;
  energyPts += rvolScore * 6;
  energyPts += (volPctRank / 100) * 8;
  energyPts += Math.min(cvdStrength * 5, 5);
  energyPts += trendingRegime ? 5 : 0;
  energyPts += fvgWithVol ? 4 : 0;
  energyPts  = Math.min(energyPts, 40);

  // ── CONFLUENCE (0–35) ──
  let confPts = 0;
  confPts += mtfBullCount * 5;
  confPts += mtfBearCount * 5;
  if (Math.abs(dirBiasRaw) < 3) confPts -= 5;
  confPts += vpocAccepted ? 5 : 0;
  confPts += (Math.abs(cur.close - pdh) < curAtr || Math.abs(cur.close - pdl) < curAtr) ? 5 : 0;
  confPts += adxOk ? 5 : 0;
  confPts += rangeExp ? 5 : 0;
  confPts  = Math.max(0, Math.min(confPts, 35));

  // ── QUALITY MULTIPLIERS ──
  let qualMult = 1.0;
  qualMult *= todBoost;
  qualMult *= (1 - decayPenalty * 0.3);
  qualMult *= rsiExhaust ? 0.5 : 1.0;
  qualMult *= (mtfBullCount === 3 || mtfBearCount === 3) ? 1.2 : 1.0;
  qualMult *= idrOk ? 1.0 : 0.7;

  // ── COMPOSITE ──
  const dirScore  = (Math.abs(dirBiasRaw) / 10) * 25;
  const rawScore  = (energyPts + confPts + dirScore) * qualMult;
  const composite = Math.min(Math.max(rawScore, 0), 100);

  const direction: "BULL" | "BEAR" | "NEUTRAL" =
    dirBiasRaw > 2 ? "BULL" : dirBiasRaw < -2 ? "BEAR" : "NEUTRAL";

  // ── TARGETS ──
  const tgt1  = direction === "BULL" ? cur.close + curAtr * cfg.tgtMult : cur.close - curAtr * cfg.tgtMult;
  const tgt2  = direction === "BULL" ? cur.close + curAtr * cfg.extMult : cur.close - curAtr * cfg.extMult;
  const stop  = direction === "BULL" ? cur.close - curAtr * cfg.stopMult : cur.close + curAtr * cfg.stopMult;
  const rrRatio = cfg.tgtMult / cfg.stopMult;

  return {
    pdh, pdl, pdc, orHigh, orLow, vpoc: vpocVal, vwap: vwapVal,
    ema21, ema55, emaSlope, superTrendDir: stDir, superTrendVal: stVal,
    adxVal, diPlus, diMinus,
    rsi: rsiVal, macdHist, macdBullHidDiv, macdBearHidDiv,
    cvd: cvdVal, cvdRoc, rvol: rvolVal, volPctRank, imbRatio: imbRatioVal,
    mtfBullCount, mtfBearCount,
    sweepBull: sweepBullCVD, sweepBear: sweepBearCVD,
    fvgBull, fvgBear, fvgWithVol, hurstEst: hurstVal, trendingRegime,
    idrOk, isPowerHour, isLateSess, touchCount, decayPenalty,
    rsiExhaust, vwapExtended, rangeExp, idOk: idrOk,
    dirBiasRaw, bullVotes, bearVotes,
    energyPts, confPts, composite, direction,
    tgt1, tgt2, stop, rrRatio, atr: curAtr,
  };
}

// ──────────────────────────────────────────────────
// SIGNAL HISTORY LOG
// ──────────────────────────────────────────────────
let lastSignalDir: "BULL" | "BEAR" | "NEUTRAL" = "NEUTRAL";

function checkSignal(state: AlgoState, cfg: Config, price: number): SignalLog | null {
  const sig = state.composite >= cfg.minScore && state.direction !== "NEUTRAL";
  if (sig && state.direction !== lastSignalDir) {
    lastSignalDir = state.direction;
    return {
      time: new Date().toLocaleTimeString(),
      direction: state.direction as "BULL" | "BEAR",
      score: Math.round(state.composite),
      price,
      tgt1: state.tgt1,
      tgt2: state.tgt2,
      stop: state.stop,
      rrRatio: state.rrRatio,
      votes: `${state.bullVotes}B/${state.bearVotes}Br`,
    };
  }
  return null;
}

// ──────────────────────────────────────────────────
// COMPONENTS
// ──────────────────────────────────────────────────

function ScoreMeter({ score, direction }: { score: number; direction: string }) {
  const angle = (score / 100) * 180 - 90;
  const color = score >= 75 ? "#22c55e" : score >= 55 ? "#eab308" : "#ef4444";
  const dirColor = direction === "BULL" ? "#22c55e" : direction === "BEAR" ? "#ef4444" : "#6b7280";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
      <svg width="160" height="90" viewBox="0 0 160 90">
        {/* Background arc */}
        <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke="#1e293b" strokeWidth="12" strokeLinecap="round" />
        {/* Score arc */}
        <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke={color}
          strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(score / 100) * 220} 220`} />
        {/* Needle */}
        <line x1="80" y1="80"
          x2={80 + 55 * Math.cos((angle * Math.PI) / 180)}
          y2={80 + 55 * Math.sin((angle * Math.PI) / 180)}
          stroke="#f1f5f9" strokeWidth="2" strokeLinecap="round" />
        <circle cx="80" cy="80" r="5" fill="#f1f5f9" />
        {/* Labels */}
        <text x="8"  y="88" fill="#64748b" fontSize="10">0</text>
        <text x="73" y="18" fill="#64748b" fontSize="10">50</text>
        <text x="144" y="88" fill="#64748b" fontSize="10">100</text>
        {/* Score */}
        <text x="80" y="68" fill={color} fontSize="22" fontWeight="700" textAnchor="middle">{Math.round(score)}</text>
      </svg>
      <div style={{ fontSize: "18px", fontWeight: 700, color: dirColor, letterSpacing: "0.1em" }}>
        {direction === "BULL" ? "▲ BULL" : direction === "BEAR" ? "▼ BEAR" : "── NEUTRAL"}
      </div>
      <div style={{ fontSize: "11px", color: "#64748b" }}>HEATSEEK COMPOSITE</div>
    </div>
  );
}

function AlignRow({ label, value, pts, color }: { label: string; value: string; pts: string; color: string }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "110px 1fr 40px",
      padding: "3px 8px", borderBottom: "1px solid #1e293b", alignItems: "center",
    }}>
      <span style={{ fontSize: "11px", color: "#94a3b8" }}>{label}</span>
      <span style={{ fontSize: "11px", color, fontWeight: 600 }}>{value}</span>
      <span style={{ fontSize: "11px", color: "#64748b", textAlign: "right" }}>{pts}</span>
    </div>
  );
}

function VoteBar({ bull, bear }: { bull: number; bear: number }) {
  const total = 10;
  const bullPct = (bull / total) * 100;
  const bearPct = (bear / total) * 100;
  return (
    <div style={{ padding: "12px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "11px", color: "#22c55e" }}>▲ BULL {bull}/10</span>
        <span style={{ fontSize: "11px", color: "#ef4444" }}>BEAR {bear}/10 ▼</span>
      </div>
      <div style={{ display: "flex", height: "8px", borderRadius: "4px", overflow: "hidden", background: "#1e293b" }}>
        <div style={{ width: `${bullPct}%`, background: "#22c55e", transition: "width 0.4s" }} />
        <div style={{ width: `${bearPct}%`, background: "#ef4444", transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function TargetPanel({ state }: { state: AlgoState }) {
  const isBull = state.direction === "BULL";
  const isBear = state.direction === "BEAR";
  const sig = state.composite >= 55 && state.direction !== "NEUTRAL";
  const px = (v: number) => v.toFixed(2);
  return (
    <div style={{ padding: "12px 16px", borderTop: "1px solid #1e293b" }}>
      <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
        Target Projection
      </div>
      {sig ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
          {[
            { label: "T1", value: px(state.tgt1), color: isBull ? "#22c55e" : "#ef4444" },
            { label: "T2", value: px(state.tgt2), color: isBull ? "#16a34a" : "#dc2626" },
            { label: "STOP", value: px(state.stop), color: "#f59e0b" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: "#1e293b", borderRadius: "6px", padding: "8px",
              textAlign: "center", border: "1px solid #334155",
            }}>
              <div style={{ fontSize: "10px", color: "#64748b" }}>{label}</div>
              <div style={{ fontSize: "14px", color, fontWeight: 700, fontFamily: "monospace" }}>{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "#64748b", fontSize: "12px", textAlign: "center", padding: "12px 0" }}>
          Score below threshold ({Math.round(state.composite)}/55)
        </div>
      )}
      <div style={{ marginTop: "8px", fontSize: "11px", color: "#64748b", display: "flex", gap: "12px", justifyContent: "center" }}>
        <span>ATR: {state.atr.toFixed(2)}</span>
        <span>R:R {state.rrRatio.toFixed(1)}R</span>
        <span>Hurst: {state.hurstEst.toFixed(2)}</span>
      </div>
    </div>
  );
}

function SignalLogTable({ logs }: { logs: SignalLog[] }) {
  if (logs.length === 0) return (
    <div style={{ color: "#64748b", fontSize: "12px", textAlign: "center", padding: "16px" }}>
      No signals yet. Watching…
    </div>
  );
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #334155" }}>
            {["Time", "Dir", "Score", "Price", "T1", "T2", "Stop", "R:R", "Votes"].map(h => (
              <th key={h} style={{ padding: "6px 8px", color: "#64748b", textAlign: "left", fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...logs].reverse().map((l, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
              <td style={{ padding: "5px 8px", color: "#94a3b8" }}>{l.time}</td>
              <td style={{ padding: "5px 8px", color: l.direction === "BULL" ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                {l.direction === "BULL" ? "▲" : "▼"} {l.direction}
              </td>
              <td style={{ padding: "5px 8px", color: l.score >= 75 ? "#22c55e" : "#eab308", fontWeight: 600 }}>{l.score}</td>
              <td style={{ padding: "5px 8px", color: "#f1f5f9", fontFamily: "monospace" }}>{l.price.toFixed(2)}</td>
              <td style={{ padding: "5px 8px", color: "#22c55e", fontFamily: "monospace" }}>{l.tgt1.toFixed(2)}</td>
              <td style={{ padding: "5px 8px", color: "#16a34a", fontFamily: "monospace" }}>{l.tgt2.toFixed(2)}</td>
              <td style={{ padding: "5px 8px", color: "#f59e0b", fontFamily: "monospace" }}>{l.stop.toFixed(2)}</td>
              <td style={{ padding: "5px 8px", color: "#94a3b8" }}>{l.rrRatio.toFixed(1)}R</td>
              <td style={{ padding: "5px 8px", color: "#64748b" }}>{l.votes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EnergyBars({ energy, conf, dir }: { energy: number; conf: number; dir: number }) {
  const bars = [
    { label: "Energy", value: energy, max: 40, color: "#f59e0b" },
    { label: "Confluence", value: conf, max: 35, color: "#818cf8" },
    { label: "Direction", value: Math.abs(dir) / 10 * 25, max: 25, color: dir > 0 ? "#22c55e" : dir < 0 ? "#ef4444" : "#64748b" },
  ];
  return (
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
      {bars.map(({ label, value, max, color }) => (
        <div key={label}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>{label}</span>
            <span style={{ fontSize: "11px", color }}>{Math.round(value)}/{max}</span>
          </div>
          <div style={{ height: "6px", background: "#1e293b", borderRadius: "3px", overflow: "hidden" }}>
            <div style={{ width: `${(value / max) * 100}%`, height: "100%", background: color, borderRadius: "3px", transition: "width 0.4s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────
// MAIN COMPONENT
// ──────────────────────────────────────────────────

const DEFAULT_CONFIG: Config = {
  symbol: "BTCUSDT", interval: "5m",
  adxMin: 25, rvolMin: 1.5, minScore: 55,
  tgtMult: 1.5, extMult: 2.5, stopMult: 0.75,
  emaFast: 21, emaSlow: 55,
  stFactor: 3.0, stLen: 10,
  cvdLen: 14, vwapDev: 2.0,
  imbRatioThresh: 1.5,
  hurstLen: 100, atrLen: 14,
  volPctLen: 100, decayLen: 5,
  idrStd: 1.5, orBars: 12,
};

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "LTCUSDT"];
const INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "4h"];

export default function HeatSeekerV2() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [algoState, setAlgoState] = useState<AlgoState | null>(null);
  const [signalLog, setSignalLog] = useState<SignalLog[]>([]);
  const [bars, setBars] = useState<OHLCV[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [tab, setTab] = useState<"dashboard" | "alignment" | "log" | "config">("dashboard");
  const wsRef = useRef<WebSocket | null>(null);
  const barsRef = useRef<OHLCV[]>([]);

  // ── FETCH INITIAL BARS ──
  const loadBars = useCallback(async (sym: string, ivl: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKlines(sym, ivl, 200);
      barsRef.current = data;
      setBars(data);
      const state = computeAlgo(data, config);
      setAlgoState(state);
      setLastPrice(data[data.length - 1].close);
      const sig = checkSignal(state, config, data[data.length - 1].close);
      if (sig) setSignalLog(prev => [...prev, sig]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load bars");
    } finally {
      setLoading(false);
    }
  }, [config]);

  // ── WEBSOCKET ──
  const connectWS = useCallback((sym: string, ivl: string) => {
    wsRef.current?.close();
    const stream = `${sym.toLowerCase()}@kline_${ivl}`;
    const ws = new WebSocket(`${BINANCE_WS}/${stream}`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const k = msg.k;
        if (!k) return;
        const bar: OHLCV = {
          time: k.t, open: parseFloat(k.o), high: parseFloat(k.h),
          low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v),
        };
        setLastPrice(bar.close);
        const updated = [...barsRef.current.slice(-199), bar];
        barsRef.current = updated;
        if (updated.length >= 60) {
          const state = computeAlgo(updated, config);
          setAlgoState(state);
          const sig = checkSignal(state, config, bar.close);
          if (sig) setSignalLog(prev => [...prev.slice(-49), sig]);
        }
      } catch {}
    };
    wsRef.current = ws;
  }, [config]);

  useEffect(() => {
    loadBars(config.symbol, config.interval).then(() => connectWS(config.symbol, config.interval));
    return () => wsRef.current?.close();
  }, [config.symbol, config.interval]);

  const panel = (title: string, children: React.ReactNode) => (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b", borderRadius: "10px",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "8px 16px", background: "#1e293b",
        fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600,
      }}>
        {title}
      </div>
      {children}
    </div>
  );

  const s = algoState;
  const scoreColor = s ? (s.composite >= 75 ? "#22c55e" : s.composite >= 55 ? "#eab308" : "#ef4444") : "#64748b";

  return (
    <div style={{
      background: "#020817", minHeight: "100vh", padding: "16px",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      color: "#f1f5f9",
    }}>
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.05em" }}>
            HEATSEEKER <span style={{ color: "#3b82f6" }}>v2.0</span>
          </div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>
            {config.symbol} · {config.interval} · All-Inputs Composite
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {lastPrice && (
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#f1f5f9", fontFamily: "monospace" }}>
              ${lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
          <div style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: loading ? "#f59e0b" : "#22c55e",
            animation: loading ? "none" : "pulse 2s infinite",
          }} />
        </div>
      </div>

      {/* SYMBOL / INTERVAL SELECTORS */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        {SYMBOLS.map(sym => (
          <button key={sym} onClick={() => setConfig(c => ({ ...c, symbol: sym }))}
            style={{
              padding: "4px 10px", fontSize: "11px", fontFamily: "monospace",
              background: config.symbol === sym ? "#3b82f6" : "#1e293b",
              color: config.symbol === sym ? "#fff" : "#94a3b8",
              border: "1px solid " + (config.symbol === sym ? "#3b82f6" : "#334155"),
              borderRadius: "4px", cursor: "pointer",
            }}>
            {sym.replace("USDT", "")}
          </button>
        ))}
        <div style={{ width: "1px", background: "#334155", alignSelf: "stretch" }} />
        {INTERVALS.map(ivl => (
          <button key={ivl} onClick={() => setConfig(c => ({ ...c, interval: ivl }))}
            style={{
              padding: "4px 10px", fontSize: "11px", fontFamily: "monospace",
              background: config.interval === ivl ? "#1d4ed8" : "#1e293b",
              color: config.interval === ivl ? "#fff" : "#94a3b8",
              border: "1px solid " + (config.interval === ivl ? "#1d4ed8" : "#334155"),
              borderRadius: "4px", cursor: "pointer",
            }}>
            {ivl}
          </button>
        ))}
      </div>

      {/* TABS */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "16px", borderBottom: "1px solid #1e293b", paddingBottom: "8px" }}>
        {(["dashboard", "alignment", "log", "config"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: "5px 14px", fontSize: "11px", background: "none", border: "none",
              color: tab === t ? "#3b82f6" : "#64748b", cursor: "pointer", fontFamily: "monospace",
              borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
              textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: "6px", padding: "12px 16px", marginBottom: "12px", color: "#fca5a5", fontSize: "12px" }}>
          ⚠ {error}
        </div>
      )}

      {loading && (
        <div style={{ color: "#64748b", fontSize: "12px", textAlign: "center", padding: "32px" }}>
          Loading bars…
        </div>
      )}

      {/* ── DASHBOARD TAB ── */}
      {tab === "dashboard" && s && !loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
          {panel("Heatseek Score", (
            <>
              <div style={{ display: "flex", justifyContent: "center", padding: "16px 0 8px" }}>
                <ScoreMeter score={s.composite} direction={s.direction} />
              </div>
              <VoteBar bull={s.bullVotes} bear={s.bearVotes} />
              <EnergyBars energy={s.energyPts} conf={s.confPts} dir={s.dirBiasRaw} />
            </>
          ))}

          {panel("Target Projection", <TargetPanel state={s} />)}

          {panel("Key Levels", (
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {[
                { label: "PDH",    value: s.pdh,    color: "#f59e0b" },
                { label: "PDL",    value: s.pdl,    color: "#ef4444" },
                { label: "VWAP",   value: s.vwap,   color: "#eab308" },
                { label: "VPOC",   value: s.vpoc,   color: "#818cf8" },
                { label: "OR Hi",  value: s.orHigh, color: "#3b82f6" },
                { label: "OR Lo",  value: s.orLow,  color: "#8b5cf6" },
                { label: "EMA21",  value: s.ema21,  color: "#22c55e" },
                { label: "EMA55",  value: s.ema55,  color: "#fb923c" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>{label}</span>
                  <span style={{ fontSize: "12px", color, fontFamily: "monospace", fontWeight: 600 }}>
                    {value.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          ))}

          {panel("Regime Indicators", (
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {[
                { label: "RVOL", value: `${s.rvol.toFixed(2)}x`, ok: s.rvol > config.rvolMin },
                { label: "ADX",  value: s.adxVal.toFixed(1), ok: s.adxVal > config.adxMin },
                { label: "Hurst", value: s.hurstEst.toFixed(3), ok: s.trendingRegime },
                { label: "Vol %ile", value: `${Math.round(s.volPctRank)}%`, ok: s.volPctRank > 50 },
                { label: "VWAP Ext.", value: s.vwapExtended ? "YES" : "no", ok: !s.vwapExtended },
                { label: "Power Hour", value: s.isPowerHour ? "YES" : "no", ok: s.isPowerHour },
                { label: "IDR OK", value: s.idrOk ? "YES" : "COMPRESSED", ok: s.idrOk },
                { label: "Range Exp", value: s.rangeExp ? "YES" : "no", ok: s.rangeExp },
                { label: "RSI Exhaust", value: s.rsiExhaust ? `${Math.round(s.rsi)} ⚠` : Math.round(s.rsi).toString(), ok: !s.rsiExhaust },
                { label: "Touch Decay", value: `${s.touchCount}x`, ok: s.touchCount < 3 },
              ].map(({ label, value, ok }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>{label}</span>
                  <span style={{ fontSize: "11px", color: ok ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── ALIGNMENT TAB ── */}
      {tab === "alignment" && s && !loading && panel("Full Alignment Stack — All 20 Algo Inputs", (
        <>
          <AlignRow label="MTF Structure" value={`${s.mtfBullCount}B/${s.mtfBearCount}Br`}
            pts={`${s.mtfBullCount * 5}pts`}
            color={s.mtfBullCount >= 2 ? "#22c55e" : s.mtfBearCount >= 2 ? "#ef4444" : "#64748b"} />
          <AlignRow label="VPOC Accept" value={`${s.vpoc.toFixed(2)}`} pts="5pts"
            color={Math.abs((lastPrice || 0) - s.vpoc) < s.atr * 0.75 ? "#22c55e" : "#64748b"} />
          <AlignRow label="CVD Delta" value={`${s.cvdRoc > 0 ? "▲ ACCUM" : "▼ DIST"}`} pts={`${(Math.min(Math.abs(s.cvdRoc) / 1e6, 1) * 5).toFixed(1)}pts`}
            color={s.cvdRoc > 0 ? "#22c55e" : "#ef4444"} />
          <AlignRow label="FVG + Vol" value={s.fvgWithVol ? (s.fvgBull ? "▲ BULL+VOL" : "▼ BEAR+VOL") : s.fvgBull ? "▲ FVG" : s.fvgBear ? "▼ FVG" : "NONE"} pts="4pts"
            color={s.fvgWithVol ? "#22c55e" : s.fvgBull || s.fvgBear ? "#eab308" : "#64748b"} />
          <AlignRow label="Sweep+CVD" value={s.sweepBull ? "▲ BULL SWEEP" : s.sweepBear ? "▼ BEAR SWEEP" : "NONE"} pts="5pts"
            color={s.sweepBull ? "#22c55e" : s.sweepBear ? "#ef4444" : "#64748b"} />
          <AlignRow label="IDR / Std Dev" value={s.idrOk ? "OK" : "COMPRESSED"} pts="x0.7"
            color={s.idrOk ? "#22c55e" : "#f59e0b"} />
          <AlignRow label="ADX" value={`${s.adxVal.toFixed(1)} DI+${s.diPlus.toFixed(1)}/DI-${s.diMinus.toFixed(1)}`} pts="5pts"
            color={s.adxVal > config.adxMin ? (s.diPlus > s.diMinus ? "#22c55e" : "#ef4444") : "#64748b"} />
          <AlignRow label="Power Hour" value={s.isPowerHour ? "ACTIVE ×1.25" : s.isLateSess ? "LATE ×0.75" : "NORMAL ×1.0"} pts="mult"
            color={s.isPowerHour ? "#22c55e" : s.isLateSess ? "#f59e0b" : "#94a3b8"} />
          <AlignRow label="VWAP Bands" value={s.vwapExtended ? "EXTENDED" : `${s.vwap.toFixed(2)}`} pts="5pts"
            color={s.vwapExtended ? "#f59e0b" : "#22c55e"} />
          <AlignRow label="Imbalance Ratio" value={`${s.imbRatio.toFixed(2)}x`} pts="5pts"
            color={s.imbRatio > config.imbRatioThresh ? "#22c55e" : (1 / Math.max(s.imbRatio, 0.001)) > config.imbRatioThresh ? "#ef4444" : "#64748b"} />
          <AlignRow label="SuperTrend" value={`${s.superTrendDir === "BULL" ? "▲" : "▼"} ${s.superTrendDir} @ ${s.superTrendVal.toFixed(2)}`} pts="5pts"
            color={s.superTrendDir === "BULL" ? "#22c55e" : "#ef4444"} />
          <AlignRow label="RVOL" value={`${s.rvol.toFixed(2)}x`} pts={`${Math.min(s.rvol / config.rvolMin, 3).toFixed(1)}×6`}
            color={s.rvol > config.rvolMin ? "#22c55e" : "#64748b"} />
          <AlignRow label="Hurst Exponent" value={`${s.hurstEst.toFixed(3)} ${s.trendingRegime ? "TREND" : "CHOP"}`} pts="5pts"
            color={s.trendingRegime ? "#22c55e" : "#64748b"} />
          <AlignRow label="EMA 21/55 Slope" value={`${s.ema21 > s.ema55 ? "▲" : "▼"} Δ${s.emaSlope.toFixed(2)}`} pts="5pts"
            color={s.ema21 > s.ema55 && s.emaSlope > 0 ? "#22c55e" : s.ema21 < s.ema55 && s.emaSlope < 0 ? "#ef4444" : "#64748b"} />
          <AlignRow label="Touch Decay" value={`${s.touchCount} touches`} pts={`-${Math.round(s.decayPenalty * 30)}%`}
            color={s.touchCount > 3 ? "#f59e0b" : "#22c55e"} />
          <AlignRow label="Vol Percentile" value={`${Math.round(s.volPctRank)}%`} pts={`${(s.volPctRank / 100 * 8).toFixed(1)}pts`}
            color={s.volPctRank > 70 ? "#22c55e" : s.volPctRank < 30 ? "#64748b" : "#eab308"} />
          <AlignRow label="Time-of-Day" value={s.isPowerHour ? "POWER HOUR" : s.isLateSess ? "LATE SESSION" : "NORMAL"} pts="mult"
            color={s.isPowerHour ? "#22c55e" : s.isLateSess ? "#f59e0b" : "#94a3b8"} />
          <AlignRow label="MACD Histogram" value={s.macdBullHidDiv ? "▲ HIDDEN DIV" : s.macdBearHidDiv ? "▼ HIDDEN DIV" : s.macdHist > 0 ? "▲ BULL" : "▼ BEAR"} pts="5pts"
            color={s.macdBullHidDiv ? "#22c55e" : s.macdBearHidDiv ? "#ef4444" : s.macdHist > 0 ? "#22c55e" : "#ef4444"} />
          <AlignRow label="RSI Exhaustion" value={`${Math.round(s.rsi)} ${s.rsiExhaust ? "⚠ EXHAUST" : ""}`} pts={s.rsiExhaust ? "-5pts" : "+5pts"}
            color={s.rsiExhaust ? "#f59e0b" : s.rsi > 50 ? "#22c55e" : "#ef4444"} />
          <AlignRow label="Range Expansion" value={s.rangeExp ? "EXPANDING" : "CONTRACTING"} pts="5pts"
            color={s.rangeExp ? "#22c55e" : "#64748b"} />
        </>
      ))}

      {/* ── LOG TAB ── */}
      {tab === "log" && panel("Signal Log", <SignalLogTable logs={signalLog} />)}

      {/* ── CONFIG TAB ── */}
      {tab === "config" && panel("Configuration", (
        <div style={{ padding: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
          {(Object.entries(config) as [keyof Config, number | string][])
            .filter(([k]) => !["symbol", "interval"].includes(k))
            .map(([key, val]) => (
              <div key={key}>
                <label style={{ display: "block", fontSize: "11px", color: "#64748b", marginBottom: "4px", textTransform: "uppercase" }}>
                  {key.replace(/([A-Z])/g, " $1")}
                </label>
                <input
                  type="number"
                  value={val as number}
                  step={typeof val === "number" && val < 5 ? "0.05" : "1"}
                  onChange={e => setConfig(c => ({ ...c, [key]: parseFloat(e.target.value) }))}
                  style={{
                    width: "100%", background: "#1e293b", border: "1px solid #334155",
                    borderRadius: "4px", padding: "6px 8px", color: "#f1f5f9",
                    fontSize: "12px", fontFamily: "monospace",
                  }}
                />
              </div>
            ))}
          <button onClick={() => loadBars(config.symbol, config.interval)}
            style={{
              gridColumn: "1/-1", padding: "10px", background: "#3b82f6",
              border: "none", borderRadius: "6px", color: "#fff",
              fontSize: "13px", cursor: "pointer", fontWeight: 600, fontFamily: "monospace",
            }}>
            ↻ RELOAD WITH NEW CONFIG
          </button>
        </div>
      ))}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
