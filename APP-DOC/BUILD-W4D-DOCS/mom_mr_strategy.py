"""
Momentum + Mean-Reversion Combined Strategy
============================================
Optimal entry and exit rules derived from OU process theory
and momentum breakout literature.

Components:
  - RegimeDetector     : OU half-life → regime classification
  - MeanReversionEntry : z-score band entry with cost-adjusted threshold
  - MomentumEntry      : ADX + breakout + cross-sectional rank filter
  - ExitRuleStack      : 6-layer ordered exit logic
  - PositionSizer      : vol-targeted ATR sizing
  - CombinedStrategy   : orchestrates all components

Dependencies: numpy, pandas, scipy
"""

import numpy as np
import pandas as pd
from scipy import stats
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum


# ─────────────────────────────────────────────
# 0. Enums and data structures
# ─────────────────────────────────────────────

class StrategyRegime(Enum):
    MEAN_REVERSION = "mean_reversion"
    MOMENTUM       = "momentum"
    BLEND          = "blend"
    NO_TRADE       = "no_trade"      # regime too uncertain


class Direction(Enum):
    LONG  =  1
    SHORT = -1
    FLAT  =  0


@dataclass
class EntrySignal:
    direction: Direction
    regime: StrategyRegime
    z_score: float          # current z-score (MR) or momentum rank (MOM)
    confidence: float       # 0–1, how strong the signal is
    entry_price: float
    atr: float              # ATR at entry, used to set stops
    half_life: float        # estimated OU half-life at entry


@dataclass
class Position:
    instrument: str
    direction: Direction
    regime: StrategyRegime
    entry_price: float
    entry_date: pd.Timestamp
    size: float             # number of shares / contracts
    stop_price: float
    profit_target: float
    time_stop_date: pd.Timestamp
    half_life: float
    entry_z: float          # z-score at entry (MR) or rank (MOM)
    peak_price: float       # for trailing stop
    pnl: float = 0.0


# ─────────────────────────────────────────────
# 1. Regime Detector — OU half-life estimation
# ─────────────────────────────────────────────

