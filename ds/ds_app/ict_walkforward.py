"""
ict_walkforward.py — ICT Signal Stack Backtest
================================================
Sharpe waterfall: does adding ICT structural signals improve the existing ensemble?

Layers tested (additive filters on existing ensemble):
  L0  Base 23-signal ensemble (Sharpe-weighted, existing HOUR_KILLS not applied here)
  L1  + v_ict_bias ≠ 0            (ICT weekly/daily midpoint directional bias)
  L2  + v_ict_kz = 1              (London 2-5am ET or NY AM 7-10am ET killzone)
  L3  + ict_t1_level = 1          (T1 is PDH/PDL/PWH/PWL institutional level)
  L4  + (v_ict_ob=1 OR v_ict_fvg=1)  (OB or FVG entry zone present)
       → full ICT structural gate (note: omits biasStrong + R:R for count reasons)
  L5  Standalone ICT gate only (no 23-signal ensemble required)
       → pure ICT structural edge

Also tests:
  HOUR_KILLS_ONLY   Existing HOUR_KILLS gate for comparison
  ICT_KZ_AFTER_HK   HOUR_KILLS + ICT_KZ (is ICT killzone additive?)
  BIAS_STRONG_ONLY  Only trades where week+daily both agree

Devil's Advocate outputs:
  - Correlation audit: ICT signals vs EMA_STACK, ADX_TREND, PULLBACK
  - Trade count at each layer (thin stats warning if < 100)
  - HOUR_KILLS vs ICT_KZ overlap analysis
  - Fold stability (OOS Sharpe std across rolling windows)
  - IS/OOS ratio per layer

Output: ds/data/ict_walkforward_report.json
Run: python -m ds_app.ict_walkforward
"""
from __future__ import annotations

import json
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

from ds_app.ict_signals import add_ict_signals, correlation_audit

SIGNAL_DB    = _DS_ROOT / "data" / "signal_log.db"
OUT_PATH     = _DS_ROOT / "data" / "ict_walkforward_report.json"
PROGRESS_PATH = _DS_ROOT / "data" / "ict_wf_progress.json"

# ── Ensemble config (mirrors sharpe_ensemble.py) ─────────────────────────────
ANNUAL = 252 * 288  # annualisation: 5m bars per year

EXISTING_SIGNALS = [
    # Retired (DISTILL-LIST.md Phase 1): DON_BO, NEW_HIGH, EMA_CROSS, RSI_CROSS
    # Retired clones: BB_BREAK, KC_BREAK, VOL_SURGE (redundant with SQZPOP/ATR_EXP)
    "SQZPOP","ATR_EXP","VOL_BO",
    "EMA_STACK","MACD_CROSS","SUPERTREND",
    "ADX_TREND","GOLDEN","PSAR","PULLBACK","TREND_SMA",
    "RSI_STRONG","CONSEC_BULL","OBV_TREND",
]

SOFT_REGIME_MULT = {
    "TRENDING": {"PULLBACK": 1.5, "EMA_STACK": 1.5, "ADX_TREND": 1.5, "TREND_SMA": 1.5,
                 "SUPERTREND": 1.5, "MACD_CROSS": 1.2,
                 "RSI_CROSS": 0.1, "RSI_STRONG": 0.1},
    "RANGING":  {"RSI_CROSS": 1.5, "RSI_STRONG": 1.5, "PSAR": 1.2,
                 "EMA_STACK": 0.2, "ADX_TREND": 0.2, "SUPERTREND": 0.05},
    "BREAKOUT": {"SQZPOP": 1.5, "BB_BREAK": 1.3, "ATR_EXP": 1.3, "VOL_BO": 1.3,
                 "SUPERTREND": 1.2,
                 "RSI_CROSS": 0.3},
    "RISK-OFF": {"GOLDEN": 1.5, "ADX_TREND": 1.2, "OBV_TREND": 1.3,
                 "SQZPOP": 0.3, "VOL_BO": 0.3},
}

# HOUR_KILLS gate: blocks UTC hours where losses dominate
KILL_HOURS_UTC = {0, 1, 3, 4, 5, 12, 13, 20, 21, 22, 23}

# Walk-forward fold structure (same as existing walkforward.py)
TRAIN_DAYS   = 90
TEST_DAYS    = 30
STEP_DAYS    = 15
EMBARGO_DAYS = 2

ENTRY_THRESHOLD = 0.35  # soft score threshold to take trade

# ── Station-hold simulation config ───────────────────────────────────────────
STATION_MAX_BARS  = 48    # 4h max hold on 5m bars (allows ~40-60 trades/fold on 30d OOS)
STATION_MIN_N     = 10    # min trades to compute Sharpe (relaxed vs global 30)
CIS_SCORE_DECAY   = 0.35  # soft score < 35% of entry = momentum dead
CIS_JEDI_FLIP     = 2.0   # JEDI crossed opposing side beyond this = exit
TP_LOOKBACK       = 100   # bars to scan backwards for opposing OB station
TP_DISPLACE_MULT  = 0.8   # relaxed displacement for TP stations (identifying, not qualifying)
TP_MIN_ATR_DIST   = 0.5   # TP must be ≥ 0.5 × ATR from entry (avoid noise-level targets)

# In-play guard (mirrors TradeLabPage 3-phase logic)
IN_PLAY_BARS      = 3     # bars 0-1: gap-stop only; bar 2: NOT_IN_PLAY check
IN_PLAY_GAP_ATR   = 2.0   # gap-stop threshold (2×ATR close gap against position)
IN_PLAY_MIN_ATR   = 0.20  # bar-3 progress check: < 0.20×ATR = NOT_IN_PLAY → neutral exit

