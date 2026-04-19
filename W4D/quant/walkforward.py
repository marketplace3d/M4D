"""
walkforward.py — walk-forward validation engine

Splits history into anchored in-sample / out-of-sample windows,
re-fits the signal pipeline on each IS window, evaluates on OOS,
and aggregates results to produce an honest performance estimate.

Methodology:
  - Expanding IS window (anchored at start) OR rolling IS window
  - Fixed OOS window (e.g. 63 days = 1 quarter)
  - Re-fit: regime classifier, IC tracker weights (signals don't change)
  - OOS metrics: Sharpe, hit-rate, IC, turnover, max DD

Why this matters:
  Standard backtest overfits signal weights to the full history.
  Walk-forward mimics real deployment: you only see history up to
  today, fit your model, then trade the next quarter blind.

Output:
  WalkForwardResult with per-fold and aggregate stats,
  an OOS equity curve stitched from all folds,
  and a Probability of Backtest Overfitting (PBO) estimate.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from core import sharpe, max_drawdown, Regime
from data import Universe
from ensemble import SignalPipeline, RegimeClassifier, ICTracker, EnsembleCombiner
from optimizer import AlphaScaledOptimizer, PortfolioConstraints
from backtester import Backtester, BacktestConfig, TransactionCostModel


@dataclass
class FoldResult:
    fold:        int
    is_start:    pd.Timestamp
    is_end:      pd.Timestamp
    oos_start:   pd.Timestamp
    oos_end:     pd.Timestamp
    oos_returns: pd.Series          # daily OOS returns
    oos_nav:     pd.Series          # daily OOS NAV
    oos_sharpe:  float
    oos_ic:      float              # mean IC across signals in OOS
    oos_hit_rate:float
    oos_max_dd:  float
    oos_turnover:float
    regime_dist: dict               # Regime → pct of OOS days
    n_is_days:   int
    n_oos_days:  int


@dataclass
class WalkForwardResult:
    folds:           list[FoldResult]
    oos_equity:      pd.Series      # stitched OOS NAV
    oos_returns:     pd.Series      # stitched OOS returns
    aggregate_sharpe:float
    aggregate_max_dd:float
    mean_oos_ic:     float
    mean_hit_rate:   float
    pbo_estimate:    float          # probability of backtest overfitting
    is_sharpe:       float          # full IS Sharpe (for comparison)
    degradation:     float          # IS Sharpe − OOS Sharpe (overfit proxy)

    def summary(self) -> str:
        lines = [
            "╔══════════════════════════════════════════════════════╗",
            "║      WALK-FORWARD VALIDATION RESULTS                ║",
            "╠══════════════════════════════════════════════════════╣",
            f"  Folds:              {len(self.folds)}",
            f"  OOS Sharpe:         {self.aggregate_sharpe:.3f}",
            f"  OOS Max Drawdown:   {self.aggregate_max_dd*100:.2f}%",
            f"  Mean OOS IC:        {self.mean_oos_ic:.4f}",
            f"  Hit rate (>0):      {self.mean_hit_rate*100:.1f}%",
            f"  IS Sharpe:          {self.is_sharpe:.3f}",
            f"  IS→OOS degradation: {self.degradation:.3f}",
            f"  PBO estimate:       {self.pbo_estimate*100:.1f}%",
            "╠══════════════════════════════════════════════════════╣",
            "  Per-fold OOS performance:",
            f"  {'Fold':<6} {'OOS period':<22} {'Sharpe':>7} {'IC':>7} "
            f"{'MaxDD':>7} {'HitRate':>8}",
            "  " + "─"*56,
        ]
        for f in self.folds:
            lines.append(
                f"  {f.fold:<6} "
                f"{str(f.oos_start.date())}–{str(f.oos_end.date())}  "
                f"{f.oos_sharpe:>7.3f} "
                f"{f.oos_ic:>7.4f} "
                f"{f.oos_max_dd*100:>6.2f}% "
                f"{f.oos_hit_rate*100:>7.1f}%"
            )
        lines.append("╚══════════════════════════════════════════════════════╝")
        return "\n".join(lines)


class WalkForwardValidator:
    """
    Runs anchored expanding-window walk-forward validation.

    Timeline (anchored, OOS = 63 days):
      IS:  [day 0 .... day 252]    OOS: [253 ... 315]   ← fold 1
      IS:  [day 0 .... day 315]    OOS: [316 ... 378]   ← fold 2
      IS:  [day 0 .... day 378]    OOS: [379 ... 441]   ← fold 3
      ...

    At each fold:
      1. Slice IS sub-universe
      2. Re-fit RegimeClassifier + recompute IC series on IS
      3. Run mini-backtester on OOS using IS-fitted weights
      4. Record OOS metrics

    Probability of Backtest Overfitting (PBO):
      Proportion of folds where OOS Sharpe < median IS Sharpe.
      A value above 50% is a strong warning sign.
    """

    def __init__(
        self,
        min_is_days:  int = 252,     # minimum IS window
        oos_days:     int = 63,      # OOS window per fold (1 quarter)
        rolling_is:   bool = False,  # False = expanding (anchored)
        initial_nav:  float = 1_000_000.0,
    ):
        self.min_is   = min_is_days
        self.oos_len  = oos_days
        self.rolling  = rolling_is
        self.nav      = initial_nav

    def run(
        self,
        universe:     Universe,
        signal_list,
        verbose:      bool = True,
    ) -> WalkForwardResult:

        dates = universe.dates
        n     = len(dates)
        folds: list[FoldResult] = []

        # Generate fold boundaries
        fold_boundaries = []
        oos_start_idx = self.min_is
        while oos_start_idx + self.oos_len <= n:
            is_start_idx  = 0 if not self.rolling else \
                            max(0, oos_start_idx - self.min_is)
            is_end_idx    = oos_start_idx - 1
            oos_end_idx   = min(n - 1, oos_start_idx + self.oos_len - 1)
            fold_boundaries.append(
                (is_start_idx, is_end_idx, oos_start_idx, oos_end_idx))
            oos_start_idx += self.oos_len

        if verbose:
            print(f"  Walk-forward: {len(fold_boundaries)} folds "
                  f"(IS≥{self.min_is}d, OOS={self.oos_len}d each)\n")

        # Full IS backtest Sharpe (for degradation calc)
        full_pipeline = self._fit_pipeline(universe, signal_list,
                                           0, len(dates)-1)
        full_bt = self._run_backtest(universe, full_pipeline, 0, len(dates)-1)
        is_sharpe = sharpe(pd.Series(full_bt.perf.returns))

        # Per-fold OOS evaluation
        all_oos_returns = []

        for fold_num, (is0, is1, oos0, oos1) in enumerate(fold_boundaries, 1):
            if verbose:
                print(f"  Fold {fold_num}/{len(fold_boundaries)}  "
                      f"IS: {dates[is0].date()}–{dates[is1].date()}  "
                      f"OOS: {dates[oos0].date()}–{dates[oos1].date()}")

            # Fit on IS
            pipeline = self._fit_pipeline(universe, signal_list, is0, is1)

            # Run backtest on OOS using IS-fitted pipeline
            bt = self._run_backtest(universe, pipeline, oos0, oos1)

            oos_ret = pd.Series(
                bt.perf.returns,
                index=pd.DatetimeIndex(bt.perf.dates))

            # Regime distribution in OOS
            oos_dates = universe.dates[oos0:oos1+1]
            reg_slice = pipeline.regimes.reindex(oos_dates)
            reg_dist  = reg_slice.value_counts(normalize=True).to_dict()

            # OOS IC (mean across signals)
            ic_slice = pipeline.ic_df.loc[
                dates[oos0]:dates[oos1]].mean().mean()

            hit_rate = (oos_ret > 0).mean()
            oos_nav  = pd.Series(bt.perf.navs,
                                 index=pd.DatetimeIndex(bt.perf.dates))

            fold = FoldResult(
                fold=fold_num,
                is_start=dates[is0], is_end=dates[is1],
                oos_start=dates[oos0], oos_end=dates[oos1],
                oos_returns=oos_ret,
                oos_nav=oos_nav,
                oos_sharpe=sharpe(oos_ret),
                oos_ic=float(ic_slice),
                oos_hit_rate=float(hit_rate),
                oos_max_dd=max_drawdown(oos_nav),
                oos_turnover=sum(abs(f.shares * f.price)
                                 for f in bt.fills_log) /
                              (self.nav * max(1, len(oos_ret))),
                regime_dist={str(k): v for k, v in reg_dist.items()},
                n_is_days=is1 - is0 + 1,
                n_oos_days=oos1 - oos0 + 1,
            )
            folds.append(fold)
            all_oos_returns.extend(oos_ret.tolist())

        # Stitch OOS equity curve
        oos_rets = pd.concat([f.oos_returns for f in folds]).sort_index()
        oos_nav  = (1 + oos_rets).cumprod() * self.nav

        # PBO: fraction of folds where OOS Sharpe < median IS Sharpe
        median_is = np.median([is_sharpe] * len(folds))
        pbo = sum(1 for f in folds if f.oos_sharpe < median_is) / len(folds)

        result = WalkForwardResult(
            folds=folds,
            oos_equity=oos_nav,
            oos_returns=oos_rets,
            aggregate_sharpe=sharpe(oos_rets),
            aggregate_max_dd=max_drawdown(oos_nav),
            mean_oos_ic=float(np.mean([f.oos_ic for f in folds])),
            mean_hit_rate=float(np.mean([f.oos_hit_rate for f in folds])),
            pbo_estimate=pbo,
            is_sharpe=is_sharpe,
            degradation=is_sharpe - sharpe(oos_rets),
        )

        if verbose:
            print()
            print(result.summary())

        return result

    def _fit_pipeline(
        self, universe: Universe, signal_list, is0: int, is1: int
    ) -> SignalPipeline:
        """Build and fit a pipeline on the IS slice."""
        from data import Universe as U
        is_dates = universe.dates[is0:is1+1]

        # Create IS sub-universe (reindex to IS dates)
        sub = Universe(
            prices      = universe.prices.loc[is_dates],
            highs       = universe.highs.loc[is_dates],
            lows        = universe.lows.loc[is_dates],
            volumes     = universe.volumes.loc[is_dates],
            returns     = universe.returns.loc[is_dates],
            fwd_ret_1d  = universe.fwd_ret_1d.loc[is_dates],
            fwd_ret_5d  = universe.fwd_ret_5d.loc[is_dates],
            fwd_ret_21d = universe.fwd_ret_21d.loc[is_dates],
            fundamentals= universe.fundamentals.loc[
                universe.fundamentals.index.get_level_values("date")
                .isin(is_dates)],
            sectors     = universe.sectors,
            market_features = universe.market_features.loc[is_dates],
            dates       = is_dates,
            instruments = universe.instruments,
        )

        pipeline = SignalPipeline(signal_list=signal_list,
                                  ic_half_life=60, fwd_horizon=5)
        pipeline.run(sub, verbose=False)
        return pipeline

    def _run_backtest(
        self, universe: Universe, pipeline: SignalPipeline,
        start_idx: int, end_idx: int,
    ) -> Backtester:
        """Run a mini-backtest on a date slice."""
        oos_dates = universe.dates[start_idx:end_idx+1]

        bt_cfg = BacktestConfig(
            initial_nav    = self.nav,
            rebalance_freq = 5,
            warmup_days    = 0,
            optimizer      = "alpha",
            alpha_pct      = 0.20,
            gross_limit    = 1.4,
            net_limit      = 0.10,
            max_position   = 0.05,
            turnover_limit = 0.35,
            verbose        = False,
            print_freq     = 9999,
        )
        tc = TransactionCostModel(
            commission_pct=0.0005, spread_pct=0.0010,
            market_impact_pct=0.0005, slippage_vol_mult=0.10,
        )

        # Create OOS-only sub-universe (but pipeline was fit on IS)
        # We feed the full universe to the backtester but only loop OOS dates

        class _OOSUniverse:
            """Thin wrapper that exposes only OOS dates to the backtester."""
            def __init__(self, full: Universe, oos_d):
                self.prices    = full.prices.loc[oos_d]
                self.highs     = full.highs.loc[oos_d]
                self.lows      = full.lows.loc[oos_d]
                self.volumes   = full.volumes.loc[oos_d]
                self.returns   = full.returns.loc[oos_d]
                self.fwd_ret_1d = full.fwd_ret_1d.loc[oos_d]
                self.fwd_ret_5d = full.fwd_ret_5d.loc[oos_d]
                self.fwd_ret_21d= full.fwd_ret_21d.loc[oos_d]
                self.fundamentals= full.fundamentals.loc[
                    full.fundamentals.index.get_level_values("date")
                    .isin(oos_d)]
                self.sectors   = full.sectors
                self.market_features = full.market_features.loc[oos_d]
                self.dates     = oos_d
                self.instruments = full.instruments

        oos_univ = _OOSUniverse(universe, oos_dates)

        # Extend pipeline signals + regimes to cover OOS dates
        from signals import compute_all_signals
        import copy
        ext_pipeline = copy.copy(pipeline)
        ext_pipeline.signals = dict(pipeline.signals)

        oos_sigs = compute_all_signals(oos_univ, pipeline.signal_list)
        for name, df in oos_sigs.items():
            existing = ext_pipeline.signals.get(name, pd.DataFrame())
            new_rows = df.loc[~df.index.isin(existing.index)] \
                       if not existing.empty else df
            ext_pipeline.signals[name] = pd.concat(
                [existing, new_rows]).sort_index() \
                if not existing.empty else df

        oos_reg = ext_pipeline.regime_clf.predict(
            universe.market_features.loc[oos_dates])
        new_reg = oos_reg.loc[
            ~oos_reg.index.isin(ext_pipeline.regimes.index)]
        ext_pipeline.regimes = pd.concat(
            [ext_pipeline.regimes, new_reg]).sort_index()

        bt = Backtester(pipeline=ext_pipeline, universe=oos_univ,
                        config=bt_cfg, tc_model=tc)
        bt.run()
        return bt
