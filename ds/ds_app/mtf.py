"""
ds_app/mtf.py — Multi-Timeframe (MTF) alignment scoring for JEDI ORB.

Fetches 5m / 15m / 60m / daily bars and scores directional alignment.
Used by JEDI master to gate entries: only trade when all TFs agree.

MTF Score = weighted alignment:
  5m  weight 0.15  — entry timing
  15m weight 0.25  — direction confirmation
  60m weight 0.35  — trend context
  1d  weight 0.25  — regime

Each TF scored via fast EMA cross + RSI > 50 (bullish) or < 50 (bearish).
Returns MTFScore dataclass with per-TF votes and composite.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

TF_WEIGHTS = {
    "5m":  0.15,
    "15m": 0.25,
    "60m": 0.35,
    "1d":  0.25,
}

# ── indicators ─────────────────────────────────────────────────────────────────

def _ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()

def _rsi(s: pd.Series, n: int = 14) -> pd.Series:
    d = s.diff()
    g = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean()
    lo = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean()
    rs = g / lo.replace(0, np.nan)
    return (100 - 100/(1+rs)).fillna(50.0)

def _safe(x, default=0.0):
    try:
        v = float(x)
        return v if math.isfinite(v) else default
    except Exception:
        return default

# ── TF vote ───────────────────────────────────────────────────────────────────

def _vote_from_ohlcv(df: pd.DataFrame) -> tuple[int, float]:
    """
    Returns (vote, score) for a single timeframe.
    vote: +1 bullish, -1 bearish, 0 neutral.
    score: 0.0–1.0 strength.
    """
    if df is None or df.empty or len(df) < 30:
        return 0, 0.0

    c = df["Close"]
    e9  = _ema(c, 9)
    e21 = _ema(c, 21)
    rsi = _rsi(c)

    last_c   = _safe(c.iloc[-1])
    last_e9  = _safe(e9.iloc[-1])
    last_e21 = _safe(e21.iloc[-1])
    last_rsi = _safe(rsi.iloc[-1], 50.0)

    bullish = (last_e9 > last_e21) and (last_c > last_e9) and (last_rsi > 50)
    bearish = (last_e9 < last_e21) and (last_c < last_e9) and (last_rsi < 50)

    if bullish:
        strength = min(1.0, (last_rsi - 50) / 50 * 2)
        return 1, round(strength, 3)
    elif bearish:
        strength = min(1.0, (50 - last_rsi) / 50 * 2)
        return -1, round(strength, 3)
    else:
        return 0, 0.0


# ── data fetching ─────────────────────────────────────────────────────────────

def _fetch_tf(symbol: str, interval: str, bars: int = 100) -> pd.DataFrame:
    """Fetch OHLCV for a given interval. Crypto via ccxt, stocks via yfinance."""
    end = datetime.utcnow()

    try:
        import ccxt
        # Map interval to ccxt timeframe
        tf_map = {"5m": "5m", "15m": "15m", "60m": "1h", "1d": "1d"}
        ccxt_tf = tf_map.get(interval, "1d")

        # Duration to fetch
        bar_seconds = {"5m": 300, "15m": 900, "60m": 3600, "1d": 86400}
        seconds = bar_seconds.get(interval, 86400) * bars * 2
        since_ms = int((end - timedelta(seconds=seconds)).timestamp() * 1000)

        exchange = ccxt.binance({"enableRateLimit": True})
        base = symbol.upper().replace("-USD", "").replace("USDT", "").replace("/", "")
        pair = f"{base}/USDT"

        ohlcv = exchange.fetch_ohlcv(pair, timeframe=ccxt_tf, since=since_ms, limit=bars)
        if not ohlcv:
            return pd.DataFrame()

        df = pd.DataFrame(ohlcv, columns=["timestamp", "Open", "High", "Low", "Close", "Volume"])
        df.index = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
        df = df.drop(columns=["timestamp"])
        return df.tail(bars)

    except Exception as exc:
        logger.debug("MTF ccxt fetch failed for %s %s: %s", symbol, interval, exc)
        return pd.DataFrame()


# ── main MTF scorer ───────────────────────────────────────────────────────────

@dataclass
class MTFScore:
    symbol: str
    votes: dict[str, int]          # {"5m": 1, "15m": 1, "60m": 1, "1d": 1}
    strengths: dict[str, float]    # per-TF strength
    composite: float               # -1.0 to +1.0
    aligned: bool                  # True if all 4 TFs agree
    direction: int                 # +1 / -1 / 0
    sentiment_stub: float = 0.5    # placeholder for X/Grok feed

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "votes": self.votes,
            "strengths": self.strengths,
            "composite": self.composite,
            "aligned": self.aligned,
            "direction": self.direction,
            "sentiment": self.sentiment_stub,
            "jedi_gate": self.aligned and abs(self.composite) > 0.4,
        }


def score_mtf(symbol: str) -> MTFScore:
    """
    Fetch 5m/15m/60m/1d bars and compute MTF alignment score.
    """
    votes: dict[str, int] = {}
    strengths: dict[str, float] = {}

    for tf in ["5m", "15m", "60m", "1d"]:
        bars = {"5m": 60, "15m": 60, "60m": 72, "1d": 100}[tf]
        df = _fetch_tf(symbol, tf, bars)
        v, s = _vote_from_ohlcv(df)
        votes[tf] = v
        strengths[tf] = s

    # Weighted composite
    composite = sum(votes[tf] * strengths[tf] * TF_WEIGHTS[tf] for tf in TF_WEIGHTS)
    composite = round(max(-1.0, min(1.0, composite)), 4)

    # Aligned: all 4 TFs vote same direction (or 3 of 4 with no opposition)
    vote_vals = list(votes.values())
    bull_count = sum(1 for v in vote_vals if v == 1)
    bear_count = sum(1 for v in vote_vals if v == -1)
    aligned = (bull_count >= 3 and bear_count == 0) or (bear_count >= 3 and bull_count == 0)
    direction = 1 if bull_count >= 3 else (-1 if bear_count >= 3 else 0)

    return MTFScore(
        symbol=symbol,
        votes=votes,
        strengths=strengths,
        composite=composite,
        aligned=aligned,
        direction=direction,
    )


def jedi_gate_score(
    bank_a_score: float,    # 0–1: BOOM algos firing
    bank_b_score: float,    # 0–1: TREND algos firing
    bank_c_score: float,    # 0–1: LEGEND score
    mtf: MTFScore,
    sentiment: float = 0.5, # 0–1: X/Grok sentiment (0.5 = neutral stub)
) -> dict:
    """
    JEDI master composite score. GO when >= 0.65.
    Returns score + breakdown for dashboard display.
    """
    # Weighted JEDI formula
    jedi = (
        bank_a_score * 0.30 +
        bank_b_score * 0.20 +
        bank_c_score * 0.20 +
        (abs(mtf.composite) if mtf.aligned else 0.0) * 0.20 +
        sentiment * 0.10
    )
    jedi = round(min(1.0, max(0.0, jedi)), 4)

    go_signal = (
        jedi >= 0.65 and
        mtf.aligned and
        mtf.direction == 1 and
        bank_a_score > 0.3
    )

    return {
        "jedi_score": jedi,
        "go": go_signal,
        "direction": mtf.direction,
        "breakdown": {
            "boom_weight": round(bank_a_score * 0.30, 4),
            "trend_weight": round(bank_b_score * 0.20, 4),
            "legend_weight": round(bank_c_score * 0.20, 4),
            "mtf_weight": round(abs(mtf.composite) * 0.20 if mtf.aligned else 0.0, 4),
            "sentiment_weight": round(sentiment * 0.10, 4),
        },
        "mtf": mtf.to_dict(),
        "sentiment_stub": sentiment,
    }
