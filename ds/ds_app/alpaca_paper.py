"""
ds_app/alpaca_paper.py — Alpaca Paper Trading Adapter (P0-D)

Full cycle: live bars → soft_score → gates → CIS → HALO → Alpaca order.

ENV:
  ALPACA_KEY      API key ID            (paper account)
  ALPACA_SECRET   API secret key        (paper account)
  PAPER_MODE      PADAWAN|NORMAL|EUPHORIA   (default: PADAWAN)
  PAPER_SYMBOLS   comma-separated DB symbols  (default: BTCUSDT,ETHUSDT,SOLUSDT)
  PAPER_LOT_PCT   account equity % per lot    (default: 0.05)

CYCLE (run_cycle, every 5m):
  1. Pull last 500 5m bars from futures.db per symbol
  2. compute_live_votes() → soft_score via SOFT_REGIME_MULT + Sharpe weights
  3. 5-gate veto (SQUEEZE, ATR_RANK, HOUR, RVOL_EXHAUST, LOW_JEDI)
  4. Open positions: compute CIS → exit / scale logic
  5. Flat positions: entry logic (score >= thr, gates clear)
  6. HALO execution (skip/delay/split/noise)
  7. Submit orders to Alpaca paper
  8. Persist trade events to paper_trades.db
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

import numpy as np
import pandas as pd
import requests

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

from ds_app.algos_crypto import compute_live_votes            # noqa: E402
from ds_app.delta_ops import (                                # noqa: E402
    PADAWAN, NORMAL, EUPHORIA, MAX, ModeConfig, compute_cis, _accel_state,
)
from ds_app.halo_mode import halo_entry, halo_exit, HaloConfig, HALO  # noqa: E402
from ds_app.sharpe_ensemble import SOFT_REGIME_MULT  # noqa: E402

log = logging.getLogger("alpaca_paper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

# ── Constants ─────────────────────────────────────────────────────────────────

FUTURES_DB   = _DS_ROOT / "data" / "futures.db"
EQUITIES_DB  = _DS_ROOT / "data" / "equities.db"
TRADES_DB    = _DS_ROOT / "data" / "paper_trades.db"
REGIME_MAP   = _DS_ROOT / "data" / "regime_signal_map.json"
MRT_SNAPSHOT = _DS_ROOT.parent / "MRT" / "data" / "mrt_snapshot.json"

ALPACA_BASE  = os.getenv("PAPER_BASE_URL", "https://paper-api.alpaca.markets")
ALPACA_KEY   = os.getenv("ALPACA_KEY", "")
ALPACA_SECRET = os.getenv("ALPACA_SECRET", "")

LOT_PCT      = float(os.getenv("PAPER_LOT_PCT", "0.05"))    # 5% equity per lot
BARS_NEEDED  = 500                                            # warmup bars for indicators

# ASSET_MODE: CRYPTO (default) | STOCKS | FUTURES
ASSET_MODE   = os.getenv("ASSET_MODE", "CRYPTO").upper()

# Crypto: raw symbol → Alpaca crypto pair
SYMBOL_MAP: dict[str, str] = {
    "BTC":   "BTC/USD",
    "ETH":   "ETH/USD",
    "SOL":   "SOL/USD",
    "BNB":   "BNB/USD",
    "ADA":   "ADA/USD",
    "AVAX":  "AVAX/USD",
    "DOGE":  "DOGE/USD",
    "DOT":   "DOT/USD",
    "LINK":  "LINK/USD",
    "MATIC": "MATIC/USD",
    "UNI":   "UNI/USD",
    "LTC":   "LTC/USD",
    "XRP":   "XRP/USD",
}

# Stocks/ETFs: symbol is its own Alpaca symbol (no /USD suffix)
EQUITY_SYMBOLS_DEFAULT = "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AMD,PLTR,SPY,QQQ"
CME_SYMBOLS_DEFAULT    = "ES,NQ,GC,CL,RTY"

# NYSE market hours in UTC minutes (09:30–16:00 ET = 14:30–21:00 UTC)
_NYSE_OPEN_UTC  = 14 * 60 + 30   # 870
_NYSE_CLOSE_UTC = 21 * 60         # 1260

ATR_RANK_WIN = 200
RVOL_WIN     = 100
ANNUAL       = 252 * 288

MODES: dict[str, ModeConfig] = {
    "PADAWAN": PADAWAN, "NORMAL": NORMAL, "EUPHORIA": EUPHORIA, "MAX": MAX,
}


# ── Alpaca REST client ─────────────────────────────────────────────────────────

class AlpacaClient:
    def __init__(self, key: str, secret: str, base: str = ALPACA_BASE):
        self._headers = {
            "APCA-API-KEY-ID": key,
            "APCA-API-SECRET-KEY": secret,
            "Content-Type": "application/json",
        }
        self._base = base.rstrip("/")

    def _get(self, path: str, params: dict | None = None) -> dict | list:
        r = requests.get(f"{self._base}{path}", headers=self._headers, params=params, timeout=10)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, body: dict) -> dict:
        r = requests.post(f"{self._base}{path}", headers=self._headers, json=body, timeout=10)
        r.raise_for_status()
        return r.json()

    def _delete(self, path: str) -> dict | None:
        r = requests.delete(f"{self._base}{path}", headers=self._headers, timeout=10)
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return r.json()

    def account(self) -> dict:
        return self._get("/v2/account")

    def positions(self) -> list[dict]:
        return self._get("/v2/positions")

    def position(self, symbol: str) -> dict | None:
        try:
            return self._get(f"/v2/positions/{symbol.replace('/', '')}")
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return None
            raise

    def place_order(self, symbol: str, qty: float, side: str) -> dict:
        return self._post("/v2/orders", {
            "symbol": symbol,
            "qty": str(round(qty, 6)),
            "side": side,
            "type": "market",
            "time_in_force": "gtc",
        })

    def close_position(self, symbol: str) -> dict | None:
        return self._delete(f"/v2/positions/{symbol.replace('/', '')}")

    def orders(self, limit: int = 50) -> list[dict]:
        return self._get("/v2/orders", {"status": "all", "limit": limit})


# ── PaperDB — local SQLite trade log ──────────────────────────────────────────

def _init_db(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS positions (
            symbol       TEXT PRIMARY KEY,
            side         TEXT,
            entry_ts     TEXT,
            entry_price  REAL,
            entry_score  REAL,
            entry_regime TEXT,
            entry_jedi   REAL,
            lots_in      REAL,
            mode         TEXT,
            jitter_bars_left INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS trades (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            ts           TEXT,
            symbol       TEXT,
            action       TEXT,
            side         TEXT,
            qty          REAL,
            price        REAL,
            lots         REAL,
            mode         TEXT,
            pnl_usd      REAL,
            note         TEXT
        );
        CREATE TABLE IF NOT EXISTS cycle_log (
            ts           TEXT,
            symbol       TEXT,
            score        REAL,
            regime       TEXT,
            jedi_raw     REAL,
            gates_pass   INTEGER,
            action       TEXT,
            note         TEXT
        );
    """)
    conn.commit()
    return conn


