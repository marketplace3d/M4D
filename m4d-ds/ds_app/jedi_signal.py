"""
jedi_signal.py — JEDI-00 Master Ensemble Signal
================================================
Iteration 00: aligned-acceleration entry + momentum-decel exit + Kelly sizing.

JEDI does not donate to the market-maker benevolent fund.

ENTRY — all conditions required:
  1. mini_council_vote >= min_agree     (N of 7 available signals agree bullish)
  2. multi_bank_align                   (squeeze + kc + accel all three firing = energy release)
  3. accel_signal                       (3-bar sequence of increasing bullish bodies + range expand)
  4. atr_gate                           (ATR expanding vs baseline)
  5. first_half_only (optional)

EXIT — priority order (JEDI leaves before the party ends):
  1. Decel exit: within decel_window bars, bar body < entry_body × decel_thresh
                 OR bar closes red (close < open) → FULL EXIT IMMEDIATELY
  2. Profit target: if close > entry × (1 + profit_target_pct/100) → close 50%,
                    hold remainder to EMA13 or hold_bars
  3. EMA13 cross-below or hold_bars timeout
  4. EOD flat (optional)
  5. Hard stop: close <= entry × (1 − stop_loss_pct/100)

KELLY SIZING:
  conviction = council_vote / max_possible_vote          (0.0 → 1.0)
  kelly_size  = conviction × kelly_base_fraction         (e.g., 0.08 × conviction)
  ultra_protect: first ultra_protect_n trades multiply by ultra_protect_scalar (0.25)
  graduated:    trades 11–25 → scalar 0.5, trades 26+ → scalar 1.0
  clamp:        [kelly_min, kelly_max] fraction of equity

GROK-X HOOK (future):
  grok_x_weight blends council_vote_score toward pure trend score.
  Wire in real X/sentiment series here when available.

OOS discipline:
  IS  = 2024-10-01 → 2025-02-28
  OOS = 2025-03-01 → 2025-04-01  (named BEFORE optimization)

Image sheet (6 panels, generated via `jedi_image_sheet()`):
  1. Price OHLCV + EMA13 + entry/exit arrows
  2. Equity curve + drawdown shading
  3. Per-trade P&L bars (green/red)
  4. Stats summary table
  5. Council vote histogram over time
  6. Kelly fraction per trade
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from io import BytesIO
from itertools import product
from typing import Any

import numpy as np
import pandas as pd
from backtesting import Backtest, Strategy

from .boom_backtest import _first_half_market_mask
from .algo_signals import (
    SIGNAL_REGISTRY,
    boom_rank_score,
    _atr,
    _exit_ema13,
)


# ── OOS window (locked before optimization) ──────────────────────────────────
JEDI_IS_START  = "2024-10-01"
JEDI_IS_END    = "2025-02-28"
JEDI_OOS_START = "2025-03-01"
JEDI_OOS_END   = "2025-04-01"

# ── Mini-council signal keys (7 available in SIGNAL_REGISTRY) ────────────────
MINI_COUNCIL_SIGNALS = [
    "ema_ribbon",
    "ob_fvg",
    "kc_breakout",
    "accel_range",
    "mfi_cross",
    "choc_bos",
    # stage2 excluded from intraday council (daily signal only)
]
MINI_COUNCIL_MAX_VOTE = len(MINI_COUNCIL_SIGNALS)  # 6

# ── Three "energy banks" for multi_bank_align check ──────────────────────────
# If all three energy banks fire on same bar → simultaneous institutional pressure
ENERGY_BANK_A = "kc_breakout"    # volatility release
ENERGY_BANK_B = "accel_range"    # momentum acceleration
ENERGY_BANK_C = "choc_bos"       # structural break (CHoCH/BOS)


# ── Params ────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class JediParams:
    # Council alignment — PRIMARY entry filter.
    # "Only trading with council vote alignment."
    # min_agree=2: at least 2 of 6 independent signals must agree before entry.
    min_agree: int = 2              # of 6 mini-council signals must agree
    require_multi_bank: bool = False

    # Acceleration entry
    accel_bars: int = 2             # iter-00: 2-bar accel (3 too strict for 5m bars)
    require_range_expand: bool = True

    # ATR gate
    atr_mult: float = 1.0

    # Decel exit (JEDI LEAVES — 10-30 sec = 1 bar on 1m charts)
    # On 1m bars: decel_window=1 = check the very next bar after entry.
    # If body shrinks OR bar closes red within decel_window bars → EXIT IMMEDIATELY.
    decel_window: int = 1           # bars after entry to watch for deceleration
    decel_thresh: float = 0.4       # if body < entry_body × this → decel detected

    # Profit target (partial scale-out — "sell 1 lot on move")
    profit_target_pct: float = 0.3  # % move → close 50% of position (tight on 1m)

    # Standard exits
    hold_bars: int = 8              # max bars to hold remainder after partial close
    exit_mode: str = "ema13"        # "ema13" | "holdbars"
    # Ultra-tight stop: 0.3% — on 1m bars, stop is hit FAST if wrong
    # "Stop 0+": as soon as trade moves green, stop lifts to entry (break-even).
    stop_loss_pct: float = 0.3
    # break_even_offset_pct: lift stop to entry + this offset immediately on first green bar
    break_even_offset_pct: float = 0.01  # almost zero — stop to exactly entry on move

    # Kelly sizing
    # iter-00: kelly_base=0.20 so ultra-protect (×0.25) = 5% per trade on 1m scalp.
    # At $100K equity, 5% = $5K position.  On NVDA $170 → ~29 shares.
    # With intraday commission $0.005/share × 29 = $0.15 RT.  Breakeven ~0.003%.
    kelly_base_fraction: float = 0.20
    kelly_min: float = 0.02
    kelly_max: float = 0.40

    # Ultra protection protocol
    ultra_protect_n: int = 10           # first N trades at ultra-protect scale
    ultra_protect_scalar: float = 0.25
    grad_protect_n: int = 25            # trades 11–grad_n at 0.5×
    grad_protect_scalar: float = 0.5

    # Grok/X sentiment hook (placeholder → wire real series later)
    grok_x_weight: float = 0.0     # 0 = pure council; 1 = pure trend

    # Session filter — "Not late in day. Maybe not Friday. Stay out of the doldrums."
    # Allowed: 09:30–14:00 ET. After 14:00 = doldrums (low vol, wide spreads, noise).
    session_cutoff_et: int = 840    # 14:00 ET in minutes since midnight (14×60)
    session_open_et: int = 570      # 09:30 ET
    friday_ok: bool = True          # iter-01: Friday allowed but Kelly-scaled (see friday_kelly_scalar)
    first_half_only: bool = False   # tighter: 09:30–12:45 only (original flag)

    # iter-01: Friday Gap-Risk Scalar (replaces hard friday_ok=False block)
    # If it's Friday, scale Kelly × this factor instead of blocking entry.
    # If council vote is 6/6 on Friday morning, edge likely exceeds liquidity risk.
    # Scaling down is more efficient than a total blackout.
    friday_kelly_scalar: float = 0.7  # 0.7× Kelly on Fridays; 1.0 = no scaling

    # iter-01: Volume-Weighted Decel Exit
    # Original: exit on any red bar close within decel_window.
    # Problem: 1m red bars often capture "noise" rests on winning momentum.
    # Fix: only exit if red bar is confirmed by volume (institutional weight).
    # decel_require_volume=True: decel fires only when red AND vol > X% of entry vol.
    # decel_require_volume=False: original behavior (any red bar = exit).
    decel_require_volume: bool = True
    decel_volume_pct_of_entry: float = 0.5  # exit if vol > 50% of entry bar volume

    # iter-01: ATR Slope Filter (blow-off protection)
    # Problem: ATR gate is binary pass/fail — misses entries into blow-off exhaustion.
    # Fix: if ATR is spiking fast (slope > thresh), widen stop instead of blocking.
    # atr_slope_thresh: ATR change % per bar that triggers stop widening.
    # atr_slope_stop_mult: multiply stop_loss_pct by this when ATR is spiking.
    atr_slope_thresh: float = 0.15   # 15% ATR growth in one bar = blow-off warning
    atr_slope_stop_mult: float = 1.25  # widen stop to 1.25× when ATR spikes

    # Flat EOD
    flat_eod: bool = True           # always flat EOD for intraday


# ── Sweep grid for Cartesian and Optuna searches ─────────────────────────────

JEDI_GRID = {
    "min_agree":            [2, 3, 4],
    "accel_bars":           [2, 3],
    "atr_mult":             [0.9, 1.0, 1.1],
    "decel_window":         [1, 2, 3],
    "decel_thresh":         [0.3, 0.4, 0.5],
    "hold_bars":            [4, 6, 8],
    "stop_loss_pct":        [0.4, 0.6, 0.8],
    "profit_target_pct":    [0.5, 0.8, 1.2],
    "kelly_base_fraction":  [0.05, 0.08, 0.12],
}

JEDI_SEARCH_SPACE: dict[str, tuple] = {
    "min_agree":            ("int",   2, 5, 1),
    "accel_bars":           ("int",   2, 4, 1),
    "atr_mult":             ("float", 0.7, 1.4, None),
    "decel_window":         ("int",   1, 4, 1),
    "decel_thresh":         ("float", 0.2, 0.7, None),
    "hold_bars":            ("int",   3, 12, 1),
    "stop_loss_pct":        ("float", 0.3, 1.5, None),
    "profit_target_pct":    ("float", 0.4, 2.0, None),
    "kelly_base_fraction":  ("float", 0.03, 0.20, None),
    "require_multi_bank":   ("cat",   [True, False]),
    "require_range_expand": ("cat",   [True, False]),
    "exit_mode":            ("cat",   ["ema13", "holdbars"]),
}


# ── Mini-council feature computer ─────────────────────────────────────────────

def _compute_mini_council(df: pd.DataFrame) -> pd.DataFrame:
    """
    Run all MINI_COUNCIL_SIGNALS on df using their default params.
    Returns a DataFrame with one bool column per signal + 'council_vote' int column.

    Uses default params for each signal — fast and deterministic for entry scoring.
    This is the "alignment oracle": how many independent methods agree right now?
    """
    out = df.copy()
    votes = pd.DataFrame(index=df.index)

    for sig_name in MINI_COUNCIL_SIGNALS:
        reg = SIGNAL_REGISTRY[sig_name]
        try:
            feat = reg["features_fn"](df, reg["default_params"])
            votes[sig_name] = feat["entry"].astype(int)
        except Exception:
            votes[sig_name] = 0

    out["council_vote"] = votes.sum(axis=1).astype(int)
    for sig_name in MINI_COUNCIL_SIGNALS:
        out[f"cv_{sig_name}"] = votes.get(sig_name, 0)
    return out


def _jedi_features(df: pd.DataFrame, p: JediParams) -> pd.DataFrame:
    """
    Compute all JEDI-00 entry/exit features.  No look-ahead.

    ENTRY LOGIC (revised iter-00):
      The "aligned acceleration" requires volatility context — accel without
      a preceding compression phase buys exhaustion, not release.

      Core entry conditions:
        1. squeeze_release: BB inside KC (compressed), then breaks out this bar.
                            This is the "coiled spring releasing" (PHYSICIST).
        2. body_accel: current bullish body > prev bar's body (acceleration).
                       "The next bar has more conviction than the last."
        3. rvol > 1.3: volume confirms institutional participation.
        4. close > EMA50: trend alignment — Jedi trades WITH the trend.
        5. ATR gate: absolute vol expanding (not a dead market).

      Council vote remains in the feature set — used for Kelly conviction sizing
      and for iter-01+ where we can tighten min_agree once we have IC data.
    """
    out = _compute_mini_council(df)
    c = out["Close"]
    h, l, v = out["High"], out["Low"], out["Volume"]
    o = out["Open"]

    # ── BB/KC Squeeze (BOOM core mechanic) ────────────────────────────────────
    from .boom_backtest import _rolling_squeeze
    sq_len = 14
    squeeze = _rolling_squeeze(c, h, l, sq_len).fillna(False)
    # Release: was squeezed last bar, not squeezed this bar
    squeeze_release = squeeze.shift(1).fillna(False) & ~squeeze
    # "Recently squeezed" context window: in a squeeze at some point in last 6 bars.
    # Acceleration AFTER compression (not necessarily on the exact release bar).
    recently_squeezed = squeeze.rolling(6).max().fillna(0).astype(bool)

    # ── Relative volume ───────────────────────────────────────────────────────
    rvol = v / v.rolling(20).mean().replace(0, np.nan).bfill()
    rvol_gate = rvol > 1.2

    # ── Trend (close > EMA50) ─────────────────────────────────────────────────
    ema50 = c.ewm(span=50, adjust=False).mean()
    trend = c > ema50

    # ── Body acceleration ─────────────────────────────────────────────────────
    body = (c - o).clip(lower=0)            # bullish body only (0 for red bars)
    bar_range = h - l

    accel = pd.Series(True, index=out.index)
    for k in range(p.accel_bars):
        accel = accel & (body.shift(k) > body.shift(k + 1)) & (body.shift(k) > 0)
    if p.require_range_expand:
        accel = accel & (bar_range > bar_range.shift(1))

    out["accel_signal"] = accel.fillna(False)
    out["entry_body"] = body

    # ── ATR gate ──────────────────────────────────────────────────────────────
    atr_fast, atr_base = _atr(h, l, c)
    out["atr_gate"] = (atr_fast > atr_base * p.atr_mult).fillna(False)
    out["atr_fast"] = atr_fast

    # ── ATR slope (iter-01: blow-off detection) ───────────────────────────────
    # Measures how fast ATR is accelerating this bar vs last bar.
    # High slope = volatility spiking fast = potential exhaustion / blow-off top.
    # Used in strategy to widen stop dynamically (not to block entry).
    atr_prev = atr_fast.shift(1)
    out["atr_slope"] = ((atr_fast - atr_prev) / atr_prev.replace(0, np.nan)).fillna(0.0)

    # ── Conviction score for Kelly sizing (mini-council + grok-x blend) ───────
    raw_conviction = (out["council_vote"] / MINI_COUNCIL_MAX_VOTE).clip(0, 1)
    trend_score = trend.astype(float).fillna(0.0)
    out["conviction"] = (
        (1.0 - p.grok_x_weight) * raw_conviction
        + p.grok_x_weight * trend_score
    )
    # Boost conviction when squeeze is releasing — the coil IS the edge
    out["conviction"] = (out["conviction"] + squeeze_release.astype(float) * 0.3).clip(0, 1)

    # ── Multi-bank alignment (optional tighter gate for iter-01+) ─────────────
    bank_a = out.get(f"cv_{ENERGY_BANK_A}", pd.Series(0, index=out.index))
    bank_b = out.get(f"cv_{ENERGY_BANK_B}", pd.Series(0, index=out.index))
    bank_c = out.get(f"cv_{ENERGY_BANK_C}", pd.Series(0, index=out.index))
    out["multi_bank_align"] = ((bank_a >= 1) & (bank_b >= 1) & (bank_c >= 1)).fillna(False)
    mb_gate = out["multi_bank_align"] if p.require_multi_bank else pd.Series(True, index=out.index)

    # ── Council gate (used in iter-01+ for tighter alignment) ─────────────────
    council_gate = (out["council_vote"] >= p.min_agree) if p.min_agree > 0 else pd.Series(True, index=out.index)

    # ── Final entry ───────────────────────────────────────────────────────────
    # iter-00: recently_squeezed + body_accel + rvol + trend + ATR
    # "recently_squeezed" = was in compression within last 6 bars (context window).
    # Acceleration can occur 1-5 bars after the release — not required same bar.
    # Council gate adds ensemble confirmation when min_agree > 0 (default=1).
    entry = (
        recently_squeezed & accel & rvol_gate & trend & out["atr_gate"]
        & council_gate & mb_gate
    )

    # ── Session / doldrums filter ─────────────────────────────────────────────
    # "Not late in day. Maybe not Friday. Stay out of the doldrums."
    # Allowed window: session_open_et → session_cutoff_et (default 09:30–14:00 ET).
    # After 14:00: low participation, choppy, wide spreads = donation to MM fund.
    try:
        dt = pd.DatetimeIndex(out.index)
        if dt.tz is None:
            dt_ny = dt.tz_localize("UTC").tz_convert("America/New_York")
        else:
            dt_ny = dt.tz_convert("America/New_York")
        mins_et = dt_ny.hour * 60 + dt_ny.minute
        in_window = pd.Series(
            (mins_et >= p.session_open_et) & (mins_et < p.session_cutoff_et),
            index=out.index,
        )
        if not p.friday_ok:
            not_friday = pd.Series(dt_ny.dayofweek < 4, index=out.index)  # Mon=0..Thu=3
            in_window = in_window & not_friday
        entry = entry & in_window
    except Exception:
        pass  # daily bars or unknown TZ → skip session filter

    if p.first_half_only:
        entry = entry & _first_half_market_mask(out.index).fillna(False)

    out["entry"] = entry.fillna(False)
    out["squeeze_release"] = squeeze_release

    # ── EMA13 exit ────────────────────────────────────────────────────────────
    out["ema13"], out["exit_ema13"] = _exit_ema13(c)

    return out


# ── Custom Strategy with decel-exit + Kelly sizing + ultra protection ─────────

def _make_jedi_strategy(feat_df: pd.DataFrame, p: JediParams):
    """
    Build a backtesting.py Strategy class with JEDI-00 logic baked in.
    """

    class JediStrategy(Strategy):
        _feat = feat_df
        _p = p

        def init(self):
            self._trade_count = 0       # total trades taken (for protection scaling)
            self._bars_in_trade = 0
            self._entry_price = None
            self._entry_body = 0.0
            self._entry_volume = 0.0    # iter-01: entry bar volume (for vol-weighted decel)
            self._entry_day = None
            self._break_even_armed = False
            self._partial_closed = False  # profit target partial close done

        def _kelly_size(self, conviction: float) -> float:
            """Fractional Kelly: conviction × base × protection scalar."""
            raw = float(conviction) * self._p.kelly_base_fraction

            n = self._trade_count
            if n < self._p.ultra_protect_n:
                scalar = self._p.ultra_protect_scalar
            elif n < self._p.grad_protect_n:
                scalar = self._p.grad_protect_scalar
            else:
                scalar = 1.0

            size = raw * scalar
            return max(self._p.kelly_min, min(self._p.kelly_max, size))

        def next(self):
            idx = len(self.data) - 1
            if idx < 0:
                return

            close_now = float(self.data.Close[-1])
            open_now = float(self.data.Open[-1])
            now_day = pd.Timestamp(self.data.index[idx]).date()

            feat = self._feat
            entry_body_now = float(feat["entry_body"].iloc[idx])
            conviction_now = float(feat["conviction"].iloc[idx])

            if self.position:
                # ── Flat EOD ────────────────────────────────────────────────
                if self._p.flat_eod and self._entry_day is not None and now_day != self._entry_day:
                    self.position.close()
                    self._reset_trade()
                    return

                # ── Decel exit (JEDI LEAVES — does not donate to MM fund) ──
                # iter-01: Volume-Weighted Decel.
                # Original: exit on any red bar within decel_window.
                # Problem: 1m red bars often capture "noise" rests, shaking out winners.
                # Fix: if decel_require_volume=True, only exit when red bar also has
                #   institutional weight (volume > decel_volume_pct_of_entry × entry vol).
                # Low-volume pullbacks = resting, not reversing → stay in trade.
                if self._bars_in_trade <= self._p.decel_window and self._entry_price is not None:
                    bar_turned_red = close_now < open_now
                    body_decel = False
                    if self._p.decel_thresh > 0 and self._entry_body > 0:
                        current_body = max(0.0, close_now - open_now)
                        if not bar_turned_red and current_body < self._entry_body * self._p.decel_thresh:
                            body_decel = True
                    raw_decel = bar_turned_red or body_decel
                    # iter-01: volume confirmation gate
                    if raw_decel and self._p.decel_require_volume and self._entry_volume > 0:
                        vol_now = float(self.data.Volume[-1])
                        vol_confirmed = vol_now > self._entry_volume * self._p.decel_volume_pct_of_entry
                        raw_decel = vol_confirmed  # only exit if reversal has institutional weight
                    if raw_decel:
                        self.position.close()
                        self._reset_trade()
                        return

                # ── Hard stop ───────────────────────────────────────────────
                if self._entry_price is not None:
                    stop_pct = self._p.stop_loss_pct
                    # iter-01: ATR slope widening — if volatility is spiking fast
                    # (blow-off top risk), widen stop to avoid being shaken out by noise.
                    atr_slope_now = float(feat["atr_slope"].iloc[idx])
                    if atr_slope_now > self._p.atr_slope_thresh:
                        stop_pct = stop_pct * self._p.atr_slope_stop_mult
                    stop_px = self._entry_price * (1.0 - stop_pct / 100.0)
                    # Break-even lock: once trade is green, lift stop to entry + offset
                    if close_now > self._entry_price:
                        self._break_even_armed = True
                    if self._break_even_armed:
                        be_lock = self._entry_price * (1.0 + self._p.break_even_offset_pct / 100.0)
                        stop_px = max(stop_px, be_lock)
                    if close_now <= stop_px:
                        self.position.close()
                        self._reset_trade()
                        return

                # ── Profit target partial close (sell 1 lot on move) ────────
                if (
                    not self._partial_closed
                    and self._entry_price is not None
                    and close_now >= self._entry_price * (1.0 + self._p.profit_target_pct / 100.0)
                ):
                    # Close 50% of position — the "SELL 1 LOT ON MOVE"
                    pos_size = self.position.size
                    if pos_size > 1:
                        self.sell(size=pos_size // 2)
                    self._partial_closed = True

                # ── EMA13 exit ──────────────────────────────────────────────
                if self._p.exit_mode == "ema13" and bool(feat["exit_ema13"].iloc[idx]):
                    self.position.close()
                    self._reset_trade()
                    return

                # ── Hold-bars timeout ────────────────────────────────────────
                self._bars_in_trade += 1
                if self._p.exit_mode == "holdbars" and self._bars_in_trade >= self._p.hold_bars:
                    self.position.close()
                    self._reset_trade()
                return

            # ── Entry ─────────────────────────────────────────────────────────
            if bool(feat["entry"].iloc[idx]):
                size = self._kelly_size(conviction_now)
                # iter-01: Friday Gap-Risk Scalar
                # Instead of blocking Friday entries (old friday_ok=False), scale Kelly down.
                # A 6/6 council vote on Friday morning likely exceeds liquidity risk.
                is_friday = pd.Timestamp(self.data.index[idx]).weekday() == 4
                if is_friday and self._p.friday_kelly_scalar < 1.0:
                    size = size * self._p.friday_kelly_scalar
                    size = max(self._p.kelly_min, min(self._p.kelly_max, size))
                self.buy(size=size)
                self._bars_in_trade = 0
                self._entry_price = close_now
                self._entry_body = entry_body_now
                self._entry_volume = float(self.data.Volume[-1])  # iter-01: for vol-decel
                self._entry_day = now_day
                self._break_even_armed = False
                self._partial_closed = False
                self._trade_count += 1

        def _reset_trade(self):
            self._bars_in_trade = 0
            self._entry_price = None
            self._entry_body = 0.0
            self._entry_volume = 0.0
            self._entry_day = None
            self._break_even_armed = False
            self._partial_closed = False

    return JediStrategy


# ── Sword-compatible run_one ──────────────────────────────────────────────────

def jedi_run_one(
    df: pd.DataFrame,
    p: JediParams,
    symbol: str = "SPY",
    flat_eod: bool = False,
) -> dict:
    """Run JEDI-00 on one symbol/timeframe. Returns Sword-compatible result dict.

    Commission model: intraday-realistic.
      IBKR fixed ~$0.005/share.  On a $500–$3000 position that's 0.01–0.001%.
      We use commission=0.0002 (0.02%) as a conservative intraday estimate.
      Spread=0.0002 (0.02% — about 1–2 cents on a $100 stock).
      The 0.15% BOOM commission is designed for daily/swing, NOT 1-min scalping.
    """
    p_with_flat = JediParams(**{**p.__dict__, "flat_eod": flat_eod})
    feat = _jedi_features(df, p_with_flat)
    strat = _make_jedi_strategy(feat, p_with_flat)
    bt = Backtest(
        df, strat,
        cash=100_000,
        commission=0.0002,    # 0.02% intraday (vs 0.15% swing — 7.5× less)
        spread=0.0002,        # 0.02% spread for liquid stocks on 1m bars
        exclusive_orders=False,   # allow partial closes
        finalize_trades=True,
    )
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        stats = bt.run()

    rs = boom_rank_score({
        "return_pct": float(stats.get("Return [%]", 0.0) or 0.0),
        "win_rate_pct": float(stats.get("Win Rate [%]", 0.0) or 0.0),
        "max_dd_pct": abs(float(stats.get("Max. Drawdown [%]", 0.0) or 0.0)),
    })
    return {
        "symbol": symbol,
        "signal": "jedi_00",
        "return_pct": float(stats.get("Return [%]", 0.0) or 0.0),
        "win_rate_pct": float(stats.get("Win Rate [%]", 0.0) or 0.0),
        "max_dd_pct": abs(float(stats.get("Max. Drawdown [%]", 0.0) or 0.0)),
        "trades": int(stats.get("# Trades", 0) or 0),
        "sharpe": float(stats.get("Sharpe Ratio", 0.0) or 0.0),
        "boom_rank_score": rs,
        **{k: getattr(p, k) for k in p.__dataclass_fields__},
        "_stats": stats,
    }


def jedi_run_grid(
    df: pd.DataFrame,
    symbol: str = "SPY",
    flat_eod: bool = False,
    min_trades: int = 5,
    grid_overrides: dict | None = None,
) -> list[dict]:
    """Cartesian sweep over JEDI_GRID. Returns rows sorted by boom_rank_score."""
    grid = {**JEDI_GRID, **(grid_overrides or {})}
    keys = list(grid.keys())
    combos = list(product(*[grid[k] for k in keys]))
    rows = []
    default_p = JediParams()
    for combo in combos:
        overrides = dict(zip(keys, combo))
        fields = {f: getattr(default_p, f) for f in default_p.__dataclass_fields__}
        fields.update(overrides)
        p = JediParams(**fields)
        try:
            r = jedi_run_one(df, p, symbol=symbol, flat_eod=flat_eod)
            rows.append(r)
        except Exception:
            continue

    eligible = [r for r in rows if r["trades"] >= min_trades]
    pool = eligible if eligible else rows
    pool.sort(key=lambda r: r["boom_rank_score"], reverse=True)
    return pool


# ── Image sheet ───────────────────────────────────────────────────────────────

def jedi_image_sheet(
    df: pd.DataFrame,
    stats,
    p: JediParams,
    symbol: str = "SPY",
    timeframe: str = "5m",
    period: str = "60d",
) -> bytes:
    """
    Generate a 6-panel JEDI-00 backtest image sheet.
    Returns PNG bytes.

    Panels:
      1. Price chart + EMA13 + entry/exit markers
      2. Equity curve + drawdown shading
      3. Per-trade P&L bars
      4. Stats summary table
      5. Council vote over time (line)
      6. Kelly fraction per trade (estimated from conviction)
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.gridspec as gridspec
    from matplotlib.patches import FancyArrowPatch

    # ── Recompute features for chart overlays ─────────────────────────────────
    feat = _jedi_features(df, p)

    close = df["Close"].values
    dates = np.arange(len(close))
    ema13 = feat["ema13"].values
    council_vote = feat["council_vote"].values
    entry_mask = feat["entry"].values
    conviction = feat["conviction"].values

    # ── Trade data ────────────────────────────────────────────────────────────
    try:
        trades_df = stats._trades.copy() if hasattr(stats, "_trades") else pd.DataFrame()
    except Exception:
        trades_df = pd.DataFrame()

    equity_curve = None
    try:
        equity_curve = stats._equity_curve["Equity"].values if hasattr(stats, "_equity_curve") else None
    except Exception:
        pass

    # ── Figure layout ─────────────────────────────────────────────────────────
    fig = plt.figure(figsize=(16, 20), facecolor="#0d1117")
    fig.suptitle(
        f"JEDI-00  ·  {symbol}  ·  {timeframe}  ·  {period}",
        color="#f0f0f0", fontsize=16, fontweight="bold", y=0.98,
    )

    gs = gridspec.GridSpec(
        3, 2,
        figure=fig,
        hspace=0.45, wspace=0.35,
        left=0.08, right=0.95, top=0.94, bottom=0.05,
    )

    dark_bg = "#161b22"
    grid_col = "#30363d"
    text_col = "#e6edf3"

    def _ax_style(ax, title):
        ax.set_facecolor(dark_bg)
        ax.tick_params(colors=text_col, labelsize=8)
        for spine in ax.spines.values():
            spine.set_edgecolor(grid_col)
        ax.grid(color=grid_col, linestyle="--", linewidth=0.5, alpha=0.6)
        ax.set_title(title, color=text_col, fontsize=10, pad=6)

    # ── Panel 1: Price + EMA13 + trade markers ────────────────────────────────
    ax1 = fig.add_subplot(gs[0, :])
    _ax_style(ax1, f"Price + EMA13 | Entries (▲) Exits (▼)")
    ax1.plot(dates, close, color="#58a6ff", linewidth=0.9, label="Close")
    ax1.plot(dates, ema13, color="#f78166", linewidth=0.8, linestyle="--", label="EMA13")

    # Entry arrows
    entry_idx = np.where(entry_mask)[0]
    if len(entry_idx):
        ax1.scatter(entry_idx, close[entry_idx], marker="^", color="#3fb950",
                    s=80, zorder=5, label="Entry")

    # Exit markers from trades_df
    if not trades_df.empty and "ExitTime" in trades_df.columns:
        for _, tr in trades_df.iterrows():
            try:
                exit_ts = pd.Timestamp(tr["ExitTime"])
                exit_loc = df.index.get_indexer([exit_ts], method="nearest")[0]
                if 0 <= exit_loc < len(close):
                    color = "#3fb950" if tr.get("PnL", 0) >= 0 else "#f85149"
                    ax1.scatter(exit_loc, close[exit_loc], marker="v", color=color, s=60, zorder=5)
            except Exception:
                pass

    ax1.set_ylabel("Price", color=text_col, fontsize=8)
    ax1.legend(loc="upper left", fontsize=7, framealpha=0.3, labelcolor=text_col,
               facecolor=dark_bg)

    # ── Panel 2: Equity curve + drawdown ──────────────────────────────────────
    ax2 = fig.add_subplot(gs[1, 0])
    _ax_style(ax2, "Equity Curve + Drawdown")
    if equity_curve is not None and len(equity_curve) > 1:
        eq_dates = np.linspace(0, len(close) - 1, len(equity_curve))
        ax2.plot(eq_dates, equity_curve, color="#58a6ff", linewidth=1.2)
        peak = np.maximum.accumulate(equity_curve)
        dd = (equity_curve - peak) / peak * 100
        ax2b = ax2.twinx()
        ax2b.fill_between(eq_dates, dd, 0, color="#f85149", alpha=0.35, label="DD%")
        ax2b.set_ylabel("DD %", color="#f85149", fontsize=7)
        ax2b.tick_params(colors="#f85149", labelsize=7)
        ax2b.spines["right"].set_edgecolor("#f85149")
    else:
        ax2.text(0.5, 0.5, "No equity data", transform=ax2.transAxes,
                 ha="center", color=text_col, fontsize=9)
    ax2.set_ylabel("Equity ($)", color=text_col, fontsize=8)

    # ── Panel 3: Per-trade P&L ────────────────────────────────────────────────
    ax3 = fig.add_subplot(gs[1, 1])
    _ax_style(ax3, "Per-Trade P&L")
    if not trades_df.empty and "PnL" in trades_df.columns:
        pnls = trades_df["PnL"].values
        colors = ["#3fb950" if p >= 0 else "#f85149" for p in pnls]
        ax3.bar(range(len(pnls)), pnls, color=colors, alpha=0.85, width=0.8)
        ax3.axhline(0, color=text_col, linewidth=0.6, linestyle="--")
        cumulative = np.cumsum(pnls)
        ax3b = ax3.twinx()
        ax3b.plot(range(len(pnls)), cumulative, color="#e3b341", linewidth=1.0, label="Cumul P&L")
        ax3b.set_ylabel("Cumulative ($)", color="#e3b341", fontsize=7)
        ax3b.tick_params(colors="#e3b341", labelsize=7)
        ax3b.spines["right"].set_edgecolor("#e3b341")
    else:
        ax3.text(0.5, 0.5, "No trades", transform=ax3.transAxes,
                 ha="center", color=text_col, fontsize=9)
    ax3.set_xlabel("Trade #", color=text_col, fontsize=8)
    ax3.set_ylabel("P&L ($)", color=text_col, fontsize=8)

    # ── Panel 4: Stats summary ────────────────────────────────────────────────
    ax4 = fig.add_subplot(gs[2, 0])
    ax4.set_facecolor(dark_bg)
    ax4.axis("off")
    ax4.set_title("JEDI-00 Stats Summary", color=text_col, fontsize=10, pad=6)

    ret_pct = float(stats.get("Return [%]", 0.0) or 0.0)
    wr = float(stats.get("Win Rate [%]", 0.0) or 0.0)
    dd = abs(float(stats.get("Max. Drawdown [%]", 0.0) or 0.0))
    n_trades = int(stats.get("# Trades", 0) or 0)
    sharpe = float(stats.get("Sharpe Ratio", 0.0) or 0.0)
    rs = boom_rank_score({"return_pct": ret_pct, "win_rate_pct": wr, "max_dd_pct": dd})

    stat_rows = [
        ("Return",        f"{ret_pct:+.2f}%"),
        ("Win Rate",      f"{wr:.1f}%"),
        ("Max DD",        f"{dd:.2f}%"),
        ("Trades",        str(n_trades)),
        ("Sharpe",        f"{sharpe:.3f}"),
        ("boom_rank",     f"{rs:+.3f}"),
        ("Gate pass",     "✓ YES" if rs > 0 and wr > 35 and n_trades >= 8 else "✗ NO"),
        ("IS window",     f"{JEDI_IS_START}→{JEDI_IS_END}"),
        ("OOS window",    f"{JEDI_OOS_START}→{JEDI_OOS_END}"),
        ("min_agree",     str(p.min_agree)),
        ("accel_bars",    str(p.accel_bars)),
        ("decel_win",     str(p.decel_window)),
        ("kelly_base",    f"{p.kelly_base_fraction:.2f}"),
        ("stop_pct",      f"{p.stop_loss_pct:.2f}%"),
        ("ultra_n",       str(p.ultra_protect_n)),
    ]

    y_pos = 0.97
    for label, val in stat_rows:
        color = "#3fb950" if "✓" in val else ("#f85149" if "✗" in val else text_col)
        ax4.text(0.05, y_pos, label, transform=ax4.transAxes, color="#8b949e", fontsize=8)
        ax4.text(0.55, y_pos, val, transform=ax4.transAxes, color=color, fontsize=8,
                 fontweight="bold" if any(k in label for k in ["Return", "boom_rank", "Gate"]) else "normal")
        y_pos -= 0.063

    # ── Panel 5: Council vote over time ───────────────────────────────────────
    ax5 = fig.add_subplot(gs[2, 1])
    _ax_style(ax5, "Council Vote / Conviction Over Time")
    ax5.fill_between(dates, council_vote, 0, color="#58a6ff", alpha=0.4, step="pre")
    ax5.axhline(p.min_agree, color="#e3b341", linewidth=0.8, linestyle="--",
                label=f"min_agree={p.min_agree}")
    ax5b = ax5.twinx()
    ax5b.plot(dates, conviction * 100, color="#bc8cff", linewidth=0.7, alpha=0.7, label="Conviction%")
    ax5b.set_ylabel("Conviction %", color="#bc8cff", fontsize=7)
    ax5b.tick_params(colors="#bc8cff", labelsize=7)
    ax5b.spines["right"].set_edgecolor("#bc8cff")
    ax5.set_ylabel("Council Vote (of 6)", color=text_col, fontsize=8)
    ax5.set_xlabel("Bar index", color=text_col, fontsize=8)
    ax5.legend(loc="upper left", fontsize=7, framealpha=0.3, labelcolor=text_col,
               facecolor=dark_bg)

    # ── Footer ────────────────────────────────────────────────────────────────
    fig.text(
        0.5, 0.015,
        f"JEDI-00 iter-0  ·  M4D Oracle  ·  IS={JEDI_IS_START}→{JEDI_IS_END}"
        f"  ·  OOS={JEDI_OOS_START}→{JEDI_OOS_END}"
        f"  ·  Kelly×{p.kelly_base_fraction:.2f}  ·  UltraProtect×{p.ultra_protect_scalar}",
        ha="center", color="#484f58", fontsize=7,
    )

    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=130, facecolor=fig.get_facecolor())
    plt.close(fig)
    return buf.getvalue()


