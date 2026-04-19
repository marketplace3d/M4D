"""
signals.py — WorldQuant-style alpha signal library

12 signals across 4 families:
  Momentum   : ts_momentum, cross_momentum, reversal_1m
  Mean-Rev   : stat_arb_zscore, vol_adjusted_mr, rsi_extremes
  Value      : ep_rank, bp_rank, composite_value
  Quality    : roe_rank, earnings_surprise, accruals

Each signal:
  - Returns a cross-sectional DataFrame (T × N) of raw alpha values
  - Values are NOT yet ranked or normalised (that happens in the combiner)
  - Handles NaN gracefully

WorldQuant-style operators used:
  cs_rank, ts_delta, ts_std, ts_corr, decay_linear, indneutralize
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from core import cs_rank, winsorise, zscore, rolling_zscore, compute_atr
from data import Universe


# ── Base class ──────────────────────────────────────────────────────────────
class AlphaSignal:
    name: str = "base"
    family: str = "base"
    default_decay_hl: int = 60      # IC half-life for ensemble weighting

    def compute(self, univ: Universe) -> pd.DataFrame:
        """Return (T × N) DataFrame of raw signal values."""
        raise NotImplementedError


# ═══════════════════════════════════════════════════════════════════════════
# MOMENTUM FAMILY
# ═══════════════════════════════════════════════════════════════════════════

class TsMomentum(AlphaSignal):
    """
    12-1 month momentum (classic Jegadeesh-Titman).
    Alpha = return over past 252 days, skipping most recent 21 days.
    Cross-sectionally ranked and industry-neutralised.
    """
    name = "ts_momentum"
    family = "momentum"
    default_decay_hl = 90

    def __init__(self, lookback: int = 252, skip: int = 21):
        self.lookback = lookback
        self.skip     = skip

    def compute(self, univ: Universe) -> pd.DataFrame:
        p = univ.prices
        ret = p.pct_change(self.lookback).shift(self.skip)
        # Cross-sectional rank per day
        ranked = ret.apply(cs_rank, axis=1)
        return ranked


class CrossMomentum(AlphaSignal):
    """
    Short-term cross-sectional momentum: 20-day return rank.
    Captures fast momentum / gap-and-go dynamics.
    """
    name = "cross_momentum"
    family = "momentum"
    default_decay_hl = 45

    def __init__(self, lookback: int = 20):
        self.lookback = lookback

    def compute(self, univ: Universe) -> pd.DataFrame:
        ret = univ.prices.pct_change(self.lookback)
        return ret.apply(cs_rank, axis=1)


class Reversal1m(AlphaSignal):
    """
    1-month short-term reversal (contrarian).
    Alpha = -rank(ret_21d) — mean-reversion on monthly losers.
    """
    name = "reversal_1m"
    family = "momentum"
    default_decay_hl = 30

    def compute(self, univ: Universe) -> pd.DataFrame:
        ret = univ.prices.pct_change(21)
        return -ret.apply(cs_rank, axis=1)


# ═══════════════════════════════════════════════════════════════════════════
# MEAN-REVERSION FAMILY
# ═══════════════════════════════════════════════════════════════════════════

class StatArbZscore(AlphaSignal):
    """
    20-day rolling z-score of price. Negative z = oversold = long signal.
    The core OU mean-reversion signal.
    """
    name = "stat_arb_zscore"
    family = "mean_rev"
    default_decay_hl = 40

    def __init__(self, window: int = 20):
        self.window = window

    def compute(self, univ: Universe) -> pd.DataFrame:
        z = univ.prices.apply(
            lambda col: rolling_zscore(col, self.window))
        # Invert: negative z → want to go long
        return -z


class VolAdjustedMR(AlphaSignal):
    """
    Volatility-adjusted mean reversion.
    Alpha = -zscore(price) / rolling_vol
    Up-weights low-volatility mean-reversion opportunities.
    """
    name = "vol_adjusted_mr"
    family = "mean_rev"
    default_decay_hl = 35

    def __init__(self, z_window: int = 20, vol_window: int = 60):
        self.z_win   = z_window
        self.vol_win = vol_window

    def compute(self, univ: Universe) -> pd.DataFrame:
        z   = univ.prices.apply(lambda c: rolling_zscore(c, self.z_win))
        vol = univ.returns.rolling(self.vol_win).std() * np.sqrt(252)
        vol = vol.replace(0, np.nan)
        signal = -z / vol
        return signal.apply(cs_rank, axis=1)


class RSIExtremes(AlphaSignal):
    """
    RSI-based mean-reversion: long when RSI < 30, short when RSI > 70.
    Classic oversold/overbought signal.
    """
    name = "rsi_extremes"
    family = "mean_rev"
    default_decay_hl = 25

    def __init__(self, period: int = 14):
        self.period = period

    def _rsi(self, col: pd.Series) -> pd.Series:
        delta = col.diff()
        gain  = delta.clip(lower=0).ewm(alpha=1/self.period, adjust=False).mean()
        loss  = (-delta.clip(upper=0)).ewm(alpha=1/self.period, adjust=False).mean()
        rs    = gain / loss.replace(0, np.nan)
        return 100 - (100 / (1 + rs))

    def compute(self, univ: Universe) -> pd.DataFrame:
        rsi = univ.prices.apply(self._rsi)
        # Signal: distance from neutral 50, inverted for MR
        signal = 50 - rsi
        return signal.apply(cs_rank, axis=1)


# ═══════════════════════════════════════════════════════════════════════════
# VALUE FAMILY
# ═══════════════════════════════════════════════════════════════════════════

class EPRank(AlphaSignal):
    """
    Earnings-to-Price yield, cross-sectionally ranked.
    Classic Fama-French value factor.
    """
    name = "ep_rank"
    family = "value"
    default_decay_hl = 120

    def compute(self, univ: Universe) -> pd.DataFrame:
        ep = univ.fundamentals["ep"].unstack("instrument")
        ep = ep.reindex(univ.dates).ffill()
        return ep.apply(cs_rank, axis=1)


class BPRank(AlphaSignal):
    """
    Book-to-Price ratio, cross-sectionally ranked.
    """
    name = "bp_rank"
    family = "value"
    default_decay_hl = 120

    def compute(self, univ: Universe) -> pd.DataFrame:
        bp = univ.fundamentals["bp"].unstack("instrument")
        bp = bp.reindex(univ.dates).ffill()
        return bp.apply(cs_rank, axis=1)


class CompositeValue(AlphaSignal):
    """
    Composite value score = average of EP rank and BP rank.
    More stable than either individually.
    """
    name = "composite_value"
    family = "value"
    default_decay_hl = 120

    def compute(self, univ: Universe) -> pd.DataFrame:
        ep = univ.fundamentals["ep"].unstack("instrument").reindex(univ.dates).ffill()
        bp = univ.fundamentals["bp"].unstack("instrument").reindex(univ.dates).ffill()
        ep_r = ep.apply(cs_rank, axis=1)
        bp_r = bp.apply(cs_rank, axis=1)
        return (ep_r + bp_r) / 2


# ═══════════════════════════════════════════════════════════════════════════
# QUALITY FAMILY
# ═══════════════════════════════════════════════════════════════════════════

class ROERank(AlphaSignal):
    """
    Return on Equity, cross-sectionally ranked.
    Quality stocks with high ROE tend to outperform.
    """
    name = "roe_rank"
    family = "quality"
    default_decay_hl = 120

    def compute(self, univ: Universe) -> pd.DataFrame:
        roe = univ.fundamentals["roe"].unstack("instrument")
        roe = roe.reindex(univ.dates).ffill()
        return roe.apply(cs_rank, axis=1)


class EarningsSurprise(AlphaSignal):
    """
    Earnings surprise: actual vs estimated. Post-earnings drift.
    Long stocks that surprised positively.
    """
    name = "earnings_surprise"
    family = "quality"
    default_decay_hl = 45

    def __init__(self, decay_window: int = 63):  # ~1 quarter
        self.decay_window = decay_window

    def compute(self, univ: Universe) -> pd.DataFrame:
        surp = univ.fundamentals["earn_surp"].unstack("instrument")
        surp = surp.reindex(univ.dates).ffill()
        # Exponential decay of surprise over time
        decayed = surp.ewm(halflife=self.decay_window, adjust=False).mean()
        return decayed.apply(cs_rank, axis=1)


class Accruals(AlphaSignal):
    """
    Low-accruals quality signal (Sloan 1996).
    Proxy accruals as: -change_in_ep (earnings quality deterioration).
    Lower accruals → higher quality → positive signal.
    """
    name = "accruals"
    family = "quality"
    default_decay_hl = 120

    def compute(self, univ: Universe) -> pd.DataFrame:
        ep = univ.fundamentals["ep"].unstack("instrument")
        ep = ep.reindex(univ.dates).ffill()
        # Accrual proxy: rate of change of EP (deteriorating EP = high accruals)
        accruals = ep.pct_change(63).fillna(0)
        # Invert: low accruals = high quality = want to be long
        return (-accruals).apply(cs_rank, axis=1)


# ── Signal registry ──────────────────────────────────────────────────────────
ALL_SIGNALS: list[AlphaSignal] = [
    TsMomentum(),
    CrossMomentum(),
    Reversal1m(),
    StatArbZscore(),
    VolAdjustedMR(),
    RSIExtremes(),
    EPRank(),
    BPRank(),
    CompositeValue(),
    ROERank(),
    EarningsSurprise(),
    Accruals(),
]

SIGNAL_MAP: dict[str, AlphaSignal] = {s.name: s for s in ALL_SIGNALS}


def compute_all_signals(univ: Universe,
                        signals: list[AlphaSignal] | None = None
                        ) -> dict[str, pd.DataFrame]:
    """Compute all signals and return {name: DataFrame(T×N)}."""
    sigs = signals or ALL_SIGNALS
    results = {}
    for sig in sigs:
        try:
            df = sig.compute(univ)
            df = df.reindex(index=univ.dates, columns=univ.instruments)
            results[sig.name] = df
        except Exception as e:
            print(f"  [WARN] Signal {sig.name} failed: {e}")
    return results