# ── Live bar loader ────────────────────────────────────────────────────────────

def _load_crypto_bars(symbol: str, n: int) -> pd.DataFrame | None:
    if not FUTURES_DB.exists():
        log.warning("futures.db not found")
        return None
    try:
        conn = sqlite3.connect(FUTURES_DB)
        df = pd.read_sql_query(
            f"SELECT ts, open, high, low, close, volume FROM bars_5m "
            f"WHERE symbol=? ORDER BY ts DESC LIMIT {n}",
            conn, params=(symbol,),
        )
        conn.close()
    except Exception as exc:
        log.error("load_bars crypto %s: %s", symbol, exc)
        return None
    if len(df) < 100:
        return None
    df = df.iloc[::-1].reset_index(drop=True)
    df.columns = ["ts", "Open", "High", "Low", "Close", "Volume"]
    return df


def _load_equity_bars(symbol: str, n: int) -> pd.DataFrame | None:
    if not EQUITIES_DB.exists():
        log.warning("equities.db not found — run: python -m ds_app.equity_bars --refresh")
        return None
    try:
        conn = sqlite3.connect(EQUITIES_DB)
        df = pd.read_sql_query(
            "SELECT ts, open, high, low, close, volume FROM bars_5m "
            f"WHERE symbol=? ORDER BY ts DESC LIMIT {n}",
            conn, params=(symbol.upper(),),
        )
        conn.close()
    except Exception as exc:
        log.error("load_bars equity %s: %s", symbol, exc)
        return None
    if len(df) < 50:
        return None
    df = df.iloc[::-1].reset_index(drop=True)
    df.columns = ["ts", "Open", "High", "Low", "Close", "Volume"]
    return df


def _load_futures_bars(symbol: str, n: int) -> pd.DataFrame | None:
    """Load CME futures 1m bars, aggregated to 5m."""
    if not FUTURES_DB.exists():
        return None
    try:
        conn = sqlite3.connect(FUTURES_DB)
        raw = pd.read_sql_query(
            "SELECT ts, open, high, low, close, volume FROM bars_1m "
            f"WHERE symbol=? ORDER BY ts DESC LIMIT {n * 5}",
            conn, params=(symbol.upper(),),
        )
        conn.close()
    except Exception as exc:
        log.error("load_bars futures %s: %s", symbol, exc)
        return None
    if len(raw) < 50:
        return None
    raw = raw.iloc[::-1].reset_index(drop=True)
    raw["dt"] = pd.to_datetime(raw["ts"], unit="s", utc=True)
    raw = raw.set_index("dt")
    agg = raw.resample("5min").agg(
        open=("open", "first"), high=("high", "max"), low=("low", "min"),
        close=("close", "last"), volume=("volume", "sum"), ts=("ts", "first"),
    ).dropna(subset=["open"]).tail(n).reset_index(drop=True)
    agg.columns = ["Open", "High", "Low", "Close", "Volume", "ts"]
    return agg[["ts", "Open", "High", "Low", "Close", "Volume"]]


