"""
Regime-Conditional Signal Weighting System
==========================================
WorldQuant-style IC-weighted ensemble with HMM regime detection.

Pipeline:
  1. RegimeClassifier   — Hidden Markov Model on vol/macro features
  2. ICTracker          — Rolling decay-weighted IC and ICIR per signal
  3. WeightCalculator   — Regime-conditional ICIR normalisation
  4. SignalCombiner     — Composite cross-sectional alpha score

Dependencies: numpy, pandas, scipy, hmmlearn, scikit-learn
  pip install numpy pandas scipy hmmlearn scikit-learn
"""

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.preprocessing import StandardScaler
from enum import IntEnum
from dataclasses import dataclass, field
from typing import Optional
import warnings
warnings.filterwarnings("ignore")


# ─────────────────────────────────────────────
# 0. Regime definitions
# ─────────────────────────────────────────────

class Regime(IntEnum):
    RISK_ON    = 0
    TRENDING   = 1
    MEAN_REV   = 2
    RISK_OFF   = 3
    CRISIS     = 4

REGIME_NAMES = {
    Regime.RISK_ON:  "risk-on",
    Regime.TRENDING: "trending",
    Regime.MEAN_REV: "mean-reversion",
    Regime.RISK_OFF: "risk-off",
    Regime.CRISIS:   "crisis",
}

# How much to scale each signal's effective IC in each regime.
# Rows = regimes, columns = signals.
# Signals: [momentum_12m, mean_rev_5d, earnings_rev, vol_carry,
#           sentiment_nlp, options_skew, stat_arb]
REGIME_SIGNAL_MULTIPLIERS = np.array([
    # risk-on
    [1.00, 0.70, 1.00, 1.00, 1.00, 0.50, 1.00],
    # trending
    [1.30, 0.30, 0.90, 0.80, 0.90, 0.70, 0.80],
    # mean-rev
    [0.50, 1.50, 0.80, 1.00, 0.80, 0.90, 1.30],
    # risk-off
    [0.60, 1.10, 0.70, 0.50, 0.80, 0.60, 1.00],
    # crisis
    [0.30, 1.20, 0.50, 0.20, 0.60, 0.30, 1.10],
], dtype=float)


# ─────────────────────────────────────────────
# 1. Regime Classifier (HMM)
# ─────────────────────────────────────────────

