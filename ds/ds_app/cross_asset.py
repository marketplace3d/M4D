"""
Cross-Asset Spread Engine — 5 new alpha dimensions from futures.db crypto bars.

Dimensions computed on aligned 5m bars (last N_BARS):

  1. btc_eth_ratio    — BTC/ETH price ratio z-score (BTC dominance signal)
  2. alt_beta         — mean(SOL,AVAX,LINK,ARB) vs BTC return diff (alt risk appetite)
  3. defi_momentum    — mean(UNI,LINK,ARB,OP) vs ETH return diff (DeFi premium)
  4. l1_spread        — SOL vs ETH 5m return spread z-score (L1 competition)
  5. btc_corr_break   — rolling BTC×alt-basket corr deviation (-1=breakdown, +1=lock-step)

All scores normalized to -1..+1. Positive = bullish regime / risk-on.
Output: data/cross_asset_report.json
"""

import json, pathlib, sqlite3, time
import numpy as np

DB_PATH    = pathlib.Path(__file__).parent.parent / "data" / "futures.db"
OUT_PATH   = pathlib.Path(__file__).parent.parent / "data" / "cross_asset_report.json"
N_BARS     = 288          # 24h of 5m bars
CORR_WINDOW = 48          # 4h rolling correlation window
Z_CLIP     = 3.0

# ── DB loader ────────────────────────────────────────────────────────────────

def load_closes(symbols: list, n: int = N_BARS) -> dict:
    conn = sqlite3.connect(DB_PATH)
    out = {}
    for sym in symbols:
        rows = conn.execute(
            "SELECT ts, close FROM bars_5m WHERE symbol=? ORDER BY ts DESC LIMIT ?",
            (sym, n),
        ).fetchall()
        if rows:
            rows.sort(key=lambda r: r[0])
            out[sym] = np.array([r[1] for r in rows], dtype=float)
    conn.close()
    return out

# ── Helpers ──────────────────────────────────────────────────────────────────

def returns(arr: np.ndarray) -> np.ndarray:
    return np.diff(arr) / arr[:-1]

def zscore(arr: np.ndarray, clip: float = Z_CLIP) -> np.ndarray:
    mu, sigma = arr.mean(), arr.std()
    if sigma < 1e-9:
        return np.zeros_like(arr)
    return np.clip((arr - mu) / sigma, -clip, clip) / clip

def rolling_corr(a: np.ndarray, b: np.ndarray, w: int) -> np.ndarray:
    n = len(a)
    out = np.full(n, np.nan)
    for i in range(w - 1, n):
        sa, sb = a[i - w + 1:i + 1], b[i - w + 1:i + 1]
        if sa.std() > 1e-9 and sb.std() > 1e-9:
            out[i] = np.corrcoef(sa, sb)[0, 1]
    return out

def align(*arrs) -> list:
    """Trim all arrays to the same length (shortest)."""
    n = min(len(a) for a in arrs)
    return [a[-n:] for a in arrs]

# ── 5 Dimensions ─────────────────────────────────────────────────────────────

def dim_btc_eth_ratio(closes: dict) -> dict:
    btc, eth = closes.get("BTC"), closes.get("ETH")
    if btc is None or eth is None:
        return {"score": 0.0, "error": "missing data"}
    btc, eth = align(btc, eth)
    ratio = btc / eth
    z = zscore(ratio)
    # Positive z-score = BTC outperforming ETH = BTC dominance rising = risk-neutral/BTC rotation
    # Negative = ETH outperforming = alt season / risk-on
    score = float(-z[-1])   # invert: ETH strength = risk-on = +1
    hist = z.tolist()
    return {
        "score": round(np.clip(score, -1, 1), 4),
        "interpretation": "ETH outperforms BTC (alt-season risk-on)" if score > 0 else "BTC dominance rising (rotation to safety)",
        "history_24h": [round(v, 4) for v in hist[-48:]],
    }