def load_bars(symbol: str, n: int = BARS_NEEDED) -> pd.DataFrame | None:
    """Auto-dispatch bar loader based on ASSET_MODE."""
    if ASSET_MODE == "STOCKS":
        return _load_equity_bars(symbol, n)
    if ASSET_MODE == "FUTURES":
        return _load_futures_bars(symbol, n)
    return _load_crypto_bars(symbol, n)


# ── ICT Kill Zones — precision 30-min session windows ─────────────────────────
# ALIVE:  London open  07:00–09:00 UTC  (liquidity sweep + trend start)
# ALIVE:  NY open      13:30–16:00 UTC  (highest confluence window)
# KILL:   London close 11:00–13:30 UTC  (chop + spread widening)
# KILL:   NY close     20:30–23:00 UTC  (low volume + spread)
# KILL:   Asia dead    00:00–06:30 UTC  (no institutional flow)
# KILL:   DR forming   13:30–14:00 UTC  (wait for NY direction to print)
_ICT_ALIVE: list[tuple[int, int]] = [
    (7 * 60,       9 * 60),       # London open
    (14 * 60,      16 * 60),      # NY open (after DR forms)
    (16 * 60,      20 * 60 + 30), # NY continuation
]
_ICT_KILL: list[tuple[int, int]] = [
    (0,            6 * 60 + 30),  # Asia dead zone
    (11 * 60,      14 * 60),      # London close / DR forming
    (20 * 60 + 30, 24 * 60),      # NY close
]


def session_gate(now_utc_mins: int) -> tuple[bool, str]:
    """
    Returns (allowed, session_label) for crypto/futures using ICT kill zones.
    """
    for start, end in _ICT_ALIVE:
        if start <= now_utc_mins < end:
            label = "LONDON" if now_utc_mins < 9 * 60 else ("NY_DR" if now_utc_mins < 14 * 60 else "NY_OPEN" if now_utc_mins < 16 * 60 else "NY_CONT")
            return True, label
    for start, end in _ICT_KILL:
        if start <= now_utc_mins < end:
            label = "ASIA_DEAD" if now_utc_mins < 6 * 60 + 30 else ("LONDON_CLOSE" if now_utc_mins < 14 * 60 else "NY_CLOSE")
            return False, label
    return False, "TRANSITION"


def is_market_open(symbol: str) -> bool:
    """Returns True if trading is allowed for this symbol right now (UTC)."""
    from datetime import datetime, timezone
    now = datetime.now(tz=timezone.utc)
    if now.weekday() >= 5:
        return False
    if ASSET_MODE == "FUTURES":
        # block CME daily settlement 21:00–21:30 UTC
        if now.hour == 21 and now.minute < 30:
            return False
        mins = now.hour * 60 + now.minute
        ok, _ = session_gate(mins)
        return ok
    if ASSET_MODE == "CRYPTO":
        mins = now.hour * 60 + now.minute
        ok, _ = session_gate(mins)
        return ok
    # STOCKS: NYSE hours only
    mins = now.hour * 60 + now.minute
    return _NYSE_OPEN_UTC <= mins < _NYSE_CLOSE_UTC


def get_session_label() -> str:
    """Current ICT session label for UI surfacing."""
    from datetime import datetime, timezone
    now = datetime.now(tz=timezone.utc)
    mins = now.hour * 60 + now.minute
    _, label = session_gate(mins)
    return label


# ── Live soft score computation ────────────────────────────────────────────────

def _load_sharpe_weights() -> dict[str, dict[str, float]]:
    if not REGIME_MAP.exists():
        return {}
    raw: dict[str, list[dict]] = json.loads(REGIME_MAP.read_text())
    out: dict[str, dict[str, float]] = {}
    for regime, signals in raw.items():
        total = sum(max(s["sharpe"], 0) for s in signals)
        if total == 0:
            continue
        out[regime] = {s["algo_id"]: max(s["sharpe"], 0) / total for s in signals}
    return out


_SHARPE_WEIGHTS: dict[str, dict[str, float]] = {}

# MRT vol regime: read latest snapshot from Rust engine output
# Returns {"vol_label": "high_vol"|"mid_vol"|"low_vol", "state": 0|1|2}
# Cached for 5m (one cycle). Fails gracefully — never blocks a trade.
_MRT_CACHE: dict = {}
_MRT_CACHE_TS: float = 0.0
_MRT_CACHE_TTL: float = 300.0  # 5 minutes