# EOD enforcement (ICT is intraday — all trades must close by session end)
NY_OFF            = 5 * 3600   # UTC→NY offset (EST, no DST; same as ict_signals.py)
EOD_NO_ENTRY_MIN  = 870        # no new entries at/after 14:30 ET (14×60+30)
EOD_FORCE_CLOSE_MIN = 930      # force-close any open trade at 15:30 ET (15×60+30)


# ── helpers ───────────────────────────────────────────────────────────────────

def sharpe(r: np.ndarray, annual: int = ANNUAL, min_n: int = 30) -> float | None:
    r = r[~np.isnan(r)]
    if len(r) < min_n:
        return None
    sd = r.std(ddof=1)
    if sd < 1e-9:
        return None
    return round(float(r.mean() / sd * np.sqrt(annual)), 3)


def hit_rate(r: np.ndarray) -> float | None:
    r = r[~np.isnan(r)]
    if len(r) < 5:
        return None
    return round(float((r > 0).mean()), 3)


def regime_label(df: pd.DataFrame) -> pd.Series:
    """4-regime price-based labeling (mirrors existing assign_regimes)."""
    try:
        from ds_app.sharpe_ensemble import assign_regimes
        return assign_regimes(df)
    except Exception:
        n = len(df)
        labels = pd.Series(["MIXED"] * n, index=df.index)
        c = df["close"].values
        if "high" in df.columns and "low" in df.columns:
            ema200 = pd.Series(c).ewm(span=200).mean().values
            atr = (df["high"] - df["low"]).rolling(14).mean().values
            atr_pct = np.where(c > 0, atr / c, 0)
            atr75 = np.nanpercentile(atr_pct, 75)
            mom = (c - np.roll(c, 12)) / (np.roll(c, 12) + 1e-9)
            labels = np.where(
                (c > ema200) & (atr_pct < atr75), "TRENDING",
                np.where(atr_pct > atr75, "BREAKOUT",
                np.where((c < ema200) & (atr_pct > atr75 * 0.9) & (mom < -0.015), "RISK-OFF",
                "RANGING"
            )))
            return pd.Series(labels, index=df.index)
        return labels


def soft_score(df: pd.DataFrame, weights: dict[str, float],
               regime_col: str = "regime") -> np.ndarray:
    """Per-bar soft-regime-weighted ensemble score."""
    n = len(df)
    score = np.zeros(n)
    for sig, base_w in weights.items():
        col = f"v_{sig}"
        if col not in df.columns:
            continue
        v = df[col].fillna(0).values.astype(float)
        reg = df[regime_col].values if regime_col in df.columns else np.full(n, "MIXED")
        for i in range(n):
            mult = SOFT_REGIME_MULT.get(str(reg[i]), {}).get(sig, 1.0)
            score[i] += v[i] * base_w * mult
    return np.clip(score, 0, 1)


def fit_weights(df_train: pd.DataFrame, outcome_col: str) -> dict[str, float]:
    """Sharpe-weighted per-signal on train split."""
    weights = {}
    for sig in EXISTING_SIGNALS:
        col = f"v_{sig}"
        if col not in df_train.columns:
            weights[sig] = 0.0
            continue
        fired = df_train[col].fillna(0).values == 1
        if fired.sum() < 10:
            weights[sig] = 0.0
            continue
        r = df_train[outcome_col].values[fired]
        r = r[~np.isnan(r)]
        if len(r) < 10:
            weights[sig] = 0.0
            continue
        sd = r.std()
        if sd < 1e-9:
            weights[sig] = 0.0
            continue
        sh = float(r.mean() / sd * np.sqrt(ANNUAL))
        weights[sig] = max(0.0, sh)
    total = sum(weights.values())
    if total < 1e-9:
        return {s: 1.0 / len(EXISTING_SIGNALS) for s in EXISTING_SIGNALS}
    return {s: w / total for s, w in weights.items()}


# ── Layer filters ─────────────────────────────────────────────────────────────

def apply_layers(df: pd.DataFrame, score: np.ndarray, outcome: np.ndarray) -> dict:
    """
    Tests 6 layers + 3 special combos. Returns Sharpe/N/WR per layer.
    All use score >= ENTRY_THRESHOLD as base entry condition.
    """
    ts_arr = df["ts"].values
    utc_hour = (ts_arr % 86400) // 3600
    kill_mask = np.array([h not in KILL_HOURS_UTC for h in utc_hour])

    base_entry = score >= ENTRY_THRESHOLD

    bias   = df["v_ict_bias"].fillna(0).values.astype(int)
    kz     = df["v_ict_kz"].fillna(0).values.astype(int)
    ob     = df["v_ict_ob"].fillna(0).values.astype(int)
    ob_sf  = df["v_ict_ob_sf"].fillna(0).values.astype(int) if "v_ict_ob_sf" in df.columns else np.zeros(len(df), dtype=int)
    fvg    = df["v_ict_fvg"].fillna(0).values.astype(int)
    t1_lvl = df["ict_t1_level"].fillna(0).values.astype(int)
    b_str  = df["ict_bias_strong"].fillna(0).values.astype(int)
    entry_zone = np.clip(ob + fvg, 0, 1)

    layers = {
        "L0_base":            base_entry,
        "L1_+bias":           base_entry & (bias != 0),
        "L2_+kz":             base_entry & (bias != 0) & (kz == 1),
        "L3_+t1_level":       base_entry & (bias != 0) & (kz == 1) & (t1_lvl == 1),
        "L4_+ob_fvg":         base_entry & (bias != 0) & (kz == 1) & (t1_lvl == 1) & (entry_zone == 1),
        "L5_ict_standalone":  (bias != 0) & (kz == 1) & (t1_lvl == 1) & (entry_zone == 1),
        # Sweep-and-Fill precision layers
        "L7_ob_sf_gate":      base_entry & (bias != 0) & (kz == 1) & (ob_sf == 1),
        "L7b_sf_standalone":  (bias != 0) & (kz == 1) & (ob_sf == 1),
        # Control comparisons
        "HOUR_KILLS_only":    base_entry & kill_mask,
        "HK_+ict_kz":         base_entry & kill_mask & (kz == 1),
        "bias_strong_only":   base_entry & (b_str == 1),
    }

    out = {}
    for name, mask in layers.items():
        r = outcome[mask]
        r = r[~np.isnan(r)]
        out[name] = {
            "sharpe":    sharpe(r),
            "n":         int(mask.sum()),
            "win_rate":  hit_rate(r),
            "mean_ret":  round(float(r.mean()), 6) if len(r) >= 5 else None,
            "pct_of_base": round(float(mask.sum()) / max(1, int(base_entry.sum())), 3),
        }
    return out


