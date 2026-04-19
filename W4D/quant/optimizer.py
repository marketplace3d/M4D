"""
optimizer.py — portfolio construction layer

Three optimisation modes:
  MeanVariance   : Markowitz MVO with constraints (long-short aware)
  RiskParity     : Equal risk contribution across positions
  AlphaScaled    : Simple alpha rank → target weight (no explicit optim)

All modes enforce:
  - Gross exposure cap
  - Net exposure cap (market-neutral option)
  - Single-name concentration limit
  - Sector concentration limit
  - Minimum position size (eliminate near-zero weights)
  - Turnover budget (soft via alpha blending)
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from core import compute_atr


class PortfolioConstraints:
    def __init__(
        self,
        gross_limit:      float = 1.5,    # total |w| ≤ 1.5×
        net_limit:        float = 0.10,   # |Σw| ≤ 10% (near market-neutral)
        max_position:     float = 0.05,   # single name ≤ 5%
        max_sector:       float = 0.20,   # sector ≤ 20%
        min_position:     float = 0.005,  # drop weights below this
        long_short:       bool  = True,   # allow short positions
        turnover_limit:   float = 0.30,   # max daily one-way turnover
    ):
        self.gross_limit    = gross_limit
        self.net_limit      = net_limit
        self.max_position   = max_position
        self.max_sector     = max_sector
        self.min_position   = min_position
        self.long_short     = long_short
        self.turnover_limit = turnover_limit


# ════════════════════════════════════════════════════════════════════════════
# 1. Alpha-Scaled (rank → weight, no explicit optimisation)
# ════════════════════════════════════════════════════════════════════════════

class AlphaScaledOptimizer:
    """
    Converts cross-sectional alpha ranks directly to target weights.

    Long book:  top alpha_pct instruments, weight ∝ (rank - threshold)
    Short book: bottom alpha_pct instruments, weight ∝ -(threshold - rank)
    Weights are normalised to meet gross/net constraints.
    """

    def __init__(
        self,
        alpha_pct:   float = 0.20,   # top/bottom 20% of universe
        constraints: PortfolioConstraints | None = None,
    ):
        self.alpha_pct   = alpha_pct
        self.constraints = constraints or PortfolioConstraints()

    def optimise(
        self,
        alpha:    pd.Series,          # percentile rank [0,1], instruments
        current_weights: pd.Series,   # current portfolio weights
        sectors:  pd.Series | None = None,
        cov:      pd.DataFrame | None = None,  # unused, accepted for API compat
    ) -> pd.Series:
        C = self.constraints
        a = alpha.dropna().sort_values(ascending=False)
        n = len(a)
        k = max(1, int(n * self.alpha_pct))

        longs  = a.iloc[:k]
        shorts = a.iloc[n-k:]

        # Raw weights proportional to rank deviation from threshold
        long_thresh  = a.iloc[k-1]
        short_thresh = a.iloc[n-k]

        lw = (longs  - long_thresh).clip(lower=0)
        sw = (short_thresh - shorts).clip(lower=0)

        lw = lw / lw.sum() if lw.sum() > 0 else lw
        sw = sw / sw.sum() if sw.sum() > 0 else sw

        # Scale to gross exposure
        long_gross  = C.gross_limit / 2
        short_gross = C.gross_limit / 2

        weights = pd.concat([lw * long_gross, -sw * short_gross])

        # Apply constraints
        weights = self._apply_constraints(weights, sectors, current_weights)
        return weights.fillna(0.0)

    def _apply_constraints(
        self,
        w: pd.Series,
        sectors: pd.Series | None,
        current: pd.Series,
    ) -> pd.Series:
        C = self.constraints

        # Single-name cap
        w = w.clip(-C.max_position, C.max_position)

        # Sector cap
        if sectors is not None:
            for sec in sectors.unique():
                sec_insts = sectors[sectors == sec].index
                common = w.index.intersection(sec_insts)
                if len(common) == 0:
                    continue
                in_sec = w.loc[common]
                sec_gross = in_sec.abs().sum()
                if sec_gross > C.max_sector:
                    scale = C.max_sector / sec_gross
                    w.loc[common] = in_sec * scale

        # Drop sub-minimum positions
        w[w.abs() < C.min_position] = 0.0

        # Net exposure adjustment (tilt toward market neutral)
        net = w.sum()
        if abs(net) > C.net_limit:
            excess = net - np.sign(net) * C.net_limit
            # Reduce the dominant side proportionally
            if excess > 0:
                long_mask = w > 0
                long_sum  = w[long_mask].sum()
                if long_sum > 0:
                    w[long_mask] -= excess * w[long_mask] / long_sum
            else:
                short_mask = w < 0
                short_sum  = w[short_mask].sum()
                if short_sum < 0:
                    w[short_mask] -= excess * w[short_mask] / short_sum

        # Turnover budget: blend with current weights
        if not current.empty:
            candidate_turnover = (w - current.reindex(w.index, fill_value=0)).abs().sum()
            if candidate_turnover > C.turnover_limit:
                blend = C.turnover_limit / candidate_turnover
                w = (1 - blend) * current.reindex(w.index, fill_value=0) + blend * w

        return w.round(6)


# ════════════════════════════════════════════════════════════════════════════
# 2. Mean-Variance Optimiser
# ════════════════════════════════════════════════════════════════════════════

class MeanVarianceOptimizer:
    """
    Markowitz MVO: maximise  w'μ - λ/2 · w'Σw

    μ is derived from the alpha signal.
    Σ is estimated from recent return history.
    λ is the risk-aversion parameter.
    """

    def __init__(
        self,
        risk_aversion:   float = 5.0,
        cov_lookback:    int   = 60,
        cov_shrinkage:   float = 0.1,   # Ledoit-Wolf style shrinkage to diag
        constraints:     PortfolioConstraints | None = None,
        max_instruments: int   = 50,    # pre-screen to top N by alpha
    ):
        self.lam             = risk_aversion
        self.cov_lb          = cov_lookback
        self.shrink          = cov_shrinkage
        self.constraints     = constraints or PortfolioConstraints()
        self.max_inst        = max_instruments

    def estimate_cov(self, returns: pd.DataFrame) -> pd.DataFrame:
        """Ledoit-Wolf shrinkage covariance."""
        ret = returns.dropna(how="all").fillna(0)
        S   = ret.cov().values
        mu  = np.trace(S) / len(S)     # average variance (shrinkage target)
        T   = self.shrink
        cov_shrunk = (1 - T) * S + T * mu * np.eye(len(S))
        return pd.DataFrame(cov_shrunk,
                            index=returns.columns,
                            columns=returns.columns)

    def optimise(
        self,
        alpha:    pd.Series,
        current_weights: pd.Series,
        sectors:  pd.Series | None = None,
        cov:      pd.DataFrame | None = None,
    ) -> pd.Series:
        C = self.constraints
        # Pre-screen to top alpha instruments to keep problem tractable
        a = alpha.dropna()
        n = len(a)
        k = min(self.max_inst, n)
        # Select top and bottom alpha_pct for long-short
        top_k  = a.nlargest(k // 2).index
        bot_k  = a.nsmallest(k // 2).index
        univ   = top_k.union(bot_k)
        a      = a.reindex(univ)

        if cov is None or not all(inst in cov.index for inst in univ):
            # Fallback: diagonal covariance (treats each stock independently)
            cov_sub = pd.DataFrame(
                np.eye(len(univ)) * 0.0004,  # ~2% daily vol
                index=univ, columns=univ)
        else:
            cov_sub = cov.reindex(index=univ, columns=univ).fillna(0)

        mu  = a.values
        Sig = cov_sub.values
        n2  = len(mu)

        def neg_utility(w):
            port_ret = mu @ w
            port_var = w @ Sig @ w
            return -(port_ret - self.lam / 2 * port_var)

        def jac(w):
            return -(mu - self.lam * Sig @ w)

        # Bounds: long-short ±max_position
        bounds = [(-C.max_position, C.max_position) for _ in range(n2)]
        x0 = np.zeros(n2)

        constraints_scipy = [
            # Gross ≤ limit
            {"type": "ineq",
             "fun": lambda w: C.gross_limit - np.abs(w).sum()},
            # Net ≤ net_limit
            {"type": "ineq", "fun": lambda w: C.net_limit - abs(w.sum())},
        ]

        res = minimize(
            neg_utility, x0, jac=jac, method="SLSQP",
            bounds=bounds, constraints=constraints_scipy,
            options={"maxiter": 200, "ftol": 1e-8},
        )

        w = pd.Series(res.x if res.success else x0, index=univ)
        w[w.abs() < C.min_position] = 0.0

        # Sector constraint (post-hoc clipping)
        if sectors is not None:
            for sec in sectors.unique():
                mask = sectors.reindex(w.index)
                in_sec = w[mask == sec]
                if in_sec.abs().sum() > C.max_sector:
                    scale = C.max_sector / in_sec.abs().sum()
                    w[mask == sec] = in_sec * scale

        # Turnover budget
        if not current_weights.empty:
            to = (w - current_weights.reindex(w.index, fill_value=0)).abs().sum()
            if to > C.turnover_limit:
                blend = C.turnover_limit / to
                w = (blend * w +
                     (1 - blend) * current_weights.reindex(w.index, fill_value=0))

        return w.reindex(alpha.index, fill_value=0.0).round(6)


# ════════════════════════════════════════════════════════════════════════════
# 3. Risk Parity Optimizer
# ════════════════════════════════════════════════════════════════════════════

class RiskParityOptimizer:
    """
    Equal Risk Contribution: each position contributes equally to portfolio vol.
    Alpha signal is used to tilt the ERC weights (alpha × 1/vol).
    """

    def __init__(
        self,
        constraints: PortfolioConstraints | None = None,
        alpha_tilt:  float = 0.3,   # how much to tilt ERC by alpha (0=pure ERC)
    ):
        self.constraints = constraints or PortfolioConstraints()
        self.alpha_tilt  = alpha_tilt

    def optimise(
        self,
        alpha:    pd.Series,
        current_weights: pd.Series,
        sectors:  pd.Series | None = None,
        cov:      pd.DataFrame | None = None,
    ) -> pd.Series:
        C = self.constraints
        a = alpha.dropna()

        if cov is not None:
            common = a.index.intersection(cov.index)
            vols   = np.sqrt(np.diag(cov.loc[common, common].values))
            vols   = pd.Series(vols, index=common).clip(lower=0.001)
        else:
            vols   = pd.Series(0.02, index=a.index)  # uniform 2% daily vol

        # ERC base: 1/vol, normalised
        erc = 1.0 / vols
        erc = erc / erc.sum()

        # Alpha tilt: scale ERC by alpha signal
        alpha_aligned = (a.reindex(erc.index).fillna(0.5) - 0.5) * 2  # centre at 0
        tilt = 1.0 + self.alpha_tilt * alpha_aligned
        tilt = tilt.clip(lower=0.1)

        w_long = (erc * tilt)
        w_long = w_long / w_long.sum() * (C.gross_limit / 2)

        # Mirror for short book (bottom alpha)
        alpha_short = (0.5 - a.reindex(erc.index).fillna(0.5)) * 2
        tilt_short  = (1.0 + self.alpha_tilt * alpha_short).clip(lower=0.1)
        w_short = -(erc * tilt_short) / (erc * tilt_short).sum() * (C.gross_limit / 2)

        w = w_long + w_short
        w = w.clip(-C.max_position, C.max_position)
        w[w.abs() < C.min_position] = 0.0

        if not current_weights.empty:
            to = (w - current_weights.reindex(w.index, fill_value=0)).abs().sum()
            if to > C.turnover_limit:
                blend = C.turnover_limit / to
                w = blend * w + (1-blend) * current_weights.reindex(w.index, fill_value=0)

        return w.reindex(alpha.index, fill_value=0.0).round(6)
