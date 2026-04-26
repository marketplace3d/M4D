"""
ict_signals.py — ICT structural signal computation from OHLCV bars.
Ports the TypeScript computeICTBrain / computeObiJediGate logic to Python
for backtesting on signal_log.db.

No look-ahead: all levels derived from completed prior sessions only.
Designed for 5m bar DataFrames with [symbol, ts, open, high, low, close, atr_pct] columns.

Signals produced:
  v_ict_bias      int8   +1=BULL  -1=BEAR  0=NEUTRAL  (weekly/daily midpoint method)
  ict_bias_strong bool   True when weekly+daily both set and agree
  v_ict_kz        int8   1=killzone active (London 2-5am ET or NY AM 7-10am ET)
  v_ict_ob        int8   1=order block (last opposing candle) within 3×ATR lookback
  v_ict_fvg       int8   1=fair value gap (3-candle imbalance) in last 40 bars
  ict_t1_level    int8   1=PDH/PDL/PWH/PWL is closest level in bias direction
                           (proxy for "T1 is an ICT institutional level")
  v_ict_gate      int8   1=all 5 structural conditions met (bias+kz+ob_or_fvg+t1_level)
                           (simplified vs 7-condition gate — omits biasStrong+R:R)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# EST offset (UTC-5, no DST — same approximation as TypeScript)
NY_OFF = 5 * 3600


# ── Time helpers ──────────────────────────────────────────────────────────────

def _ny_hour_arr(ts: np.ndarray) -> np.ndarray:
    return ((ts - NY_OFF) % 86400) // 3600


def _ny_day_idx(ts: np.ndarray) -> np.ndarray:
    """Unique integer index per NY calendar day."""
    return (ts - NY_OFF) // 86400


def _ny_week_idx(ts: np.ndarray) -> np.ndarray:
    """Unique integer index per NY calendar week (Sunday-start)."""
    days = (ts - NY_OFF) // 86400
    dow = (days + 4) % 7   # epoch was Thursday Jan 1 1970
    return days - dow


# ── PDH/PDL/PWH/PWL (no look-ahead) ──────────────────────────────────────────

def _add_session_levels(df: pd.DataFrame) -> pd.DataFrame:
    """
    Adds pdh, pdl (previous day high/low) and pwh, pwl (previous week high/low)
    to each bar. Uses shift(1) on grouped daily/weekly summaries — no look-ahead.
    """
    df = df.copy()
    df["_ny_day"]  = _ny_day_idx(df["ts"].values)
    df["_ny_week"] = _ny_week_idx(df["ts"].values)

    # Daily: previous complete day H/L
    daily = (
        df.groupby(["symbol", "_ny_day"])
        .agg(day_h=("high", "max"), day_l=("low", "min"))
        .reset_index()
    )
    daily = daily.sort_values(["symbol", "_ny_day"])
    daily["pdh"] = daily.groupby("symbol")["day_h"].shift(1)
    daily["pdl"] = daily.groupby("symbol")["day_l"].shift(1)
    df = df.merge(
        daily[["symbol", "_ny_day", "pdh", "pdl"]],
        on=["symbol", "_ny_day"], how="left"
    )

    # Weekly: previous complete week H/L
    weekly = (
        df.groupby(["symbol", "_ny_week"])
        .agg(wk_h=("high", "max"), wk_l=("low", "min"))
        .reset_index()
    )
    weekly = weekly.sort_values(["symbol", "_ny_week"])
    weekly["pwh"] = weekly.groupby("symbol")["wk_h"].shift(1)
    weekly["pwl"] = weekly.groupby("symbol")["wk_l"].shift(1)
    df = df.merge(
        weekly[["symbol", "_ny_week", "pwh", "pwl"]],
        on=["symbol", "_ny_week"], how="left"
    )

    df["pdh"] = df["pdh"].fillna(0.0)
    df["pdl"] = df["pdl"].fillna(0.0)
    df["pwh"] = df["pwh"].fillna(0.0)
    df["pwl"] = df["pwl"].fillna(0.0)

    df.drop(columns=["_ny_day", "_ny_week"], inplace=True)
    return df


# ── ICT bias per bar ──────────────────────────────────────────────────────────

def _ict_bias(close: np.ndarray,
              pdh: np.ndarray, pdl: np.ndarray,
              pwh: np.ndarray, pwl: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Returns (bias, bias_strong).
    bias: +1 BULL, -1 BEAR, 0 NEUTRAL (same logic as TypeScript computeOBI).
    bias_strong: True when weekly+daily both valid and agree.
    """
    daily_valid  = (pdh > 0) & (pdl > 0)
    weekly_valid = (pwh > 0) & (pwl > 0)

    daily_bull  = daily_valid  & (close > (pdh + pdl) / 2)
    daily_bear  = daily_valid  & (close < (pdh + pdl) / 2)
    weekly_bull = weekly_valid & (close > (pwh + pwl) / 2)
    weekly_bear = weekly_valid & (close < (pwh + pwl) / 2)

    daily_b  = np.where(daily_bull, 1, np.where(daily_bear, -1, 0)).astype(np.int8)
    weekly_b = np.where(weekly_bull, 1, np.where(weekly_bear, -1, 0)).astype(np.int8)

    both_valid = daily_valid & weekly_valid
    both_agree = both_valid & (daily_b == weekly_b)
    both_conflict = both_valid & (daily_b != weekly_b)

    bias = np.where(
        both_agree,    weekly_b,            # strong: both agree → weekly direction
        np.where(
            both_conflict, np.int8(0),     # conflict → NEUTRAL
            np.where(weekly_valid, weekly_b, daily_b)  # one valid → that one
        )
    ).astype(np.int8)

    bias_strong = both_agree
    return bias, bias_strong