class RegimeDetector:
    """
    Estimates the OU mean-reversion half-life via AR(1) regression
    on the price series, then classifies into a strategy regime.

    Model:  ΔP_t = α + ρ · P_{t-1} + ε_t
    If ρ < 0: mean-reverting, half-life = ln(2) / |ρ|
    If ρ ≥ 0: trending / random walk

    Thresholds:
        HL < mr_threshold       → MEAN_REVERSION
        mr_threshold ≤ HL < mom_threshold → BLEND
        HL ≥ mom_threshold      → MOMENTUM
        ADF p-value > 0.20      → NO_TRADE (too noisy to classify)
    """

    def __init__(
        self,
        lookback: int = 252,
        mr_threshold: float = 20.0,    # days
        mom_threshold: float = 60.0,   # days
        adf_pvalue_cutoff: float = 0.20,
        blend_weights_smooth: bool = True,
    ):
        self.lookback = lookback
        self.mr_threshold = mr_threshold
        self.mom_threshold = mom_threshold
        self.adf_pvalue_cutoff = adf_pvalue_cutoff
        self.blend_smooth = blend_weights_smooth

    def estimate_half_life(self, prices: pd.Series) -> tuple[float, float]:
        """
        Returns (half_life_days, ar1_rho).
        half_life = inf if rho >= 0 (pure trend / random walk).
        """
        p = prices.dropna()
        if len(p) < 20:
            return np.inf, 1.0

        y  = p.diff().dropna().values          # ΔP_t
        x  = p.shift(1).dropna().values        # P_{t-1}
        n  = min(len(y), len(x))
        y, x = y[-n:], x[-n:]

        # OLS: ΔP = α + ρ·P_{t-1}
        X = np.column_stack([np.ones(n), x])
        try:
            beta = np.linalg.lstsq(X, y, rcond=None)[0]
        except np.linalg.LinAlgError:
            return np.inf, 1.0

        rho = beta[1]           # coefficient on lagged level
        if rho >= 0:
            return np.inf, rho  # not mean-reverting

        half_life = np.log(2) / abs(rho)
        return half_life, rho

    def adf_pvalue(self, prices: pd.Series) -> float:
        """
        Augmented Dickey-Fuller p-value.
        Low p → reject unit root → mean-reverting.
        High p → cannot reject unit root → trending.
        """
        from scipy.stats import t as tdist
        p = prices.dropna().values
        if len(p) < 20:
            return 1.0

        # Simple ADF without lag selection (ADF-0)
        y  = np.diff(p)
        x  = p[:-1]
        n  = len(y)
        X  = np.column_stack([np.ones(n), x])
        try:
            beta, res, _, _ = np.linalg.lstsq(X, y, rcond=None)
        except np.linalg.LinAlgError:
            return 1.0

        rho   = beta[1]
        y_hat = X @ beta
        sigma2 = np.sum((y - y_hat)**2) / (n - 2)
        XtX_inv = np.linalg.pinv(X.T @ X)
        se_rho  = np.sqrt(sigma2 * XtX_inv[1, 1])
        if se_rho < 1e-10:
            return 1.0
        t_stat = rho / se_rho
        pval   = tdist.cdf(t_stat, df=n - 2)   # one-sided
        return float(pval)

    def classify(
        self, prices: pd.Series
    ) -> tuple[StrategyRegime, float, dict]:
        """
        Returns (regime, half_life, metadata).
        metadata: {rho, adf_pval, mr_weight, mom_weight}
        """
        p = prices.iloc[-self.lookback:]
        hl, rho   = self.estimate_half_life(p)
        adf_pval  = self.adf_pvalue(p)

        meta = {"rho": rho, "adf_pval": adf_pval,
                "half_life": hl, "mr_weight": 0.0, "mom_weight": 0.0}

        # Too uncertain to trade
        if adf_pval > self.adf_pvalue_cutoff and hl > self.mom_threshold:
            return StrategyRegime.NO_TRADE, hl, meta

        if hl < self.mr_threshold:
            meta["mr_weight"]  = 1.0
            return StrategyRegime.MEAN_REVERSION, hl, meta

        if hl >= self.mom_threshold:
            meta["mom_weight"] = 1.0
            return StrategyRegime.MOMENTUM, hl, meta

        # Blend regime: smooth transition between thresholds
        # w_MOM increases linearly from 0 at mr_threshold to 1 at mom_threshold
        span = self.mom_threshold - self.mr_threshold
        w_mom = (hl - self.mr_threshold) / span
        if self.blend_smooth:
            # Sigmoid smoothing for cleaner weight path
            x = (hl - (self.mr_threshold + span / 2)) / (span / 6)
            w_mom = 1 / (1 + np.exp(-x))

        meta["mr_weight"]  = 1.0 - w_mom
        meta["mom_weight"] = w_mom
        return StrategyRegime.BLEND, hl, meta


# ─────────────────────────────────────────────
# 2. Mean-Reversion Entry
# ─────────────────────────────────────────────

