import { writable, derived } from 'svelte/store'

// Raw engine data
export const engineAssets = writable([])   // Vec<AssetSummary> from /api/v1/assets
export const pulse        = writable(null) // Grok pulse latest

// MoE expert signals — computed from engine data + pulse
// Each expert returns -1..+1
export const expertScores = writable({
  vector:    null,   // MTF momentum expert  (engine TREND/MOM)
  volatility: null,  // Volatility/Gamma expert (engine VOL/ATR)
  ghost:     null,   // SMC Order Block expert  [[[NOT BUILT — placeholder]]]
  arb:       null,   // Stat Arb cointegration  [[[NOT BUILT — placeholder]]]
  pulse:     null,   // Sentiment velocity from Grok pulse
})

// Detected regime from engine data → determines MoE weights
// Regimes: HIGH_VOL_NEWS | MEAN_REVERSION | TREND | GAMMA_SQUEEZE
export const regime = writable('UNKNOWN')

// MoE gating weights per regime (from Gemini blueprint)
export const moeWeights = derived(regime, $r => {
  switch ($r) {
    case 'HIGH_VOL_NEWS':   return { vector: 0.2, volatility: 0.1, ghost: 0.0, arb: 0.0, pulse: 0.7 }
    case 'MEAN_REVERSION':  return { vector: 0.1, volatility: 0.1, ghost: 0.1, arb: 0.7, pulse: 0.0 }
    case 'GAMMA_SQUEEZE':   return { vector: 0.1, volatility: 0.7, ghost: 0.1, arb: 0.0, pulse: 0.1 }
    case 'TREND':           return { vector: 0.5, volatility: 0.1, ghost: 0.3, arb: 0.0, pulse: 0.1 }
    default:                return { vector: 0.3, volatility: 0.2, ghost: 0.2, arb: 0.2, pulse: 0.1 }
  }
})

// Final gated alpha per asset — computed externally and written here
export const alphaSignals = writable([])  // [{ symbol, alpha, regime, direction, experts }]

// Active page
export const page = writable('alpha')