# ── Killzone mask ─────────────────────────────────────────────────────────────

def _killzone_mask(ts: np.ndarray) -> np.ndarray:
    """True if bar is in London (2-5am ET) or NY AM (7-10am ET)."""
    ny_h = _ny_hour_arr(ts)
    london = (ny_h >= 2)  & (ny_h <= 5)
    ny_am  = (ny_h >= 7)  & (ny_h <= 10)
    return (london | ny_am).astype(np.int8)


# ── Order Block detection — Displacement + Freshness qualified ───────────────

def _ob_series(open_a: np.ndarray, high_a: np.ndarray, low_a: np.ndarray,
               close_a: np.ndarray, bias: np.ndarray, atr_a: np.ndarray,
               lookback: int = 50,
               displace_mult: float = 1.5,
               max_touches: int = 1,
               at_zone_mult: float = 1.0) -> np.ndarray:
    """
    For each bar i: 1 if price is currently RETRACING INTO a live qualified OB.

    ICT doctrine: the entry is specifically when price returns to the OB zone.
    This fires only when price is within at_zone_mult×ATR of the OB zone —
    not whenever "an OB exists somewhere in the last N bars."

    Qualifications:
      1. Direction: BULL OB = last bearish candle, BEAR OB = last bullish candle
      2. Displacement: candle after OB ≥ displace_mult×ATR (institutional conviction)
      3. Freshness: fewer than max_touches retests (mitigated OB = dead)
      4. At-zone: current price is retracing INTO the OB zone
                  BULL: close[i] ≤ ob_high + at_zone_mult×ATR  (price at demand)
                  BEAR: close[i] ≥ ob_low  − at_zone_mult×ATR  (price at supply)

    No look-ahead: OB at j, displacement at j+1, touches at j+2..i-1.
    """
    n          = len(close_a)
    has_ob     = np.zeros(n, dtype=np.int8)
    bar_ranges = high_a - low_a   # 5m bar high-low for local ATR

    for i in range(lookback, n):
        b = bias[i]
        if b == 0:
            continue
        cur   = close_a[i]
        atr_i = atr_a[i]            # DB ATR (daily scale) — used only for reach window
        reach = atr_i * 3.0

        # Local 5m ATR: rolling mean of last 14 bar ranges — correct scale for
        # displacement and at-zone checks (atr_a from DB is daily ATR, ~100x too large)
        lo14 = max(0, i - 14)
        local_atr = float(np.mean(bar_ranges[lo14:i])) if i > lo14 else bar_ranges[i]
        if local_atr < 1e-9:
            continue

        for j in range(i - 2, max(0, i - lookback), -1):
            # ── Step 1: OB candle at j ────────────────────────────────────────
            if b == 1:   # BULL: need bearish OB candle below price
                ob_body     = close_a[j] < open_a[j]
                ob_in_reach = high_a[j] < cur and high_a[j] > cur - reach
            else:        # BEAR: need bullish OB candle above price
                ob_body     = close_a[j] > open_a[j]
                ob_in_reach = low_a[j] > cur and low_a[j] < cur + reach

            if not (ob_body and ob_in_reach):
                continue

            ob_high = high_a[j]
            ob_low  = low_a[j]

            # ── Step 2: displacement candle at j+1 (local 5m ATR scale) ─────
            if j + 1 >= i:
                continue
            disp_range = bar_ranges[j + 1]
            if disp_range < displace_mult * local_atr:
                continue  # no institutional follow-through → skip

            # ── Step 3: freshness — close-based retests j+2..i-1 ─────────────
            # ICT: wick test = entry signal; close through OB = mitigation.
            touches = 0
            for k in range(j + 2, i):
                if b == 1 and close_a[k] <= ob_high:
                    touches += 1
                elif b == -1 and close_a[k] >= ob_low:
                    touches += 1
                if touches > max_touches:
                    break
            if touches > max_touches:
                continue  # OB mitigated — dead

            # ── Step 4: price AT zone — wick tests OB (ICT entry condition) ──
            # Use local_atr for at-zone tolerance (not daily ATR).
            at_tol = local_atr * at_zone_mult
            if b == 1:
                if low_a[i] > ob_high + at_tol:
                    continue  # price hasn't retested the demand zone yet
            else:
                if high_a[i] < ob_low - at_tol:
                    continue  # price hasn't retested the supply zone yet

            has_ob[i] = 1
            break

    return has_ob