class MeanReversionEntry:
    """
    Entry when the price deviates sufficiently from its rolling mean.

    Optimal threshold (Bertram 2010, cost-adjusted):
        z* ≈ 1.5 for daily rebalance with typical transaction costs
        z* ≈ 0.8 for intraday with tight spreads

    Entry conditions (ALL must be met):
      1. |z-score| > entry_threshold
      2. z-score moving toward mean (not still diverging)
      3. Half-life < max_half_life (don't MR-trade slow-moving series)
      4. Volatility not in crisis (ATR not > 3× its 60d average)
    """

    def __init__(
        self,
        lookback: int = 20,            # rolling mean/std window
        entry_threshold: float = 1.5,  # z-score for entry
        max_half_life: float = 25.0,   # don't enter if HL > this
        require_reversal: bool = True,  # z must be moving toward mean
        vol_filter_mult: float = 3.0,  # reject if ATR > mult × mean ATR
    ):
        self.lookback = lookback
        self.threshold = entry_threshold
        self.max_hl = max_half_life
        self.require_reversal = require_reversal
        self.vol_filter_mult = vol_filter_mult

    def z_score(self, prices: pd.Series) -> float:
        """Current z-score against rolling mean/std."""
        window = prices.iloc[-self.lookback:]
        mu  = window.mean()
        sig = window.std(ddof=1)
        if sig < 1e-8:
            return 0.0
        return float((prices.iloc[-1] - mu) / sig)

    def check_entry(
        self,
        prices: pd.Series,
        half_life: float,
        atr: float,
        atr_hist: pd.Series,         # historical ATR for vol filter
    ) -> Optional[EntrySignal]:
        """
        Returns EntrySignal if all conditions are met, else None.
        """
        if half_life > self.max_hl:
            return None

        # Vol filter: skip if market is in panic
        if len(atr_hist) >= 60:
            mean_atr = atr_hist.iloc[-60:].mean()
            if atr > self.vol_filter_mult * mean_atr:
                return None

        z = self.z_score(prices)
        if abs(z) < self.threshold:
            return None

        # Reversal check: z-score must be moving toward zero
        if self.require_reversal and len(prices) >= 3:
            z_prev = self.z_score(prices.iloc[:-1])
            moving_toward_mean = abs(z) < abs(z_prev)
            if not moving_toward_mean:
                return None

        direction = Direction.LONG if z < 0 else Direction.SHORT
        confidence = min(1.0, (abs(z) - self.threshold) / self.threshold)

        return EntrySignal(
            direction=direction,
            regime=StrategyRegime.MEAN_REVERSION,
            z_score=z,
            confidence=confidence,
            entry_price=float(prices.iloc[-1]),
            atr=atr,
            half_life=half_life,
        )


# ─────────────────────────────────────────────
# 3. Momentum Entry
# ─────────────────────────────────────────────

class MomentumEntry:
    """
    Entry on confirmed trend breakout with quality filters.

    Entry conditions (ALL must be met):
      1. ADX > adx_threshold (trending market)
      2. Price closes above N-day high + buffer (long) or below N-day low
      3. Instrument in top (long) or bottom (short) cross-sectional quartile
      4. Not in a high-vol crisis regime

    ADX calculation uses the standard Wilder method.
    """

    def __init__(
        self,
        breakout_lookback: int = 20,   # N-day high/low channel
        adx_period: int = 14,
        adx_threshold: float = 25.0,
        rank_threshold: float = 0.75,  # top quartile for longs
        atr_buffer_mult: float = 0.1,  # entry = high + mult*ATR
    ):
        self.breakout_n  = breakout_lookback
        self.adx_period  = adx_period
        self.adx_thresh  = adx_threshold
        self.rank_thresh = rank_threshold
        self.atr_buf     = atr_buffer_mult

    def adx(self, high: pd.Series, low: pd.Series,
            close: pd.Series) -> float:
        """Wilder's Average Directional Index — returns current ADX value."""
        p = self.adx_period
        if len(close) < p * 2:
            return 0.0

        h, l, c = high.values, low.values, close.values
        tr, pdm, ndm = [], [], []
        for i in range(1, len(c)):
            tr.append(max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1])))
            pdm.append(max(h[i]-h[i-1], 0) if h[i]-h[i-1] > l[i-1]-l[i] else 0)
            ndm.append(max(l[i-1]-l[i], 0) if l[i-1]-l[i] > h[i]-h[i-1] else 0)

        def wilder_smooth(arr, n):
            s = [sum(arr[:n])]
            for v in arr[n:]:
                s.append(s[-1] - s[-1]/n + v)
            return s

        atr_s  = wilder_smooth(tr,  p)
        pdm_s  = wilder_smooth(pdm, p)
        ndm_s  = wilder_smooth(ndm, p)

        dx = []
        for a, pd_, nd in zip(atr_s, pdm_s, ndm_s):
            if a < 1e-8:
                dx.append(0.0)
                continue
            pdi = 100 * pd_ / a
            ndi = 100 * nd / a
            denom = pdi + ndi
            dx.append(100 * abs(pdi - ndi) / denom if denom > 0 else 0.0)

        adx_vals = wilder_smooth(dx, p)
        return float(adx_vals[-1]) if adx_vals else 0.0

    def check_entry(
        self,
        prices_ohlc: pd.DataFrame,     # columns: open, high, low, close
        cross_sectional_rank: float,   # percentile rank vs universe [0,1]
        atr: float,
    ) -> Optional[EntrySignal]:
        """
        Returns EntrySignal if momentum entry conditions are met.
        cross_sectional_rank: 1.0 = best momentum in universe.
        """
        if len(prices_ohlc) < self.breakout_n + self.adx_period * 2:
            return None

        close  = prices_ohlc["close"]
        high   = prices_ohlc["high"]
        low    = prices_ohlc["low"]
        latest = float(close.iloc[-1])

        # ADX filter
        adx_val = self.adx(high, low, close)
        if adx_val < self.adx_thresh:
            return None

        # Breakout filter
        channel_high = float(high.iloc[-self.breakout_n-1:-1].max())
        channel_low  = float(low.iloc[-self.breakout_n-1:-1].min())
        long_entry_px  = channel_high + self.atr_buf * atr
        short_entry_px = channel_low  - self.atr_buf * atr

        is_long_breakout  = latest > long_entry_px
        is_short_breakout = latest < short_entry_px

        if not (is_long_breakout or is_short_breakout):
            return None

        # Cross-sectional rank filter
        if is_long_breakout and cross_sectional_rank < self.rank_thresh:
            return None
        if is_short_breakout and cross_sectional_rank > (1 - self.rank_thresh):
            return None

        direction = Direction.LONG if is_long_breakout else Direction.SHORT
        rank_edge = (cross_sectional_rank - 0.5) * 2 if is_long_breakout else \
                    (0.5 - cross_sectional_rank) * 2
        confidence = min(1.0, (adx_val - self.adx_thresh) / 25 * rank_edge)

        return EntrySignal(
            direction=direction,
            regime=StrategyRegime.MOMENTUM,
            z_score=cross_sectional_rank,
            confidence=confidence,
            entry_price=latest,
            atr=atr,
            half_life=np.inf,
        )