class RegimeClassifier:
    """
    Gaussian HMM fitted on daily market features.

    Features fed in (all standardised before fitting):
      - realised_vol_20d   : 20-day realised volatility (annualised)
      - vol_of_vol_60d     : rolling std of realised_vol_20d over 60d
      - momentum_60d       : 60-day price return of broad index
      - cross_asset_corr   : rolling equity-bond correlation (60d)
      - credit_spread_chg  : daily change in IG credit spread (bps)

    States are assigned to regime labels by matching fitted means
    to known regime characteristics (high vol → crisis, etc.).
    """

    def __init__(self, n_states: int = 5, n_iter: int = 200,
                 covariance_type: str = "full"):
        self.n_states = n_states
        self.n_iter = n_iter
        self.covariance_type = covariance_type
        self.model = None
        self.scaler = StandardScaler()
        self.state_to_regime: dict[int, Regime] = {}
        self._fitted = False

    # ------------------------------------------------------------------
    def fit(self, features: pd.DataFrame) -> "RegimeClassifier":
        """
        features : DataFrame with columns
            [realised_vol_20d, vol_of_vol_60d, momentum_60d,
             cross_asset_corr, credit_spread_chg]
        """
        try:
            from hmmlearn.hmm import GaussianHMM
        except ImportError:
            raise ImportError("pip install hmmlearn")

        X = self.scaler.fit_transform(features.values)

        self.model = GaussianHMM(
            n_components=self.n_states,
            covariance_type=self.covariance_type,
            n_iter=self.n_iter,
            random_state=42,
        )
        self.model.fit(X)

        # Map hidden states → regime labels using fitted means
        means = self.scaler.inverse_transform(self.model.means_)
        # means columns: [rv20, vov60, mom60, corr, spread_chg]
        self.state_to_regime = self._assign_regimes(means)
        self._fitted = True
        return self

    def _assign_regimes(self, means: np.ndarray) -> dict[int, Regime]:
        """
        Heuristic assignment of HMM states → Regime labels.

        Sort states by realised vol (col 0) ascending.
        Lowest vol + positive momentum = RISK_ON or TRENDING
        Mid vol = MEAN_REV or RISK_OFF
        Highest vol = CRISIS
        """
        rv   = means[:, 0]   # realised vol
        mom  = means[:, 2]   # momentum
        corr = means[:, 3]   # equity-bond correlation

        order = np.argsort(rv)          # states sorted by vol ascending
        mapping: dict[int, Regime] = {}

        for rank, state in enumerate(order):
            if rank == 0:
                # Lowest vol: risk-on if positive momentum, else mean-rev
                mapping[state] = (Regime.RISK_ON if mom[state] >= 0
                                  else Regime.MEAN_REV)
            elif rank == 1:
                mapping[state] = (Regime.TRENDING if mom[state] > 0.02
                                  else Regime.MEAN_REV)
            elif rank == 2:
                mapping[state] = Regime.RISK_OFF
            elif rank == 3:
                mapping[state] = Regime.RISK_OFF
            else:
                mapping[state] = Regime.CRISIS   # highest vol = crisis

        return mapping

    def predict(self, features: pd.DataFrame) -> pd.Series:
        """Return a Series of Regime values indexed like features."""
        assert self._fitted, "Call fit() first."
        X = self.scaler.transform(features.values)
        states = self.model.predict(X)
        regimes = pd.Series(
            [self.state_to_regime[s] for s in states],
            index=features.index,
            name="regime",
        )
        return regimes

    def predict_proba(self, features: pd.DataFrame) -> pd.DataFrame:
        """
        Posterior probability of each regime state.
        Returns DataFrame with one column per Regime.
        """
        assert self._fitted, "Call fit() first."
        X = self.scaler.transform(features.values)
        log_proba = self.model.predict_proba(X)   # (T, n_states)

        # Map state indices → Regime labels
        cols = {r: np.zeros(len(features)) for r in Regime}
        for state_idx, regime in self.state_to_regime.items():
            cols[regime] += log_proba[:, state_idx]

        return pd.DataFrame(cols, index=features.index)

    def current_regime(self, features: pd.DataFrame) -> tuple[Regime, float]:
        """
        Returns (regime, confidence) for the last row of features.
        Confidence = probability of the winning regime.
        """
        proba = self.predict_proba(features)
        last = proba.iloc[-1]
        regime = Regime(last.idxmax())
        confidence = float(last.max())
        return regime, confidence


# ─────────────────────────────────────────────
# 2. IC Tracker — rolling decay-weighted ICIR
# ─────────────────────────────────────────────

@dataclass
class SignalStats:
    name: str
    ic_series: pd.Series          # raw IC per period
    ic_mean: float = 0.0          # decay-weighted mean IC
    ic_vol: float  = 0.0          # decay-weighted std of IC
    icir: float    = 0.0          # ic_mean / ic_vol
    n_obs: int     = 0