def _load_mrt_vol() -> dict:
    global _MRT_CACHE, _MRT_CACHE_TS
    now = time.time()
    if now - _MRT_CACHE_TS < _MRT_CACHE_TTL and _MRT_CACHE:
        return _MRT_CACHE
    try:
        data = json.loads(MRT_SNAPSHOT.read_text())
        _MRT_CACHE = data.get("regime", {"label": "mid_vol", "state": 1})
        _MRT_CACHE_TS = now
    except Exception:
        _MRT_CACHE = {"label": "mid_vol", "state": 1}
    return _MRT_CACHE

def _mrt_size_mult(vol_label: str, direction_regime: str) -> float:
    """
    MRT vol → sizing multiplier.
    high_vol + RISK-OFF → 0.5 (drawdown protection, force near-PADAWAN)
    high_vol + TRENDING → 1.2 (fat pitch — vol = fuel when trend is clear)
    high_vol + BREAKOUT → 1.1
    mid_vol  → 1.0 (no change)
    low_vol  → 0.7 (thin tape, reduce all sizes)
    """
    if vol_label == "high_vol":
        if direction_regime == "RISK-OFF":
            return 0.5
        if direction_regime == "TRENDING":
            return 1.2
        if direction_regime == "BREAKOUT":
            return 1.1
        return 0.9   # RANGING + high vol = noise
    if vol_label == "low_vol":
        return 0.7
    return 1.0       # mid_vol = baseline


def _live_regime(df: pd.DataFrame, votes: dict) -> str:
    cl  = df["Close"].values
    n   = len(cl)
    hi  = df["High"].values
    lo  = df["Low"].values
    prev_c = np.concatenate([[cl[0]], cl[:-1]])
    tr  = np.maximum(hi - lo, np.maximum(np.abs(hi - prev_c), np.abs(lo - prev_c)))
    atr14 = np.zeros(n)
    alpha = 2.0 / 15.0
    atr14[0] = tr[0]
    for i in range(1, n):
        atr14[i] = alpha * tr[i] + (1 - alpha) * atr14[i - 1]
    atr_pct = atr14 / np.where(cl > 0, cl, 1.0)

    sup_v = int(votes.get("SUPERTREND", {}).get("vote", 0) == 1)
    adx_v = int(votes.get("ADX_TREND",  {}).get("vote", 0) == 1)
    atr_v = int(votes.get("ATR_EXP",    {}).get("vote", 0) == 1)
    sqz_v = int(votes.get("SQZPOP",     {}).get("vote", 0) == 0)  # 0 = squeeze off = potential pop

    atr_75   = np.percentile(atr_pct[atr_pct > 0], 75) if (atr_pct > 0).any() else 1.0
    mom12    = (cl[-1] - cl[-13]) / cl[-13] if n > 13 and cl[-13] != 0 else 0.0

    ema200 = cl[0]
    alpha2 = 2.0 / 201.0
    for v in cl:
        ema200 = alpha2 * v + (1 - alpha2) * ema200

    risk_off = (atr_pct[-1] > atr_75) and (mom12 < -0.015)
    breakout = atr_v == 1
    trending = (cl[-1] > ema200) and (sup_v == 1) and (adx_v == 1)

    if risk_off:   return "RISK-OFF"
    if breakout:   return "BREAKOUT"
    if trending:   return "TRENDING"
    return "RANGING"