# ─────────────────────────────────────────────
# 4. Exit Rule Stack
# ─────────────────────────────────────────────

class ExitRuleStack:
    """
    Six exit rules, checked in priority order.

    Priority:
        1. Signal exit      — primary alpha signal has reversed
        2. Profit target    — reached target (MR only)
        3. Stop-loss        — fixed ATR-based hard stop
        4. Time stop        — trade hasn't worked within expected window
        5. Regime flip      — strategy regime has changed
        6. Risk override    — daily PnL breach (circuit breaker)
    """

    def __init__(
        self,
        # Stop-loss
        mr_stop_atr_mult: float = 3.0,    # MR stop: 3 × ATR from entry
        mom_stop_atr_mult: float = 2.0,   # MOM stop: trailing 2 × ATR
        # Profit target (MR only)
        mr_profit_z: float = 0.25,        # exit MR when z within 0.25σ of mean
        # Time stop
        mr_time_mult: float = 2.0,        # exit MR after 2 × half_life days
        mom_time_days: int = 252,         # max hold for momentum (1 year)
        # Signal exit
        mr_exit_z: float = 0.1,          # MR: exit when |z| < this
        mom_rank_exit: float = 0.50,     # MOM: exit when rank < this
        # Risk circuit breaker
        max_daily_loss_pct: float = 0.015,  # 1.5% daily NAV loss → cut
        max_total_loss_pct: float = 0.03,   # 3% daily NAV loss → flatten
    ):
        self.mr_stop_mult   = mr_stop_atr_mult
        self.mom_stop_mult  = mom_stop_atr_mult
        self.mr_profit_z    = mr_profit_z
        self.mr_time_mult   = mr_time_mult
        self.mom_time_days  = mom_time_days
        self.mr_exit_z      = mr_exit_z
        self.mom_rank_exit  = mom_rank_exit
        self.max_daily_loss = max_daily_loss_pct
        self.max_total_loss = max_total_loss_pct

    def should_exit(
        self,
        pos: Position,
        current_price: float,
        current_date: pd.Timestamp,
        current_z: float,                    # current z-score (MR)
        current_rank: float,                 # current momentum rank
        current_regime: StrategyRegime,
        daily_pnl_pct: float = 0.0,          # today's PnL as % of NAV
        nav_pnl_pct: float = 0.0,            # total open PnL % of NAV
        reduce_only: bool = False,           # partial size reduction
    ) -> tuple[bool, str, float]:            # (exit, reason, size_to_exit)
        """
        Returns (should_exit, reason, fraction_to_exit).
        fraction_to_exit: 1.0 = full exit, 0.5 = half exit.
        """

        # Update trailing stop for momentum
        if pos.regime == StrategyRegime.MOMENTUM:
            pos = self._update_trailing_stop(pos, current_price)

        size = 1.0  # default full exit

        # ── Priority 6: Risk override (circuit breaker) ──────────────
        if daily_pnl_pct < -self.max_total_loss:
            return True, "risk_override_flatten", 1.0
        if daily_pnl_pct < -self.max_daily_loss:
            return True, "risk_override_reduce", 0.5

        # ── Priority 3: Stop-loss ─────────────────────────────────────
        if pos.direction == Direction.LONG and current_price <= pos.stop_price:
            return True, "stop_loss", 1.0
        if pos.direction == Direction.SHORT and current_price >= pos.stop_price:
            return True, "stop_loss", 1.0

        # ── Priority 5: Regime flip ───────────────────────────────────
        if (pos.regime == StrategyRegime.MEAN_REVERSION
                and current_regime == StrategyRegime.MOMENTUM):
            return True, "regime_flip_to_momentum", 1.0
        if (pos.regime == StrategyRegime.MOMENTUM
                and current_regime == StrategyRegime.MEAN_REVERSION):
            return True, "regime_flip_to_mr", 1.0

        # ── Priority 4: Time stop ─────────────────────────────────────
        if pos.regime == StrategyRegime.MEAN_REVERSION:
            time_limit = pos.entry_date + pd.Timedelta(
                days=int(self.mr_time_mult * pos.half_life))
            if current_date >= time_limit:
                return True, "time_stop_mr", 1.0
        else:
            time_limit = pos.entry_date + pd.Timedelta(days=self.mom_time_days)
            if current_date >= time_limit:
                return True, "time_stop_mom", 1.0

        # ── Priority 2: Profit target (MR only) ──────────────────────
        if pos.regime == StrategyRegime.MEAN_REVERSION:
            if abs(current_z) < self.mr_profit_z:
                return True, "profit_target", 1.0

        # ── Priority 1: Signal exit ───────────────────────────────────
        if pos.regime == StrategyRegime.MEAN_REVERSION:
            if abs(current_z) < self.mr_exit_z:
                return True, "signal_exit_mr", 1.0
            # Partial exit if z has halved from entry
            if abs(current_z) < abs(pos.entry_z) * 0.5:
                return True, "signal_exit_mr_partial", 0.5

        elif pos.regime == StrategyRegime.MOMENTUM:
            if pos.direction == Direction.LONG and current_rank < self.mom_rank_exit:
                return True, "signal_exit_mom", 1.0
            if pos.direction == Direction.SHORT and current_rank > (1 - self.mom_rank_exit):
                return True, "signal_exit_mom", 1.0

        return False, "hold", 0.0

    def _update_trailing_stop(self, pos: Position, price: float) -> Position:
        """Ratchet trailing stop for momentum positions."""
        if pos.direction == Direction.LONG:
            new_peak = max(pos.peak_price, price)
            new_stop = new_peak - self.mom_stop_mult * pos.atr
            pos.peak_price = new_peak
            pos.stop_price = max(pos.stop_price, new_stop)
        else:
            new_trough = min(pos.peak_price, price)
            new_stop = new_trough + self.mom_stop_mult * pos.atr
            pos.peak_price = new_trough
            pos.stop_price = min(pos.stop_price, new_stop)
        return pos

    def compute_stops(
        self, entry: EntrySignal, entry_date: pd.Timestamp,
        mean_price: float
    ) -> tuple[float, float, pd.Timestamp]:
        """
        Returns (stop_price, profit_target_price, time_stop_date).
        """
        atr = entry.atr
        px  = entry.entry_price
        d   = entry.direction

        if entry.regime == StrategyRegime.MEAN_REVERSION:
            stop  = px - d.value * self.mr_stop_mult * atr
            target = mean_price
            tsd   = entry_date + pd.Timedelta(
                days=int(self.mr_time_mult * entry.half_life))
        else:
            stop  = px - d.value * self.mom_stop_mult * atr
            target = px + d.value * 5 * atr   # momentum: wide profit target
            tsd   = entry_date + pd.Timedelta(days=self.mom_time_days)

        return stop, target, tsd


