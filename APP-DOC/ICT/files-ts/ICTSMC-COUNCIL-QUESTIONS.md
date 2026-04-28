# ICTSMC Council Question Pack (Gold-Standard Validation)

Use these prompts with your AI Council to challenge dogma and improve robustness.

## 1) Core Edge Validity
- Does "Purge (L3) gates Displacement (L4)" improve expectancy vs displacement-only?
- What is the Sharpe/Calmar delta when BOS/CHoCH is confidence-only vs hard-gate?
- Is sentiment at 4% weight optimal, or does 0-2% outperform in volatile regimes?

## 2) Early vs Late Entry Policy
- In trending regimes, does `EARLY >= 65` outperform `LATE >= 70` after costs?
- In ranging regimes, should EARLY be disabled entirely?
- In volatile regimes, is "both allowed at half size" better than "late only"?

## 3) Human Factors Encoding
- Which human factors produce the biggest reduction in left-tail drawdowns?
- Should low sleep + high stress trigger no-trade instead of size reduction?
- What discipline threshold should force hard-stop trading for the session?

## 4) Risk & Survivability
- Is quarter-Kelly still too aggressive under clustered volatility?
- What max risk per trade survives 10-loss streaks while preserving CAGR?
- Should we add a daily circuit breaker after 2 losses or -2R?

## 5) Execution Reality Checks
- Slippage/fees: how much alpha remains at realistic execution quality?
- Does this edge survive spread widening around session transitions?
- Which entry type is least fragile: OB touch, FVG midpoint reclaim, or displacement close?

## 6) Anti-Dogma Red-Team
- Which ICT beliefs fail most often on out-of-sample data?
- Where does BOS/CHoCH become structurally late and lose RR?
- What conditions create the highest false-positive liquidity sweeps?

## 7) Acceptance Criteria (Go/No-Go)
- OOS Sharpe >= 1.4
- Profit factor >= 1.35
- Max DD <= 12%
- Positive expectancy in all three regimes over walk-forward windows
- No single month contributes >35% of total returns (avoid one-regime dependence)