def score_symbol(df: pd.DataFrame) -> dict:
    global _SHARPE_WEIGHTS
    if not _SHARPE_WEIGHTS:
        _SHARPE_WEIGHTS = _load_sharpe_weights()

    votes    = compute_live_votes(df)
    regime   = _live_regime(df, votes)
    jedi_raw = float(votes.get("JEDI", {}).get("raw_score", 0))

    regime_weights = _SHARPE_WEIGHTS.get(regime, {})
    weighted_num = 0.0
    weighted_den = 0.0
    for sig_id, v in votes.items():
        if sig_id == "JEDI":
            continue
        vote = float(v.get("vote", 0))
        if vote <= 0:
            continue
        sharpe_w = regime_weights.get(sig_id, 0.0)
        soft_m   = SOFT_REGIME_MULT.get(sig_id, {}).get(regime, 1.0)
        w = sharpe_w * soft_m
        weighted_num += w * vote
        weighted_den += w

    soft_score = weighted_num / weighted_den if weighted_den > 0 else 0.0

    # ATR rank (last ATR_RANK_WIN bars)
    hi, lo, cl = df["High"], df["Low"], df["Close"]
    prev_c = cl.shift(1)
    tr     = pd.concat([(hi-lo).abs(), (hi-prev_c).abs(), (lo-prev_c).abs()], axis=1).max(axis=1)
    atr_14 = tr.ewm(span=14, adjust=False).mean()
    atr_rank = float(atr_14.rank(pct=True).iloc[-1])

    # RVOL (last RVOL_WIN bars)
    rvol_series = df["Volume"] / df["Volume"].rolling(RVOL_WIN).mean()
    rvol_rank   = float(rvol_series.rank(pct=True).iloc[-1])
    rvol_now    = float(rvol_series.iloc[-1]) if not np.isnan(rvol_series.iloc[-1]) else 1.0

    # Squeeze state (SQZPOP: BB inside KC)
    from ds_app.algos_crypto import feat_SQZPOP
    sqz_df   = feat_SQZPOP(df, {})
    squeeze  = bool(sqz_df.get("squeeze", pd.Series([False])).iloc[-1]) if "squeeze" in sqz_df.columns else False

    # MRT vol regime bridge (0C fix)
    mrt_vol        = _load_mrt_vol()
    mrt_vol_label  = mrt_vol.get("label", "mid_vol")
    mrt_vol_mult   = _mrt_size_mult(mrt_vol_label, regime)
    # force PADAWAN-level sizing signal when high_vol + RISK-OFF
    mrt_force_padawan = (mrt_vol_label == "high_vol" and regime == "RISK-OFF")

    return {
        "regime":           regime,
        "soft_score":       round(soft_score, 4),
        "jedi_raw":         jedi_raw,
        "atr_rank":         round(atr_rank, 3),
        "rvol_rank":        round(rvol_rank, 3),
        "rvol_now":         round(rvol_now, 3),
        "squeeze":          squeeze,
        "price":            float(df["Close"].iloc[-1]),
        "votes":            votes,
        "mrt_vol_label":    mrt_vol_label,
        "mrt_vol_mult":     round(mrt_vol_mult, 2),
        "mrt_force_padawan": mrt_force_padawan,
    }


# ── Gate veto ─────────────────────────────────────────────────────────────────

def check_gates(sc: dict, mode: ModeConfig, symbol: str = "") -> tuple[bool, list[str]]:
    killed: list[str] = []

    if sc["squeeze"]:
        killed.append("SQUEEZE_LOCK")
    if sc["atr_rank"] < 0.30:
        killed.append("ATR_RANK_LOW")
    if sc.get("mrt_force_padawan") and mode.kelly_mult > PADAWAN.kelly_mult:
        killed.append("MRT_HIGH_VOL_RISK_OFF")
    if not is_market_open(symbol):
        utc_hour = datetime.now(timezone.utc).hour
        killed.append(f"HOUR_KILL_{utc_hour}")
    if sc["rvol_rank"] > 0.90:
        killed.append("RVOL_EXHAUSTION")
    if abs(sc["jedi_raw"]) < mode.jedi_min:
        killed.append("LOW_JEDI")

    return len(killed) == 0, killed


# ── CIS live computation ───────────────────────────────────────────────────────

def live_cis(df: pd.DataFrame, pos: sqlite3.Row, mode: ModeConfig) -> tuple[int, dict]:
    scores_arr = np.zeros(len(df))
    sc_now = score_symbol(df)
    regimes_arr = np.full(len(df), sc_now["regime"], dtype=object)
    idx = len(df) - 1

    sc = score_symbol(df)
    scores_arr[idx] = sc["soft_score"]

    _df_for_cis = df.copy()
    _df_for_cis["jedi_raw"] = sc["jedi_raw"]
    _df_for_cis["squeeze"] = int(sc["squeeze"])
    _df_for_cis["atr_rank"] = sc["atr_rank"]

    return compute_cis(
        idx           = idx,
        df            = _df_for_cis,
        scores        = scores_arr,
        regimes       = regimes_arr,
        entry_regime  = pos["entry_regime"],
        entry_jedi    = pos["entry_jedi"],
        entry_score   = pos["entry_score"],
        mode          = mode,
    )


# ── Order sizing ───────────────────────────────────────────────────────────────

def _lot_qty(equity: float, lot_fraction: float, price: float, mode: ModeConfig) -> float:
    usd_value = equity * LOT_PCT * mode.kelly_mult * lot_fraction
    return max(usd_value / price, 1e-6)


# ── Main trade cycle ───────────────────────────────────────────────────────────