# ─────────────────────────────────────────────
# 5. Position Sizer
# ─────────────────────────────────────────────

class PositionSizer:
    """
    Volatility-targeted position sizing.

    size = (risk_budget_$ × confidence_scale) / (ATR × price)

    At regime transition: scale down by transition_discount.
    First entry in new regime: scale down by first_entry_discount.
    """

    def __init__(
        self,
        nav: float = 1_000_000.0,
        risk_per_trade_pct: float = 0.005,   # 0.5% NAV per trade
        vol_target_pct: float = 0.15,         # 15% annual vol target
        max_position_pct: float = 0.05,       # max 5% NAV per position
        transition_discount: float = 0.5,     # 50% size at regime transition
        confidence_scale: bool = True,
    ):
        self.nav              = nav
        self.risk_per_trade   = risk_per_trade_pct
        self.vol_target       = vol_target_pct
        self.max_pos          = max_position_pct
        self.trans_discount   = transition_discount
        self.conf_scale       = confidence_scale

    def size(
        self,
        entry: EntrySignal,
        at_transition: bool = False,
    ) -> float:
        """Returns position size in shares/contracts (floor to int)."""
        risk_$ = self.nav * self.risk_per_trade
        if self.conf_scale:
            risk_$ *= (0.5 + 0.5 * entry.confidence)   # scale with confidence

        if at_transition:
            risk_$ *= self.trans_discount

        # ATR-based: risk$ = shares × ATR × stop_mult
        # Invert to get shares
        stop_mult = 3.0 if entry.regime == StrategyRegime.MEAN_REVERSION else 2.0
        size_by_atr = risk_$ / (entry.atr * stop_mult)

        # Cap by max position size
        max_shares = (self.nav * self.max_pos) / entry.entry_price
        size = min(size_by_atr, max_shares)
        return max(1.0, size)


