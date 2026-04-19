"""
risk.py — risk management layer

Pre-trade checks, real-time risk monitoring, circuit breakers.

Components:
  RiskLimits       : parameter container
  PreTradeChecker  : validates orders before execution
  RiskMonitor      : tracks live P&L, drawdown, exposure
  CircuitBreaker   : automatic de-lever and kill-switch
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from core import PortfolioState, Order


@dataclass
class RiskLimits:
    # Exposure
    max_gross_exposure:  float = 1.60   # × NAV
    max_net_exposure:    float = 0.15   # × NAV
    max_single_name:     float = 0.06   # × NAV per instrument
    max_sector_gross:    float = 0.25   # × NAV per sector

    # Drawdown / loss
    max_drawdown_pct:    float = 0.10   # 10% from HWM → reduce
    kill_drawdown_pct:   float = 0.15   # 15% from HWM → full exit
    daily_loss_reduce:   float = 0.015  # 1.5% daily → cut 50%
    daily_loss_kill:     float = 0.030  # 3.0% daily → flatten

    # Liquidity
    max_adv_pct:         float = 0.05   # max 5% of ADV per instrument

    # VaR (parametric, 1d 99%)
    max_var_pct:         float = 0.025  # 2.5% NAV

    # Turnover
    max_daily_turnover:  float = 0.40   # 40% one-way per day


class PreTradeChecker:
    """
    Validates and potentially modifies orders before they reach execution.
    Returns (approved_orders, rejected_reasons).
    """

    def __init__(self, limits: RiskLimits | None = None):
        self.limits = limits or RiskLimits()

    def check(
        self,
        orders:    list[Order],
        state:     PortfolioState,
        sectors:   pd.Series | None = None,
        adv:       pd.Series | None = None,   # avg daily volume $ per inst
    ) -> tuple[list[Order], list[dict]]:
        approved, rejected = [], []
        L = self.limits
        nav = state.nav if state.nav > 0 else 1.0

        for order in orders:
            inst = order.instrument
            tgt  = order.target_weight
            reason = None

            # ── Single-name check ────────────────────────────────────
            if abs(tgt) > L.max_single_name:
                tgt = np.sign(tgt) * L.max_single_name
                reason = f"single_name_cap: clipped to {tgt:.3f}"

            # ── ADV check ────────────────────────────────────────────
            if adv is not None and inst in adv.index:
                notional = abs(tgt) * nav
                if adv[inst] > 0 and notional / adv[inst] > L.max_adv_pct:
                    max_notional = adv[inst] * L.max_adv_pct
                    tgt = np.sign(tgt) * max_notional / nav
                    reason = f"adv_cap: clipped to {tgt:.3f}"

            # ── Gross exposure check (portfolio level) ────────────────
            current_w  = state.weights()
            cur_gross  = sum(abs(v) for v in current_w.values())
            order_delta = abs(tgt) - abs(current_w.get(inst, 0.0))
            if cur_gross + order_delta > L.max_gross_exposure:
                rejected.append({"order": order,
                                  "reason": "gross_exposure_limit"})
                continue

            mod_order = Order(order.date, inst, tgt,
                              reason or order.reason)
            approved.append(mod_order)

        return approved, rejected


class RiskMonitor:
    """
    Tracks portfolio risk metrics in real time.
    Updated once per bar.
    """

    def __init__(self, limits: RiskLimits | None = None):
        self.limits  = limits or RiskLimits()
        self.hwm:    float = 0.0          # high-water mark NAV
        self.daily_open_nav: float = 0.0  # NAV at start of today
        self._history: list[dict] = []

    def update(self, state: PortfolioState,
               sectors: pd.Series | None = None) -> dict:
        """
        Update risk metrics and return current risk snapshot.
        """
        L    = self.limits
        nav  = state.nav

        # High-water mark
        if nav > self.hwm:
            self.hwm = nav
        drawdown = (nav - self.hwm) / self.hwm if self.hwm > 0 else 0.0

        # Exposure
        gross = state.gross_exposure() / nav if nav > 0 else 0.0
        net   = state.net_exposure()   / nav if nav > 0 else 0.0

        # Daily P&L
        daily_pnl = (nav - self.daily_open_nav) / self.daily_open_nav \
                    if self.daily_open_nav > 0 else 0.0

        # Sector concentration
        sec_gross = {}
        if sectors is not None:
            weights = state.weights()
            for sec in sectors.unique():
                in_sec = [abs(weights.get(inst, 0.0))
                          for inst in sectors[sectors == sec].index]
                sec_gross[sec] = sum(in_sec)

        # Parametric VaR (1d 99%, assume 15% ann vol of portfolio)
        port_vol_daily = 0.15 / np.sqrt(252)
        var_99 = 2.326 * port_vol_daily * gross   # scaled by exposure

        snap = {
            "date":      state.date,
            "nav":       nav,
            "drawdown":  round(drawdown, 4),
            "gross":     round(gross, 4),
            "net":       round(net, 4),
            "daily_pnl": round(daily_pnl, 4),
            "var_99":    round(var_99, 4),
            "hwm":       round(self.hwm, 2),
            "n_pos":     sum(1 for v in state.positions.values() if abs(v) > 0),
            "alerts":    [],
        }

        # ── Alert generation ─────────────────────────────────────────
        if drawdown < -L.max_drawdown_pct:
            snap["alerts"].append("DRAWDOWN_REDUCE")
        if drawdown < -L.kill_drawdown_pct:
            snap["alerts"].append("DRAWDOWN_KILL")
        if daily_pnl < -L.daily_loss_reduce:
            snap["alerts"].append("DAILY_LOSS_REDUCE")
        if daily_pnl < -L.daily_loss_kill:
            snap["alerts"].append("DAILY_LOSS_KILL")
        if gross > L.max_gross_exposure:
            snap["alerts"].append("GROSS_EXPOSURE")
        if var_99 > L.max_var_pct:
            snap["alerts"].append("VAR_BREACH")

        self._history.append(snap)
        return snap

    def set_daily_open(self, nav: float):
        self.daily_open_nav = nav

    def history_df(self) -> pd.DataFrame:
        if not self._history:
            return pd.DataFrame()
        df = pd.DataFrame(self._history).set_index("date")
        return df


class CircuitBreaker:
    """
    Translates risk alerts → position scaling actions.

    Actions returned:
      "HOLD"   : no change
      "REDUCE" : scale all positions by 50%
      "FLATTEN": close all positions immediately
    """

    def evaluate(self, snap: dict) -> str:
        alerts = snap.get("alerts", [])
        if "DRAWDOWN_KILL" in alerts or "DAILY_LOSS_KILL" in alerts:
            return "FLATTEN"
        if "DRAWDOWN_REDUCE" in alerts or "DAILY_LOSS_REDUCE" in alerts:
            return "REDUCE"
        return "HOLD"

    def apply(
        self,
        action:          str,
        target_weights:  pd.Series,
        current_weights: pd.Series,
    ) -> pd.Series:
        if action == "FLATTEN":
            return pd.Series(0.0, index=target_weights.index)
        if action == "REDUCE":
            return target_weights * 0.5
        return target_weights
