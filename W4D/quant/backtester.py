"""
backtester.py — event-driven backtester

Features:
  - Daily rebalancing with configurable frequency
  - Realistic transaction costs (commission + bid-ask spread + market impact)
  - Slippage model (vol-scaled)
  - Position-level P&L tracking
  - Factor attribution (momentum / value / quality / MR contributions)
  - Full performance analytics

Architecture:
  Backtester.run() loops over dates:
    1. Mark positions to market
    2. Update risk monitor
    3. Check circuit breaker
    4. Compute alpha (via SignalPipeline)
    5. Optimise target weights
    6. Pre-trade risk check
    7. Generate orders → fills
    8. Update positions
    9. Record performance
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from core import (PortfolioState, PerformanceRecord, Order, Fill,
                  sharpe, max_drawdown, calmar)
from data import Universe
from ensemble import SignalPipeline
from optimizer import AlphaScaledOptimizer, MeanVarianceOptimizer, PortfolioConstraints
from risk import RiskLimits, PreTradeChecker, RiskMonitor, CircuitBreaker


@dataclass
class TransactionCostModel:
    commission_pct:    float = 0.0005   # 5bps per side
    spread_pct:        float = 0.0010   # 10bps half-spread
    market_impact_pct: float = 0.0005   # 5bps market impact (flat)
    slippage_vol_mult: float = 0.10     # 10% of daily vol as slippage

    def total_cost(self, notional: float, daily_vol: float = 0.02) -> float:
        """Return total cost in $ for a trade of given notional."""
        fixed  = (self.commission_pct + self.spread_pct) * abs(notional)
        impact = self.market_impact_pct * abs(notional)
        slip   = self.slippage_vol_mult * daily_vol * abs(notional)
        return fixed + impact + slip

    def fill_price(self, mid: float, direction: int,
                   daily_vol: float = 0.02) -> float:
        """Adverse fill: buying costs more, selling gets less."""
        slippage = self.slippage_vol_mult * daily_vol * mid
        spread   = self.spread_pct * mid
        return mid + direction * (slippage + spread)


@dataclass
class BacktestConfig:
    initial_nav:       float = 10_000_000.0
    rebalance_freq:    int   = 5          # rebalance every N days
    warmup_days:       int   = 63         # don't trade first N days
    optimizer:         str   = "alpha"    # "alpha" | "mvo" | "risk_parity"
    max_positions:     int   = 40
    alpha_pct:         float = 0.20       # long/short each side
    gross_limit:       float = 1.4
    net_limit:         float = 0.10
    max_position:      float = 0.05
    turnover_limit:    float = 0.35
    verbose:           bool  = True
    print_freq:        int   = 63         # print progress every N days


class Backtester:
    """
    Full event-driven backtester.
    """

    def __init__(
        self,
        pipeline:  SignalPipeline,
        universe:  Universe,
        config:    BacktestConfig | None = None,
        tc_model:  TransactionCostModel | None = None,
        risk_limits: RiskLimits | None = None,
    ):
        self.pipeline  = pipeline
        self.univ      = universe
        self.cfg       = config or BacktestConfig()
        self.tc        = tc_model or TransactionCostModel()
        self.risk_lim  = risk_limits or RiskLimits()

        # Build optimiser
        C = PortfolioConstraints(
            gross_limit=self.cfg.gross_limit,
            net_limit=self.cfg.net_limit,
            max_position=self.cfg.max_position,
            turnover_limit=self.cfg.turnover_limit,
        )
        if self.cfg.optimizer == "mvo":
            self.optimizer = MeanVarianceOptimizer(constraints=C)
        else:
            self.optimizer = AlphaScaledOptimizer(
                alpha_pct=self.cfg.alpha_pct, constraints=C)

        self.pre_trade  = PreTradeChecker(self.risk_lim)
        self.monitor    = RiskMonitor(self.risk_lim)
        self.breaker    = CircuitBreaker()

        # State
        self.nav:        float         = self.cfg.initial_nav
        self.cash:       float         = self.cfg.initial_nav
        self.positions:  dict[str, float] = {}   # shares
        self.cur_weights:pd.Series     = pd.Series(dtype=float)

        # Records
        self.perf:       PerformanceRecord = PerformanceRecord()
        self.fills_log:  list[Fill]     = []
        self.alpha_log:  list[dict]     = []
        self.risk_log:   list[dict]     = []
        self.weight_log: list[pd.Series] = []

    # ── Main loop ────────────────────────────────────────────────────────────

    def run(self) -> "Backtester":
        dates = self.univ.dates
        C = self.cfg

        self.monitor.hwm          = self.nav
        self.monitor.daily_open_nav = self.nav

        for i, date in enumerate(dates):
            prices_today = self.univ.prices.loc[date]

            # ── Mark to market ────────────────────────────────────────
            self._mark_to_market(date, prices_today)

            # ── Risk snapshot ─────────────────────────────────────────
            state = self._build_state(date, prices_today)
            if i == 0:
                self.monitor.set_daily_open(self.nav)

            risk_snap = self.monitor.update(state, self.univ.sectors)
            self.risk_log.append(risk_snap)

            # ── Record performance ────────────────────────────────────
            ret = ((self.nav / self.perf.navs[-1]) - 1) \
                  if self.perf.navs else 0.0
            self.perf.dates.append(date)
            self.perf.navs.append(self.nav)
            self.perf.returns.append(ret)
            self.perf.gross.append(risk_snap["gross"])
            self.perf.net.append(risk_snap["net"])

            if i % C.print_freq == 0 and C.verbose:
                self._print_progress(date, i, len(dates), risk_snap)

            # ── Skip warmup ───────────────────────────────────────────
            if i < C.warmup_days:
                continue

            # ── Rebalance? ────────────────────────────────────────────
            if i % C.rebalance_freq != 0:
                continue

            # ── Circuit breaker ───────────────────────────────────────
            cb_action = self.breaker.evaluate(risk_snap)
            if cb_action == "FLATTEN":
                self._flatten_all(date, prices_today)
                self.monitor.set_daily_open(self.nav)
                continue

            # ── Alpha ─────────────────────────────────────────────────
            alpha = self.pipeline.get_alpha(date, self.univ.sectors)
            if alpha.empty:
                continue

            self.alpha_log.append({"date": date, "alpha": alpha.copy()})

            # ── Covariance (rolling 60d) for MVO ─────────────────────
            cov = None
            if self.cfg.optimizer == "mvo":
                ret_window = self.univ.returns.iloc[max(0, i-60):i]
                if len(ret_window) >= 10:
                    cov = self.optimizer.estimate_cov(ret_window)

            # ── Optimise ──────────────────────────────────────────────
            target_w = self.optimizer.optimise(
                alpha=alpha,
                current_weights=self.cur_weights,
                sectors=self.univ.sectors,
                cov=cov,
            )

            # ── Circuit breaker: scale if REDUCE ─────────────────────
            if cb_action == "REDUCE":
                target_w = self.breaker.apply("REDUCE", target_w, self.cur_weights)

            # ── Pre-trade risk check ──────────────────────────────────
            orders = self._weights_to_orders(date, target_w, prices_today)
            approved, _ = self.pre_trade.check(orders, state)

            # ── Execute fills ─────────────────────────────────────────
            self._execute(date, approved, prices_today)
            self._update_cur_weights(prices_today)
            self.weight_log.append(self.cur_weights.copy())
            self.monitor.set_daily_open(self.nav)

        return self

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _mark_to_market(self, date: pd.Timestamp, prices: pd.Series):
        mkt_value = sum(
            self.positions.get(inst, 0) * prices.get(inst, 0)
            for inst in self.positions
        )
        self.nav = self.cash + mkt_value

    def _build_state(self, date: pd.Timestamp,
                     prices: pd.Series) -> PortfolioState:
        return PortfolioState(
            date=date,
            nav=self.nav,
            cash=self.cash,
            positions=dict(self.positions),
            prices=prices.to_dict(),
        )

    def _weights_to_orders(
        self, date: pd.Timestamp, target_w: pd.Series,
        prices: pd.Series
    ) -> list[Order]:
        orders = []
        all_inst = set(target_w.index) | set(self.cur_weights.index)
        for inst in all_inst:
            tgt = float(target_w.get(inst, 0.0))
            cur = float(self.cur_weights.get(inst, 0.0))
            if abs(tgt - cur) > 0.001:
                orders.append(Order(date, inst, tgt, "rebalance"))
        return orders

    def _execute(self, date: pd.Timestamp, orders: list[Order],
                 prices: pd.Series):
        for order in orders:
            inst  = order.instrument
            price = prices.get(inst)
            if price is None or price <= 0:
                continue

            nav      = self.nav if self.nav > 0 else 1.0
            cur_shr  = self.positions.get(inst, 0.0)
            tgt_shr  = order.target_weight * nav / price
            delta    = tgt_shr - cur_shr

            if abs(delta) < 0.01:
                continue

            direction = 1 if delta > 0 else -1
            vol = self.univ.returns[inst].iloc[-20:].std() \
                  if inst in self.univ.returns.columns else 0.02
            fill_px = self.tc.fill_price(price, direction, vol)
            cost    = self.tc.total_cost(abs(delta) * price, vol)

            self.positions[inst] = cur_shr + delta
            self.cash -= delta * fill_px + cost
            self.nav   = self.cash + sum(
                self.positions.get(k, 0) * prices.get(k, price)
                for k in self.positions
            )

            self.fills_log.append(Fill(
                date=date, instrument=inst,
                shares=delta, price=fill_px, commission=cost,
            ))

    def _update_cur_weights(self, prices: pd.Series):
        nav = self.nav if self.nav > 0 else 1.0
        w = {inst: (shares * prices.get(inst, 0)) / nav
             for inst, shares in self.positions.items()
             if abs(shares) > 0.01}
        self.cur_weights = pd.Series(w)

    def _flatten_all(self, date: pd.Timestamp, prices: pd.Series):
        for inst in list(self.positions.keys()):
            if abs(self.positions[inst]) > 0.01:
                price = prices.get(inst)
                if price and price > 0:
                    proceeds = self.positions[inst] * price
                    cost = self.tc.total_cost(abs(proceeds), 0.02)
                    self.cash += proceeds - cost
            del self.positions[inst]
        self.cur_weights = pd.Series(dtype=float)
        self._mark_to_market(date, prices)

    def _print_progress(self, date, i, total, snap):
        pct  = i / total * 100
        ret  = ((self.nav / self.cfg.initial_nav) - 1) * 100
        dd   = snap["drawdown"] * 100
        print(f"  {date.date()}  {pct:5.1f}%  "
              f"NAV={self.nav/1e6:.3f}M  "
              f"ret={ret:+.1f}%  dd={dd:.1f}%  "
              f"gross={snap['gross']:.2f}x  "
              f"n_pos={snap['n_pos']}")

    # ── Analytics ────────────────────────────────────────────────────────────

    def performance(self) -> "PerformanceAnalytics":
        return PerformanceAnalytics(self)


class PerformanceAnalytics:
    def __init__(self, bt: Backtester):
        self.bt    = bt
        self.df    = bt.perf.to_df()
        self.risk  = bt.monitor.history_df()

    def summary(self) -> pd.DataFrame:
        r   = self.df["ret"].dropna()
        nav = self.df["nav"]

        ann_ret = r.mean() * 252
        ann_vol = r.std() * np.sqrt(252)
        sr      = sharpe(r)
        mdd     = max_drawdown(nav)
        cal     = calmar(r, nav)
        win_rt  = (r > 0).mean()

        fills   = self.bt.fills_log
        total_tc = sum(f.commission for f in fills) if fills else 0
        turnover = sum(abs(f.shares * f.price) for f in fills) / (
                   self.bt.cfg.initial_nav * len(self.df)) if fills else 0

        stats = {
            "Total return":      f"{(nav.iloc[-1]/nav.iloc[0]-1)*100:.2f}%",
            "Ann. return":       f"{ann_ret*100:.2f}%",
            "Ann. volatility":   f"{ann_vol*100:.2f}%",
            "Sharpe ratio":      f"{sr:.3f}",
            "Max drawdown":      f"{mdd*100:.2f}%",
            "Calmar ratio":      f"{cal:.3f}",
            "Win rate":          f"{win_rt*100:.1f}%",
            "Avg daily turnover":f"{turnover*100:.2f}%",
            "Total t-costs ($)": f"${total_tc:,.0f}",
            "Final NAV ($M)":    f"${nav.iloc[-1]/1e6:.3f}M",
            "Trading days":      len(self.df),
        }
        return pd.DataFrame(stats.items(), columns=["Metric", "Value"])

    def ic_table(self) -> pd.DataFrame:
        return self.bt.pipeline.regime_summary()

    def regime_breakdown(self) -> pd.Series:
        counts = self.bt.pipeline.regimes.value_counts()
        return counts / counts.sum()

    def monthly_returns(self) -> pd.DataFrame:
        r = self.df["ret"].copy()
        r.index = pd.to_datetime(r.index)
        monthly = (1 + r).resample("ME").prod() - 1
        tbl = monthly.groupby([monthly.index.year, monthly.index.month]).first()
        tbl.index = pd.MultiIndex.from_tuples(
            tbl.index.tolist(), names=["Year", "Month"])
        return tbl.unstack("Month").round(4)

    def print_report(self):
        print("\n" + "═"*55)
        print("  WORLDQUANT SYSTEM — BACKTEST REPORT")
        print("═"*55)
        print(self.summary().to_string(index=False))
        print("\n  IC / ICIR by signal:")
        print(self.ic_table().to_string())
        print("\n  Regime distribution:")
        for r, pct in self.regime_breakdown().items():
            bar = "█" * int(pct * 30)
            print(f"    {str(r.value):<14} {pct*100:5.1f}%  {bar}")
        print("═"*55)
