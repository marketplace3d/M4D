"""
ds_app/ibkr_paper.py — IBKR Paper Trading Adapter

Connects Delta Ops + HALO + MTF + OBI to Interactive Brokers paper account.
Uses ib_insync (sync wrapper around IBKR TWS/IB Gateway API).

SETUP:
  1. Open TWS or IB Gateway → set to PAPER account
  2. TWS: API Settings → Enable ActiveX/Socket client → port 7497
     IB Gateway: port 4002
  3. Add 127.0.0.1 to trusted IPs in TWS/Gateway settings
  4. Set env vars (optional overrides):
       IBKR_HOST=127.0.0.1  IBKR_PORT=7497  IBKR_CLIENT_ID=10

WHAT IBKR SUPPORTS vs ALPACA:
  Crypto     → Paxos (BTC/ETH/SOL/LTC via PAXOS exchange)
  Stocks     → NYSE/NASDAQ (SMART routing)
  ES Futures → CME (NQ, RTY, ES, GC, CL)
  Options    → SMART
  Forex      → IDEALPRO

CYCLE (run_cycle, every 5m):
  Same pipeline as alpaca_paper: bars→score→gates→CIS→HALO→MTF→OBI→order
  IBKR positions are read from TWS (not local DB) — ground truth is the broker.
  Trade log still written to ibkr_trades.db (local SQLite for analysis).

ASSET CLASSES:
  PAPER_MODE=CRYPTO  → BTC/ETH/SOL via Paxos
  PAPER_MODE=FUTURES → ES/NQ micro-futures (MES/MNQ)
  PAPER_MODE=STOCKS  → top liquid US stocks (list from scanner.py)
  Default: CRYPTO (matches existing signal infrastructure)
"""
from __future__ import annotations

import json
import logging
import os
import random
import sqlite3
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