# ─────────────────────────────────────────────
# 6. ATR utility
# ─────────────────────────────────────────────

def compute_atr(ohlc: pd.DataFrame, period: int = 14) -> float:
    """Wilder's ATR — returns the current (latest) ATR value."""
    h, l, c = ohlc["high"].values, ohlc["low"].values, ohlc["close"].values
    if len(c) < period + 1:
        return float(np.std(np.diff(c)) * np.sqrt(period))
    tr = [max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1]))
          for i in range(1, len(c))]
    atr = sum(tr[:period]) / period
    for v in tr[period:]:
        atr = (atr * (period - 1) + v) / period
    return float(atr)


# ─────────────────────────────────────────────
# 7. Combined Strategy Orchestrator
# ─────────────────────────────────────────────

class CombinedStrategy:
    """
    Orchestrates the full momentum + mean-reversion pipeline.

    Call update() on each bar. It:
      1. Estimates current OU regime
      2. Generates entry signals (both legs where appropriate)
      3. Checks exits on open positions
      4. Sizes new entries
      5. Returns a list of orders to execute
    """

    def __init__(
        self,
        nav: float = 1_000_000.0,
        mr_entry_threshold: float = 1.5,
        mom_adx_threshold: float = 25.0,
        max_positions: int = 20,
    ):
        self.detector  = RegimeDetector()
        self.mr_entry  = MeanReversionEntry(entry_threshold=mr_entry_threshold)
        self.mom_entry = MomentumEntry(adx_threshold=mom_adx_threshold)
        self.exits     = ExitRuleStack()
        self.sizer     = PositionSizer(nav=nav)
        self.max_pos   = max_positions

        self._positions: dict[str, Position] = {}
        self._prev_regime: dict[str, StrategyRegime] = {}

    def update(
        self,
        instrument: str,
        ohlc: pd.DataFrame,             # OHLCV history (close, high, low)
        cross_sectional_rank: float,    # current momentum rank [0,1]
        current_z: float,               # current z-score
        current_rank: float,            # alias for cross_sectional_rank
        current_date: pd.Timestamp,
        daily_pnl_pct: float = 0.0,
    ) -> list[dict]:
        """
        Returns list of order dicts:
          {"action": "buy"|"sell"|"close",
           "instrument": ..., "size": ..., "reason": ...}
        """
        orders = []
        prices = ohlc["close"]
        atr    = compute_atr(ohlc)
        atr_hist = prices.rolling(60).std() * np.sqrt(14)  # approximate ATR history

        current_price = float(prices.iloc[-1])

        # ── 1. Classify current regime ──────────────────────────────
        regime, half_life, regime_meta = self.detector.classify(prices)
        at_transition = (instrument in self._prev_regime and
                         self._prev_regime[instrument] != regime)
        self._prev_regime[instrument] = regime

        # ── 2. Check exits on open positions ────────────────────────
        if instrument in self._positions:
            pos = self._positions[instrument]
            exit_flag, exit_reason, exit_frac = self.exits.should_exit(
                pos=pos,
                current_price=current_price,
                current_date=current_date,
                current_z=current_z,
                current_rank=cross_sectional_rank,
                current_regime=regime,
                daily_pnl_pct=daily_pnl_pct,
            )
            if exit_flag:
                exit_size = pos.size * exit_frac
                orders.append({
                    "action": "close" if exit_frac == 1.0 else "reduce",
                    "instrument": instrument,
                    "size": exit_size,
                    "direction": pos.direction.value * -1,  # opposite to close
                    "reason": exit_reason,
                    "price": current_price,
                })
                if exit_frac == 1.0:
                    del self._positions[instrument]
                else:
                    self._positions[instrument].size -= exit_size
            return orders    # don't enter new position on same bar as exit

        # ── 3. Generate entry signals ────────────────────────────────
        if len(self._positions) >= self.max_pos:
            return orders    # at capacity

        if regime == StrategyRegime.NO_TRADE:
            return orders

        entry: Optional[EntrySignal] = None

        if regime == StrategyRegime.MEAN_REVERSION:
            entry = self.mr_entry.check_entry(
                prices=prices, half_life=half_life,
                atr=atr, atr_hist=atr_hist)

        elif regime == StrategyRegime.MOMENTUM:
            entry = self.mom_entry.check_entry(
                prices_ohlc=ohlc,
                cross_sectional_rank=cross_sectional_rank,
                atr=atr)

        elif regime == StrategyRegime.BLEND:
            # Try both; take whichever fires (MR has priority in tie)
            mr_candidate  = self.mr_entry.check_entry(
                prices=prices, half_life=half_life,
                atr=atr, atr_hist=atr_hist)
            mom_candidate = self.mom_entry.check_entry(
                prices_ohlc=ohlc,
                cross_sectional_rank=cross_sectional_rank,
                atr=atr)

            # Weight by regime meta
            mr_w  = regime_meta["mr_weight"]
            mom_w = regime_meta["mom_weight"]

            if mr_candidate and mom_candidate:
                entry = mr_candidate if mr_w >= mom_w else mom_candidate
            elif mr_candidate:
                entry = mr_candidate
            elif mom_candidate:
                entry = mom_candidate

        if entry is None:
            return orders

        # ── 4. Size and record position ─────────────────────────────
        size = self.sizer.size(entry, at_transition=at_transition)

        mean_price = float(prices.iloc[-self.mr_entry.lookback:].mean())
        stop, target, time_stop = self.exits.compute_stops(
            entry, current_date, mean_price)

        pos = Position(
            instrument=instrument,
            direction=entry.direction,
            regime=entry.regime,
            entry_price=current_price,
            entry_date=current_date,
            size=size,
            stop_price=stop,
            profit_target=target,
            time_stop_date=time_stop,
            half_life=half_life,
            entry_z=entry.z_score,
            peak_price=current_price,
        )
        self._positions[instrument] = pos

        action = "buy" if entry.direction == Direction.LONG else "sell"
        orders.append({
            "action": action,
            "instrument": instrument,
            "size": size,
            "direction": entry.direction.value,
            "regime": regime.value,
            "reason": f"entry_{regime.value}",
            "price": current_price,
            "stop": stop,
            "target": target,
            "confidence": entry.confidence,
            "half_life": half_life,
        })

        return orders