class ICTracker:
    """
    Computes rolling Information Coefficient (IC) for each signal
    using exponential decay so recent observations dominate.

    IC_t = spearman_rank_corr(signal_t, forward_return_t)

    Decay-weighted mean:
        IC_mean = Σ_t λ^(T-t) · IC_t  /  Σ_t λ^(T-t)

    where λ = exp(-ln(2) / half_life)
    """

    def __init__(self, half_life: int = 60, min_obs: int = 20):
        """
        half_life : days after which an IC observation has half its weight
        min_obs   : minimum observations before reporting ICIR
        """
        self.half_life = half_life
        self.min_obs   = min_obs
        self._decay    = np.exp(-np.log(2) / half_life)

    def compute_ic_series(
        self,
        signals: pd.DataFrame,         # (T, N_instruments) per signal
        forward_returns: pd.DataFrame,  # (T, N_instruments)
    ) -> pd.DataFrame:
        """
        Compute cross-sectional IC for every (signal, time) pair.

        signals         : MultiIndex columns (signal_name, instrument)
                          or a dict {signal_name: DataFrame(T, N)}
        forward_returns : DataFrame (T, N) of next-period returns

        Returns DataFrame of shape (T, n_signals) — IC per period.
        """
        if isinstance(signals, dict):
            ic_data = {}
            for sig_name, sig_df in signals.items():
                ic_data[sig_name] = self._compute_single_ic(
                    sig_df, forward_returns)
            return pd.DataFrame(ic_data)
        else:
            raise ValueError("Pass signals as dict {name: DataFrame}")

    def _compute_single_ic(
        self,
        signal_df: pd.DataFrame,
        fwd_ret_df: pd.DataFrame,
    ) -> pd.Series:
        """Row-wise Spearman IC between signal cross-section and returns."""
        common_dates = signal_df.index.intersection(fwd_ret_df.index)
        ics = []
        for date in common_dates:
            s = signal_df.loc[date].dropna()
            r = fwd_ret_df.loc[date].dropna()
            common = s.index.intersection(r.index)
            if len(common) < 10:
                ics.append(np.nan)
                continue
            rho, _ = spearmanr(s[common], r[common])
            ics.append(rho)
        return pd.Series(ics, index=common_dates, name="ic")

    def get_signal_stats(
        self, ic_df: pd.DataFrame, as_of: Optional[pd.Timestamp] = None
    ) -> dict[str, SignalStats]:
        """
        Compute decay-weighted IC stats for each signal as of a date.

        ic_df  : (T, n_signals) IC series from compute_ic_series()
        as_of  : if None, use the last available date
        """
        if as_of is None:
            as_of = ic_df.index[-1]

        subset = ic_df.loc[:as_of].dropna(how="all")
        n = len(subset)
        t_vec = np.arange(n)               # 0, 1, ..., T-1
        weights = self._decay ** (n - 1 - t_vec)   # older → smaller weight
        weights /= weights.sum()

        stats = {}
        for col in subset.columns:
            series = subset[col].fillna(0.0)
            ic_mean = float(np.dot(weights, series.values))
            ic_var  = float(np.dot(weights, (series.values - ic_mean) ** 2))
            ic_vol  = float(np.sqrt(max(ic_var, 1e-8)))
            icir    = ic_mean / ic_vol if ic_vol > 0 else 0.0
            stats[col] = SignalStats(
                name=col,
                ic_series=series,
                ic_mean=ic_mean,
                ic_vol=ic_vol,
                icir=icir,
                n_obs=int(series.count()),
            )

        # Zero out signals with insufficient history
        for s in stats.values():
            if s.n_obs < self.min_obs:
                s.ic_mean = 0.0
                s.ic_vol  = 0.0
                s.icir    = 0.0

        return stats


# ─────────────────────────────────────────────
# 3. Weight Calculator
# ─────────────────────────────────────────────

@dataclass
class WeightResult:
    weights: dict[str, float]          # signal_name → weight (sum to 1)
    effective_icir: dict[str, float]   # regime-adjusted ICIR per signal
    regime: Regime
    regime_confidence: float
    portfolio_ic: float                # expected IC of the ensemble
    hhi: float                         # Herfindahl concentration index