def dim_alt_beta(closes: dict) -> dict:
    alts = ["SOL", "AVAX", "LINK", "ARB"]
    btc = closes.get("BTC")
    alt_closes = [closes.get(s) for s in alts if closes.get(s) is not None]
    if btc is None or len(alt_closes) < 2:
        return {"score": 0.0, "error": "missing data"}

    # Align all to shortest
    all_arrs = [btc] + alt_closes
    all_arrs = align(*all_arrs)
    btc_r = returns(all_arrs[0])
    alt_rs = [returns(a) for a in all_arrs[1:]]
    mean_alt_r = np.mean(alt_rs, axis=0)

    # Spread: alts - BTC (positive = alts outperforming = risk appetite)
    spread = mean_alt_r - btc_r
    z = zscore(spread)
    score = float(z[-1])
    return {
        "score": round(np.clip(score, -1, 1), 4),
        "alts_used": alts[:len(alt_closes)],
        "interpretation": "Alts outperforming BTC (risk-on appetite)" if score > 0 else "BTC leading (risk-off rotation)",
        "history_24h": [round(v, 4) for v in z[-48:].tolist()],
    }

def dim_defi_momentum(closes: dict) -> dict:
    defi_syms = ["UNI", "LINK", "ARB", "OP"]
    eth = closes.get("ETH")
    defi_closes = [closes.get(s) for s in defi_syms if closes.get(s) is not None]
    if eth is None or len(defi_closes) < 2:
        return {"score": 0.0, "error": "missing data"}

    all_arrs = [eth] + defi_closes
    all_arrs = align(*all_arrs)
    eth_r = returns(all_arrs[0])
    defi_rs = [returns(a) for a in all_arrs[1:]]
    mean_defi_r = np.mean(defi_rs, axis=0)

    spread = mean_defi_r - eth_r
    z = zscore(spread)
    score = float(z[-1])
    return {
        "score": round(np.clip(score, -1, 1), 4),
        "defi_used": defi_syms[:len(defi_closes)],
        "interpretation": "DeFi outperforming ETH (protocol premium expanding)" if score > 0 else "ETH base layer leading (DeFi discount)",
        "history_24h": [round(v, 4) for v in z[-48:].tolist()],
    }

def dim_l1_spread(closes: dict) -> dict:
    sol, eth = closes.get("SOL"), closes.get("ETH")
    if sol is None or eth is None:
        return {"score": 0.0, "error": "missing data"}
    sol, eth = align(sol, eth)
    sol_r = returns(sol)
    eth_r = returns(eth)
    spread = sol_r - eth_r
    z = zscore(spread)
    score = float(z[-1])
    return {
        "score": round(np.clip(score, -1, 1), 4),
        "interpretation": "SOL outperforming ETH (L1 competition / beta chase)" if score > 0 else "ETH leading (quality rotation)",
        "history_24h": [round(v, 4) for v in z[-48:].tolist()],
    }

def dim_btc_corr_break(closes: dict) -> dict:
    """
    Rolling 4h corr between BTC and alt basket.
    High corr = market moving together (BTC-led, reliable signals).
    Corr breakdown = divergence = noise, caution.
    Score: current_corr - mean_corr (z-scored). Positive = corr holding = clean.
    """
    alt_syms = ["ETH", "SOL", "BNB", "XRP"]
    btc = closes.get("BTC")
    alt_closes = [closes.get(s) for s in alt_syms if closes.get(s) is not None]
    if btc is None or len(alt_closes) < 2:
        return {"score": 0.0, "error": "missing data"}

    all_arrs = [btc] + alt_closes
    all_arrs = align(*all_arrs)
    btc_r = returns(all_arrs[0])
    alt_rs = [returns(a) for a in all_arrs[1:]]
    mean_alt_r = np.mean(alt_rs, axis=0)

    corr_series = rolling_corr(btc_r, mean_alt_r, CORR_WINDOW)
    valid = corr_series[~np.isnan(corr_series)]
    if len(valid) < 2:
        return {"score": 0.0, "error": "insufficient data"}

    current_corr = valid[-1]
    z = zscore(valid)
    score = float(z[-1])  # positive = corr above mean = cohesive market
    return {
        "score": round(np.clip(score, -1, 1), 4),
        "current_corr": round(current_corr, 4),
        "mean_corr": round(float(valid.mean()), 4),
        "interpretation": "Cohesive market (BTC-led, signals reliable)" if score > 0 else "Divergence: alts decoupling from BTC (noise elevated)",
        "history_24h": [round(v, 4) for v in z[-48:].tolist()],
    }