# ─────────────────────────────────────────────
# 8. Demo — synthetic single-instrument run
# ─────────────────────────────────────────────

def run_demo():
    rng = np.random.default_rng(42)
    n   = 600

    # Synthetic price: 200d mean-reverting → 200d trending → 200d MR again
    prices, highs, lows = [100.0], [100.5], [99.5]
    for i in range(1, n):
        phase = i // 200
        if phase == 1:   # trending
            drift = 0.0012
            kappa = 0.005
        else:            # mean-reverting
            drift = 0.0002
            kappa = 0.12
        mu_force = kappa * (100 - prices[-1])
        ret = mu_force + drift + 0.013 * rng.standard_normal()
        p = prices[-1] * (1 + ret)
        prices.append(p)
        highs.append(p * (1 + 0.003 * abs(rng.standard_normal())))
        lows.append(p  * (1 - 0.003 * abs(rng.standard_normal())))

    dates = pd.bdate_range("2022-01-03", periods=n)
    ohlc  = pd.DataFrame({
        "open":  prices,
        "high":  highs,
        "low":   lows,
        "close": prices,
        "volume": rng.integers(1_000_000, 5_000_000, n),
    }, index=dates)

    strategy = CombinedStrategy(nav=1_000_000)
    all_orders, regime_log = [], []

    for i in range(60, n):
        window = ohlc.iloc[:i+1]
        z = (prices[i] - np.mean(prices[i-20:i])) / (np.std(prices[i-20:i]) + 1e-8)
        rank = float(stats.percentileofscore(prices[max(0,i-252):i], prices[i]) / 100)

        orders = strategy.update(
            instrument="DEMO",
            ohlc=window,
            cross_sectional_rank=rank,
            current_z=z,
            current_rank=rank,
            current_date=dates[i],
        )
        if orders:
            for o in orders:
                o["date"] = dates[i]
                all_orders.append(o)

        regime, hl, _ = strategy.detector.classify(window["close"])
        regime_log.append({"date": dates[i], "regime": regime.value, "half_life": hl})

    print("=" * 58)
    print(f"  Total bars processed : {n - 60}")
    print(f"  Total orders         : {len(all_orders)}")

    entries = [o for o in all_orders if o["action"] in ("buy","sell")]
    exits   = [o for o in all_orders if o["action"] in ("close","reduce")]
    mr_e    = [o for o in entries if "mean_reversion" in o.get("regime","")]
    mom_e   = [o for o in entries if "momentum" in o.get("regime","")]

    print(f"  Entry orders         : {len(entries)}")
    print(f"    MR entries         : {len(mr_e)}")
    print(f"    MOM entries        : {len(mom_e)}")
    print(f"  Exit orders          : {len(exits)}")
    print("=" * 58)

    print("\n  Last 10 orders:")
    for o in all_orders[-10:]:
        hl  = f"HL={o.get('half_life',0):.1f}d" if 'half_life' in o else ""
        st  = f"stop={o.get('stop',0):.2f}" if 'stop' in o else ""
        print(f"  {str(o['date'].date())} | {o['action']:6} | "
              f"{o.get('regime','—'):16} | sz={o['size']:.0f} | "
              f"{hl} {st}")

    return strategy, all_orders, pd.DataFrame(regime_log)


if __name__ == "__main__":
    strategy, orders, regime_df = run_demo()