class WeightCalculator:
    """
    Combines IC stats + regime state → normalised signal weights.

    Effective ICIR for signal i in regime r:
        ICIR_eff_i = ICIR_i · multiplier[r, i]

    Weight:
        w_i = max(0, ICIR_eff_i) / Σ_j max(0, ICIR_eff_j)

    Optional: soft regime blending.
        Instead of hard regime assignment, blend weights across
        all regimes weighted by posterior probability p(r|data):
        w_i = Σ_r p(r) · w_i(r)
    """

    def __init__(
        self,
        signal_names: list[str],
        multipliers: np.ndarray = REGIME_SIGNAL_MULTIPLIERS,
        min_icir: float = 0.5,            # signals below this are zeroed
        use_soft_blending: bool = True,   # blend across regime probs
        max_weight: float = 0.40,         # cap any single signal weight
    ):
        self.signal_names    = signal_names
        self.multipliers     = multipliers   # shape (n_regimes, n_signals)
        self.min_icir        = min_icir
        self.use_soft_blending = use_soft_blending
        self.max_weight      = max_weight

        assert len(signal_names) == multipliers.shape[1], (
            "multipliers columns must match len(signal_names)"
        )

    def compute(
        self,
        signal_stats: dict[str, SignalStats],
        regime: Regime,
        regime_proba: Optional[dict[Regime, float]] = None,
    ) -> WeightResult:
        """
        signal_stats  : output of ICTracker.get_signal_stats()
        regime        : current Regime (for hard assignment)
        regime_proba  : {Regime: probability} for soft blending
        """
        raw_icir = np.array([
            signal_stats[n].icir if n in signal_stats else 0.0
            for n in self.signal_names
        ])

        if self.use_soft_blending and regime_proba is not None:
            weights = self._soft_blend(raw_icir, regime_proba)
        else:
            weights = self._hard_weights(raw_icir, int(regime))

        # Apply single-signal cap then renormalise
        weights = np.clip(weights, 0, self.max_weight)
        total = weights.sum()
        if total > 1e-8:
            weights /= total
        else:
            weights = np.ones(len(self.signal_names)) / len(self.signal_names)

        # Effective ICIRs for reporting
        eff_icir = raw_icir * self.multipliers[int(regime)]
        eff_icir = np.maximum(eff_icir, 0)

        # Portfolio IC = weighted average effective IC
        ic_means = np.array([
            signal_stats[n].ic_mean if n in signal_stats else 0.0
            for n in self.signal_names
        ])
        port_ic = float(np.dot(weights, ic_means))
        hhi = float(np.dot(weights, weights))

        return WeightResult(
            weights={n: float(w) for n, w in zip(self.signal_names, weights)},
            effective_icir={n: float(v) for n, v in zip(self.signal_names, eff_icir)},
            regime=regime,
            regime_confidence=float(max(regime_proba.values()))
                              if regime_proba else 1.0,
            portfolio_ic=port_ic,
            hhi=hhi,
        )

    def _hard_weights(self, raw_icir: np.ndarray, regime_idx: int) -> np.ndarray:
        mult   = self.multipliers[regime_idx]
        eff    = raw_icir * mult
        eff    = np.where(eff >= self.min_icir, eff, 0.0)
        total  = eff.sum()
        return eff / total if total > 1e-8 else np.zeros_like(eff)

    def _soft_blend(
        self,
        raw_icir: np.ndarray,
        regime_proba: dict[Regime, float],
    ) -> np.ndarray:
        """Probability-weighted blend of weights across all regimes."""
        blended = np.zeros(len(self.signal_names))
        for regime, prob in regime_proba.items():
            if prob < 1e-4:
                continue
            w = self._hard_weights(raw_icir, int(regime))
            blended += prob * w
        return blended


# ─────────────────────────────────────────────
# 4. Signal Combiner — composite alpha score
# ─────────────────────────────────────────────

class SignalCombiner:
    """
    Produces a composite cross-sectional alpha score per instrument.

    α_k = Σ_i w_i · rank_pct(signal_i,k)

    where rank_pct is the cross-sectional percentile rank [0, 1].

    Additional options:
      - industry neutralisation: subtract industry-median rank
      - winsorisation: clip extreme ranks before combining
    """

    def __init__(
        self,
        winsorise_pct: float = 0.01,       # clip top/bottom 1%
        neutralise_industry: bool = False,
        industry_col: Optional[str] = None,
    ):
        self.winsorise_pct = winsorise_pct
        self.neutralise_industry = neutralise_industry
        self.industry_col = industry_col

    def combine(
        self,
        signals: dict[str, pd.Series],    # {signal_name: Series(instruments)}
        weights: dict[str, float],
        industries: Optional[pd.Series] = None,
    ) -> pd.Series:
        """
        signals    : each Series has instruments as index, raw signal as value
        weights    : from WeightCalculator.compute().weights
        industries : Series mapping instrument → industry (for neutralisation)

        Returns: composite alpha Series (instruments as index), ranked [0,1].
        """
        # Find common instruments
        all_instruments = None
        for s in signals.values():
            idx = s.dropna().index
            all_instruments = idx if all_instruments is None else \
                              all_instruments.intersection(idx)

        composite = pd.Series(0.0, index=all_instruments)

        for name, raw in signals.items():
            w = weights.get(name, 0.0)
            if w < 1e-6:
                continue

            raw_aligned = raw.reindex(all_instruments).fillna(raw.median())

            # Rank to [0, 1]
            ranked = raw_aligned.rank(pct=True)

            # Winsorise
            lo = self.winsorise_pct
            hi = 1.0 - self.winsorise_pct
            ranked = ranked.clip(lo, hi)

            # Industry neutralise: subtract industry median rank
            if self.neutralise_industry and industries is not None:
                ind_aligned = industries.reindex(all_instruments)
                ind_median = (
                    ranked.groupby(ind_aligned)
                    .transform("median")
                    .fillna(0.5)
                )
                ranked = ranked - ind_median

            composite += w * ranked

        # Final cross-sectional re-rank
        if composite.std() > 1e-8:
            composite = composite.rank(pct=True)

        return composite.sort_values(ascending=False)