# ── Composite cross-asset score ───────────────────────────────────────────────

WEIGHTS = {
    "btc_eth_ratio":  0.15,   # BTC vs ETH dominance
    "alt_beta":       0.30,   # alt risk appetite — highest weight
    "defi_momentum":  0.20,   # DeFi protocol premium
    "l1_spread":      0.15,   # SOL vs ETH L1 competition
    "btc_corr_break": 0.20,   # market cohesion quality gate
}

def run_cross_asset() -> dict:
    all_syms = ["BTC", "ETH", "SOL", "BNB", "XRP", "AVAX", "LINK", "ARB", "UNI", "OP"]
    closes = load_closes(all_syms, N_BARS + 10)

    dims = {
        "btc_eth_ratio":  dim_btc_eth_ratio(closes),
        "alt_beta":       dim_alt_beta(closes),
        "defi_momentum":  dim_defi_momentum(closes),
        "l1_spread":      dim_l1_spread(closes),
        "btc_corr_break": dim_btc_corr_break(closes),
    }

    composite = sum(
        dims[k]["score"] * w
        for k, w in WEIGHTS.items()
        if "error" not in dims[k]
    )
    composite = round(float(np.clip(composite, -1, 1)), 4)

    # Regime label
    if composite > 0.35:
        regime = "RISK_ON"
    elif composite < -0.35:
        regime = "RISK_OFF"
    else:
        regime = "NEUTRAL"

    report = {
        "ok": True,
        "ts": int(time.time()),
        "composite": composite,
        "regime": regime,
        "weights": WEIGHTS,
        "dimensions": dims,
        "symbols_loaded": list(closes.keys()),
        "n_bars": N_BARS,
    }
    OUT_PATH.parent.mkdir(exist_ok=True)
    OUT_PATH.write_text(json.dumps(report, indent=2))
    return report


def load_latest() -> dict | None:
    if OUT_PATH.exists():
        return json.loads(OUT_PATH.read_text())
    return None


_CROSS_CACHE_TTL = 900   # 15 min: refresh cross-asset report if stale

def cross_asset_mult(
    risk_on_boost: float  = 1.20,
    risk_off_cut:  float  = 0.70,
    stale_default: float  = 1.0,
) -> tuple[float, str]:
    """
    Returns (size_multiplier, regime_label) from the latest cached cross-asset report.
    RISK_ON  → +20% size (default)
    RISK_OFF → -30% size (default)
    NEUTRAL / stale → 1.0×
    """
    report = load_latest()
    if report is None:
        return stale_default, "UNKNOWN"

    age = time.time() - report.get("ts", 0)
    if age > _CROSS_CACHE_TTL:
        return stale_default, "STALE"

    regime = report.get("regime", "NEUTRAL")
    if regime == "RISK_ON":
        return risk_on_boost, regime
    elif regime == "RISK_OFF":
        return risk_off_cut, regime
    return 1.0, regime


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)
    r = run_cross_asset()
    print(f"Composite: {r['composite']:+.4f}  Regime: {r['regime']}")
    for k, v in r["dimensions"].items():
        s = v.get("score", "?")
        note = v.get("interpretation", v.get("error", ""))[:60]
        print(f"  {k:20s} {s:+.4f}  {note}")
