"""
ensemble.py — regime detection + IC tracker + IC-weighted combiner

Three components:
  RegimeClassifier  : HMM-style regime detection on market features
  ICTracker         : rolling decay-weighted IC/ICIR per signal
  EnsembleCombiner  : regime-conditional IC-weighted alpha score
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.preprocessing import StandardScaler
from core import cs_rank, winsorise, decay_weights, Regime
from data import Universe


# ── Regime multiplier matrix ──────────────────────────────────────────────────
# Rows = regimes, cols = signal families [momentum, mean_rev, value, quality]
# Then mapped to individual signals
_FAMILY_MULT = {
    #                mom    mr   val   qual
    Regime.RISK_ON:  [1.00, 0.70, 1.00, 1.00],
    Regime.TRENDING: [1.30, 0.30, 0.80, 0.90],
    Regime.MEAN_REV: [0.50, 1.50, 1.00, 1.00],
    Regime.RISK_OFF: [0.60, 1.10, 1.10, 1.20],
    Regime.CRISIS:   [0.30, 1.20, 1.30, 1.10],
}
FAMILY_ORDER = ["momentum", "mean_rev", "value", "quality"]


def _family_mult(regime: Regime, family: str) -> float:
    idx = FAMILY_ORDER.index(family) if family in FAMILY_ORDER else 0
    return _FAMILY_MULT.get(regime, _FAMILY_MULT[Regime.RISK_ON])[idx]


# ════════════════════════════════════════════════════════════════════════════
# 1. Regime Classifier
# ════════════════════════════════════════════════════════════════════════════

class RegimeClassifier:
    """
    Lightweight HMM-style regime classifier without hmmlearn dependency.
    Uses threshold rules on standardised market features + smooth transitions.

    Features (standardised):
      realised_vol_20d, vol_of_vol_60d, momentum_60d,
      cross_asset_corr, credit_spread_chg
    """

    def __init__(self, smooth_window: int = 5):
        self.smooth = smooth_window
        self.scaler = StandardScaler()
        self._fitted = False

    def fit(self, features: pd.DataFrame) -> "RegimeClassifier":
        self.scaler.fit(features.values)
        self._fitted = True
        return self

    def predict(self, features: pd.DataFrame) -> pd.Series:
        """Returns Series of Regime values."""
        X = pd.DataFrame(
            self.scaler.transform(features.values),
            index=features.index,
            columns=features.columns,
        )
        regimes = X.apply(self._classify_row, axis=1)
        # Smooth transitions: map to int, rolling mode, map back
        if self.smooth > 1:
            regime_list = list(Regime)
            int_map  = {r: i for i, r in enumerate(regime_list)}
            back_map = {i: r for i, r in enumerate(regime_list)}
            int_ser  = regimes.map(int_map).astype(float)
            smoothed = int_ser.rolling(self.smooth, min_periods=1).apply(
                lambda x: pd.Series(x).mode().iloc[0])
            regimes  = smoothed.map(lambda v: back_map.get(int(v), regime_list[0]))
        return regimes

    def _classify_row(self, row: pd.Series) -> Regime:
        rv   = row.get("realised_vol_20d", 0)
        vov  = row.get("vol_of_vol_60d", 0)
        mom  = row.get("momentum_60d", 0)
        corr = row.get("cross_asset_corr", 0)
        cred = row.get("credit_spread_chg", 0)

        if rv > 1.8 or (rv > 1.2 and cred > 1.5):
            return Regime.CRISIS
        if rv > 0.8 or (rv > 0.4 and cred > 0.8):
            return Regime.RISK_OFF
        if mom > 0.5 and rv < 0.3:
            return Regime.TRENDING
        if rv < -0.3 and mom > -0.2:
            return Regime.RISK_ON
        return Regime.MEAN_REV

    def predict_proba(self, features: pd.DataFrame) -> pd.DataFrame:
        """Soft regime probabilities via distance-based softmax."""
        hard = self.predict(features)
        # One-hot → smooth with rolling mean for soft blending
        dummies = pd.get_dummies(hard)
        for r in Regime:
            if r not in dummies.columns:
                dummies[r] = 0.0
        soft = dummies[list(Regime)].rolling(10, min_periods=1).mean()
        return soft


# ════════════════════════════════════════════════════════════════════════════
# 2. IC Tracker
# ════════════════════════════════════════════════════════════════════════════

class ICTracker:
    """
    Computes and tracks IC (Information Coefficient) per signal.

    IC_t = Spearman_rank_corr(signal_cross_section_t, fwd_return_t)
    ICIR  = decay_weighted_mean(IC) / decay_weighted_std(IC)
    """

    def __init__(self, half_life: int = 60, min_obs: int = 20,
                 fwd_horizon: int = 5):
        self.half_life   = half_life
        self.min_obs     = min_obs
        self.fwd_horizon = fwd_horizon

    def compute_ic_series(
        self,
        signals: dict[str, pd.DataFrame],
        fwd_returns: pd.DataFrame,
    ) -> pd.DataFrame:
        """
        Returns DataFrame (T × n_signals) of per-period IC values.
        """
        results = {}
        for name, sig_df in signals.items():
            ics = []
            common_dates = sig_df.index.intersection(fwd_returns.index)
            for date in common_dates:
                s = sig_df.loc[date].dropna()
                r = fwd_returns.loc[date].dropna()
                common = s.index.intersection(r.index)
                if len(common) < 10:
                    ics.append(np.nan)
                    continue
                rho, _ = spearmanr(s[common].values, r[common].values)
                ics.append(float(rho))
            results[name] = pd.Series(ics, index=common_dates)
        return pd.DataFrame(results)

    def get_icir(
        self, ic_df: pd.DataFrame, as_of: pd.Timestamp
    ) -> dict[str, float]:
        """
        Decay-weighted ICIR for each signal as of a date.
        Returns {signal_name: ICIR}.
        """
        subset = ic_df.loc[:as_of].dropna(how="all")
        n = len(subset)
        if n < self.min_obs:
            return {col: 0.0 for col in ic_df.columns}

        w = decay_weights(n, self.half_life)
        icirs = {}
        for col in ic_df.columns:
            series = subset[col].fillna(0.0).values
            ic_mean = float(np.dot(w, series))
            ic_var  = float(np.dot(w, (series - ic_mean) ** 2))
            ic_vol  = float(np.sqrt(max(ic_var, 1e-10)))
            icirs[col] = ic_mean / ic_vol if ic_vol > 0 else 0.0
        return icirs

    def get_ic_means(
        self, ic_df: pd.DataFrame, as_of: pd.Timestamp
    ) -> dict[str, float]:
        subset = ic_df.loc[:as_of].dropna(how="all")
        n = len(subset)
        if n < self.min_obs:
            return {col: 0.0 for col in ic_df.columns}
        w = decay_weights(n, self.half_life)
        return {col: float(np.dot(w, subset[col].fillna(0.0).values))
                for col in ic_df.columns}


# ════════════════════════════════════════════════════════════════════════════
# 3. Ensemble Combiner
# ════════════════════════════════════════════════════════════════════════════

class EnsembleCombiner:
    """
    Combines signals into a composite alpha score.

    Weight formula (per signal i, in regime r):
      effective_ICIR_i = ICIR_i × family_multiplier(r, family_i)
      w_i = max(0, effective_ICIR_i) / Σ_j max(0, effective_ICIR_j)

    Composite alpha:
      α_k = Σ_i w_i · rank_pct(signal_i, k)

    Supports:
      - Hard regime assignment
      - Soft regime blending via regime probability vector
      - Single-signal weight cap
      - Industry neutralisation of composite
    """

    def __init__(
        self,
        signal_families: dict[str, str],  # signal_name → family
        min_icir: float = 0.3,
        max_weight: float = 0.35,
        winsorise_pct: float = 0.01,
        neutralise_sector: bool = True,
    ):
        self.sig_families    = signal_families
        self.min_icir        = min_icir
        self.max_weight      = max_weight
        self.winsorise_pct   = winsorise_pct
        self.neutralise_sec  = neutralise_sector

    def compute_weights(
        self,
        icirs: dict[str, float],
        regime: Regime,
        regime_proba: dict[Regime, float] | None = None,
    ) -> dict[str, float]:
        """
        Regime-conditional normalised weights.
        If regime_proba provided, soft-blends across regimes.
        """
        if regime_proba is not None:
            return self._soft_blend(icirs, regime_proba)
        return self._hard_weights(icirs, regime)

    def _hard_weights(
        self, icirs: dict[str, float], regime: Regime
    ) -> dict[str, float]:
        eff = {}
        for name, icir in icirs.items():
            fam = self.sig_families.get(name, "momentum")
            mult = _family_mult(regime, fam)
            eff[name] = max(0.0, icir * mult)

        # Zero out below threshold
        eff = {k: v if v >= self.min_icir else 0.0 for k, v in eff.items()}
        total = sum(eff.values())
        if total < 1e-8:
            n = len(eff)
            return {k: 1.0/n for k in eff}

        # Normalise → cap → renormalise
        w = {k: v/total for k, v in eff.items()}
        w = {k: min(v, self.max_weight) for k, v in w.items()}
        total2 = sum(w.values())
        return {k: v/total2 for k, v in w.items()}

    def _soft_blend(
        self, icirs: dict[str, float], regime_proba: dict[Regime, float]
    ) -> dict[str, float]:
        blended = {k: 0.0 for k in icirs}
        for regime, prob in regime_proba.items():
            if prob < 0.01:
                continue
            hw = self._hard_weights(icirs, regime)
            for k in blended:
                blended[k] += prob * hw.get(k, 0.0)
        total = sum(blended.values())
        if total < 1e-8:
            n = len(blended)
            return {k: 1.0/n for k in blended}
        return {k: v/total for k, v in blended.items()}

    def combine(
        self,
        signals: dict[str, pd.DataFrame],
        weights: dict[str, float],
        date: pd.Timestamp,
        sectors: pd.Series | None = None,
    ) -> pd.Series:
        """
        Produce composite alpha cross-section for a given date.
        Returns Series (instruments), values ∈ [0,1].
        """
        composite = None
        total_w = 0.0

        for name, w in weights.items():
            if w < 1e-4 or name not in signals:
                continue
            sig_date = signals[name]
            if date not in sig_date.index:
                continue
            raw = sig_date.loc[date].dropna()
            if raw.empty:
                continue
            ranked = raw.rank(pct=True)
            ranked = winsorise(ranked, self.winsorise_pct)

            if composite is None:
                composite = w * ranked
            else:
                composite = composite.add(w * ranked, fill_value=0)
            total_w += w

        if composite is None or composite.empty:
            return pd.Series(dtype=float)

        # Sector neutralisation: subtract sector median
        if self.neutralise_sec and sectors is not None:
            common = composite.index.intersection(sectors.index)
            comp_c = composite[common]
            sec_c  = sectors[common]
            sec_med = comp_c.groupby(sec_c).transform("median")
            composite = (comp_c - sec_med).reindex(composite.index, fill_value=0)

        # Final re-rank
        return composite.rank(pct=True).sort_values(ascending=False)


# ════════════════════════════════════════════════════════════════════════════
# 4. Pre-compute pipeline (runs once over full history)
# ════════════════════════════════════════════════════════════════════════════

class SignalPipeline:
    """
    Orchestrates signal computation, IC tracking, and regime detection
    over the full historical universe.

    Produces:
      .signals      : {name: DataFrame(T×N)}
      .ic_df        : DataFrame(T × n_signals) — daily IC
      .regimes      : Series(T) — Regime per day
      .regime_proba : DataFrame(T × 5) — soft probabilities
    """

    def __init__(self, signal_list, ic_half_life: int = 60,
                 fwd_horizon: int = 5):
        from signals import AlphaSignal
        self.signal_list  = signal_list
        self.ic_tracker   = ICTracker(half_life=ic_half_life,
                                      fwd_horizon=fwd_horizon)
        self.regime_clf   = RegimeClassifier()
        self.combiner     = EnsembleCombiner(
            signal_families={s.name: s.family for s in signal_list},
            min_icir=0.05,
        )
        self.signals: dict[str, pd.DataFrame] = {}
        self.ic_df: pd.DataFrame              = pd.DataFrame()
        self.regimes: pd.Series               = pd.Series(dtype=object)
        self.regime_proba: pd.DataFrame       = pd.DataFrame()

    def run(self, univ: Universe, verbose: bool = True) -> "SignalPipeline":
        if verbose:
            print("  [1/4] Computing signals...")
        from signals import compute_all_signals
        self.signals = compute_all_signals(univ, self.signal_list)

        if verbose:
            print("  [2/4] Computing IC series...")
        fwd = univ.fwd_ret_5d
        self.ic_df = self.ic_tracker.compute_ic_series(self.signals, fwd)

        if verbose:
            print("  [3/4] Detecting regimes...")
        self.regime_clf.fit(univ.market_features)
        self.regimes = self.regime_clf.predict(univ.market_features)
        self.regime_proba = self.regime_clf.predict_proba(univ.market_features)

        if verbose:
            print("  [4/4] Pipeline ready.\n")
        return self

    def get_alpha(
        self, date: pd.Timestamp, sectors: pd.Series | None = None
    ) -> pd.Series:
        """Get composite alpha cross-section for a specific date."""
        regime = self.regimes.get(date, Regime.RISK_ON)
        proba  = self.regime_proba.loc[date].to_dict() \
                 if date in self.regime_proba.index else None

        icirs = self.ic_tracker.get_icir(self.ic_df, as_of=date)
        weights = self.combiner.compute_weights(icirs, regime, proba)
        alpha   = self.combiner.combine(self.signals, weights, date, sectors)
        return alpha

    def regime_summary(self) -> pd.DataFrame:
        """Regime distribution and IC stats summary."""
        counts = self.regimes.value_counts()
        ic_means = self.ic_df.mean()
        ic_stds  = self.ic_df.std()
        icir     = ic_means / ic_stds.replace(0, np.nan)
        return pd.DataFrame({
            "mean_IC":  ic_means.round(4),
            "IC_vol":   ic_stds.round(4),
            "ICIR":     icir.round(3),
        })