# ── IC per ICT signal ─────────────────────────────────────────────────────────

def ict_ic(df: pd.DataFrame, outcome_col: str) -> dict:
    """Spearman IC: each ICT signal vs outcome."""
    from scipy.stats import spearmanr
    ict_sigs = ["v_ict_bias", "v_ict_kz", "v_ict_ob", "v_ict_fvg",
                "ict_t1_level", "v_ict_gate", "ict_bias_strong"]
    result = {}
    for col in ict_sigs:
        if col not in df.columns:
            continue
        v = df[col].fillna(0).values.astype(float)
        out = df[outcome_col].values
        valid = ~np.isnan(out)
        if valid.sum() < 50:
            result[col] = None
            continue
        rho, _ = spearmanr(v[valid], out[valid])
        result[col] = round(float(rho), 5) if not np.isnan(rho) else None
    return result


# ── HOUR_KILLS vs ICT killzone overlap ────────────────────────────────────────

def kz_overlap_analysis(df: pd.DataFrame) -> dict:
    """
    What % of ICT killzone bars are also blocked by HOUR_KILLS?
    High overlap = ICT_KZ is redundant. Low overlap = additive.
    """
    ts_arr  = df["ts"].values
    utc_h   = (ts_arr % 86400) // 3600
    kz      = df["v_ict_kz"].fillna(0).values.astype(int)
    hk      = np.array([1 if h in KILL_HOURS_UTC else 0 for h in utc_h])

    kz_bars   = int((kz == 1).sum())
    hk_bars   = int((hk == 1).sum())
    both      = int(((kz == 1) & (hk == 1)).sum())
    kz_blocked_by_hk = round(both / max(1, kz_bars), 3)

    return {
        "total_bars":          len(df),
        "ict_kz_bars":         kz_bars,
        "hour_kills_bars":     hk_bars,
        "kz_blocked_by_hk":    kz_blocked_by_hk,
        "kz_pass_through_pct": round(1.0 - kz_blocked_by_hk, 3),
        "note": ("HIGH OVERLAP — ICT_KZ and HOUR_KILLS agree on timing"
                 if kz_blocked_by_hk > 0.60
                 else "LOW OVERLAP — ICT_KZ adds new timing constraint"),
    }


# ── Station-hold simulation ───────────────────────────────────────────────────

def _find_tp_station(
    i: int,
    open_a: np.ndarray, high_a: np.ndarray, low_a: np.ndarray,
    close_a: np.ndarray, atr_a: np.ndarray, b: int,
) -> float:
    """
    Nearest opposing OB as TP target — called lazily at entry bars only.

    BULL (b=1): find nearest BEAR OB above price = bullish candle (up body) that
                was followed by a displacement move; TP = low of that candle
                (= entry to the supply zone; MMs sold from here, price will seek it)
    BEAR (b=-1): find nearest BULL OB below price = bearish candle (down body)
                 that was followed by displacement; TP = high of that candle

    This implements the ICT "Draw on Liquidity" / "next station" concept.
    Returns 0.0 if no qualifying station found.
    """
    cur, atr_i = close_a[i], atr_a[i]
    if atr_i <= 0:
        return 0.0
    min_dist  = atr_i * TP_MIN_ATR_DIST
    best_dist = float("inf")
    best_tp   = 0.0
    n         = len(close_a)

    for j in range(max(0, i - TP_LOOKBACK), i - 1):
        if b == 1:
            if close_a[j] <= open_a[j]:   # need bullish candle (BEAR OB body)
                continue
            tp_p = low_a[j]               # TP = entry to supply zone
            if tp_p <= cur + min_dist:
                continue
            # Displacement after the OB: proves institutions moved away from here
            if j + 1 < n and (high_a[j + 1] - low_a[j + 1]) < TP_DISPLACE_MULT * atr_i:
                continue
        else:
            if close_a[j] >= open_a[j]:   # need bearish candle (BULL OB body)
                continue
            tp_p = high_a[j]              # TP = entry to demand zone
            if tp_p >= cur - min_dist:
                continue
            if j + 1 < n and (high_a[j + 1] - low_a[j + 1]) < TP_DISPLACE_MULT * atr_i:
                continue

        d = abs(tp_p - cur)
        if d < best_dist:
            best_dist, best_tp = d, tp_p

    return best_tp


