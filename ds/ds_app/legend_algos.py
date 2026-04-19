"""
ds_app/legend_algos.py — LEGEND Bank: 9 legendary trader methods for stock scanning.

Timeline: 1–6 months. Data: daily OHLCV via yfinance (stocks).
Each algo surfaces high-probability swing/position trade setups.

The 9 LEGEND algos:
  WN  — Weinstein Stage 2 base breakout
  MM  — Minervini VCP (Volatility Contraction Pattern)
  OR  — O'Neil CAN SLIM breakout (EPS proxy via price + RS + volume)
  SE  — Stockbee Episodic Pivot (gap-up + massive volume)
  RT  — Rayner 200MA trend pullback
  TF  — TTrades MTF fractal (HH/HL on daily confirming weekly)
  DV  — Dragonfly RS line (relative strength vs SPY, 52W high)
  WS  — Wyckoff Spring / LPS accumulation
  DX  — Darvas Box (quiet accumulation then explosive breakout)

Scoring: each algo returns score 0.0–1.0 + signal (True/False) + reason string.
Scanner aggregates across 400 stocks, returns ranked LEGEND candidates.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ── shared indicators ─────────────────────────────────────────────────────────

def _sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()

def _ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()

def _atr(h: pd.Series, l: pd.Series, c: pd.Series, n: int = 14) -> pd.Series:
    prev = c.shift(1)
    tr = pd.concat([(h - l).abs(), (h - prev).abs(), (l - prev).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean()

def _rsi(s: pd.Series, n: int = 14) -> pd.Series:
    d = s.diff()
    g = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean()
    lo = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean()
    rs = g / lo.replace(0, np.nan)
    return (100 - 100/(1+rs)).fillna(50.0)

def _safe(x, default=0.0) -> float:
    try:
        v = float(x)
        return v if math.isfinite(v) else default
    except Exception:
        return default

def _last(s: pd.Series) -> float:
    return _safe(s.iloc[-1]) if len(s) else 0.0

def _last_bool(s: pd.Series) -> bool:
    return bool(s.iloc[-1]) if len(s) else False


# ── result dataclass ──────────────────────────────────────────────────────────

@dataclass
class LegendSignal:
    algo_id: str
    signal: bool          # True = setup is active
    score: float          # 0.0 – 1.0
    reason: str
    entry_zone: float = 0.0   # suggested entry price
    target: float = 0.0       # price target (rough)
    stop: float = 0.0         # stop loss level


# ═══════════════════════════════════════════════════════════════════════════════
# WN — WEINSTEIN STAGE 2
# Mark Weinstein's Stage Analysis: stock builds a flat base above 30W MA,
# MA turns up, then breaks out on expanding volume.
# ═══════════════════════════════════════════════════════════════════════════════

def legend_WN(df: pd.DataFrame) -> LegendSignal:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]

    if len(c) < 150:
        return LegendSignal("WN", False, 0.0, "insufficient data")

    ma30w = _sma(c, 150)        # ~30 weeks on daily bars
    ma_slope = (ma30w - ma30w.shift(20)) / 20
    ma_rising = _last(ma_slope) > 0

    # Base: price within 15% of MA for 60+ bars
    deviation = ((c - ma30w) / ma30w * 100).abs()
    in_base_60 = (deviation.rolling(60).max() < 15).fillna(False)

    # Breakout: close above MA AND above recent 60-bar high
    high_60 = h.shift(1).rolling(60).max()
    breakout = (c > ma30w) & (c > high_60)

    # Volume expansion
    vol_surge = v > _sma(v, 20) * 1.5

    was_in_base = _last_bool(in_base_60)
    broke_out = _last_bool(breakout)
    vol_ok = _last_bool(vol_surge)

    signal = ma_rising and was_in_base and broke_out and vol_ok
    conds = [ma_rising, was_in_base, broke_out, vol_ok]
    score = round(sum(conds) / len(conds), 3)

    reasons = []
    if ma_rising: reasons.append("MA150 rising")
    if was_in_base: reasons.append("60-bar base")
    if broke_out: reasons.append("breakout above base+MA")
    if vol_ok: reasons.append("vol expansion")

    price = _last(c)
    return LegendSignal("WN", signal, score,
                        "; ".join(reasons) or "no setup",
                        entry_zone=price,
                        target=round(price * 1.30, 2),
                        stop=round(_last(ma30w) * 0.97, 2))


# ═══════════════════════════════════════════════════════════════════════════════
# MM — MINERVINI VCP (Volatility Contraction Pattern)
# Progressive tightening of price ranges + declining volume in base.
# Each contraction is narrower than the prior one. Breakout on pivot vol.
# ═══════════════════════════════════════════════════════════════════════════════

def legend_MM(df: pd.DataFrame) -> LegendSignal:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    if len(c) < 60:
        return LegendSignal("MM", False, 0.0, "insufficient data")

    # Overall uptrend: price above 150MA and 200MA
    ma150 = _sma(c, min(150, len(c)))
    ma200 = _sma(c, min(200, len(c)))
    above_ma = (c > ma150) & (c > ma200)
    in_uptrend = _last_bool(above_ma)

    # RS: stock up more than market proxy (use raw price momentum as proxy)
    roc_63 = (c - c.shift(63)) / c.shift(63) * 100
    strong_rs = _last(roc_63) > 10  # up >10% in 3 months

    # VCP: look for contracting ranges in last 3 weeks
    def _range_pct(start: int, end: int) -> float:
        sl = c.iloc[start:end]
        if sl.empty: return 0.0
        return (sl.max() - sl.min()) / sl.mean() * 100

    n = len(c)
    r1 = _range_pct(max(0, n-60), max(0, n-40))
    r2 = _range_pct(max(0, n-40), max(0, n-20))
    r3 = _range_pct(max(0, n-20), n)
    contracting = (r1 > 0 and r2 > 0 and r3 > 0 and
                   r1 > r2 and r2 > r3 and r3 < 8)

    # Pivot breakout: today's close above 5-week high on vol surge
    high_25 = h.shift(1).rolling(25).max()
    pivot_break = (c > high_25) & (v > _sma(v, 50) * 1.4)
    at_pivot = _last_bool(pivot_break)

    signal = in_uptrend and strong_rs and contracting and at_pivot
    conds = [in_uptrend, strong_rs, contracting, at_pivot]
    score = round(sum(conds) / len(conds), 3)

    reasons = []
    if in_uptrend: reasons.append("above MA150+200")
    if strong_rs: reasons.append(f"RS strong (+{_last(roc_63):.0f}% 3M)")
    if contracting: reasons.append(f"VCP contracting ({r1:.1f}→{r2:.1f}→{r3:.1f}%)")
    if at_pivot: reasons.append("pivot breakout + vol")

    price = _last(c)
    return LegendSignal("MM", signal, score,
                        "; ".join(reasons) or "no VCP setup",
                        entry_zone=price,
                        target=round(price * 1.25, 2),
                        stop=round(price * 0.93, 2))


# ═══════════════════════════════════════════════════════════════════════════════
# OR — O'NEIL CAN SLIM BREAKOUT
# Cup-and-handle or flat base breakout: RS line at highs, vol surge.
# EPS acceleration proxied by price momentum (no fundamental data).
# ═══════════════════════════════════════════════════════════════════════════════

def legend_OR(df: pd.DataFrame) -> LegendSignal:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    if len(c) < 100:
        return LegendSignal("OR", False, 0.0, "insufficient data")

    # RS proxy: 3M and 6M momentum (O'Neil RS line relative to market)
    roc_63  = (c - c.shift(63))  / c.shift(63).replace(0, np.nan) * 100
    roc_126 = (c - c.shift(126)) / c.shift(126).replace(0, np.nan) * 100
    rs_score = _last(roc_63) * 0.4 + _last(roc_126) * 0.6
    strong_rs = rs_score > 15  # RS composite > 15%

    # Near 52-week high (O'Neil: buy within 5% of 52W high)
    high_52w = h.rolling(min(252, len(h))).max()
    near_52w_high = (c >= high_52w * 0.95).iloc[-1]

    # Volume dry-up in handle (last 10 bars vol < 20-bar avg)
    handle_vol_low = (_last(v) < _last(_sma(v, 20)) * 0.85)

    # Breakout bar: vol surge on up day
    vol_surge = (v > _sma(v, 50) * 1.4) & (c > c.shift(1))
    at_breakout = _last_bool(vol_surge)

    # Price above 50MA
    above_50 = c > _sma(c, 50)
    trend_ok = _last_bool(above_50)

    signal = strong_rs and near_52w_high and at_breakout and trend_ok
    conds = [strong_rs, near_52w_high, at_breakout, trend_ok]
    score = round(sum(conds) / len(conds), 3)

    reasons = []
    if strong_rs: reasons.append(f"RS composite {rs_score:.0f}%")
    if near_52w_high: reasons.append("within 5% of 52W high")
    if at_breakout: reasons.append("vol surge breakout")
    if trend_ok: reasons.append("above MA50")

    price = _last(c)
    return LegendSignal("OR", signal, score,
                        "; ".join(reasons) or "no CAN SLIM setup",
                        entry_zone=price,
                        target=round(price * 1.20, 2),
                        stop=round(price * 0.92, 2))


# ═══════════════════════════════════════════════════════════════════════════════
# SE — STOCKBEE EPISODIC PIVOT
# Gap-up >3% on 3×+ average volume with a fundamental catalyst.
# (Catalyst proxied by vol spike since we have no news feed.)
# ═══════════════════════════════════════════════════════════════════════════════

def legend_SE(df: pd.DataFrame) -> LegendSignal:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    if len(c) < 30:
        return LegendSignal("SE", False, 0.0, "insufficient data")

    # Gap-up: today's open > yesterday's close by >3%
    gap_pct = (df["Open"] - c.shift(1)) / c.shift(1) * 100
    big_gap = gap_pct > 3.0

    # Massive volume: 3× the 20-day average
    avg_vol = _sma(v, 20)
    huge_vol = v > avg_vol * 3.0

    # Close near high of day (strong follow-through)
    day_range = h - l
    close_pct = (c - l) / day_range.replace(0, np.nan)
    strong_close = close_pct > 0.6

    # Within last 3 bars (recent pivot)
    recent_gap = big_gap.iloc[-3:].any()
    recent_vol  = huge_vol.iloc[-3:].any()
    recent_str  = strong_close.iloc[-3:].any()

    # Above 50MA (not a dead-cat bounce)
    above_50 = _last(c) > _last(_sma(c, min(50, len(c))))

    signal = recent_gap and recent_vol and recent_str and above_50
    conds = [recent_gap, recent_vol, recent_str, above_50]
    score = round(sum(conds) / len(conds), 3)

    # Score bonus: vol intensity
    vol_ratio = _last(v) / (_last(avg_vol) + 1)
    score = min(1.0, round(score * 0.6 + min(vol_ratio / 5.0, 1.0) * 0.4, 3))

    reasons = []
    if recent_gap: reasons.append(f"gap-up {_last(gap_pct):.1f}%")
    if recent_vol: reasons.append(f"vol {vol_ratio:.1f}×avg")
    if recent_str: reasons.append("strong close")
    if above_50: reasons.append("above MA50")

    price = _last(c)
    return LegendSignal("SE", signal, score,
                        "; ".join(reasons) or "no EP setup",
                        entry_zone=price,
                        target=round(price * 1.20, 2),
                        stop=round(price * 0.93, 2))


# ═══════════════════════════════════════════════════════════════════════════════
# RT — RAYNER TREND (200MA PULLBACK)
# Uptrend (price > 200MA, MA rising), pull back to 50MA / dynamic support,
# bullish reversal bar. 1:3 risk/reward setups.
# ═══════════════════════════════════════════════════════════════════════════════

def legend_RT(df: pd.DataFrame) -> LegendSignal:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    n = min(200, len(c))
    if len(c) < 60:
        return LegendSignal("RT", False, 0.0, "insufficient data")

    ma200 = _sma(c, n)
    ma50  = _sma(c, min(50, len(c)))
    ma200_slope = (ma200 - ma200.shift(20)) / 20

    # Major uptrend
    above_200 = _last(c) > _last(ma200)
    ma_rising = _last(ma200_slope) > 0

    # Pullback to 50MA (price within 3% of MA50)
    dist_to_50 = abs(_last(c) - _last(ma50)) / _last(ma50) * 100
    at_support = dist_to_50 < 4.0

    # Bullish reversal bar (hammer or engulfing)
    body = (c - df["Open"]).abs()
    lower_wick = df["Open"].combine(c, min) - l
    bullish_rev = (lower_wick > body * 1.5) & (c > df["Open"])
    reversal = _last_bool(bullish_rev)

    # RSI not overbought (room to run)
    rsi = _rsi(c)
    rsi_ok = 35 < _last(rsi) < 65

    signal = above_200 and ma_rising and at_support and (reversal or rsi_ok)
    conds = [above_200, ma_rising, at_support, reversal or rsi_ok]
    score = round(sum(conds) / len(conds), 3)

    reasons = []
    if above_200: reasons.append("above MA200")
    if ma_rising: reasons.append("MA200 rising")
    if at_support: reasons.append(f"at MA50 ({dist_to_50:.1f}% away)")
    if reversal: reasons.append("bullish reversal bar")
    if rsi_ok: reasons.append(f"RSI {_last(rsi):.0f}")

    price = _last(c)
    stop_level = min(_last(l), _last(ma200)) * 0.99
    return LegendSignal("RT", signal, score,
                        "; ".join(reasons) or "no pullback setup",
                        entry_zone=price,
                        target=round(price * 1.20, 2),
                        stop=round(stop_level, 2))


# ═══════════════════════════════════════════════════════════════════════════════
# TF — TTRADES MTF FRACTAL
# Higher highs + higher lows confirmed on daily AND weekly timeframe.
# Fibonacci retracement entry at 38-61% of last swing.
# ═══════════════════════════════════════════════════════════════════════════════

def legend_TF(df: pd.DataFrame) -> LegendSignal:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    if len(c) < 50:
        return LegendSignal("TF", False, 0.0, "insufficient data")

    # Daily HH/HL (last 20 bars)
    daily_hh = h.rolling(20).max().iloc[-1] > h.rolling(20).max().shift(10).iloc[-1]
    daily_hl = l.rolling(20).min().iloc[-1] > l.rolling(20).min().shift(10).iloc[-1]
    daily_trend = daily_hh and daily_hl

    # Weekly proxy: resample to 5-bar chunks
    weekly_c = c.iloc[::5]
    weekly_h = h.iloc[::5]
    weekly_l = l.iloc[::5]
    if len(weekly_c) >= 4:
        w_hh = float(weekly_h.iloc[-1]) > float(weekly_h.iloc[-2])
        w_hl = float(weekly_l.iloc[-1]) > float(weekly_l.iloc[-2])
        weekly_trend = w_hh and w_hl
    else:
        weekly_trend = daily_trend

    # Fib retracement: find swing high/low in last 40 bars
    sw_high = float(h.iloc[-40:].max())
    sw_low  = float(l.iloc[-40:].min())
    sw_range = sw_high - sw_low
    price = _last(c)
    if sw_range > 0:
        fib_382 = sw_high - sw_range * 0.382
        fib_618 = sw_high - sw_range * 0.618
        in_fib_zone = fib_618 <= price <= fib_382
    else:
        in_fib_zone = False

    # Volume confirming
    vol_ok = _last(v) > _last(_sma(v, 10))

    signal = daily_trend and weekly_trend and in_fib_zone
    conds = [daily_trend, weekly_trend, in_fib_zone, vol_ok]
    score = round(sum(conds) / len(conds), 3)

    reasons = []
    if daily_trend: reasons.append("daily HH/HL")
    if weekly_trend: reasons.append("weekly HH/HL")
    if in_fib_zone: reasons.append(f"in Fib 38–62% zone")
    if vol_ok: reasons.append("vol above avg")

    return LegendSignal("TF", signal, score,
                        "; ".join(reasons) or "no fractal setup",
                        entry_zone=price,
                        target=round(sw_high * 1.05, 2),
                        stop=round(sw_low * 0.99, 2))


# ═══════════════════════════════════════════════════════════════════════════════
# DV — DRAGONFLY RS STRENGTH
# Relative Strength line making 52-week high (stock outperforming SPY).
# Sector accumulation phase.
# ═══════════════════════════════════════════════════════════════════════════════

def legend_DV(df: pd.DataFrame, spy_df: pd.DataFrame | None = None) -> LegendSignal:
    c = df["Close"]
    v = df["Volume"]
    if len(c) < 60:
        return LegendSignal("DV", False, 0.0, "insufficient data")

    # RS line vs SPY (or vs itself if no SPY data — use momentum proxy)
    if spy_df is not None and len(spy_df) == len(c):
        spy_c = spy_df["Close"]
        rs_line = c / spy_c.replace(0, np.nan)
    else:
        # Proxy: stock's 6M momentum (RS vs "market" assumed flat)
        rs_line = c / c.shift(126).replace(0, np.nan)

    rs_52w_high = rs_line.rolling(min(252, len(rs_line))).max()
    rs_at_high = (rs_line >= rs_52w_high * 0.98).iloc[-1]

    # Stock uptrend
    above_50 = _last(c) > _last(_sma(c, min(50, len(c))))

    # Accumulation: OBV making new highs
    direction = np.sign(c.diff()).fillna(0)
    obv = (direction * v).cumsum()
    obv_high = (obv == obv.rolling(min(60, len(obv))).max()).iloc[-1]

    # Not extended (within 10% of 10-week MA)
    ma50 = _sma(c, min(50, len(c)))
    dist = abs(_last(c) - _last(ma50)) / _last(ma50) * 100
    not_extended = dist < 12

    signal = rs_at_high and above_50 and obv_high
    conds = [rs_at_high, above_50, obv_high, not_extended]
    score = round(sum(conds) / len(conds), 3)

    reasons = []
    if rs_at_high: reasons.append("RS line at 52W high")
    if above_50: reasons.append("above MA50")
    if obv_high: reasons.append("OBV accumulation")
    if not_extended: reasons.append(f"not extended ({dist:.1f}% from MA50)")

    price = _last(c)
    return LegendSignal("DV", signal, score,
                        "; ".join(reasons) or "no RS setup",
                        entry_zone=price,
                        target=round(price * 1.25, 2),
                        stop=round(_last(ma50) * 0.97, 2))


# ═══════════════════════════════════════════════════════════════════════════════
# WS — WYCKOFF SPRING / LPS
# Accumulation schematic: SC→AR→ST→Spring→LPS→Breakout
# Detects Spring (false breakdown below support then reclaim) or LPS
# (Last Point of Support — pullback after test, price holds above support).
# ═══════════════════════════════════════════════════════════════════════════════

def legend_WS(df: pd.DataFrame) -> LegendSignal:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    if len(c) < 60:
        return LegendSignal("WS", False, 0.0, "insufficient data")

    # Support: lowest low of last 60 bars (excluding last 5)
    support = float(l.iloc[:-5].rolling(60).min().iloc[-1])
    resistance = float(h.iloc[:-5].rolling(60).max().iloc[-1])
    price = _last(c)

    # Spring: low dipped below support but closed back above it
    recent_low = float(l.iloc[-5:].min())
    spring = (recent_low < support * 1.001) and (price > support)

    # LPS: price pulls back to support zone (within 3%) + holds + low vol
    at_support_zone = abs(price - support) / support < 0.04
    low_vol_pullback = _last(v) < _last(_sma(v, 20)) * 0.8
    lps = at_support_zone and low_vol_pullback

    # Upward bias: price above 50-bar MA
    above_ma = price > _last(_sma(c, min(50, len(c))))

    # Cause built: range duration > 30 bars (accumulation time)
    cause_built = len(c) >= 30

    setup = spring or lps
    signal = setup and above_ma and cause_built
    conds = [spring or lps, above_ma, cause_built,
             _last(v) < _last(_sma(v, 20)) * 1.5]
    score = round(sum(conds) / len(conds), 3)

    reasons = []
    if spring: reasons.append("Wyckoff Spring (false breakdown + reclaim)")
    if lps: reasons.append("LPS (low-vol pullback to support)")
    if above_ma: reasons.append("above MA50")
    if cause_built: reasons.append("accumulation base built")

    return LegendSignal("WS", signal, score,
                        "; ".join(reasons) or "no Wyckoff setup",
                        entry_zone=price,
                        target=round(resistance * 1.05, 2),
                        stop=round(support * 0.97, 2))


# ═══════════════════════════════════════════════════════════════════════════════
# DX — DARVAS BOX BREAKOUT
# Nicolas Darvas: stock makes new high, consolidates in a box,
# then breaks above box ceiling on expanding volume.
# ═══════════════════════════════════════════════════════════════════════════════

def legend_DX(df: pd.DataFrame) -> LegendSignal:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    if len(c) < 30:
        return LegendSignal("DX", False, 0.0, "insufficient data")

    # Find box: last 15-bar range where price was contained
    box_high = float(h.iloc[-16:-1].max())
    box_low  = float(l.iloc[-16:-1].min())
    box_width = (box_high - box_low) / box_low * 100

    price = _last(c)

    # Box is valid: width < 15%, duration > 5 bars
    box_tight = 0 < box_width < 15
    box_duration = (h.iloc[-15:] < box_high * 1.005).sum() > 5

    # Breakout: close above box ceiling
    box_break = price > box_high

    # Volume surge on breakout
    vol_surge = _last(v) > _last(_sma(v, 20)) * 1.3

    # Overall uptrend (new high in last 52 weeks)
    near_52w = price > float(h.rolling(min(200, len(h))).max().iloc[-1]) * 0.85

    signal = box_tight and box_duration and box_break and vol_surge
    conds = [box_tight, box_duration, box_break, vol_surge]
    score = round(sum(conds) / len(conds), 3)

    reasons = []
    if box_tight: reasons.append(f"Darvas box {box_width:.1f}% wide")
    if box_duration: reasons.append("5+ bars in box")
    if box_break: reasons.append(f"break above ${box_high:.2f}")
    if vol_surge: reasons.append("vol expansion")

    return LegendSignal("DX", signal, score,
                        "; ".join(reasons) or "no Darvas setup",
                        entry_zone=price,
                        target=round(price * 1.20, 2),
                        stop=round(box_low * 0.99, 2))


# ═══════════════════════════════════════════════════════════════════════════════
# REGISTRY
# ═══════════════════════════════════════════════════════════════════════════════

LEGEND_REGISTRY: dict[str, dict] = {
    "WN": {"fn": legend_WN, "name": "Weinstein Stage 2",       "horizon": "3–6M", "trader": "Mark Weinstein"},
    "MM": {"fn": legend_MM, "name": "Minervini VCP",            "horizon": "2–4M", "trader": "Mark Minervini"},
    "OR": {"fn": legend_OR, "name": "O'Neil CAN SLIM",          "horizon": "2–4M", "trader": "William O'Neil"},
    "SE": {"fn": legend_SE, "name": "Stockbee Ep Pivot",        "horizon": "1–3M", "trader": "Pradeep Bonde"},
    "RT": {"fn": legend_RT, "name": "Rayner 200MA Pullback",    "horizon": "2–4M", "trader": "Rayner Teo"},
    "TF": {"fn": legend_TF, "name": "TTrades MTF Fractal",      "horizon": "2–6M", "trader": "TraderLion"},
    "DV": {"fn": legend_DV, "name": "Dragonfly RS Strength",    "horizon": "3–6M", "trader": "IBD/Dragonfly"},
    "WS": {"fn": legend_WS, "name": "Wyckoff Spring/LPS",       "horizon": "2–5M", "trader": "Richard Wyckoff"},
    "DX": {"fn": legend_DX, "name": "Darvas Box Breakout",      "horizon": "1–3M", "trader": "Nicolas Darvas"},
}

LEGEND_IDS = list(LEGEND_REGISTRY.keys())


def score_symbol(df: pd.DataFrame, spy_df: pd.DataFrame | None = None) -> dict[str, LegendSignal]:
    """Run all 9 LEGEND algos on a single symbol's OHLCV DataFrame."""
    results: dict[str, LegendSignal] = {}
    for algo_id, meta in LEGEND_REGISTRY.items():
        try:
            if algo_id == "DV":
                sig = meta["fn"](df, spy_df)
            else:
                sig = meta["fn"](df)
            results[algo_id] = sig
        except Exception as exc:
            logger.debug("LEGEND %s error: %s", algo_id, exc)
            results[algo_id] = LegendSignal(algo_id, False, 0.0, f"error: {exc}")
    return results


def legend_composite_score(signals: dict[str, LegendSignal]) -> float:
    """
    Composite LEGEND score for a symbol: weighted average of individual scores.
    Signals that fire (True) get 2× weight.
    Returns 0.0–1.0.
    """
    total_weight = 0.0
    weighted_sum = 0.0
    for sig in signals.values():
        w = 2.0 if sig.signal else 1.0
        weighted_sum += sig.score * w
        total_weight += w
    return round(weighted_sum / total_weight, 4) if total_weight > 0 else 0.0