# ─────────────────────────────────────────────
# 5. Master orchestrator
# ─────────────────────────────────────────────

class RegimeSignalSystem:
    """
    Top-level orchestrator. Wires all four components together.

    Usage:
        system = RegimeSignalSystem(signal_names=[...])
        system.fit(market_features, signal_ic_df)

        # Every day / rebalance:
        result = system.run(
            market_features=...,
            current_signals=...,
            forward_returns=...   # for IC update (optional intraday)
        )
        alpha_scores = result.composite_alpha   # ranked instruments
    """

    def __init__(
        self,
        signal_names: list[str],
        ic_half_life: int = 60,
        hmm_states: int = 5,
        use_soft_blending: bool = True,
        max_signal_weight: float = 0.40,
    ):
        self.signal_names = signal_names

        self.classifier = RegimeClassifier(n_states=hmm_states)
        self.ic_tracker = ICTracker(half_life=ic_half_life)
        self.calculator = WeightCalculator(
            signal_names=signal_names,
            use_soft_blending=use_soft_blending,
            max_weight=max_signal_weight,
        )
        self.combiner = SignalCombiner()

        self._ic_df: Optional[pd.DataFrame] = None
        self._fitted = False

    # ------------------------------------------------------------------
    def fit(
        self,
        market_features: pd.DataFrame,
        ic_df: pd.DataFrame,
    ) -> "RegimeSignalSystem":
        """
        market_features : (T, 5) — regime classifier features
        ic_df           : (T, n_signals) — historical IC per signal
        """
        self.classifier.fit(market_features)
        self._ic_df = ic_df
        self._fitted = True
        return self

    def run(
        self,
        market_features: pd.DataFrame,
        current_signals: dict[str, pd.Series],
        as_of: Optional[pd.Timestamp] = None,
        new_ic_row: Optional[dict[str, float]] = None,
    ) -> "RunResult":
        """
        market_features  : recent feature window for regime detection
        current_signals  : {signal_name: Series(instruments)} today's values
        as_of            : date for IC lookup (default: last in ic_df)
        new_ic_row       : today's realised IC to append before computing weights
        """
        assert self._fitted, "Call fit() first."

        # Optionally append today's IC observation
        if new_ic_row is not None:
            ts = as_of or pd.Timestamp.today().normalize()
            row = pd.DataFrame([new_ic_row], index=[ts])
            self._ic_df = pd.concat([self._ic_df, row])

        # Step 1: classify regime
        regime, confidence = self.classifier.current_regime(market_features)
        regime_proba_df = self.classifier.predict_proba(market_features)
        regime_proba = regime_proba_df.iloc[-1].to_dict()

        # Step 2: compute IC stats
        signal_stats = self.ic_tracker.get_signal_stats(
            self._ic_df, as_of=as_of)

        # Step 3: compute weights
        weight_result = self.calculator.compute(
            signal_stats=signal_stats,
            regime=regime,
            regime_proba=regime_proba,
        )

        # Step 4: combine signals
        composite_alpha = self.combiner.combine(
            signals=current_signals,
            weights=weight_result.weights,
        )

        return RunResult(
            regime=regime,
            regime_name=REGIME_NAMES[regime],
            confidence=confidence,
            weights=weight_result.weights,
            effective_icir=weight_result.effective_icir,
            portfolio_ic=weight_result.portfolio_ic,
            hhi=weight_result.hhi,
            composite_alpha=composite_alpha,
            signal_stats=signal_stats,
        )

    def report(self, result: "RunResult") -> str:
        lines = [
            f"{'='*55}",
            f"  Regime:        {result.regime_name.upper():<20} "
            f"({result.confidence:.0%} confidence)",
            f"  Portfolio IC:  {result.portfolio_ic:.4f}",
            f"  HHI (conc.):   {result.hhi:.3f}",
            f"{'─'*55}",
            f"  {'Signal':<22} {'Weight':>7}  {'Eff-ICIR':>9}  {'IC-mean':>8}",
            f"{'─'*55}",
        ]
        for name in self.signal_names:
            w   = result.weights.get(name, 0.0)
            eic = result.effective_icir.get(name, 0.0)
            ic  = result.signal_stats[name].ic_mean \
                  if name in result.signal_stats else 0.0
            bar = "#" * int(w * 30)
            lines.append(
                f"  {name:<22} {w:>6.1%}  {eic:>9.3f}  {ic:>8.4f}  {bar}"
            )
        lines.append(f"{'='*55}")
        lines.append("\n  Top 10 alpha scores:")
        for inst, score in result.composite_alpha.head(10).items():
            lines.append(f"    {inst:<12} {score:.4f}")
        return "\n".join(lines)


