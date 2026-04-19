"""
attribution.py — P&L attribution and alpha decay analysis

Two components:

AttributionEngine:
  Decomposes daily P&L into contributions from:
  - Each signal family (momentum, mean_rev, value, quality)
  - Each regime (risk_on, trending, mean_rev, risk_off, crisis)
  - Long book vs short book
  - Transaction costs drag
  Produces a full attribution DataFrame and summary table.

AlphaDecayAnalyser:
  Measures how IC decays as you hold a signal longer:
  - Compute IC at horizons 1d, 5d, 10d, 21d, 63d
  - Fit exponential decay: IC(h) = IC_0 · exp(-h / τ)
  - Estimate optimal rebalancing frequency from decay half-life
  - Flag signals where IC has decayed >50% from peak (dying signals)
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from core import sharpe, Regime
from backtester import Backtester


# ════════════════════════════════════════════════════════════════════════════
# 1. Attribution Engine
# ════════════════════════════════════════════════════════════════════════════

class AttributionEngine:
    """
    Decomposes backtester P&L into factor/regime contributions.

    For each day t, and each signal i with weight w_i:
      contribution_i,t = w_i · IC_i,t · portfolio_IC_realised_t

    Regime contribution = mean daily return in each regime state.
    Long/short attribution = separate P&L tracking by position sign.
    """

    def __init__(self, bt: Backtester):
        self.bt       = bt
        self.pipeline = bt.pipeline
        self.univ     = bt.univ

    def compute(self) -> "AttributionResult":
        perf_df  = self.bt.perf.to_df()
        ic_df    = self.pipeline.ic_df
        regimes  = self.pipeline.regimes
        families = {s.name: s.family
                    for s in self.bt.pipeline.signal_list}

        # ── Family contributions via IC correlation ─────────────────
        family_rets = {}
        for fam in ["momentum", "mean_rev", "value", "quality"]:
            sigs = [n for n, f in families.items() if f == fam]
            if not sigs:
                continue
            fam_ic = ic_df[sigs].mean(axis=1).reindex(perf_df.index)
            # Scale: positive IC day → strategy benefits
            scaled = fam_ic * perf_df["ret"].std() / (fam_ic.std() + 1e-8)
            family_rets[fam] = scaled.fillna(0)

        family_df = pd.DataFrame(family_rets, index=perf_df.index)

        # ── Regime contributions ─────────────────────────────────────
        regime_rets = {}
        reg_aligned = regimes.reindex(perf_df.index, method="ffill")
        for regime in Regime:
            mask = reg_aligned == regime
            if mask.sum() == 0:
                regime_rets[regime.value] = 0.0
            else:
                regime_rets[regime.value] = float(
                    perf_df["ret"][mask].mean() * 252)

        # ── Long / short book split ──────────────────────────────────
        long_rets, short_rets = [], []
        for fill in self.bt.fills_log:
            pnl = fill.shares * fill.price  # simplification
            if fill.shares > 0:
                long_rets.append(pnl)
            else:
                short_rets.append(pnl)
        long_contrib  = sum(long_rets)  / (self.bt.cfg.initial_nav + 1e-8)
        short_contrib = sum(short_rets) / (self.bt.cfg.initial_nav + 1e-8)

        # ── Transaction cost drag ────────────────────────────────────
        total_tc  = sum(f.commission for f in self.bt.fills_log)
        tc_pct    = total_tc / self.bt.cfg.initial_nav

        # ── Rolling Sharpe by regime ─────────────────────────────────
        sharpe_by_regime = {}
        for regime in Regime:
            mask = reg_aligned == regime
            r    = perf_df["ret"][mask].dropna()
            sharpe_by_regime[regime.value] = sharpe(r) if len(r) > 5 else 0.0

        return AttributionResult(
            perf_df=perf_df,
            family_df=family_df,
            regime_ann_returns=regime_rets,
            sharpe_by_regime=sharpe_by_regime,
            long_contrib=long_contrib,
            short_contrib=short_contrib,
            tc_drag_pct=tc_pct,
            regime_dist=reg_aligned.value_counts(normalize=True).to_dict(),
        )


class AttributionResult:
    def __init__(self, perf_df, family_df, regime_ann_returns,
                 sharpe_by_regime, long_contrib, short_contrib,
                 tc_drag_pct, regime_dist):
        self.perf_df             = perf_df
        self.family_df           = family_df
        self.regime_ann_returns  = regime_ann_returns
        self.sharpe_by_regime    = sharpe_by_regime
        self.long_contrib        = long_contrib
        self.short_contrib       = short_contrib
        self.tc_drag_pct         = tc_drag_pct
        self.regime_dist         = regime_dist

    def print_report(self):
        print("\n" + "═"*55)
        print("  P&L ATTRIBUTION REPORT")
        print("═"*55)

        print("\n  Signal family IC correlation to P&L:")
        for fam, ser in self.family_df.items():
            corr = ser.corr(self.perf_df["ret"])
            bar  = "█" * int(abs(corr) * 20)
            sign = "+" if corr >= 0 else "-"
            print(f"    {fam:<14} {sign}{abs(corr):.3f}  {bar}")

        print("\n  Ann. return by regime:")
        for reg, ret in self.regime_ann_returns.items():
            pct = self.regime_dist.get(reg, 0)
            print(f"    {str(reg):<14} {ret*100:>+7.2f}%  "
                  f"({pct*100:.1f}% of days)  "
                  f"Sharpe={self.sharpe_by_regime.get(reg, 0):.2f}")

        print(f"\n  Long book contribution:  {self.long_contrib*100:+.2f}%")
        print(f"  Short book contribution: {self.short_contrib*100:+.2f}%")
        print(f"  Transaction cost drag:   -{self.tc_drag_pct*100:.2f}%")
        print("═"*55)


# ════════════════════════════════════════════════════════════════════════════
# 2. Alpha Decay Analyser
# ════════════════════════════════════════════════════════════════════════════

class AlphaDecayAnalyser:
    """
    Measures IC at multiple forward horizons and fits an exponential
    decay curve to determine the optimal holding period per signal.

    IC(h) ≈ IC_0 · exp(-h / τ)

    τ = decay half-life in trading days
    Optimal rebalance frequency ≈ τ / 2

    Flags:
      "dying"  : recent IC (last 60d) < 50% of full-period IC
      "noisy"  : IC vol / IC mean > 5 (inconsistent alpha)
      "healthy": ICIR > 0.5 and not dying
    """

    HORIZONS = [1, 5, 10, 21, 63]   # days

    def __init__(self, bt: Backtester):
        self.bt   = bt
        self.univ = bt.univ
        self.pipeline = bt.pipeline

    def analyse(self) -> "DecayResult":
        results = {}
        signal_list = self.bt.pipeline.signal_list

        for sig in signal_list:
            if sig.name not in self.pipeline.signals:
                continue
            sig_df = self.pipeline.signals[sig.name]
            ic_by_horizon = {}

            for h in self.HORIZONS:
                fwd_key = (
                    "fwd_ret_1d"  if h == 1  else
                    "fwd_ret_5d"  if h == 5  else
                    "fwd_ret_21d" if h == 21 else None
                )
                if fwd_key:
                    fwd = getattr(self.univ, fwd_key)
                else:
                    # Compute custom horizon
                    fwd = self.univ.returns.rolling(h).sum().shift(-h)

                ics = []
                for date in sig_df.index[:-h]:
                    s = sig_df.loc[date].dropna()
                    r = fwd.loc[date].dropna() if date in fwd.index else pd.Series()
                    common = s.index.intersection(r.index)
                    if len(common) < 10:
                        continue
                    from scipy.stats import spearmanr
                    rho, _ = spearmanr(s[common].values, r[common].values)
                    ics.append(rho)

                ic_by_horizon[h] = float(np.nanmean(ics)) if ics else 0.0

            # Fit exponential decay
            horizons = np.array(self.HORIZONS, dtype=float)
            ic_vals  = np.array([ic_by_horizon[h] for h in self.HORIZONS])
            ic0, tau = self._fit_decay(horizons, ic_vals)

            # Recent IC (last 60 trading days)
            ic_full   = self.pipeline.ic_df.get(sig.name, pd.Series())
            ic_recent = ic_full.iloc[-60:].mean() if len(ic_full) >= 60 else ic_full.mean()
            ic_full_m = ic_full.mean()
            ic_vol    = ic_full.std()
            icir      = ic_full_m / ic_vol if ic_vol > 1e-8 else 0.0

            # Status flag
            dying = (abs(ic_recent) < 0.5 * abs(ic_full_m)
                     and abs(ic_full_m) > 0.005)
            noisy = (ic_vol / (abs(ic_full_m) + 1e-8) > 5)
            if dying:
                status = "DYING"
            elif noisy:
                status = "NOISY"
            elif icir > 0.5:
                status = "HEALTHY"
            else:
                status = "WEAK"

            results[sig.name] = {
                "family":    sig.family,
                "ic_by_horizon": ic_by_horizon,
                "ic_0":      ic0,
                "tau":       tau,            # decay half-life (days)
                "optimal_rebal": max(1, int(tau / 2)),
                "ic_full":   ic_full_m,
                "ic_recent": ic_recent,
                "icir":      icir,
                "status":    status,
            }

        return DecayResult(results)

    def _fit_decay(
        self, horizons: np.ndarray, ics: np.ndarray
    ) -> tuple[float, float]:
        """Fit IC(h) = IC_0 * exp(-h/tau). Returns (IC_0, tau)."""
        ic0_guess = abs(ics[0]) if abs(ics[0]) > 1e-6 else 0.05
        try:
            def exp_decay(h, ic0, tau):
                return ic0 * np.exp(-h / max(tau, 0.1))
            popt, _ = curve_fit(
                exp_decay, horizons, ics,
                p0=[ic0_guess, 20.0],
                bounds=([0, 0.1], [1.0, 500.0]),
                maxfev=1000,
            )
            return float(popt[0]), float(popt[1])
        except Exception:
            return float(ic0_guess), 20.0


class DecayResult:
    def __init__(self, results: dict):
        self.results = results

    def print_report(self):
        print("\n" + "═"*70)
        print("  ALPHA DECAY ANALYSIS")
        print("═"*70)
        print(f"  {'Signal':<22} {'τ(d)':>6} {'Rebal':>6} "
              f"{'IC_full':>8} {'IC_now':>8} {'ICIR':>7} {'Status':<10}")
        print("  " + "─"*68)
        for name, r in sorted(self.results.items(),
                               key=lambda x: -x[1]["icir"]):
            status_color = {
                "HEALTHY": "✓", "WEAK": "~",
                "DYING": "!", "NOISY": "?"
            }.get(r["status"], " ")
            print(
                f"  {name:<22} {r['tau']:>6.1f} {r['optimal_rebal']:>6}d "
                f"{r['ic_full']:>8.4f} {r['ic_recent']:>8.4f} "
                f"{r['icir']:>7.3f} {status_color} {r['status']}"
            )

        print("\n  Horizon IC profile (mean IC at each holding period):")
        print(f"  {'Signal':<22} " +
              " ".join(f"{h:>5}d" for h in AlphaDecayAnalyser.HORIZONS))
        print("  " + "─"*60)
        for name, r in self.results.items():
            ics = [r["ic_by_horizon"].get(h, 0)
                   for h in AlphaDecayAnalyser.HORIZONS]
            print(f"  {name:<22} " +
                  " ".join(f"{v:>6.3f}" for v in ics))
        print("═"*70)

    def dying_signals(self) -> list[str]:
        return [n for n, r in self.results.items() if r["status"] == "DYING"]

    def optimal_rebal_freq(self) -> float:
        """Portfolio-level optimal rebalance (weighted by ICIR)."""
        icirs  = np.array([r["icir"] for r in self.results.values()])
        rebals = np.array([r["optimal_rebal"]
                           for r in self.results.values()])
        w = np.clip(icirs, 0, None)
        if w.sum() < 1e-8:
            return 5.0
        return float(np.dot(w, rebals) / w.sum())