def _simulate_station_fold(
    df_oos: pd.DataFrame,
    score: np.ndarray,
    mode: str,
    gate_col: str = "v_ict_gate",
) -> dict:
    """
    Simulate ICT-gate trades with variable exit logic. 4 modes:

      fixed_4h     — outcome_4h_pct at entry bar (matches apply_layers baseline)
      cis_exit     — hold; exit when score decays or JEDI flips (no TP target)
      station_hold — exit when price reaches nearest opposing OB; max_bars fallback
      station_cis  — station TP as primary + CIS as emergency exit  ← MM TRAIN

    P&L uses actual close prices (no outcome_1h_pct lookahead for exit decisions).
    Per-symbol simulation prevents cross-symbol bleed.
    gate_col: column to use for trade entry gate (default v_ict_gate, can be v_ict_gate_sf)
    Returns apply_layers()-compatible dict.
    """
    gate_arr = df_oos[gate_col].fillna(0).values.astype(int) if gate_col in df_oos.columns else np.zeros(len(df_oos), dtype=int)
    gate_total = int(gate_arr.sum())
    if gate_total == 0:
        return {"sharpe": None, "n": 0, "win_rate": None, "mean_ret": None, "pct_of_base": 0.0}

    # Position-reset so score[i] aligns with df_r.iloc[i]
    df_r    = df_oos.reset_index(drop=True)
    close_g = df_r["close"].ffill().values.astype(float)
    open_g  = df_r["open"].values.astype(float)
    high_g  = df_r["high"].values.astype(float)
    low_g   = df_r["low"].values.astype(float)
    atr_g   = (df_r["atr_pct"].fillna(0).values * close_g).astype(float)
    bias_g  = df_r["v_ict_bias"].fillna(0).values.astype(int)
    _gc = gate_col if gate_col in df_r.columns else "v_ict_gate"
    gate_g  = df_r[_gc].fillna(0).values.astype(int)
    jedi_g  = df_r["jedi_raw"].fillna(0).values.astype(float)
    o4h_g   = df_r["outcome_4h_pct"].fillna(0).values.astype(float)
    ts_g    = df_r["ts"].values.astype(np.int64)
    sym_g   = df_r["symbol"].values

    all_rets: list[float] = []

    for sym in np.unique(sym_g):
        pos = np.where(sym_g == sym)[0]
        c   = close_g[pos]; op = open_g[pos]; hi = high_g[pos]; lo = low_g[pos]
        at  = atr_g[pos];   b  = bias_g[pos]; g  = gate_g[pos]
        jd  = jedi_g[pos];  sc = score[pos];  o4 = o4h_g[pos]
        ts  = ts_g[pos]
        m   = len(pos)

        in_trade = False
        e_i      = 0
        e_price  = 0.0
        e_b      = 0
        e_sc     = 1e-9
        e_tp     = 0.0

        for i in range(m):
            ny_min = int(((ts[i] - NY_OFF) % 86400) // 60)

            if not in_trade:
                if g[i] != 1 or b[i] == 0:
                    continue
                if mode == "fixed_4h":
                    all_rets.append(float(o4[i]))
                    continue
                # ICT intraday rule: no new entries at/after 14:30 ET
                if ny_min >= EOD_NO_ENTRY_MIN:
                    continue
                in_trade = True
                e_i     = i
                e_price = c[i]
                e_b     = int(b[i])
                e_sc    = max(float(sc[i]), 1e-9)
                e_tp    = _find_tp_station(i, op, hi, lo, c, at, e_b)
                continue

            cur    = c[i]
            ret    = (cur - e_price) / (e_price + 1e-9) * e_b
            held   = i - e_i
            exited = False

            # ── In-play guard (3-phase) ────────────────────────────────────────
            if held < IN_PLAY_BARS:
                # Phase 1: bars 1-2 — gap-stop only (2×ATR close gap against position)
                gap_against = (
                    (e_b == 1  and cur < e_price - IN_PLAY_GAP_ATR * at[e_i]) or
                    (e_b == -1 and cur > e_price + IN_PLAY_GAP_ATR * at[e_i])
                )
                if gap_against:
                    all_rets.append(ret)
                    in_trade = False
                continue   # skip normal exit logic
            if held == IN_PLAY_BARS:
                # Phase 2: bar 3 — progress check
                progress = (cur - e_price) * e_b
                if progress < IN_PLAY_MIN_ATR * max(at[e_i], 1e-9):
                    # NOT_IN_PLAY — exit at breakeven (trade had no momentum)
                    all_rets.append(0.0)
                    in_trade = False
                    continue
            # ── Phase 3: bar 4+ — normal exit management ───────────────────────

            # EOD force-close at 15:30 ET — ICT intraday, no overnight holds
            if ny_min >= EOD_FORCE_CLOSE_MIN:
                all_rets.append(ret)
                in_trade = False
                continue

            # Primary exit: TP station reached
            if mode in ("station_hold", "station_cis") and e_tp > 0:
                tp_hit = (e_b == 1 and cur >= e_tp) or (e_b == -1 and cur <= e_tp)
                if tp_hit:
                    all_rets.append(ret)
                    in_trade = False
                    exited   = True

            # Emergency exit: CIS — score decay or JEDI flip
            if not exited and mode in ("cis_exit", "station_cis"):
                decay = sc[i] < e_sc * CIS_SCORE_DECAY
                flip  = (e_b == 1 and jd[i] < -CIS_JEDI_FLIP) or \
                        (e_b == -1 and jd[i] > CIS_JEDI_FLIP)
                if decay or flip:
                    all_rets.append(ret)
                    in_trade = False
                    exited   = True

            # Max horizon fallback
            if not exited and (i - e_i) >= STATION_MAX_BARS:
                all_rets.append(ret)
                in_trade = False

    r = np.array(all_rets, dtype=float)
    r = r[~np.isnan(r)]
    # Annualise by estimated trades/year (≈ 5 trades/day × 252 days)
    _ann = round(5 * 252)
    return {
        "sharpe":      sharpe(r, annual=_ann, min_n=STATION_MIN_N),
        "n":           len(r),
        "win_rate":    hit_rate(r),
        "mean_ret":    round(float(r.mean()), 6) if len(r) >= 5 else None,
        "pct_of_base": round(len(r) / max(1, gate_total), 3),
    }


# ── Walk-forward fold engine ──────────────────────────────────────────────────

def _write_progress(phase: str, fold: int = 0, total: int = 0, elapsed: float = 0.0, started_at: str = "") -> None:
    pct = round(fold / max(1, total) * 100, 1) if total else 0
    PROGRESS_PATH.write_text(json.dumps({
        "running": True, "phase": phase,
        "fold": fold, "total_folds": total,
        "elapsed_s": round(elapsed, 1), "pct": pct,
        "started_at": started_at,
    }))


def run_folds(df: pd.DataFrame, outcome_col: str) -> list[dict]:
    """Rolling walk-forward: fit on train, evaluate layers on OOS."""
    ts_arr = df["ts"].values
    ts_min, ts_max = int(ts_arr.min()), int(ts_arr.max())

    train_s   = TRAIN_DAYS   * 86400
    test_s    = TEST_DAYS    * 86400
    embargo_s = EMBARGO_DAYS * 86400
    step_s    = STEP_DAYS    * 86400

    # estimate total folds for progress tracking
    _est = max(1, (ts_max - ts_min - train_s - test_s - embargo_s) // step_s)
    _t0 = time.time()
    _started = datetime.now().isoformat(timespec="seconds")

    folds = []
    w_start = ts_min
    fold_idx = 0

    while True:
        t_start = w_start
        t_end   = t_start + train_s
        oos_s   = t_end + embargo_s
        oos_e   = oos_s + test_s
        if oos_e > ts_max:
            break

        tr_mask  = (ts_arr >= t_start) & (ts_arr < t_end)
        oos_mask = (ts_arr >= oos_s)   & (ts_arr < oos_e)
        if tr_mask.sum() < 500 or oos_mask.sum() < 100:
            w_start += step_s
            continue

        df_train = df[tr_mask].copy()
        df_oos   = df[oos_mask].copy()
        df_oos["regime"] = regime_label(df_oos).values

        weights = fit_weights(df_train, outcome_col)
        oos_score = soft_score(df_oos, weights)
        oos_out   = df_oos[outcome_col].values

        layer_results = apply_layers(df_oos, oos_score, oos_out)

        # Station-hold comparison (4-way exit strategy test on standard ICT gate)
        for _mode, _key in (
            ("cis_exit",    "L6a_cis_exit"),
            ("station_hold","L6b_station_tp"),
            ("station_cis", "L6c_station_cis"),
        ):
            layer_results[_key] = _simulate_station_fold(df_oos, oos_score, _mode)

        # Station-hold on Sweep-and-Fill gate (precision entries only)
        layer_results["L8_sf_station_cis"] = _simulate_station_fold(
            df_oos, oos_score, "station_cis", gate_col="v_ict_gate_sf"
        )

        # IS Sharpe for overfit check
        df_train["regime"] = regime_label(df_train).values
        is_score = soft_score(df_train, weights)
        is_out   = df_train[outcome_col].values
        is_entry = is_score >= ENTRY_THRESHOLD
        is_r     = is_out[is_entry]
        is_r     = is_r[~np.isnan(is_r)]
        is_sh    = sharpe(is_r)

        is_oos_ratio = None
        l0_sh = layer_results["L0_base"]["sharpe"]
        if is_sh and l0_sh and abs(is_sh) > 0.01:
            is_oos_ratio = round(l0_sh / abs(is_sh), 3)

        _write_progress("walkforward_folds", fold_idx + 1, _est, time.time() - _t0, _started)
        folds.append({
            "fold":       fold_idx,
            "train_start": datetime.fromtimestamp(t_start).strftime("%Y-%m-%d"),
            "train_end":   datetime.fromtimestamp(t_end).strftime("%Y-%m-%d"),
            "oos_start":   datetime.fromtimestamp(oos_s).strftime("%Y-%m-%d"),
            "oos_end":     datetime.fromtimestamp(oos_e).strftime("%Y-%m-%d"),
            "n_train":     int(tr_mask.sum()),
            "n_oos":       int(oos_mask.sum()),
            "is_sharpe":   is_sh,
            "is_oos_ratio": is_oos_ratio,
            "layers":      layer_results,
        })
        fold_idx += 1
        w_start += step_s

    return folds


# ── Aggregate fold results ────────────────────────────────────────────────────

def aggregate_folds(folds: list[dict]) -> dict:
    """Mean/std Sharpe per layer across folds."""
    layer_names = list(folds[0]["layers"].keys()) if folds else []
    summary = {}
    for lname in layer_names:
        sharpes  = [f["layers"][lname]["sharpe"] for f in folds if f["layers"][lname]["sharpe"] is not None]
        ns       = [f["layers"][lname]["n"] for f in folds]
        wrs      = [f["layers"][lname]["win_rate"] for f in folds if f["layers"][lname]["win_rate"] is not None]
        if not sharpes:
            summary[lname] = {"mean_oos_sharpe": None, "std_sharpe": None, "mean_n": None}
            continue
        a = np.array(sharpes)
        summary[lname] = {
            "mean_oos_sharpe": round(float(a.mean()), 3),
            "std_sharpe":      round(float(a.std()),  3),
            "pct_pos_folds":   round(float((a > 0).mean()), 3),
            "mean_n_per_fold": round(float(np.mean(ns)), 0),
            "mean_win_rate":   round(float(np.mean(wrs)), 3) if wrs else None,
            "thin_stats_warn": float(np.mean(ns)) < 100,
        }
    return summary


def rentech_gates(summary: dict, folds: list[dict]) -> dict:
    """Apply RenTech 5-gate check to the full-gate layer (L4)."""
    l4 = summary.get("L4_+ob_fvg", {})
    oos_sh_mean = l4.get("mean_oos_sharpe") or 0
    oos_sh_std  = l4.get("std_sharpe") or 1

    ios_ratios = [f["is_oos_ratio"] for f in folds if f["is_oos_ratio"] is not None]
    ios_mean   = float(np.mean(ios_ratios)) if ios_ratios else 0

    # IC slope for ICT gate across folds (fold order vs fold sharpe)
    l4_sharpes = [f["layers"]["L4_+ob_fvg"]["sharpe"] for f in folds
                  if f["layers"]["L4_+ob_fvg"]["sharpe"] is not None]
    ict_slope = None
    if len(l4_sharpes) >= 4:
        x = np.arange(len(l4_sharpes))
        ict_slope = round(float(np.polyfit(x, l4_sharpes, 1)[0]), 4)

    gates = {
        "oos_sharpe_positive":   oos_sh_mean > 0,
        "oos_stability_ok":      (oos_sh_std < 0.3 * abs(oos_sh_mean)) if oos_sh_mean != 0 else False,
        "is_oos_ratio_ok":       ios_mean > 0.4,
        "regime_consistent":     l4.get("pct_pos_folds", 0) >= 0.6,
        "not_decaying":          ict_slope is not None and ict_slope >= -0.01,
    }
    return {
        "gates": gates,
        "passed": f"{sum(gates.values())}/5",
        "verdict": (
            "ROBUST"    if sum(gates.values()) >= 5 else
            "PROMISING" if sum(gates.values()) >= 3 else
            "FRAGILE"   if sum(gates.values()) >= 2 else
            "OVERFIT"
        ),
        "ict_sharpe_slope_over_folds": ict_slope,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def run() -> dict:
    t0 = time.time()
    print("Loading signal_log.db…")
    conn = sqlite3.connect(SIGNAL_DB)
    # Load price + all signal votes + outcomes. Skip v_ cols we don't need for now.
    want_v = [f"v_{s}" for s in EXISTING_SIGNALS]
    pragma_cols = {r[1] for r in conn.execute("PRAGMA table_info(signal_log)")}
    base_cols = ["ts","symbol","open","high","low","close","volume","rvol",
                 "atr_pct","squeeze","jedi_raw","outcome_4h_pct","outcome_1h_pct"]
    sel = [c for c in base_cols + want_v if c in pragma_cols]
    rows = conn.execute(
        f"SELECT {','.join(sel)} FROM signal_log WHERE outcome_4h_pct IS NOT NULL ORDER BY symbol,ts"
    ).fetchall()
    conn.close()

    df = pd.DataFrame(rows, columns=sel)
    print(f"  {len(df):,} rows · {df['symbol'].nunique()} symbols · "
          f"{df['ts'].min()} → {df['ts'].max()}")
    print(f"  Date range: {datetime.fromtimestamp(df['ts'].min()).date()} "
          f"→ {datetime.fromtimestamp(df['ts'].max()).date()}")

    # ── Compute ICT signals ────────────────────────────────────────────────────
    print("Computing ICT signals (OB/FVG loops are slow — ~5 min)…")
    t_ict = time.time()
    df = add_ict_signals(df, ob_lookback=50)
    print(f"  ICT signals done in {time.time()-t_ict:.1f}s")

    outcome_col = "outcome_4h_pct"

    # ── Signal counts (how often each fires) ──────────────────────────────────
    signal_fire_rates = {
        "v_ict_bias_bull":   round(float((df["v_ict_bias"] == 1).mean()), 4),
        "v_ict_bias_bear":   round(float((df["v_ict_bias"] == -1).mean()), 4),
        "v_ict_bias_neutral":round(float((df["v_ict_bias"] == 0).mean()), 4),
        "v_ict_kz":          round(float(df["v_ict_kz"].mean()), 4),
        "v_ict_ob":          round(float(df["v_ict_ob"].mean()), 4),
        "v_ict_ob_sf":       round(float(df["v_ict_ob_sf"].mean()), 4) if "v_ict_ob_sf" in df.columns else 0.0,
        "v_ict_fvg":         round(float(df["v_ict_fvg"].mean()), 4),
        "ict_t1_level":      round(float(df["ict_t1_level"].mean()), 4),
        "ict_bias_strong":   round(float(df["ict_bias_strong"].mean()), 4),
        "v_ict_gate":        round(float(df["v_ict_gate"].mean()), 4),
        "v_ict_gate_sf":     round(float(df["v_ict_gate_sf"].mean()), 4) if "v_ict_gate_sf" in df.columns else 0.0,
    }
    print("  Signal fire rates:", {k: v for k, v in signal_fire_rates.items()})

    # ── Killzone / HOUR_KILLS overlap ─────────────────────────────────────────
    print("Analysing killzone overlap…")
    kz_overlap = kz_overlap_analysis(df)
    print(f"  ICT_KZ bars: {kz_overlap['ict_kz_bars']:,} · "
          f"blocked by HOUR_KILLS: {kz_overlap['kz_blocked_by_hk']*100:.1f}% · "
          f"{kz_overlap['note']}")

    # ── IC per ICT signal (full dataset OOS portion) ───────────────────────────
    print("Computing ICT IC values…")
    oos_cut = int(np.percentile(df["ts"].values, 70))
    df_oos_ic = df[df["ts"] >= oos_cut].copy()
    ic_vals = ict_ic(df_oos_ic, outcome_col)
    print(f"  ICT IC: {ic_vals}")

    # ── Correlation audit (not-dumb check) ────────────────────────────────────
    print("Correlation audit (ICT vs existing signals)…")
    audit_sigs = [f"v_{s}" for s in ["EMA_STACK","ADX_TREND","PULLBACK","SUPERTREND","TREND_SMA"]]
    corr_audit = correlation_audit(df_oos_ic, audit_sigs)
    max_corrs = {k: max((abs(v) for v in row.values() if v is not None), default=0)
                 for k, row in corr_audit.items()}
    print(f"  Max correlations: {max_corrs}")

    # ── Walk-forward folds ────────────────────────────────────────────────────
    print(f"Running walk-forward ({TRAIN_DAYS}d train / {TEST_DAYS}d test / {STEP_DAYS}d step)…")
    folds = run_folds(df, outcome_col)
    print(f"  {len(folds)} folds completed")

    agg = aggregate_folds(folds)
    gates = rentech_gates(agg, folds)

    # ── Waterfall table ───────────────────────────────────────────────────────
    waterfall = []
    layer_labels = {
        "L0_base":            "L0  Base ensemble (14 sigs, Sharpe-wt, no extra gates)",
        "L1_+bias":           "L1  + ICT weekly/daily bias",
        "L2_+kz":             "L2  + ICT killzone",
        "L3_+t1_level":       "L3  + T1 is ICT institutional level",
        "L4_+ob_fvg":         "L4  + OB or FVG entry zone  ← FULL ICT GATE",
        "L5_ict_standalone":  "L5  ICT gate STANDALONE (no ensemble)",
        # Sweep-and-Fill precision layers
        "L7_ob_sf_gate":      "L7  + OB Sweep-and-Fill (wick sweep + close back inside)",
        "L7b_sf_standalone":  "L7b SF STANDALONE (bias + KZ + OB SF only)",
        "HOUR_KILLS_only":    "CTL HOUR_KILLS only (existing gate)",
        "HK_+ict_kz":         "CTL HOUR_KILLS + ICT_KZ",
        "bias_strong_only":   "CTL Bias STRONG (week+day agree)",
        # Station-hold 4-way comparison (variable-exit simulation on ICT gate entries)
        "L6a_cis_exit":       "L6a ICT + CIS exit (score/JEDI decay → emergency stop)",
        "L6b_station_tp":     "L6b ICT + Station TP (next opposing OB → draw on liq)",
        "L6c_station_cis":    "L6c ICT + Station TP + CIS emergency  ← MM TRAIN",
        # Precision entry + station hold
        "L8_sf_station_cis":  "L8  OB SF + Station TP + CIS  ← PRECISION MM TRAIN ★",
    }
    for lname, label in layer_labels.items():
        s = agg.get(lname, {})
        waterfall.append({
            "layer": lname,
            "label": label,
            "mean_oos_sharpe": s.get("mean_oos_sharpe"),
            "std_sharpe":      s.get("std_sharpe"),
            "pct_pos_folds":   s.get("pct_pos_folds"),
            "mean_n_per_fold": s.get("mean_n_per_fold"),
            "mean_win_rate":   s.get("mean_win_rate"),
            "thin_stats_warn": s.get("thin_stats_warn"),
        })

    # ── Devil's Advocate summary ──────────────────────────────────────────────
    devils = []
    for sig, max_c in max_corrs.items():
        if max_c > 0.70:
            devils.append(f"HIGH CORR: {sig} max_corr={max_c:.3f} → likely redundant with existing signals")
        elif max_c > 0.50:
            devils.append(f"MED CORR: {sig} max_corr={max_c:.3f} → partial overlap")

    l4_mean = agg.get("L4_+ob_fvg", {}).get("mean_oos_sharpe")
    l4_n    = agg.get("L4_+ob_fvg", {}).get("mean_n_per_fold", 0)
    if l4_n and l4_n < 100:
        devils.append(f"THIN STATS: L4 mean {l4_n:.0f} trades/fold < 100 — Sharpe not reliable")
    if l4_mean and l4_mean < agg.get("L0_base", {}).get("mean_oos_sharpe", 0):
        devils.append("ICT gate DEGRADES Sharpe vs L0 — adding gates is reducing good trades not bad")

    kz_pct = kz_overlap["kz_blocked_by_hk"]
    if kz_pct > 0.6:
        devils.append(f"KZ OVERLAP: {kz_pct*100:.0f}% of ICT killzone bars already blocked by HOUR_KILLS — L2 is partially redundant")

    # Station-hold verdict
    l6c = agg.get("L6c_station_cis", {})
    l6b = agg.get("L6b_station_tp",  {})
    l6a = agg.get("L6a_cis_exit",    {})
    l5  = agg.get("L5_ict_standalone", {})
    l6c_sh = l6c.get("mean_oos_sharpe")
    l6b_sh = l6b.get("mean_oos_sharpe")
    l6a_sh = l6a.get("mean_oos_sharpe")
    l5_sh  = l5.get("mean_oos_sharpe")
    if l6c_sh is not None and l5_sh is not None:
        delta = round(l6c_sh - (l5_sh or 0), 3)
        if l6c_sh > (l5_sh or 0) and delta > 0.1:
            devils.append(
                f"MM TRAIN CONFIRMED: Station+CIS exit ({l6c_sh:+.3f}) beats fixed-horizon "
                f"ICT ({l5_sh:+.3f}) by {delta:+.3f} Sharpe — draw-on-liquidity exits are real"
            )
        elif l6c_sh <= 0:
            devils.append(
                f"MM TRAIN WEAK: Station+CIS ({l6c_sh:+.3f}) non-positive — entry OBs not "
                f"reaching opposing stations in this data window"
            )
        else:
            devils.append(
                f"MM TRAIN MARGINAL: Station+CIS {l6c_sh:+.3f} vs fixed {l5_sh:+.3f} "
                f"({delta:+.3f}) — meaningful but not dominant"
            )
    if l6b_sh is not None and l6a_sh is not None:
        if l6b_sh > l6a_sh:
            devils.append(f"STATION TP ({l6b_sh:+.3f}) > CIS-only ({l6a_sh:+.3f}) — structural OB target beats score-decay stop")
        else:
            devils.append(f"CIS EXIT ({l6a_sh:+.3f}) > Station TP ({l6b_sh:+.3f}) — momentum exit outperforms structure; TP stations may be misidentified")

    l1_delta = (
        (agg.get("L1_+bias",{}).get("mean_oos_sharpe") or 0)
        - (agg.get("L0_base",{}).get("mean_oos_sharpe") or 0)
    )
    if abs(l1_delta) < 0.05:
        devils.append(f"ICT BIAS adds only {l1_delta:+.3f} Sharpe vs base — marginal directional value")

    elapsed = time.time() - t0
    report = {
        "ok":             True,
        "generated_at":   datetime.now().isoformat(timespec="seconds"),
        "elapsed_s":      round(elapsed, 1),
        "data_range": {
            "from": datetime.fromtimestamp(int(df["ts"].min())).strftime("%Y-%m-%d"),
            "to":   datetime.fromtimestamp(int(df["ts"].max())).strftime("%Y-%m-%d"),
            "days": round((df["ts"].max() - df["ts"].min()) / 86400, 0),
            "rows": len(df),
            "symbols": sorted(df["symbol"].unique().tolist()),
        },
        "config": {
            "train_days": TRAIN_DAYS, "test_days": TEST_DAYS,
            "step_days": STEP_DAYS, "embargo_days": EMBARGO_DAYS,
            "entry_threshold": ENTRY_THRESHOLD, "outcome": outcome_col,
            "n_signals": len(EXISTING_SIGNALS),
            "station_max_bars": STATION_MAX_BARS,
            "cis_score_decay":  CIS_SCORE_DECAY,
            "cis_jedi_flip":    CIS_JEDI_FLIP,
            "tp_lookback":      TP_LOOKBACK,
        },
        "n_folds":            len(folds),
        "signal_fire_rates":  signal_fire_rates,
        "killzone_overlap":   kz_overlap,
        "ict_ic":             ic_vals,
        "correlation_audit":  corr_audit,
        "waterfall":          waterfall,
        "fold_summary":       agg,
        "rentech_gates":      gates,
        "devils_advocate":    devils,
        "folds":              folds,  # full fold detail
    }

    OUT_PATH.parent.mkdir(exist_ok=True)
    OUT_PATH.write_text(json.dumps(report, indent=2))
    PROGRESS_PATH.write_text(json.dumps({
        "running": False, "phase": "done",
        "fold": len(folds), "total_folds": len(folds),
        "elapsed_s": round(elapsed, 1), "pct": 100.0,
    }))
    print(f"\nWrote: {OUT_PATH}")
    print(f"Elapsed: {elapsed:.1f}s")
    return report


def print_summary(r: dict) -> None:
    print(f"\n{'='*66}")
    print(f" ICT WALKFORWARD BACKTEST — {r['data_range']['from']} → {r['data_range']['to']}")
    print(f" {r['data_range']['rows']:,} bars · {r['n_folds']} folds · {r['elapsed_s']}s")
    print(f"{'='*66}")
    print(f"\n{'LAYER':<50} {'OOS SH':>7} {'±':>6} {'%+F':>5} {'N/fold':>7} {'WR':>6}")
    print("-"*66)
    for row in r["waterfall"]:
        sh  = row["mean_oos_sharpe"]
        std = row["std_sharpe"]
        pp  = row["pct_pos_folds"]
        n   = row["mean_n_per_fold"]
        wr  = row["mean_win_rate"]
        thin = " ⚠THIN" if row["thin_stats_warn"] else ""
        sh_str  = f"{sh:+.3f}"  if sh  is not None else "  N/A "
        std_str = f"{std:.3f}"  if std is not None else "  N/A"
        pp_str  = f"{pp:.0%}"   if pp  is not None else "  N/A"
        n_str   = f"{n:.0f}"    if n   is not None else "  N/A"
        wr_str  = f"{wr:.1%}"   if wr  is not None else " N/A"
        print(f"{row['label']:<50} {sh_str:>7} {std_str:>6} {pp_str:>5} {n_str:>7} {wr_str:>6}{thin}")

    g = r["rentech_gates"]
    print(f"\n{'─'*66}")
    print(f" RenTech gates (L4 full ICT gate): {g['passed']} · {g['verdict']}")
    for gname, val in g["gates"].items():
        print(f"   {'OK' if val else 'FAIL'}  {gname}")

    print(f"\n KZ/HOUR_KILLS overlap: {r['killzone_overlap']['kz_blocked_by_hk']*100:.0f}% "
          f"({r['killzone_overlap']['note']})")
    print(f"\n ICT signal IC (OOS):")
    for k, v in r["ict_ic"].items():
        print(f"   {k:<22}: {v}")

    print(f"\n Devil's Advocate:")
    for d in r["devils_advocate"]:
        print(f"   ⚠  {d}")
    if not r["devils_advocate"]:
        print("   None — ICT signals appear additive and non-redundant")

    print(f"\n{'='*66}\n")


if __name__ == "__main__":
    result = run()
    if result.get("ok"):
        print_summary(result)
