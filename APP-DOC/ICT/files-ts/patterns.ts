// =============================================================================
// SURGE — Candle Pattern Classifier
// =============================================================================

import type { OHLCV, CandlePattern, CandleFeatures } from "../../types/index.js";

export function features(bar: OHLCV): CandleFeatures {
  const body       = Math.abs(bar.close - bar.open);
  const range      = bar.high - bar.low;
  const upperWick  = bar.high - Math.max(bar.close, bar.open);
  const lowerWick  = Math.min(bar.close, bar.open) - bar.low;
  return {
    body,
    range,
    upperWick,
    lowerWick,
    isBull:        bar.close > bar.open,
    bodyPct:       range > 0 ? body / range : 0,
    upperWickPct:  range > 0 ? upperWick / range : 0,
    lowerWickPct:  range > 0 ? lowerWick / range : 0,
  };
}

/** Bullish candle pattern at a retest level */
export function bullPattern(cur: OHLCV, prev: OHLCV): CandlePattern {
  const c = features(cur);
  const p = features(prev);

  // Engulfing: bull body swallows prev bear body
  if (
    c.isBull &&
    cur.open  <= prev.close &&
    cur.close >= prev.open  &&
    c.body >= p.body * 0.75
  ) return "Engulfing";

  // Pin bar / hammer: long lower wick, small body
  if (c.lowerWick > c.body * 2.0 && c.lowerWick > c.upperWick * 2.5 && c.range > 0)
    return "PinBar";

  // Rejection wick: lower wick > 60% of range, closes bullish
  if (c.lowerWickPct > 0.60 && c.isBull)
    return "RejectionWick";

  // Inside bar: consolidation, confirms level respect
  if (cur.high < prev.high && cur.low > prev.low)
    return "InsideBar";

  // Doji at level
  if (c.bodyPct < 0.10 && c.range > 0)
    return "Doji";

  // Plain close above level counts as confirmation if requirePattern=false
  return "None";
}

/** Bearish candle pattern at a retest level */
export function bearPattern(cur: OHLCV, prev: OHLCV): CandlePattern {
  const c = features(cur);
  const p = features(prev);

  if (
    !c.isBull &&
    cur.open  >= prev.close &&
    cur.close <= prev.open  &&
    c.body >= p.body * 0.75
  ) return "Engulfing";

  if (c.upperWick > c.body * 2.0 && c.upperWick > c.lowerWick * 2.5 && c.range > 0)
    return "PinBar";

  if (c.upperWickPct > 0.60 && !c.isBull)
    return "RejectionWick";

  if (cur.high < prev.high && cur.low > prev.low)
    return "InsideBar";

  if (c.bodyPct < 0.10 && c.range > 0)
    return "Doji";

  return "None";
}

/** Pattern strength score 0-1 */
export function patternStrength(p: CandlePattern): number {
  const s: Record<CandlePattern, number> = {
    Engulfing:      0.90,
    PinBar:         0.85,
    RejectionWick:  0.75,
    InsideBar:      0.55,
    Doji:           0.50,
    CloseConfirm:   0.40,
    None:           0.00,
  };
  return s[p] ?? 0;
}
