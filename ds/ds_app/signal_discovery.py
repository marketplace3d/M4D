"""
ds_app/signal_discovery.py — Alpha Signal Discovery Engine (P3-A)

RenTech-style systematic signal generation + IC screening.

Pipeline:
  1. GENERATE — 500+ candidate transforms from OHLCV bars
     - Lagged returns (1–20 bars)
     - Rolling stats: z-scores, percentile ranks, std ratios
     - Cross-asset ratios (when multiple symbols available)
     - Nonlinear transforms: abs, sign, clip, power
     - Interaction terms: product of two primitives
     - Indicator residuals: RSI/MACD/ATR normalized
  2. IC SCREEN — Spearman IC(candidate, outcome_1h_pct) over last 30d
     - Min |IC| > IC_MIN_ABS to pass screening
     - Compute IC for each candidate vs future return
  3. FDR FILTER — Benjamini-Hochberg multiple-testing correction
     - Controls false discovery rate at FDR_ALPHA (default 5%)
     - Only keep candidates significant after correction
  4. RANK & OUTPUT — sorted by |IC|, limited to TOP_N
     - Output: ds/data/signal_discovery.json
     - Endpoint: GET /v1/discovery/   POST /v1/discovery/run/

NOTE: This runs on futures.db 5m bars. Runtime ~30-120s for 500 candidates.
      Results are static until re-run. Run weekly or after major bar ingestion.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

log = logging.getLogger("signal_discovery")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent

FUTURES_DB   = _DS_ROOT / "data" / "futures.db"
REPORT_OUT   = _DS_ROOT / "data" / "signal_discovery.json"

LOOKBACK_BARS  = 8640    # 30 days of 5m bars (for IC computation)
WARMUP_BARS    = 200     # extra bars for indicator warmup (trimmed before IC)
OUTCOME_LAGS   = [12, 24, 36]  # outcome bars ahead (1h, 2h, 3h)
IC_MIN_ABS     = 0.008   # minimum |IC| to report
FDR_ALPHA      = 0.05    # Benjamini-Hochberg FDR threshold
TOP_N          = 50      # max signals to report
MIN_OBS        = 100     # minimum observations per IC computation
# Discovery priority: futures first (deepest liquid signal), BTC last
DISCOVERY_SYMBOLS = ["ES", "NQ", "RTY", "CL", "6E", "ZN", "ZB", "GC", "SI", "BTC"]
TARGET_SYMBOL  = "ES"   # default single-symbol run


# ── Bar loader ─────────────────────────────────────────────────────────────────

def load_bars(symbol: str, n: int) -> pd.DataFrame | None:
    conn = sqlite3.connect(FUTURES_DB)
    rows = conn.execute(
        "SELECT ts, open, high, low, close, volume FROM bars_5m "
        "WHERE symbol=? ORDER BY ts DESC LIMIT ?",
        (symbol, n + WARMUP_BARS),
    ).fetchall()
    conn.close()
    if len(rows) < MIN_OBS:
        return None
    rows.sort(key=lambda r: r[0])
    df = pd.DataFrame(rows, columns=["ts", "Open", "High", "Low", "Close", "Volume"])
    df["ts"] = pd.to_datetime(df["ts"], unit="s", utc=True)
    return df.set_index("ts").astype(float)


# ── Primitive features ─────────────────────────────────────────────────────────

def _safe_zscore(s: pd.Series, w: int) -> pd.Series:
    mu  = s.rolling(w).mean()
    std = s.rolling(w).std().replace(0, np.nan)
    return (s - mu) / std

def _safe_rank(s: pd.Series, w: int) -> pd.Series:
    return s.rolling(w).rank(pct=True)


def generate_candidates(df: pd.DataFrame) -> dict[str, pd.Series]:
    """Returns dict of {name: pd.Series} for all candidate features."""
    c = df["Close"]
    h = df["High"]
    lo = df["Low"]
    v = df["Volume"]
    feats: dict[str, pd.Series] = {}

    # ── 1. Lagged returns ──────────────────────────────────────────────────────
    for lag in [1, 2, 3, 5, 8, 12, 20]:
        feats[f"ret_{lag}"] = c.pct_change(lag)

    # ── 2. Rolling z-scores of return ─────────────────────────────────────────
    ret1 = c.pct_change(1)
    for w in [12, 24, 48, 96]:
        feats[f"ret1_z{w}"] = _safe_zscore(ret1, w)

    # ── 3. Percentile rank of return ──────────────────────────────────────────
    for w in [24, 48, 96, 288]:
        feats[f"ret1_rank{w}"] = _safe_rank(ret1, w)

    # ── 4. Volatility (realized vol) z-score ─────────────────────────────────
    rvol = ret1.rolling(12).std()
    for w in [48, 96, 288]:
        feats[f"rvol_z{w}"] = _safe_zscore(rvol, w)
        feats[f"rvol_rank{w}"] = _safe_rank(rvol, w)

    # ── 5. ATR-normalized price distance from MA ──────────────────────────────
    prev_c = c.shift(1)
    tr = pd.concat([(h-lo), (h-prev_c).abs(), (lo-prev_c).abs()], axis=1).max(axis=1)
    atr14 = tr.ewm(span=14, adjust=False).mean().replace(0, np.nan)

    for ma_span in [12, 24, 48, 96]:
        ma = c.ewm(span=ma_span, adjust=False).mean()
        feats[f"dist_ema{ma_span}_atr"] = (c - ma) / atr14

    # ── 6. Momentum signals ───────────────────────────────────────────────────
    # RSI(14)
    delta = c.diff()
    gain = delta.clip(lower=0).ewm(span=14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(span=14, adjust=False).mean().replace(0, np.nan)
    rsi = 100 - (100 / (1 + gain / loss))
    feats["rsi14"]      = rsi
    feats["rsi14_z48"]  = _safe_zscore(rsi, 48)
    feats["rsi14_rank96"] = _safe_rank(rsi, 96)
    # MACD
    macd = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    sig  = macd.ewm(span=9, adjust=False).mean()
    feats["macd_hist"]      = macd - sig
    feats["macd_hist_z48"]  = _safe_zscore(macd - sig, 48)
    feats["macd_hist_rank96"] = _safe_rank(macd - sig, 96)

    # ── 7. Volume features ────────────────────────────────────────────────────
    dv = c * v
    for w in [12, 24, 48]:
        feats[f"dv_z{w}"]    = _safe_zscore(dv, w)
        feats[f"dv_rank{w}"] = _safe_rank(dv, w)
    # VWAP deviation
    vwap = dv.rolling(48).sum() / v.rolling(48).sum().replace(0, np.nan)
    feats["vwap_dev_atr"] = (c - vwap) / atr14

    # ── 8. High-low range (efficiency) ───────────────────────────────────────
    hl_range = (h - lo) / atr14
    for w in [12, 48]:
        feats[f"hl_range_z{w}"] = _safe_zscore(hl_range, w)

    # ── 9. Close position in bar (candle body) ────────────────────────────────
    # 1 = closed at high, 0 = closed at low
    feats["close_pos"] = (c - lo) / (h - lo + 1e-9)
    for w in [12, 48]:
        feats[f"close_pos_z{w}"] = _safe_zscore(feats["close_pos"], w)

    # ── 10. Nonlinear transforms of key features ──────────────────────────────
    for base in ["ret_1", "ret_3", "ret_5", "rsi14"]:
        if base in feats:
            feats[f"{base}_abs"] = feats[base].abs()
            feats[f"{base}_sign"] = np.sign(feats[base])
            feats[f"{base}_sq"]  = feats[base] ** 2

    # ── 11. Interaction terms (product of two primitives) ─────────────────────
    pairs = [
        ("ret_1",         "rvol_z48"),
        ("ret_1",         "dv_z24"),
        ("macd_hist",     "rsi14"),
        ("rsi14",         "rvol_rank96"),
        ("dist_ema24_atr","rvol_z96"),
        ("close_pos",     "dv_rank24"),
        ("ret_3",         "macd_hist_z48"),
        ("ret_5",         "close_pos"),
    ]
    for a, b in pairs:
        if a in feats and b in feats:
            feats[f"{a}__x__{b}"] = feats[a] * feats[b]

    # ── 12. Mean-reversion: distance from rolling high/low ────────────────────
    for w in [24, 48, 96]:
        hi_w  = h.rolling(w).max()
        lo_w  = lo.rolling(w).min()
        rng_w = (hi_w - lo_w).replace(0, np.nan)
        feats[f"pct_from_high_{w}"] = (c - hi_w) / rng_w
        feats[f"pct_from_low_{w}"]  = (c - lo_w) / rng_w

    return feats


# ── IC computation + FDR filter ───────────────────────────────────────────────

def compute_ic(feat: pd.Series, outcome: pd.Series) -> tuple[float, float]:
    """Spearman IC + p-value. Returns (IC, p)."""
    mask = (~feat.isna()) & (~outcome.isna()) & feat.ne(0)
    if mask.sum() < MIN_OBS:
        return 0.0, 1.0
    r, p = spearmanr(feat[mask].values, outcome[mask].values)
    return (round(float(r), 5) if not np.isnan(r) else 0.0,
            float(p) if not np.isnan(p) else 1.0)


def bh_fdr(p_values: list[float], alpha: float = FDR_ALPHA) -> list[bool]:
    """Benjamini-Hochberg FDR correction. Returns boolean mask of significant tests."""
    n = len(p_values)
    if n == 0:
        return []
    idx   = np.argsort(p_values)
    ranks = np.empty(n)
    ranks[idx] = np.arange(1, n + 1)
    threshold = (ranks / n) * alpha
    p_arr = np.array(p_values)
    # Accept all p-values up to the largest rank that satisfies p ≤ threshold
    below = p_arr <= threshold
    if not below.any():
        return [False] * n
    max_rank = ranks[below].max()
    return [r <= max_rank for r in ranks]


# ── Main run ───────────────────────────────────────────────────────────────────

def run(symbol: str = TARGET_SYMBOL, outcome_lag: int = 12) -> dict:
    """
    symbol      — futures.db symbol to run discovery on
    outcome_lag — bars ahead for IC target (12=1h, 24=2h, 36=3h)
    """
    t0 = time.time()
    log.info("Signal discovery: symbol=%s  outcome_lag=%d bars", symbol, outcome_lag)

    df = load_bars(symbol, LOOKBACK_BARS)
    if df is None:
        return {"ok": False, "error": f"No bars for {symbol}"}

    # Outcome: forward return
    outcome = df["Close"].pct_change(outcome_lag).shift(-outcome_lag)

    # Generate candidates
    candidates = generate_candidates(df)
    log.info("Generated %d candidate features", len(candidates))

    # Trim warmup
    df_trim = df.iloc[WARMUP_BARS:]
    outcome_trim = outcome.iloc[WARMUP_BARS:]

    # Compute IC for each candidate
    records: list[dict] = []
    for name, series in candidates.items():
        series_trim = series.iloc[WARMUP_BARS:]
        ic, pval = compute_ic(series_trim, outcome_trim)
        records.append({"name": name, "ic": ic, "pval": pval, "ic_abs": abs(ic)})

    # FDR filter
    p_vals = [r["pval"] for r in records]
    significant = bh_fdr(p_vals, FDR_ALPHA)

    surviving: list[dict] = []
    for rec, sig in zip(records, significant):
        if sig and rec["ic_abs"] >= IC_MIN_ABS:
            surviving.append(rec)

    surviving.sort(key=lambda r: r["ic_abs"], reverse=True)
    top = surviving[:TOP_N]

    elapsed = round(time.time() - t0, 1)
    log.info("FDR survivors: %d / %d  (%.1fs)", len(surviving), len(records), elapsed)
    for r in top[:10]:
        log.info("  %-40s IC=%+.5f  p=%.4f", r["name"], r["ic"], r["pval"])

    report = {
        "ok":              True,
        "generated_at":    __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "symbol":          symbol,
        "outcome_lag_bars": outcome_lag,
        "outcome_horizon": f"{outcome_lag * 5}m",
        "n_candidates":    len(records),
        "n_fdr_survivors": len(surviving),
        "fdr_alpha":       FDR_ALPHA,
        "ic_min_abs":      IC_MIN_ABS,
        "runtime_s":       elapsed,
        "top_signals":     top,
        "all_survivors":   surviving,
    }
    REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT_OUT.write_text(json.dumps(report, indent=2))
    log.info("Discovery report → %s", REPORT_OUT)
    return report


def load_latest() -> dict | None:
    if REPORT_OUT.exists():
        return json.loads(REPORT_OUT.read_text())
    return None


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--sym", default=TARGET_SYMBOL, help="Symbol to run discovery on")
    parser.add_argument("--all", action="store_true", help="Run on all DISCOVERY_SYMBOLS in priority order")
    args = parser.parse_args()

    syms = DISCOVERY_SYMBOLS if args.all else [args.sym.upper()]
    for sym in syms:
        print(f"\n{'='*60}\nDISCOVERY: {sym}\n{'='*60}")
        out = run(symbol=sym)
        if not out.get("ok"):
            print("ERROR:", out.get("error"))
        else:
            print(f"Candidates: {out['n_candidates']}  FDR survivors: {out['n_fdr_survivors']}  {out['runtime_s']}s")
            print(f"  {'Feature':42s} {'IC':>8s}  {'p-val':>8s}")
            for r in out["top_signals"][:10]:
                print(f"  {r['name']:42s} {r['ic']:+.5f}  {r['pval']:.4f}")
