"""
crypto_worker.py — Live Crypto Council Scanner + Sim Trader
===========================================================
Run as: python crypto_worker.py   (from m4d-ds/ directory)

Requires: pip install websockets

What it does:
  1. Subscribes to the Rust WS bridge (ws://127.0.0.1:3330/v1/ws/algo)
  2. Accumulates rolling 300 1m bars per symbol (in memory)
  3. Every confirmed bar: runs SIGNAL_REGISTRY signals + JEDI features → council vote
  4. Sim trader: state machine per symbol — entries, stops, targets, P&L
  5. Writes signal_state + sim_trades + running_stats → crypto_lab.sqlite
  6. Optuna loop: every 60 min, runs 60-trial sweep per symbol → best params JSON

Output: ~/.m4d_cache/crypto_lab.sqlite  (read by Django /crypto/live/ endpoint)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import sys
import threading
import time
import warnings
from collections import deque
from pathlib import Path

import numpy as np
import pandas as pd

# ── Django setup (for SIGNAL_REGISTRY, JediParams, etc.) ─────────────────────
sys.path.insert(0, str(Path(__file__).parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "m4d_ds.settings")
import django
django.setup()

from ds_app.jedi_signal import JediParams, _jedi_features, MINI_COUNCIL_SIGNALS
from ds_app.algo_signals import SIGNAL_REGISTRY, boom_rank_score

# ── Config ────────────────────────────────────────────────────────────────────
WS_URL        = os.environ.get("M4D_WS_URL", "ws://127.0.0.1:3330/v1/ws/algo")
DB_PATH       = Path(os.environ.get("M4D_CACHE_DIR", Path.home() / ".m4d_cache")) / "crypto_lab.sqlite"
MAX_BARS      = 300          # rolling window per symbol
MIN_BARS      = 60           # minimum bars before running signals
OPTUNA_EVERY  = 3600         # seconds between Optuna sweeps (1 hour)
OPTUNA_TRIALS = 60
OPTUNA_TIMEOUT = 45.0        # seconds per symbol

# ── Crypto-appropriate JEDI params ────────────────────────────────────────────
# Crypto is 24/7 — disable session filter. More volatile — slightly looser ATR.
CRYPTO_JEDI_PARAMS = JediParams(
    min_agree=2,
    session_open_et=0,        # open from midnight
    session_cutoff_et=1440,   # 24×60 = midnight — no cutoff
    friday_ok=True,
    flat_eod=False,           # crypto never closes
    atr_mult=0.8,             # crypto is volatile — don't require as wide ATR
    decel_require_volume=True,
    friday_kelly_scalar=1.0,  # no Friday penalty for 24/7 markets
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [crypto] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("crypto_worker")

# ── In-memory bar store ───────────────────────────────────────────────────────
# keyed by symbol (e.g. "BTCUSDT")
# BUG-2 fix: both async loop and Optuna thread touch these — protect with a lock
SYMBOL_BARS: dict[str, deque] = {}
_bars_lock = threading.Lock()

# ── Best Optuna params (reloaded every sweep) ─────────────────────────────────
BEST_PARAMS: dict[str, dict] = {}
_params_lock = threading.Lock()
BEST_PARAMS_PATH = DB_PATH.parent / "crypto_best_params.json"

# ── SQLite write lock (BUG-1: protect against future cross-thread writes) ──────
_db_lock = threading.Lock()

# ── SQLite setup ──────────────────────────────────────────────────────────────
def init_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS signal_state (
            symbol      TEXT PRIMARY KEY,
            ts          INTEGER,
            council_vote INTEGER,
            conviction  REAL,
            jedi_entry  INTEGER,
            atr_slope   REAL,
            rvol        REAL,
            close       REAL,
            sim_state   TEXT,
            updated_at  INTEGER
        );
        CREATE TABLE IF NOT EXISTS sim_trades (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol      TEXT,
            entry_ts    INTEGER,
            exit_ts     INTEGER,
            entry_price REAL,
            exit_price  REAL,
            pnl_pct     REAL,
            exit_reason TEXT,
            council_vote INTEGER,
            conviction  REAL
        );
        CREATE TABLE IF NOT EXISTS running_stats (
            symbol      TEXT PRIMARY KEY,
            trades      INTEGER,
            wins        INTEGER,
            win_rate    REAL,
            boom_rank_score REAL,
            total_pnl_pct REAL,
            last_updated INTEGER
        );
    """)
    conn.commit()
    return conn