@dataclass
class CycleResult:
    ts: str
    mode: str
    symbols_scored: int
    entries: list[dict] = field(default_factory=list)
    exits: list[dict] = field(default_factory=list)
    scales: list[dict] = field(default_factory=list)
    skips: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def run_cycle(mode_name: str = "PADAWAN", dry_run: bool = False) -> dict:
    mode_name = mode_name.upper()
    mode      = MODES.get(mode_name, PADAWAN)

    raw_syms = os.getenv("PAPER_SYMBOLS", "BTC,ETH,SOL").split(",")
    symbols  = [s.strip() for s in raw_syms if s.strip() in SYMBOL_MAP]

    if not ALPACA_KEY or not ALPACA_SECRET:
        return {"error": "ALPACA_KEY / ALPACA_SECRET not set in environment"}

    client = AlpacaClient(ALPACA_KEY, ALPACA_SECRET)
    acct   = client.account()
    equity = float(acct.get("equity", acct.get("portfolio_value", 10000)))

    db   = _init_db(TRADES_DB)
    now  = datetime.now(timezone.utc).isoformat(timespec="seconds")
    result = CycleResult(ts=now, mode=mode_name, symbols_scored=len(symbols))

    for raw_sym in symbols:
        alp_sym = SYMBOL_MAP[raw_sym]
        try:
            df = load_bars(raw_sym)
            if df is None:
                result.errors.append(f"{raw_sym}: no bars")
                continue

            sc = score_symbol(df)
            gates_pass, killed = check_gates(sc, mode, symbol=raw_sym)

            # Check jitter countdown
            row = db.execute("SELECT * FROM positions WHERE symbol=?", (raw_sym,)).fetchone()
            if row and row["jitter_bars_left"] > 0:
                db.execute(
                    "UPDATE positions SET jitter_bars_left=jitter_bars_left-1 WHERE symbol=?",
                    (raw_sym,),
                )
                db.commit()
                result.skips.append({"symbol": raw_sym, "reason": "HALO_JITTER"})
                _log_cycle(db, now, raw_sym, sc, gates_pass, "JITTER_WAIT")
                continue

            if row:
                # ── OPEN POSITION: check CIS ──────────────────────────────────
                cis_total, cis_flags = live_cis(df, row, mode)

                alp_pos = client.position(alp_sym) if not dry_run else None
                accel   = _accel_state(
                    len(df)-1,
                    np.array([sc["soft_score"]] * len(df)),
                    np.array([sc["rvol_now"]] * len(df)),
                    mode.accel_bars,
                )

                if cis_total >= mode.cis_threshold:
                    # EXIT with HALO stagger
                    lots_in = float(row["lots_in"])
                    lots_now, exit_note = halo_exit(cis_total, lots_in)
                    if not dry_run:
                        client.close_position(alp_sym)
                    pnl = _estimate_pnl(row, sc["price"], alp_pos)
                    db.execute("DELETE FROM positions WHERE symbol=?", (raw_sym,))
                    _log_trade(db, now, raw_sym, "EXIT", row["side"],
                               float(alp_pos["qty"]) if alp_pos else lots_in,
                               sc["price"], lots_in, mode_name, pnl,
                               f"CIS={cis_total} {exit_note}")
                    result.exits.append({
                        "symbol": raw_sym, "cis": cis_total, "flags": cis_flags,
                        "pnl_usd": pnl,
                    })
                    _log_cycle(db, now, raw_sym, sc, gates_pass, f"EXIT_CIS_{cis_total}")

                elif accel == "DECEL" and row["lots_in"] > 0.5:
                    # SCALE-OUT: lock partial
                    scale_lot = round(random.uniform(HALO.scale_lot_min, HALO.scale_lot_max), 2)
                    out_qty   = _lot_qty(equity, scale_lot, sc["price"], mode)
                    if not dry_run and alp_pos and float(alp_pos.get("qty", 0)) > out_qty:
                        client.place_order(alp_sym, out_qty, "sell")
                    new_lots = max(row["lots_in"] - scale_lot, 0)
                    db.execute("UPDATE positions SET lots_in=? WHERE symbol=?", (new_lots, raw_sym))
                    _log_trade(db, now, raw_sym, "SCALE_OUT", row["side"],
                               out_qty, sc["price"], scale_lot, mode_name, 0.0, "DECEL")
                    result.scales.append({"symbol": raw_sym, "action": "SCALE_OUT", "lots": new_lots})
                    _log_cycle(db, now, raw_sym, sc, gates_pass, "SCALE_OUT")

                elif accel == "ACCEL" and row["lots_in"] < mode.max_lots:
                    # SCALE-IN
                    scale_lot = round(random.uniform(HALO.scale_lot_min, HALO.scale_lot_max), 2)
                    new_lots  = min(row["lots_in"] + scale_lot, mode.max_lots)
                    add_lots  = new_lots - row["lots_in"]
                    add_qty   = _lot_qty(equity, add_lots, sc["price"], mode)
                    if not dry_run:
                        client.place_order(alp_sym, add_qty, row["side"])
                    db.execute("UPDATE positions SET lots_in=? WHERE symbol=?", (new_lots, raw_sym))
                    _log_trade(db, now, raw_sym, "SCALE_IN", row["side"],
                               add_qty, sc["price"], add_lots, mode_name, 0.0, "ACCEL")
                    result.scales.append({"symbol": raw_sym, "action": "SCALE_IN", "lots": new_lots})
                    _log_cycle(db, now, raw_sym, sc, gates_pass, "SCALE_IN")
                else:
                    _log_cycle(db, now, raw_sym, sc, gates_pass, "HOLD")

            else:
                # ── FLAT: check entry ─────────────────────────────────────────
                if not gates_pass:
                    result.skips.append({"symbol": raw_sym, "killed_by": killed})
                    _log_cycle(db, now, raw_sym, sc, gates_pass, f"GATE_KILL:{','.join(killed)}")
                    continue

                if sc["soft_score"] < mode.entry_thr:
                    result.skips.append({"symbol": raw_sym, "reason": "SCORE_LOW", "score": sc["soft_score"]})
                    _log_cycle(db, now, raw_sym, sc, gates_pass, "SCORE_LOW")
                    continue

                # HALO entry decision
                halo_dec = halo_entry(sc["soft_score"], sc["jedi_raw"], mode_name)
                if halo_dec.action == "SKIP":
                    result.skips.append({"symbol": raw_sym, "reason": "HALO_SKIP"})
                    _log_cycle(db, now, raw_sym, sc, gates_pass, "HALO_SKIP")
                    continue

                side = "buy" if sc["jedi_raw"] >= 0 else "sell"
                # MTF confirmation filter
                try:
                    from ds_app.mtf_confirm import mtf_confirm
                    mtf_result, mtf_mult = mtf_confirm(raw_sym, side)
                except Exception:
                    mtf_result, mtf_mult = "NEUTRAL", 0.75

                # OBI hard gate (T1-A): OBI actively opposes direction → block entry
                obi_label = "SKIP"
                try:
                    from ds_app.obi_signal import get_obi
                    obi = get_obi(raw_sym)
                    obi_vote  = obi.get("vote", 0)
                    obi_label = obi.get("label", "BALANCED")
                    obi_ratio = obi.get("obi", 0.0)
                    direction_vote = 1 if side == "buy" else -1
                    if obi_vote != 0 and obi_vote != direction_vote:
                        # OBI explicitly opposing (BID_HEAVY on a SHORT or ASK_HEAVY on a LONG)
                        result.skips.append({"symbol": raw_sym, "reason": "OBI_GATE", "obi": obi_ratio, "label": obi_label})
                        _log_cycle(db, now, raw_sym, sc, False, f"OBI_GATE:{obi_label}:{obi_ratio:+.3f}")
                        continue
                    # OBI neutral or aligned: use as size modifier (aligned = boost, neutral = flat)
                    if obi_vote == direction_vote:
                        mtf_mult = min(mtf_mult * 1.15, 1.5)   # OBI confirms → +15% size
                        mtf_result = f"{mtf_result}+OBI_ALIGN"
                except Exception:
                    obi_label = "ERROR"

                # Cumulative significant levels gate + size multiplier (T1-C)
                dr_zone   = "NO_DATA"
                dr_prox   = None
                lvl_mult  = 1.0
                try:
                    from ds_app.target_levels import dr_entry_allowed, get_current_levels, level_stack_mult
                    dr_ok, dr_zone = dr_entry_allowed(raw_sym)
                    lvl = get_current_levels(raw_sym)
                    dr_prox  = lvl.get("nearest_sig_pct")
                    lvl_mult = level_stack_mult(raw_sym)
                    if not dr_ok:
                        result.skips.append({"symbol": raw_sym, "reason": "DR_ZONE", "zone": dr_zone})
                        _log_cycle(db, now, raw_sym, sc, False, f"DR_GATE:{dr_zone}")
                        continue
                except Exception:
                    pass

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

                # VWAP alignment multiplier (T3-A)
                vwap_mult = 1.0
                try:
                    from ds_app.vwap_signal import get_vwap_status, vwap_size_mult
                    vs = get_vwap_status(raw_sym)
                    vwap_mult = vwap_size_mult(
                        vs.get("vwap_bias", 0), side, vs.get("vwap_dev_pct", 0.0) or 0.0
                    )
                except Exception:
                    pass

                # MRT vol regime multiplier (0C fix — wired 2026-04-19)
                mrt_mult = sc.get("mrt_vol_mult", 1.0)
                effective_lot = round(
                    halo_dec.lot_fraction * mtf_mult * ca_mult * cap_frac
                    * oi_mult * fng_mult * liq_mult * mrt_mult * lvl_mult * vwap_mult, 3
                )
                qty  = _lot_qty(equity, effective_lot, sc["price"], mode)
                if not dry_run:
                    client.place_order(alp_sym, qty, side)

                db.execute("""
                    INSERT OR REPLACE INTO positions
                    (symbol, side, entry_ts, entry_price, entry_score, entry_regime,
                     entry_jedi, lots_in, mode, jitter_bars_left)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                """, (raw_sym, side, now, sc["price"], sc["soft_score"],
                      sc["regime"], sc["jedi_raw"], halo_dec.lot_fraction, mode_name,
                      halo_dec.delay_bars))

                if halo_dec.split_remainder > 0:
                    split_qty = _lot_qty(equity, halo_dec.split_remainder, sc["price"], mode)
                    if not dry_run:
                        client.place_order(alp_sym, split_qty, side)
                    _log_trade(db, now, raw_sym, "ENTRY_SPLIT", side,
                               split_qty, sc["price"], halo_dec.split_remainder, mode_name, 0.0,
                               f"HALO_SPLIT score={sc['soft_score']:.3f}")

                _log_trade(db, now, raw_sym, "ENTRY", side, qty, sc["price"],
                           effective_lot, mode_name, 0.0,
                           f"score={sc['soft_score']:.3f} regime={sc['regime']} "
                           f"mrt={sc.get('mrt_vol_label','?')}×{mrt_mult:.2f} "
                           f"mtf={mtf_result} obi={obi_label} "
                           f"lvl={dr_zone}×{lvl_mult:.2f}"
                           f"{'@'+str(round(dr_prox,3))+'%' if dr_prox is not None else ''} "
                           f"ca={ca_regime} oi={oi_mult:.2f} fng={fng_mult:.2f} "
                           f"cap={cap_frac:.2f} liq={liq_mult:.2f}")
                result.entries.append({
                    "symbol": raw_sym, "side": side, "score": sc["soft_score"],
                    "regime": sc["regime"], "jedi": sc["jedi_raw"], "halo": halo_dec.note,
                })
                _log_cycle(db, now, raw_sym, sc, gates_pass, f"ENTRY_{side.upper()}")

        except Exception as exc:
            log.exception("cycle %s: %s", raw_sym, exc)
            result.errors.append(f"{raw_sym}: {exc}")

    db.commit()
    db.close()
    return asdict(result)