@dataclass
class RunResult:
    regime: Regime
    regime_name: str
    confidence: float
    weights: dict[str, float]
    effective_icir: dict[str, float]
    portfolio_ic: float
    hhi: float
    composite_alpha: pd.Series
    signal_stats: dict[str, SignalStats]


# ─────────────────────────────────────────────
# 6. Demo — synthetic data end-to-end run
# ─────────────────────────────────────────────

def _generate_demo_data(
    n_days: int = 504,
    n_instruments: int = 500,
    seed: int = 42,
) -> tuple[pd.DataFrame, dict, pd.DataFrame, pd.DataFrame]:
    """Generate synthetic market features, signals, IC history, and returns."""
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2022-01-03", periods=n_days)
    instruments = [f"INST_{i:04d}" for i in range(n_instruments)]

    # ── Market features (regime classifier inputs) ──────────────────
    # Simulate a path with two regime shifts
    rv = np.abs(rng.normal(0.15, 0.05, n_days)).cumsum() * 0.001 + 0.12
    rv[200:320] += 0.08    # risk-off episode
    rv[380:420] += 0.20    # crisis spike
    rv = np.clip(rv, 0.08, 0.55)

    features = pd.DataFrame({
        "realised_vol_20d":   rv,
        "vol_of_vol_60d":     pd.Series(rv).rolling(60).std().fillna(0.02).values,
        "momentum_60d":       rng.normal(0.005, 0.03, n_days).cumsum() * 0.1,
        "cross_asset_corr":   rng.uniform(-0.4, 0.4, n_days),
        "credit_spread_chg":  rng.normal(0, 0.5, n_days),
    }, index=dates)

    # ── Historical IC per signal ─────────────────────────────────────
    signal_names = [
        "momentum_12m", "mean_rev_5d", "earnings_rev",
        "vol_carry", "sentiment_nlp", "options_skew", "stat_arb",
    ]
    true_ic = np.array([0.091, 0.051, 0.073, 0.038, 0.062, 0.022, 0.085])
    ic_data = {}
    for i, name in enumerate(signal_names):
        noise = rng.normal(0, 0.03, n_days)
        ic_data[name] = true_ic[i] + noise
    ic_df = pd.DataFrame(ic_data, index=dates)

    # ── Today's cross-sectional signals ─────────────────────────────
    today_signals = {}
    for name in signal_names:
        today_signals[name] = pd.Series(
            rng.normal(0, 1, n_instruments), index=instruments, name=name
        )

    # ── Forward returns (for reference) ─────────────────────────────
    fwd_ret = pd.Series(rng.normal(0, 0.02, n_instruments), index=instruments)

    return features, today_signals, ic_df, fwd_ret


def run_demo():
    SIGNAL_NAMES = [
        "momentum_12m", "mean_rev_5d", "earnings_rev",
        "vol_carry", "sentiment_nlp", "options_skew", "stat_arb",
    ]

    print("Generating synthetic data...")
    features, today_signals, ic_df, _ = _generate_demo_data()

    print("Building system and fitting regime classifier...")
    system = RegimeSignalSystem(
        signal_names=SIGNAL_NAMES,
        ic_half_life=60,
        hmm_states=5,
        use_soft_blending=True,
        max_signal_weight=0.40,
    )
    system.fit(features, ic_df)

    print("Running signal combination...\n")
    result = system.run(
        market_features=features,
        current_signals=today_signals,
    )

    print(system.report(result))
    return system, result


if __name__ == "__main__":
    system, result = run_demo()