# ── Bar → DataFrame ───────────────────────────────────────────────────────────
def bars_to_df(bars: deque) -> pd.DataFrame:
    """Convert rolling deque of bar dicts to OHLCV DataFrame with DatetimeIndex."""
    rows = list(bars)
    df = pd.DataFrame(rows, columns=["time", "Open", "High", "Low", "Close", "Volume"])
    df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
    df = df.set_index("time").sort_index()
    df = df.astype(float)
    return df


# ── Signal runner ─────────────────────────────────────────────────────────────
def run_signals(df: pd.DataFrame, params: JediParams) -> dict:
    """Run JEDI features + mini-council on latest bars. Returns state dict for last bar."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            feat = _jedi_features(df, params)
    except Exception as e:
        log.debug(f"_jedi_features error: {e}")
        return {}

    last = feat.iloc[-1]
    council_vote = int(last.get("council_vote", 0))
    conviction   = float(last.get("conviction", 0.0))
    jedi_entry   = bool(last.get("entry", False))
    atr_slope    = float(last.get("atr_slope", 0.0))

    # rvol from raw bars
    vol = df["Volume"]
    rvol_val = float(vol.iloc[-1] / vol.rolling(20).mean().iloc[-1]) if len(vol) >= 20 else 0.0

    return {
        "council_vote": council_vote,
        "conviction":   conviction,
        "jedi_entry":   jedi_entry,
        "atr_slope":    atr_slope,
        "rvol":         rvol_val,
        "close":        float(df["Close"].iloc[-1]),
        "entry_body":   float(feat["entry_body"].iloc[-1]),
    }


# ── Per-symbol sim trader state ───────────────────────────────────────────────
class SimTrader:
    def __init__(self, symbol: str, params: JediParams):
        self.symbol = symbol
        self.params = params
        self.state = "FLAT"
        self.entry_price: float | None = None
        self.entry_ts: int | None = None
        self.entry_volume: float = 0.0
        self.entry_body: float = 0.0
        self.bars_in_trade: int = 0
        self.break_even_armed: bool = False
        self.partial_closed: bool = False
        # rolling stats
        self.trades: int = 0
        self.wins: int = 0
        self.total_pnl: float = 0.0

    def on_bar(self, bar: dict, sig: dict, conn: sqlite3.Connection) -> dict | None:
        """Process one bar. Returns closed trade dict or None."""
        close  = bar["close"]
        open_  = bar["open"]
        volume = bar["volume"]
        ts     = bar["time"]
        p      = self.params

        closed_trade = None

        if self.state == "IN_TRADE" and self.entry_price is not None:
            self.bars_in_trade += 1

            bar_red = close < open_
            body    = max(0.0, close - open_)

            # ── Decel exit (volume-weighted, iter-01) ──────────────────────────
            if self.bars_in_trade <= p.decel_window:
                body_decel = (
                    p.decel_thresh > 0
                    and self.entry_body > 0
                    and not bar_red
                    and body < self.entry_body * p.decel_thresh
                )
                raw_decel = bar_red or body_decel
                if raw_decel and p.decel_require_volume and self.entry_volume > 0:
                    vol_confirmed = volume > self.entry_volume * p.decel_volume_pct_of_entry
                    raw_decel = vol_confirmed
                if raw_decel:
                    closed_trade = self._close(ts, close, "decel", sig, conn)
                    return closed_trade

            # ── ATR slope stop widening ────────────────────────────────────────
            stop_pct = p.stop_loss_pct
            atr_slope = sig.get("atr_slope", 0.0)
            if atr_slope > p.atr_slope_thresh:
                stop_pct *= p.atr_slope_stop_mult

            stop_px = self.entry_price * (1.0 - stop_pct / 100.0)

            # ── Break-even lift ────────────────────────────────────────────────
            if close > self.entry_price:
                self.break_even_armed = True
            if self.break_even_armed:
                be_lock = self.entry_price * (1.0 + p.break_even_offset_pct / 100.0)
                stop_px = max(stop_px, be_lock)

            # ── Hard stop ──────────────────────────────────────────────────────
            if close <= stop_px:
                closed_trade = self._close(ts, close, "stop", sig, conn)
                return closed_trade

            # ── Profit target ──────────────────────────────────────────────────
            target_px = self.entry_price * (1.0 + p.profit_target_pct / 100.0)
            if not self.partial_closed and close >= target_px:
                self.partial_closed = True  # simulate 50% close; hold rest

            # ── Hold bars timeout ──────────────────────────────────────────────
            if self.bars_in_trade >= p.hold_bars:
                closed_trade = self._close(ts, close, "hold_bars", sig, conn)
                return closed_trade

        elif self.state == "FLAT":
            # ── Entry signal ───────────────────────────────────────────────────
            if sig.get("jedi_entry"):
                self.state        = "IN_TRADE"
                self.entry_price  = close
                self.entry_ts     = ts
                self.entry_volume = volume
                self.entry_body   = sig.get("entry_body", 0.0)
                self.bars_in_trade = 0
                self.break_even_armed = False
                self.partial_closed   = False
                log.info(f"[sim] {self.symbol} ENTRY @ {close:.4f}  vote={sig.get('council_vote',0)}")

        self._write_state(ts, sig, conn)
        return closed_trade

    def _close(self, ts: int, close: float, reason: str, sig: dict, conn: sqlite3.Connection) -> dict:
        pnl_pct = (close / self.entry_price - 1.0) * 100.0
        self.trades += 1
        if pnl_pct > 0:
            self.wins += 1
        self.total_pnl += pnl_pct

        win_rate = self.wins / self.trades if self.trades > 0 else 0.0
        brs_dict = {"return_pct": self.total_pnl, "win_rate_pct": win_rate * 100, "max_dd_pct": 0.0}
        brs = boom_rank_score(brs_dict)
        with _db_lock:
            conn.execute(
                "INSERT INTO sim_trades (symbol,entry_ts,exit_ts,entry_price,exit_price,"
                "pnl_pct,exit_reason,council_vote,conviction) VALUES (?,?,?,?,?,?,?,?,?)",
                (self.symbol, self.entry_ts, ts, self.entry_price, close, pnl_pct,
                 reason, sig.get("council_vote", 0), sig.get("conviction", 0.0)),
            )
            conn.execute(
                "INSERT OR REPLACE INTO running_stats VALUES (?,?,?,?,?,?,?)",
                (self.symbol, self.trades, self.wins, win_rate, brs, self.total_pnl, ts),
            )
            conn.commit()

        log.info(
            f"[sim] {self.symbol} EXIT @ {close:.4f}  pnl={pnl_pct:+.2f}%  "
            f"reason={reason}  trades={self.trades}  wr={win_rate:.0%}"
        )

        self.state       = "FLAT"
        self.entry_price = None
        self.entry_ts    = None
        return {"symbol": self.symbol, "pnl_pct": pnl_pct, "reason": reason}

    def _write_state(self, ts: int, sig: dict, conn: sqlite3.Connection):
        now = int(time.time())
        with _db_lock:
            conn.execute(
                "INSERT OR REPLACE INTO signal_state VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    self.symbol, ts,
                    sig.get("council_vote", 0),
                    sig.get("conviction", 0.0),
                    int(sig.get("jedi_entry", False)),
                    sig.get("atr_slope", 0.0),
                    sig.get("rvol", 0.0),
                    sig.get("close", 0.0),
                    self.state,
                    now,
                ),
            )
            conn.commit()


# ── Optuna sweep (runs in background thread) ──────────────────────────────────
def _optuna_sweep():
    """Run Optuna on accumulated bars for each symbol. Updates BEST_PARAMS."""
    from ds_app.algo_optimizer import optimize_signal

    while True:
        time.sleep(OPTUNA_EVERY)
        log.info("[optuna] starting hourly sweep")
        results = {}
        with _bars_lock:
            bars_snapshot = {s: deque(list(b)) for s, b in SYMBOL_BARS.items()}
        for sym, bars in bars_snapshot.items():
            if len(bars) < MIN_BARS * 2:
                continue
            try:
                df = bars_to_df(bars)
                rows = optimize_signal(
                    "jedi_00", df, symbol=sym,
                    n_trials=OPTUNA_TRIALS, timeout=OPTUNA_TIMEOUT, min_trades=3,
                )
                if rows:
                    best = rows[0]
                    results[sym] = best
                    log.info(
                        f"[optuna] {sym} best BRS={best.get('boom_rank_score',0):.2f} "
                        f"wr={best.get('win_rate_pct',0):.0f}%"
                    )
            except Exception as e:
                log.warning(f"[optuna] {sym} failed: {e}")

        if results:
            with _params_lock:
                BEST_PARAMS.update(results)
            try:
                BEST_PARAMS_PATH.write_text(json.dumps(results, indent=2, default=str))
                log.info(f"[optuna] saved best params → {BEST_PARAMS_PATH}")
            except Exception as e:
                log.warning(f"[optuna] save failed: {e}")


# ── Main WS loop ──────────────────────────────────────────────────────────────
async def run(conn: sqlite3.Connection):
    import websockets  # noqa: PLC0415  (imported here so error is localised)

    traders: dict[str, SimTrader] = {}
    params = CRYPTO_JEDI_PARAMS

    while True:
        try:
            log.info(f"Connecting to {WS_URL}")
            async with websockets.connect(WS_URL, ping_interval=20, ping_timeout=30) as ws:
                # Subscribe (Rust ignores content but hook expects the message)
                await ws.send(json.dumps({"op": "subscribe", "stream": "bars", "symbol": "*"}))
                log.info("Subscribed — waiting for bars...")

                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue

                    if msg.get("type") == "info":
                        log.info(f"[server] {msg.get('message','')}")
                        continue

                    if msg.get("type") != "bar":
                        continue

                    sym = msg.get("symbol") or msg.get("bar", {}).get("_symbol")
                    if not sym:
                        continue
                    sym = sym.upper()

                    bar_raw = msg["bar"]
                    bar = {
                        "time":   bar_raw["time"],
                        "open":   bar_raw["open"],
                        "high":   bar_raw["high"],
                        "low":    bar_raw["low"],
                        "close":  bar_raw["close"],
                        "volume": bar_raw["volume"],
                    }

                    # BUG-4: skip bars with zero/invalid OHLCV (corrupts signals)
                    if bar["close"] <= 0.0 or bar["open"] <= 0.0:
                        log.debug(f"{sym}: skipping zero-price bar ts={bar['time']}")
                        continue

                    # BUG-2: lock around SYMBOL_BARS mutation
                    with _bars_lock:
                        if sym not in SYMBOL_BARS:
                            SYMBOL_BARS[sym] = deque(maxlen=MAX_BARS)
                        SYMBOL_BARS[sym].append((
                            bar["time"], bar["open"], bar["high"],
                            bar["low"], bar["close"], bar["volume"],
                        ))
                        n_bars = len(SYMBOL_BARS[sym])
                        bars_snap = deque(list(SYMBOL_BARS[sym]))

                    # Need minimum history before running signals
                    if n_bars < MIN_BARS:
                        log.debug(f"{sym}: {n_bars}/{MIN_BARS} bars accumulated")
                        continue

                    # Get best params for this symbol if available
                    sym_params = params
                    with _params_lock:
                        sym_best = BEST_PARAMS.get(sym)
                    if sym_best is not None:
                        try:
                            bp = sym_best
                            overrides = {
                                k: v for k, v in bp.items()
                                if k in JediParams.__dataclass_fields__
                            }
                            # Always keep crypto session settings
                            overrides["session_open_et"]  = 0
                            overrides["session_cutoff_et"] = 1440
                            overrides["friday_ok"]        = True
                            overrides["flat_eod"]         = False
                            fields = {f: getattr(params, f) for f in JediParams.__dataclass_fields__}
                            fields.update(overrides)
                            sym_params = JediParams(**fields)
                        except Exception:
                            sym_params = params

                    # Run signals (use snapshot, not live deque)
                    df = bars_to_df(bars_snap)
                    sig = run_signals(df, sym_params)
                    if not sig:
                        continue

                    # Sim trader
                    if sym not in traders:
                        traders[sym] = SimTrader(sym, sym_params)
                    traders[sym].params = sym_params
                    traders[sym].on_bar(bar, sig, conn)

                    log.info(
                        f"{sym:8s} close={bar['close']:>12.4f}  "
                        f"vote={sig.get('council_vote',0)}/6  "
                        f"conviction={sig.get('conviction',0):.2f}  "
                        f"{'GO' if sig.get('jedi_entry') else '  '}"
                    )

        except Exception as e:
            log.warning(f"WS error: {e} — reconnecting in 5s")
            await asyncio.sleep(5)


def main():
    log.info("=" * 60)
    log.info("M4D Crypto Worker starting")
    log.info(f"WS  : {WS_URL}")
    log.info(f"DB  : {DB_PATH}")
    log.info(f"Optuna sweep every {OPTUNA_EVERY}s")
    log.info("=" * 60)

    conn = init_db()

    # Optuna runs in a background daemon thread (CPU-bound, doesn't block async loop)
    optuna_thread = threading.Thread(target=_optuna_sweep, daemon=True)
    optuna_thread.start()

    asyncio.run(run(conn))


if __name__ == "__main__":
    main()