# ── Report ─────────────────────────────────────────────────────────────────────

def get_status() -> dict:
    if not ALPACA_KEY or not ALPACA_SECRET:
        return {"error": "ALPACA_KEY / ALPACA_SECRET not set"}

    client = AlpacaClient(ALPACA_KEY, ALPACA_SECRET)
    acct   = client.account()

    db = _init_db(TRADES_DB)
    positions = [dict(r) for r in db.execute("SELECT * FROM positions").fetchall()]
    recent_trades = [dict(r) for r in
                     db.execute("SELECT * FROM trades ORDER BY id DESC LIMIT 50").fetchall()]
    recent_cycles = [dict(r) for r in
                     db.execute("SELECT * FROM cycle_log ORDER BY rowid DESC LIMIT 100").fetchall()]
    db.close()

    total_pnl = sum(t["pnl_usd"] or 0 for t in recent_trades)
    return {
        "account": {
            "equity":        float(acct.get("equity", 0)),
            "buying_power":  float(acct.get("buying_power", 0)),
            "cash":          float(acct.get("cash", 0)),
            "portfolio_value": float(acct.get("portfolio_value", 0)),
        },
        "open_positions": positions,
        "trade_count":    len(recent_trades),
        "total_pnl_usd":  round(total_pnl, 2),
        "recent_trades":  recent_trades[:20],
        "recent_cycles":  recent_cycles[:20],
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _estimate_pnl(pos: sqlite3.Row, exit_price: float, alp_pos: dict | None) -> float:
    entry = pos["entry_price"]
    qty   = float(alp_pos["qty"]) if alp_pos else 0.0
    if pos["side"] == "buy":
        return round((exit_price - entry) * qty, 2)
    return round((entry - exit_price) * qty, 2)


def _log_trade(db, ts, symbol, action, side, qty, price, lots, mode, pnl, note):
    db.execute("""
        INSERT INTO trades (ts,symbol,action,side,qty,price,lots,mode,pnl_usd,note)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    """, (ts, symbol, action, side, round(qty, 6), round(price, 4),
          round(lots, 3), mode, round(pnl, 2), note))


def _log_cycle(db, ts, symbol, sc, gates_pass, action):
    db.execute("""
        INSERT INTO cycle_log (ts,symbol,score,regime,jedi_raw,gates_pass,action,note)
        VALUES (?,?,?,?,?,?,?,?)
    """, (ts, symbol, round(sc["soft_score"], 4), sc["regime"],
          round(sc["jedi_raw"], 1), int(gates_pass), action, ""))


if __name__ == "__main__":
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "PADAWAN"
    dry  = "--dry" in sys.argv
    result = run_cycle(mode, dry_run=dry)
    print(json.dumps(result, indent=2))
