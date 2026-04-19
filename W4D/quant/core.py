"""
core.py — shared types, constants, and utilities
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum


# ── Regime ──────────────────────────────────────────────────────────────────
class Regime(Enum):
    RISK_ON    = "risk_on"
    TRENDING   = "trending"
    MEAN_REV   = "mean_rev"
    RISK_OFF   = "risk_off"
    CRISIS     = "crisis"


# ── Order / Fill ─────────────────────────────────────────────────────────────
@dataclass
class Order:
    date:       pd.Timestamp
    instrument: str
    target_weight: float      # signed: +long, -short
    reason:     str = ""


@dataclass
class Fill:
    date:       pd.Timestamp
    instrument: str
    shares:     float
    price:      float
    commission: float = 0.0

    @property
    def notional(self) -> float:
        return self.shares * self.price


# ── Portfolio snapshot ───────────────────────────────────────────────────────
@dataclass
class PortfolioState:
    date:      pd.Timestamp
    nav:       float
    cash:      float
    positions: dict[str, float]   # instrument → shares
    prices:    dict[str, float]   # instrument → last price

    def market_value(self) -> float:
        return sum(self.positions.get(k, 0) * v for k, v in self.prices.items())

    def gross_exposure(self) -> float:
        return sum(abs(self.positions.get(k, 0) * v) for k, v in self.prices.items())

    def net_exposure(self) -> float:
        return sum(self.positions.get(k, 0) * v for k, v in self.prices.items())

    def weights(self) -> dict[str, float]:
        nav = self.nav if self.nav > 0 else 1.0
        return {k: self.positions.get(k, 0) * v / nav for k, v in self.prices.items()}


# ── Performance record ────────────────────────────────────────────────────────
@dataclass
class PerformanceRecord:
    dates:   list[pd.Timestamp] = field(default_factory=list)
    navs:    list[float]        = field(default_factory=list)
    returns: list[float]        = field(default_factory=list)
    gross:   list[float]        = field(default_factory=list)
    net:     list[float]        = field(default_factory=list)

    def to_df(self) -> pd.DataFrame:
        return pd.DataFrame({
            "nav":    self.navs,
            "ret":    self.returns,
            "gross":  self.gross,
            "net":    self.net,
        }, index=pd.DatetimeIndex(self.dates))


# ── Shared math utilities ─────────────────────────────────────────────────────
def cs_rank(s: pd.Series) -> pd.Series:
    """Cross-sectional percentile rank [0,1], handles NaN."""
    return s.rank(pct=True, na_option="keep")


def winsorise(s: pd.Series, pct: float = 0.01) -> pd.Series:
    lo, hi = s.quantile(pct), s.quantile(1 - pct)
    return s.clip(lo, hi)


def zscore(s: pd.Series) -> pd.Series:
    mu, sig = s.mean(), s.std()
    return (s - mu) / sig if sig > 1e-8 else s * 0


def rolling_zscore(s: pd.Series, window: int) -> pd.Series:
    mu  = s.rolling(window, min_periods=window // 2).mean()
    sig = s.rolling(window, min_periods=window // 2).std()
    return (s - mu) / sig.replace(0, np.nan)


def decay_weights(n: int, half_life: float) -> np.ndarray:
    lam = np.exp(-np.log(2) / half_life)
    w   = lam ** np.arange(n - 1, -1, -1)
    return w / w.sum()


def compute_atr(high: pd.Series, low: pd.Series, close: pd.Series,
                period: int = 14) -> pd.Series:
    prev_c = close.shift(1)
    tr = pd.concat([high - low,
                    (high - prev_c).abs(),
                    (low  - prev_c).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1/period, min_periods=period, adjust=False).mean()


def sharpe(returns: pd.Series, ann: int = 252) -> float:
    r = returns.dropna()
    if r.std() < 1e-10 or len(r) < 2:
        return 0.0
    return float(r.mean() / r.std() * np.sqrt(ann))


def max_drawdown(nav: pd.Series) -> float:
    roll_max = nav.cummax()
    dd = (nav - roll_max) / roll_max
    return float(dd.min())


def calmar(returns: pd.Series, nav: pd.Series, ann: int = 252) -> float:
    ann_ret = returns.mean() * ann
    mdd = abs(max_drawdown(nav))
    return ann_ret / mdd if mdd > 1e-8 else 0.0