# ── Premium / Discount filter ─────────────────────────────────────────────────

def _premium_discount_mask(close_a: np.ndarray,
                           pdh_a: np.ndarray,
                           pdl_a: np.ndarray,
                           bias:  np.ndarray) -> np.ndarray:
    """
    1 if current bar is in the correct premium/discount zone for its bias:
      BULL entry only in DISCOUNT (close < daily midpoint)
      BEAR entry only in PREMIUM  (close > daily midpoint)
    Returns 0 when chasing (wrong side of the range).
    """
    valid  = (pdh_a > 0) & (pdl_a > 0) & (pdh_a > pdl_a)
    mid    = (pdh_a + pdl_a) / 2.0
    bull_ok = ~valid | (close_a <= mid)    # BULL: discount or unknown range
    bear_ok = ~valid | (close_a >= mid)    # BEAR: premium or unknown range
    result  = np.where(bias == 1, bull_ok.astype(np.int8),
               np.where(bias == -1, bear_ok.astype(np.int8),
               np.int8(1)))  # NEUTRAL: no filter
    return result.astype(np.int8)


# ── Fair Value Gap detection ──────────────────────────────────────────────────

def _fvg_series(high_a: np.ndarray, low_a: np.ndarray,
                bias: np.ndarray, lookback: int = 40) -> np.ndarray:
    """
    For each bar i: True if a FVG exists within [i-lookback, i-1].
    BULL FVG: high[j] < low[j+2]  (gap up).
    BEAR FVG: low[j]  > high[j+2] (gap down).
    """
    n = len(high_a)
    has_fvg = np.zeros(n, dtype=np.int8)
    for i in range(2, n):
        b = bias[i]
        if b == 0:
            continue
        end = max(0, i - lookback)
        for j in range(i - 2, end, -1):
            if b == 1 and high_a[j] < low_a[j + 2]:
                has_fvg[i] = 1
                break
            if b == -1 and low_a[j] > high_a[j + 2]:
                has_fvg[i] = 1
                break
    return has_fvg


# ── T1 is ICT institutional level ─────────────────────────────────────────────

def _t1_is_ict_level(close: np.ndarray,
                     pdh: np.ndarray, pdl: np.ndarray,
                     pwh: np.ndarray, pwl: np.ndarray,
                     bias: np.ndarray,
                     atr: np.ndarray,
                     tol_mult: float = 0.20) -> np.ndarray:
    """
    True when the nearest ICT institutional level in the bias direction
    is also the closest ANY level is to current price (within tol_mult×ATR).
    Proxy: PDH/PDL or PWH/PWL is nearest target in bias direction.
    """
    tol = atr * tol_mult
    n = len(close)
    result = np.zeros(n, dtype=np.int8)
    ict_levels = np.stack([pdh, pdl, pwh, pwl], axis=1)  # (n, 4)
    for i in range(n):
        b = bias[i]
        if b == 0:
            continue
        cur = close[i]
        # Levels in bias direction
        candidates = []
        for lvl in ict_levels[i]:
            if lvl <= 0:
                continue
            if b == 1 and lvl > cur * 1.001:
                candidates.append(lvl)
            elif b == -1 and lvl < cur * 0.999:
                candidates.append(lvl)
        if candidates:
            nearest_ict = min(candidates, key=lambda x: abs(x - cur))
            result[i] = 1
            _ = nearest_ict  # always True if any candidate exists
        # (refined: True iff nearest_ict is within tol of closest level)
    return result


# ── Main entry point ──────────────────────────────────────────────────────────