log = logging.getLogger("ibkr_paper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

# ── Config ─────────────────────────────────────────────────────────────────────

IBKR_HOST  = os.getenv("IBKR_HOST",      "127.0.0.1")
IBKR_PORT  = int(os.getenv("IBKR_PORT",  "7497"))       # TWS paper=7497, Gateway paper=4002
CLIENT_ID  = int(os.getenv("IBKR_CLIENT_ID", "10"))
TIMEOUT    = 10   # seconds to wait for TWS responses

ASSET_MODE = os.getenv("IBKR_ASSET", "CRYPTO").upper()  # CRYPTO | FUTURES | STOCKS
LOT_PCT    = float(os.getenv("PAPER_LOT_PCT", "0.05"))

TRADES_DB  = _DS_ROOT / "data" / "ibkr_trades.db"

from ds_app.delta_ops   import PADAWAN, NORMAL, EUPHORIA, MAX, ModeConfig, compute_cis, _accel_state
from ds_app.halo_mode   import halo_entry, halo_exit, HALO
from ds_app.alpaca_paper import (
    load_bars, score_symbol, check_gates, _init_db, _log_trade, _log_cycle, MODES,
)


def _lot_usd(equity: float, lot_fraction: float, mode: ModeConfig) -> float:
    """Returns USD dollar value for a lot (used as cashQty for crypto)."""
    return round(equity * LOT_PCT * mode.kelly_mult * lot_fraction, 2)


def _lot_qty(equity: float, lot_fraction: float, price: float, mode: ModeConfig) -> float:
    """Returns asset quantity for stocks/futures."""
    usd = _lot_usd(equity, lot_fraction, mode)
    return max(usd / price, 1e-6) if price > 0 else 0.0

MODES_MAP: dict[str, ModeConfig] = {
    "PADAWAN": PADAWAN, "NORMAL": NORMAL, "EUPHORIA": EUPHORIA, "MAX": MAX,
}


# ── IBKR contract factory ──────────────────────────────────────────────────────

def make_contract(symbol: str, asset_mode: str):
    """Returns ib_insync Contract for the given symbol + asset mode."""
    from ib_insync import Crypto, Stock, Future, ContFuture

    if asset_mode == "CRYPTO":
        # IBKR crypto via Paxos: symbol is BTC/ETH/SOL/LTC
        # Note: IBKR does NOT support all Alpaca crypto — check availability
        _CRYPTO_EXCHANGE = {
            "BTC": ("BTC", "PAXOS", "USD"),
            "ETH": ("ETH", "PAXOS", "USD"),
            "SOL": ("SOL", "PAXOS", "USD"),
            "LTC": ("LTC", "PAXOS", "USD"),
        }
        if symbol not in _CRYPTO_EXCHANGE:
            return None
        sym, exch, curr = _CRYPTO_EXCHANGE[symbol]
        return Crypto(sym, exch, curr)

    elif asset_mode == "FUTURES":
        # Micro-futures on CME
        _FUTURES = {
            "ES":  ("MES", "CME",   "USD"),   # Micro E-mini S&P
            "NQ":  ("MNQ", "CME",   "USD"),   # Micro NASDAQ
            "RTY": ("M2K", "CME",   "USD"),   # Micro Russell
            "GC":  ("MGC", "COMEX", "USD"),   # Micro Gold
            "CL":  ("MCL", "NYMEX", "USD"),   # Micro Crude
        }
        if symbol not in _FUTURES:
            return None
        sym, exch, curr = _FUTURES[symbol]
        return ContFuture(sym, exch, currency=curr)

    elif asset_mode == "STOCKS":
        return Stock(symbol, "SMART", "USD")

    return None


# ── IBKR session (connect → do work → disconnect) ─────────────────────────────

class IBKRSession:
    """Context manager: connect on enter, disconnect on exit."""

    def __init__(self, host=IBKR_HOST, port=IBKR_PORT, client_id=CLIENT_ID):
        import asyncio
        try:
            asyncio.get_event_loop()
        except RuntimeError:
            asyncio.set_event_loop(asyncio.new_event_loop())
        from ib_insync import IB
        self.ib = IB()
        self._host = host
        self._port = port
        self._cid  = client_id

    def __enter__(self) -> "IBKRSession":
        self.ib.connect(self._host, self._port, clientId=self._cid, timeout=TIMEOUT)
        if not self.ib.isConnected():
            raise ConnectionError(f"TWS/Gateway not reachable at {self._host}:{self._port}")
        log.info("IBKR connected: %s:%s  account=%s",
                 self._host, self._port, self.ib.managedAccounts())
        return self

    def __exit__(self, *_):
        if self.ib.isConnected():
            self.ib.disconnect()

    # ── Account ──────────────────────────────────────────────────────────────

    def equity(self) -> float:
        """Returns net liquidation value in account base currency."""
        summary = self.ib.accountSummary()
        # Prefer BASE currency first, then any non-empty currency
        for currency in ("USD", "EUR", "GBP", "BASE", ""):
            for item in summary:
                if item.tag == "NetLiquidation" and item.currency == currency:
                    try:
                        return float(item.value)
                    except ValueError:
                        pass
        return 0.0

    def base_currency(self) -> str:
        summary = self.ib.accountSummary()
        for item in summary:
            if item.tag == "NetLiquidation" and float(item.value or 0) > 0:
                return item.currency
        return "USD"

    def account_summary(self) -> dict:
        summary = self.ib.accountSummary()
        tags = ("NetLiquidation", "TotalCashValue", "UnrealizedPnL", "RealizedPnL",
                "BuyingPower", "GrossPositionValue", "AvailableFunds", "ExcessLiquidity")
        out: dict[str, float] = {}
        for item in summary:
            if item.tag in tags:
                try:
                    val = float(item.value)
                    if val != 0 or item.tag not in out:
                        out[f"{item.tag}_{item.currency}"] = val
                        if item.tag not in out:
                            out[item.tag] = val
                except ValueError:
                    pass
        return out

    # ── Positions ─────────────────────────────────────────────────────────────

    def positions(self) -> list[dict]:
        out = []
        for pos in self.ib.positions():
            out.append({
                "symbol":   pos.contract.symbol,
                "asset":    pos.contract.secType,
                "exchange": pos.contract.exchange,
                "qty":      float(pos.position),
                "avg_cost": float(pos.avgCost),
            })
        return out

    def position_qty(self, symbol: str) -> float:
        for p in self.ib.positions():
            if p.contract.symbol == symbol:
                return float(p.position)
        return 0.0

    # ── Market data ───────────────────────────────────────────────────────────

    def live_price(self, contract) -> float | None:
        self.ib.qualifyContracts(contract)
        ticker = self.ib.reqMktData(contract, "", False, False)
        self.ib.sleep(1.5)
        price = ticker.last or ticker.close or ticker.bid
        self.ib.cancelMktData(contract)
        return float(price) if price and price > 0 else None

    # ── Orders ────────────────────────────────────────────────────────────────

    def place_market(self, contract, qty: float, side: str,
                     usd_value: float | None = None) -> dict:
        """
        Place a market order.
        For IBKR crypto (Paxos): qty is ignored — use usd_value instead (cashQty).
        For stocks/futures: qty is number of shares/contracts.
        """
        from ib_insync import MarketOrder, Order
        self.ib.qualifyContracts(contract)
        action = "BUY" if side == "buy" else "SELL"

        is_crypto  = getattr(contract, "secType", "") == "CRYPTO"
        is_futures = getattr(contract, "secType", "") in ("FUT", "CONTFUT")

        order = Order()
        order.action     = action
        order.orderType  = "MKT"
        order.tif        = "DAY"                        # TWS prefers DAY over GTC for MKT
        order.outsideRth = True                         # allow pre/post-market + futures OTC

        if is_crypto and usd_value is not None:
            order.cashQty = round(usd_value, 2)
        else:
            order.totalQuantity = abs(qty)

        trade = self.ib.placeOrder(contract, order)
        self.ib.sleep(1.5)
        return {
            "orderId":   trade.order.orderId,
            "status":    trade.orderStatus.status,
            "symbol":    contract.symbol,
            "action":    action,
            "qty":       abs(qty),
            "usd_value": usd_value,
        }

    def close_position(self, contract, qty: float,
                       usd_value: float | None = None) -> dict:
        from ib_insync import Order
        self.ib.qualifyContracts(contract)
        action     = "SELL" if qty > 0 else "BUY"
        is_crypto  = getattr(contract, "secType", "") == "CRYPTO"

        order = Order()
        order.action          = action
        order.orderType       = "MKT"
        order.tif             = "DAY"
        order.outsideRth      = True
        if is_crypto and usd_value is not None:
            order.cashQty     = round(abs(usd_value), 2)
        else:
            order.totalQuantity = abs(qty)

        trade = self.ib.placeOrder(contract, order)
        self.ib.sleep(1.5)
        return {
            "orderId": trade.order.orderId,
            "status":  trade.orderStatus.status,
            "symbol":  contract.symbol,
            "action":  action,
            "qty":     abs(qty),
        }


# ── IBKR historical bars → DataFrame ──────────────────────────────────────────

def _fetch_ibkr_bars(sess: "IBKRSession", contract, bar_count: int = 400) -> "pd.DataFrame | None":
    """Pull 5m bars from IBKR historical data and return a DataFrame compatible with score_symbol()."""
    import pandas as pd
    try:
        sess.ib.qualifyContracts(contract)
        raw = sess.ib.reqHistoricalData(
            contract,
            endDateTime="",
            durationStr="3 D",
            barSizeSetting="5 mins",
            whatToShow="TRADES",
            useRTH=False,
            formatDate=1,
        )
        if not raw:
            return None
        df = pd.DataFrame([{
            "ts":     b.date,
            "Open":   float(b.open),
            "High":   float(b.high),
            "Low":    float(b.low),
            "Close":  float(b.close),
            "Volume": float(b.volume),
        } for b in raw])
        df["ts"] = pd.to_datetime(df["ts"], utc=True)
        df = df.sort_values("ts").reset_index(drop=True)
        return df.tail(bar_count).reset_index(drop=True)
    except Exception as exc:
        log.warning("_fetch_ibkr_bars %s: %s", getattr(contract, "symbol", "?"), exc)
        return None


# ── Symbols by asset mode ──────────────────────────────────────────────────────

_SYMBOLS: dict[str, list[str]] = {
    "CRYPTO":  os.getenv("IBKR_SYMBOLS", "BTC,ETH,SOL").split(","),
    "FUTURES": os.getenv("IBKR_SYMBOLS", "ES,NQ").split(","),
    "STOCKS":  os.getenv("IBKR_SYMBOLS", "AAPL,MSFT,NVDA,TSLA,META").split(","),
}

# DB symbol → futures.db short form for bar loading
_FUTURES_TO_DB = {"ES": "ES", "NQ": "NQ", "RTY": "RTY", "GC": "GC", "CL": "CL"}
_STOCKS_TO_DB  = {}   # stocks not in futures.db — live price only


# ── Main cycle ─────────────────────────────────────────────────────────────────

@dataclass
class CycleResult:
    ts: str
    mode: str
    asset_mode: str
    symbols_scored: int
    entries: list[dict]  = field(default_factory=list)
    exits:   list[dict]  = field(default_factory=list)
    scales:  list[dict]  = field(default_factory=list)
    skips:   list[dict]  = field(default_factory=list)
    errors:  list[str]   = field(default_factory=list)


def run_cycle(
    mode_name:  str  = "PADAWAN",
    asset_mode: str  = ASSET_MODE,
    dry_run:    bool = False,
) -> dict:
    mode_name  = mode_name.upper()
    asset_mode = asset_mode.upper()
    mode       = MODES_MAP.get(mode_name, PADAWAN)
    symbols    = [s.strip() for s in _SYMBOLS.get(asset_mode, [])]

    now    = datetime.now(timezone.utc).isoformat(timespec="seconds")
    result = CycleResult(ts=now, mode=mode_name, asset_mode=asset_mode,
                         symbols_scored=len(symbols))
    db     = _init_db(TRADES_DB)

    def _order_args(equity: float, lot_frac: float, price: float,
                    mode: ModeConfig, is_crypto: bool) -> dict:
        """Returns kwargs for sess.place_market() / sess.close_position()."""
        if is_crypto:
            return {"qty": 0, "usd_value": _lot_usd(equity, lot_frac, mode)}
        return {"qty": _lot_qty(equity, lot_frac, price, mode), "usd_value": None}

    try:
        with IBKRSession() as sess:
            equity = sess.equity()
            if equity <= 0:
                result.errors.append("Could not read equity from TWS")
                return asdict(result)
            log.info("Account equity: %.2f", equity)

            for raw_sym in symbols:
                try:
                    # ── Get bars + score ──────────────────────────────────────
                    db_sym = (
                        raw_sym if asset_mode == "CRYPTO"
                        else _FUTURES_TO_DB.get(raw_sym, raw_sym)
                    )
                    df = load_bars(db_sym)

                    if df is None and asset_mode == "FUTURES":
                        # Pull bars directly from IBKR historical data
                        contract_pre = make_contract(raw_sym, asset_mode)
                        if contract_pre is not None:
                            df = _fetch_ibkr_bars(sess, contract_pre)
                    if df is None and asset_mode == "STOCKS":
                        result.skips.append({"symbol": raw_sym, "reason": "NO_BARS"})
                        continue

                    if df is None:
                        result.errors.append(f"{raw_sym}: no bars")
                        continue

                    sc = score_symbol(df)
                    gates_pass, killed = check_gates(sc, mode)

                    # ── Jitter countdown ──────────────────────────────────────
                    row = db.execute(
                        "SELECT * FROM positions WHERE symbol=?", (raw_sym,)
                    ).fetchone()
                    if row and row["jitter_bars_left"] > 0:
                        db.execute(
                            "UPDATE positions SET jitter_bars_left=jitter_bars_left-1 WHERE symbol=?",
                            (raw_sym,),
                        )
                        db.commit()
                        result.skips.append({"symbol": raw_sym, "reason": "HALO_JITTER"})
                        _log_cycle(db, now, raw_sym, sc, gates_pass, "JITTER_WAIT")
                        continue

                    contract = make_contract(raw_sym, asset_mode)
                    if contract is None:
                        result.errors.append(f"{raw_sym}: unsupported in {asset_mode}")
                        continue

                    ibkr_qty  = sess.position_qty(raw_sym)
                    is_crypto = (asset_mode == "CRYPTO")

                    if ibkr_qty != 0 or (row and row["lots_in"] > 0):
                        # ── OPEN: CIS check ───────────────────────────────────
                        lots_in = row["lots_in"] if row else abs(ibkr_qty)
                        import numpy as np
                        scores_arr = np.zeros(len(df))
                        regimes_arr = np.full(len(df), sc["regime"], dtype=object)
                        scores_arr[-1] = sc["soft_score"]

                        _df_cis = df.copy()
                        _df_cis["jedi_raw"] = sc["jedi_raw"]
                        _df_cis["squeeze"]  = int(sc["squeeze"])
                        _df_cis["atr_rank"] = sc["atr_rank"]

                        cis_total, cis_flags = compute_cis(
                            idx          = len(df) - 1,
                            df           = _df_cis,
                            scores       = scores_arr,
                            regimes      = regimes_arr,
                            entry_regime = row["entry_regime"] if row else sc["regime"],
                            entry_jedi   = row["entry_jedi"]   if row else sc["jedi_raw"],
                            entry_score  = row["entry_score"]  if row else sc["soft_score"],
                            mode         = mode,
                        )

                        accel = _accel_state(
                            len(df) - 1,
                            np.array([sc["soft_score"]] * len(df)),
                            np.array([sc["rvol_now"]]   * len(df)),
                            mode.accel_bars,
                        )

                        if cis_total >= mode.cis_threshold:
                            lots_now, exit_note = halo_exit(cis_total, lots_in)
                            exit_usd = _lot_usd(equity, lots_now, mode)
                            if not dry_run and ibkr_qty != 0:
                                sess.close_position(contract, ibkr_qty,
                                                    usd_value=exit_usd if is_crypto else None)
                            pnl = 0.0
                            if row:
                                entry_usd = _lot_usd(equity, row["lots_in"], mode)
                                pnl = (entry_usd * (sc["price"] / row["entry_price"] - 1)
                                       if ibkr_qty >= 0
                                       else entry_usd * (1 - sc["price"] / row["entry_price"]))
                            db.execute("DELETE FROM positions WHERE symbol=?", (raw_sym,))
                            _log_trade(db, now, raw_sym, "EXIT",
                                       "sell" if ibkr_qty >= 0 else "buy",
                                       abs(ibkr_qty), sc["price"], lots_in, mode_name,
                                       round(pnl, 2), f"CIS={cis_total} {exit_note}")
                            result.exits.append({
                                "symbol": raw_sym, "cis": cis_total, "flags": cis_flags,
                                "pnl_usd": round(pnl, 2),
                            })
                            _log_cycle(db, now, raw_sym, sc, gates_pass, f"EXIT_CIS_{cis_total}")

                        elif accel == "DECEL" and lots_in > 0.5:
                            scale_lot = round(random.uniform(HALO.scale_lot_min, HALO.scale_lot_max), 2)
                            oa        = _order_args(equity, scale_lot, sc["price"], mode, is_crypto)
                            if not dry_run and ibkr_qty != 0:
                                close_side = "sell" if ibkr_qty > 0 else "buy"
                                sess.place_market(contract, oa["qty"], close_side,
                                                  usd_value=oa["usd_value"])
                            new_lots = max(lots_in - scale_lot, 0)
                            if row:
                                db.execute("UPDATE positions SET lots_in=? WHERE symbol=?",
                                           (new_lots, raw_sym))
                            _log_trade(db, now, raw_sym, "SCALE_OUT",
                                       "sell" if ibkr_qty > 0 else "buy",
                                       oa["qty"] or oa["usd_value"],
                                       sc["price"], scale_lot, mode_name, 0.0, "DECEL")
                            result.scales.append({
                                "symbol": raw_sym, "action": "SCALE_OUT", "lots": new_lots,
                            })
                            _log_cycle(db, now, raw_sym, sc, gates_pass, "SCALE_OUT")

                        elif accel == "ACCEL" and lots_in < mode.max_lots:
                            scale_lot  = round(random.uniform(HALO.scale_lot_min, HALO.scale_lot_max), 2)
                            new_lots   = min(lots_in + scale_lot, mode.max_lots)
                            add_frac   = new_lots - lots_in
                            oa         = _order_args(equity, add_frac, sc["price"], mode, is_crypto)
                            entry_side = "buy" if (ibkr_qty or 0) >= 0 else "sell"
                            if not dry_run:
                                sess.place_market(contract, oa["qty"], entry_side,
                                                  usd_value=oa["usd_value"])
                            if row:
                                db.execute("UPDATE positions SET lots_in=? WHERE symbol=?",
                                           (new_lots, raw_sym))
                            _log_trade(db, now, raw_sym, "SCALE_IN", entry_side,
                                       oa["qty"] or oa["usd_value"],
                                       sc["price"], add_frac, mode_name, 0.0, "ACCEL")
                            result.scales.append({
                                "symbol": raw_sym, "action": "SCALE_IN", "lots": new_lots,
                            })
                            _log_cycle(db, now, raw_sym, sc, gates_pass, "SCALE_IN")
                        else:
                            _log_cycle(db, now, raw_sym, sc, gates_pass, "HOLD")

                    else:
                        # ── FLAT: entry check ─────────────────────────────────
                        if not gates_pass:
                            result.skips.append({"symbol": raw_sym, "killed_by": killed})
                            _log_cycle(db, now, raw_sym, sc, gates_pass,
                                       f"GATE_KILL:{','.join(killed)}")
                            continue

                        if sc["soft_score"] < mode.entry_thr:
                            result.skips.append({
                                "symbol": raw_sym, "reason": "SCORE_LOW",
                                "score": sc["soft_score"],
                            })
                            _log_cycle(db, now, raw_sym, sc, gates_pass, "SCORE_LOW")
                            continue

                        # HALO entry
                        halo_dec = halo_entry(sc["soft_score"], sc["jedi_raw"], mode_name)
                        if halo_dec.action == "SKIP":
                            result.skips.append({"symbol": raw_sym, "reason": "HALO_SKIP"})
                            _log_cycle(db, now, raw_sym, sc, gates_pass, "HALO_SKIP")
                            continue

                        side = "buy" if sc["jedi_raw"] >= 0 else "sell"

                        # ICT session gate (T1-B) — FUTURES/STOCKS only
                        if asset_mode in ("FUTURES", "STOCKS"):
                            try:
                                from ds_app.alpaca_paper import session_gate
                                _utc_now   = datetime.now(timezone.utc)
                                _utc_mins  = _utc_now.hour * 60 + _utc_now.minute
                                _allowed, _slabel = session_gate(_utc_mins)
                                if not _allowed:
                                    result.skips.append({"symbol": raw_sym, "reason": f"SESSION_{_slabel}"})
                                    _log_cycle(db, now, raw_sym, sc, gates_pass, f"SESSION_KILL:{_slabel}")
                                    continue
                            except Exception:
                                pass

                        # DR/IDR zone gate (T1-C)
                        try:
                            from ds_app.target_levels import dr_entry_allowed
                            if not dr_entry_allowed(raw_sym):
                                result.skips.append({"symbol": raw_sym, "reason": "IDR_TRAP"})
                                _log_cycle(db, now, raw_sym, sc, gates_pass, "IDR_TRAP")
                                continue
                        except Exception:
                            pass

                        # MTF filter
                        mtf_result, mtf_mult = "NEUTRAL", 0.75
                        try:
                            from ds_app.mtf_confirm import mtf_confirm
                            mtf_result, mtf_mult = mtf_confirm(db_sym, side)
                        except Exception:
                            pass

                        # OBI hard gate (T1-A)
                        direction_vote = 1 if side == "buy" else -1
                        obi_vote = 0
                        try:
                            from ds_app.obi_signal import get_obi
                            obi_vote = get_obi(raw_sym).get("vote", 0)
                        except Exception:
                            pass
                        if obi_vote != 0 and obi_vote != direction_vote:
                            result.skips.append({"symbol": raw_sym, "reason": "OBI_GATE"})
                            _log_cycle(db, now, raw_sym, sc, gates_pass, "OBI_GATE")
                            continue
                        if obi_vote == direction_vote:
                            mtf_mult = min(mtf_mult * 1.15, 1.5)
                            mtf_result = f"{mtf_result}+OBI_ALIGNED"

                        # Cross-asset regime multiplier (P2-C)
                        ca_mult, ca_regime = 1.0, "UNKNOWN"
                        try:
                            from ds_app.cross_asset import cross_asset_mult
                            ca_mult, ca_regime = cross_asset_mult()
                        except Exception:
                            pass

                        # Liquidity capacity cap (P3-C)
                        cap_frac = 1.0
                        try:
                            from ds_app.capacity_model import cap_lot_fraction
                            cap_frac = cap_lot_fraction(raw_sym, equity, LOT_PCT)
                        except Exception:
                            pass

                        # Open Interest signal mult
                        oi_mult = 1.0
                        try:
                            from ds_app.oi_signal import get_oi_mult
                            oi_mult = get_oi_mult(raw_sym)
                        except Exception:
                            pass

                        # Fear & Greed contrarian mult
                        fng_mult = 1.0
                        try:
                            from ds_app.fear_greed import get_fng_mult
                            fng_mult = get_fng_mult()
                        except Exception:
                            pass

                        # Liquidation pressure mult
                        liq_mult = 1.0
                        try:
                            from ds_app.liquidations import get_liq_mult
                            liq_mult = get_liq_mult(raw_sym)
                        except Exception:
                            pass

                        # Level stack mult — PWH/PDH/DR confluence (T1-C)
                        lvl_mult = 1.0
                        try:
                            from ds_app.target_levels import level_stack_mult
                            lvl_mult = level_stack_mult(raw_sym)
                        except Exception:
                            pass

                        # VWAP deviation size mult (T3-A)
                        vwap_mult = 1.0
                        try:
                            from ds_app.vwap_signal import get_vwap_status, vwap_size_mult
                            _vs = get_vwap_status(raw_sym)
                            vwap_mult = vwap_size_mult(
                                _vs.get("vwap_bias", "AT_VWAP"), side,
                                _vs.get("vwap_dev_pct", 0.0)
                            )
                        except Exception:
                            pass

                        eff_lot = round(
                            halo_dec.lot_fraction * mtf_mult * ca_mult * cap_frac
                            * oi_mult * fng_mult * liq_mult * lvl_mult * vwap_mult, 3
                        )
                        oa      = _order_args(equity, eff_lot, sc["price"], mode, is_crypto)

                        if not dry_run:
                            sess.place_market(contract, oa["qty"], side,
                                              usd_value=oa["usd_value"])

                        db.execute("""
                            INSERT OR REPLACE INTO positions
                            (symbol, side, entry_ts, entry_price, entry_score, entry_regime,
                             entry_jedi, lots_in, mode, jitter_bars_left)
                            VALUES (?,?,?,?,?,?,?,?,?,?)
                        """, (raw_sym, side, now, sc["price"], sc["soft_score"],
                              sc["regime"], sc["jedi_raw"], eff_lot, mode_name,
                              halo_dec.delay_bars))

                        if halo_dec.split_remainder > 0 and not dry_run:
                            sp = _order_args(equity, halo_dec.split_remainder,
                                            sc["price"], mode, is_crypto)
                            sess.place_market(contract, sp["qty"], side,
                                              usd_value=sp["usd_value"])

                        _log_trade(db, now, raw_sym, "ENTRY", side,
                                   oa["qty"] or oa["usd_value"], sc["price"],
                                   eff_lot, mode_name, 0.0,
                                   f"score={sc['soft_score']:.3f} regime={sc['regime']} mtf={mtf_result} "
                                   f"ca={ca_regime} oi={oi_mult:.2f} fng={fng_mult:.2f} liq={liq_mult:.2f} "
                                   f"cap={cap_frac:.2f} lvl={lvl_mult:.2f} vwap={vwap_mult:.2f}")
                        result.entries.append({
                            "symbol": raw_sym, "side": side, "score": sc["soft_score"],
                            "regime": sc["regime"], "jedi": sc["jedi_raw"],
                            "mtf": mtf_result, "halo": halo_dec.note,
                        })
                        _log_cycle(db, now, raw_sym, sc, gates_pass, f"ENTRY_{side.upper()}")

                except Exception as exc:
                    log.exception("cycle %s: %s", raw_sym, exc)
                    result.errors.append(f"{raw_sym}: {exc}")

    except ConnectionError as exc:
        result.errors.append(f"IBKR connection failed: {exc}")
        result.errors.append(
            "Ensure TWS or IB Gateway is running in PAPER mode on "
            f"{IBKR_HOST}:{IBKR_PORT} with API enabled."
        )

    db.commit()
    db.close()
    return asdict(result)


def get_status() -> dict:
    """Returns account summary + open positions. Requires live TWS connection."""
    try:
        with IBKRSession() as sess:
            summary   = sess.account_summary()
            positions = sess.positions()
    except ConnectionError as exc:
        return {"error": str(exc), "hint": f"TWS/Gateway must be open on {IBKR_HOST}:{IBKR_PORT}"}
    except Exception as exc:
        return {"error": str(exc)}

    db     = _init_db(TRADES_DB)
    trades = [dict(r) for r in
              db.execute("SELECT * FROM trades ORDER BY id DESC LIMIT 50").fetchall()]
    db.close()

    return {
        "account":        summary,
        "open_positions": positions,
        "recent_trades":  trades[:20],
        "trade_count":    len(trades),
        "connection":     {"host": IBKR_HOST, "port": IBKR_PORT, "client_id": CLIENT_ID},
    }


def test_connection() -> dict:
    """Quick connection test — does not place orders."""
    try:
        with IBKRSession() as sess:
            accts    = sess.ib.managedAccounts()
            equity   = sess.equity()
            currency = sess.base_currency()
            return {
                "connected":   True,
                "accounts":    accts,
                "equity":      equity,
                "currency":    currency,
                "host":        IBKR_HOST,
                "port":        IBKR_PORT,
                "read_only":   False,
            }
    except Exception as exc:
        return {
            "connected": False,
            "error":     str(exc),
            "hint":      (
                f"Open TWS → File → Paper Trading or IB Gateway paper mode. "
                f"Enable API: TWS Settings → API → Socket port {IBKR_PORT}. "
                f"Add 127.0.0.1 to trusted IPs."
            ),
        }


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "test"

    if cmd == "test":
        print(json.dumps(test_connection(), indent=2))
    elif cmd == "status":
        print(json.dumps(get_status(), indent=2))
    elif cmd == "run":
        mode     = sys.argv[2] if len(sys.argv) > 2 else "PADAWAN"
        asset    = sys.argv[3] if len(sys.argv) > 3 else "CRYPTO"
        dry_run  = "--dry" in sys.argv
        result   = run_cycle(mode, asset, dry_run=dry_run)
        print(json.dumps(result, indent=2))