# ── Standalone runner (python -m ds_app.jedi_signal) ─────────────────────────

def run_jedi_quick(
    symbol: str = "SPY",
    period: str = "60d",
    interval: str = "5m",
    p: JediParams | None = None,
    save_sheet: str | None = None,
) -> dict:
    """
    Quick single-symbol JEDI-00 run.  Fetches data via yfinance.
    Returns result dict; optionally saves image sheet to save_sheet path.

    Usage:
        from ds_app.jedi_signal import run_jedi_quick
        r = run_jedi_quick("SPY", save_sheet="/tmp/jedi_spy.png")
    """
    try:
        import yfinance as yf
    except ImportError:
        raise ImportError("yfinance required: pip install yfinance")

    df = yf.download(symbol, period=period, interval=interval, auto_adjust=True, progress=False)
    if df.empty:
        raise ValueError(f"No data returned for {symbol}")

    from .boom_backtest import _normalize_ohlcv
    df = _normalize_ohlcv(df)

    if p is None:
        p = JediParams()

    result = jedi_run_one(df, p, symbol=symbol)
    stats = result.pop("_stats")

    if save_sheet:
        png = jedi_image_sheet(df, stats, p, symbol=symbol,
                               timeframe=interval, period=period)
        with open(save_sheet, "wb") as f:
            f.write(png)
        print(f"Image sheet saved: {save_sheet}")

    return result