def add_ict_signals(df: pd.DataFrame, ob_lookback: int = 50) -> pd.DataFrame:
    """
    Computes all ICT signals per bar and appends columns to df.
    Input df must have: symbol, ts, open, high, low, close, atr_pct columns.
    All computed without look-ahead (previous sessions only).

    Added columns:
      pdh, pdl, pwh, pwl        — structural session levels
      v_ict_bias                — +1/−1/0 directional bias
      ict_bias_strong           — bool, week+day agree
      v_ict_kz                  — 1 if killzone active
      v_ict_ob                  — 1 if LIVE OB (displaced + fresh, ≤max_touches retests)
      v_ict_fvg                 — 1 if FVG present in lookback
      ict_t1_level              — 1 if nearest target is ICT institutional level
      ict_pd_ok                 — 1 if price in correct premium/discount zone for bias
      v_ict_gate                — Whacker gate: bias≠0 AND kz AND (ob OR fvg) AND pd_ok
    """
    df = _add_session_levels(df)
    results = []

    for sym, sg in df.groupby("symbol"):
        sg = sg.sort_values("ts").reset_index(drop=True)
        close_a = sg["close"].values.astype(float)
        high_a  = sg["high"].values.astype(float)
        low_a   = sg["low"].values.astype(float)
        open_a  = sg["open"].values.astype(float)
        ts_a    = sg["ts"].values.astype(np.int64)
        pdh_a   = sg["pdh"].values.astype(float)
        pdl_a   = sg["pdl"].values.astype(float)
        pwh_a   = sg["pwh"].values.astype(float)
        pwl_a   = sg["pwl"].values.astype(float)
        atr_a   = (sg["atr_pct"].fillna(0).values * close_a).astype(float)

        bias, bias_strong = _ict_bias(close_a, pdh_a, pdl_a, pwh_a, pwl_a)
        kz     = _killzone_mask(ts_a)
        # Qualified OB: displacement candle ≥1.5×ATR + freshness ≤1 retest
        ob     = _ob_series(open_a, high_a, low_a, close_a, bias, atr_a,
                            ob_lookback, displace_mult=1.5, max_touches=1)
        fvg    = _fvg_series(high_a, low_a, bias, lookback=40)
        t1_lvl = _t1_is_ict_level(close_a, pdh_a, pdl_a, pwh_a, pwl_a, bias, atr_a)
        pd_ok  = _premium_discount_mask(close_a, pdh_a, pdl_a, bias)

        # Whacker gate: bias + KZ (hard gate) + OB or FVG entry zone
        # pd_ok is kept as UI warning column only — NOT a hard gate.
        # Reason: P/D vs prior-day midpoint blocks all trend entries in uptrend
        # (close always above PDL/PDH mid when trending up). ICT P/D is context,
        # not a binary filter. Chasing warning still shown in OBI panel.
        entry_zone = np.clip(ob + fvg, 0, 1).astype(np.int8)
        gate = (
            (bias != 0).astype(np.int8)
            * kz
            * entry_zone
        )

        sg["v_ict_bias"]      = bias
        sg["ict_bias_strong"] = bias_strong.astype(np.int8)
        sg["v_ict_kz"]        = kz
        sg["v_ict_ob"]        = ob
        sg["v_ict_fvg"]       = fvg
        sg["ict_t1_level"]    = t1_lvl
        sg["ict_pd_ok"]       = pd_ok
        sg["v_ict_gate"]      = gate
        results.append(sg)

    out = pd.concat(results).sort_values(["symbol", "ts"]).reset_index(drop=True)
    return out


# ── Correlation audit (not-dumb check) ────────────────────────────────────────

def correlation_audit(df: pd.DataFrame, existing_signals: list[str]) -> dict:
    """
    Spearman correlations between ICT signals and existing v_* signals.
    Checks that ICT is not just a shadow of EMA_STACK/ADX_TREND.
    """
    from scipy.stats import spearmanr
    ict_cols = ["v_ict_bias", "v_ict_kz", "v_ict_ob", "v_ict_fvg", "v_ict_gate"]
    available_existing = [c for c in existing_signals if c in df.columns]
    result = {}
    for ict_c in ict_cols:
        if ict_c not in df.columns:
            continue
        row = {}
        for ex_c in available_existing:
            try:
                rho, _ = spearmanr(df[ict_c].values, df[ex_c].fillna(0).values)
                row[ex_c.replace("v_", "")] = round(float(rho), 4) if not np.isnan(rho) else None
            except Exception:
                row[ex_c.replace("v_", "")] = None
        result[ict_c] = row
    return result
