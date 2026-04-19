// MoE Gating Engine — client-side compute
// Gemini blueprint: regime → weights → gated alpha
// Experts that ARE wired: vector (MTF), volatility (ATR/BB)
// Experts NOT YET built: ghost (SMC/OB), arb (stat-arb), pulse (Grok velocity)

// PULSE = XSocial Grok×X signal — 45% weight when regime is news-driven
// Gemini blueprint: "meritocracy not democracy" — one expert dominates per regime
const MOE_WEIGHTS = {
  HIGH_VOL_NEWS:  { vector: 0.15, volatility: 0.10, ghost: 0.00, arb: 0.00, pulse: 0.75 },
  MEAN_REVERSION: { vector: 0.10, volatility: 0.10, ghost: 0.10, arb: 0.70, pulse: 0.00 },
  GAMMA_SQUEEZE:  { vector: 0.10, volatility: 0.70, ghost: 0.10, arb: 0.00, pulse: 0.10 },
  TREND:          { vector: 0.45, volatility: 0.10, ghost: 0.30, arb: 0.00, pulse: 0.15 },
  UNKNOWN:        { vector: 0.25, volatility: 0.15, ghost: 0.15, arb: 0.15, pulse: 0.30 },
  // UNKNOWN baseline: PULSE gets 30% — X always has signal even in ambiguous regime
}

// Detect regime from asset summary data
// Uses: rel_vol, atr_score, trend_score, composite_score
export function detectRegime(assets) {
  if (!assets?.length) return 'UNKNOWN'

  const n = assets.length
  const avgRelVol  = assets.reduce((s, a) => s + (a.rel_vol ?? 1), 0) / n
  const avgATR     = assets.reduce((s, a) => s + (a.vol_score ?? 0), 0) / n
  const avgTrend   = assets.reduce((s, a) => s + Math.abs(a.trend_score ?? 0), 0) / n

  if (avgRelVol > 2.0 && avgATR > 0.5)  return 'HIGH_VOL_NEWS'
  if (avgATR > 0.7 && avgRelVol < 1.2)  return 'GAMMA_SQUEEZE'
  if (avgTrend > 0.5 && avgATR < 0.4)   return 'TREND'
  if (avgATR < 0.3 && avgRelVol < 1.1)  return 'MEAN_REVERSION'
  return 'UNKNOWN'
}

// Compute per-asset alpha using available experts + regime weights
export function computeAlpha(asset, regime, pulseSignal = 0) {
  const w = MOE_WEIGHTS[regime] ?? MOE_WEIGHTS.UNKNOWN

  // VECTOR expert: trend + momentum alignment (-1..+1)
  const vector    = normalize(asset.trend_score ?? 0, asset.mom_score ?? 0)

  // VOLATILITY expert: ATR breakout signal (-1..+1)
  const volatility = clamp(asset.vol_score ?? 0, -1, 1)

  // GHOST expert: SMC order block — [[[NOT BUILT]]]
  const ghost = 0

  // ARB expert: stat-arb z-score — [[[NOT BUILT]]]
  const arb = 0

  // PULSE expert: from Grok velocity (-1..+1)
  const pulse = clamp(pulseSignal, -1, 1)

  const alpha = (
    vector    * w.vector    +
    volatility * w.volatility +
    ghost     * w.ghost     +
    arb       * w.arb       +
    pulse     * w.pulse
  )

  return {
    symbol: asset.symbol,
    alpha: clamp(alpha, -1, 1),
    direction: alpha > 0.15 ? 'LONG' : alpha < -0.15 ? 'SHORT' : 'FLAT',
    regime,
    fire: Math.abs(alpha) > 0.85,
    experts: { vector, volatility, ghost, arb, pulse },
    weights: w,
  }
}

function normalize(trend, mom) {
  return clamp((trend + mom) / 2, -1, 1)
}

function clamp(v, min = -1, max = 1) {
  return Math.max(min, Math.min(max, v))
}

export { MOE_WEIGHTS }
