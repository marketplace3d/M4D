"""
ds_app/algos_crypto.py — 27 simplified crypto-native algo signal builders.

Three banks of 9:
  Bank A — BREAK  (breakout from range/compression)
  Bank B — TREND  (trend identification and riding)
  Bank C — MOMENTUM (momentum + volume confirmation)

Design principles:
  - Each algo uses ONE signal family (no indicator soup)
  - 2-3 tunable parameters max
  - All computable from daily OHLCV (no exotic data)
  - Exit strategy standardised: ATR trailing stop OR hold_bars + stop_loss_pct
  - Anti-overfit: params kept to minimum; optimizer uses IS/OOS walk-forward

Each feature builder returns a DataFrame with:
  entry  : bool Series — entry signal
  exit_sig : bool Series — algo-specific exit (may be used alongside stop)
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

# ── shared low-level helpers ──────────────────────────────────────────────────

def _ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def _sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()


def _atr(h: pd.Series, l: pd.Series, c: pd.Series, n: int = 14) -> pd.Series:
    prev_c = c.shift(1)
    tr = pd.concat([(h - l).abs(), (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
    return tr.ewm(span=n, adjust=False).mean()


def _rsi(s: pd.Series, n: int = 14) -> pd.Series:
    delta = s.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50.0)


def _stoch(h: pd.Series, l: pd.Series, c: pd.Series,
           k_n: int = 14, d_n: int = 3) -> tuple[pd.Series, pd.Series]:
    low_n = l.rolling(k_n).min()
    high_n = h.rolling(k_n).max()
    k = 100 * (c - low_n) / (high_n - low_n).replace(0, np.nan)
    k = k.fillna(50.0)
    d = k.rolling(d_n).mean()
    return k, d


def _obv(c: pd.Series, v: pd.Series) -> pd.Series:
    direction = np.sign(c.diff()).fillna(0)
    return (direction * v).cumsum()


def _mfi(h: pd.Series, l: pd.Series, c: pd.Series, v: pd.Series, n: int = 14) -> pd.Series:
    typical = (h + l + c) / 3
    raw_mf = typical * v
    up = (typical > typical.shift(1)).fillna(False)
    pos = raw_mf.where(up, 0.0).rolling(n).sum()
    neg = raw_mf.where(~up, 0.0).rolling(n).sum()
    mfr = pos / neg.replace(0, np.nan)
    return (100 - 100 / (1 + mfr)).fillna(50.0)


def _cmf(h: pd.Series, l: pd.Series, c: pd.Series, v: pd.Series, n: int = 20) -> pd.Series:
    denom = (h - l).replace(0, np.nan)
    mfv = ((c - l) - (h - c)) / denom * v
    return mfv.rolling(n).sum() / v.rolling(n).sum().replace(0, np.nan)


def _crosses_above(a: pd.Series, b: pd.Series) -> pd.Series:
    return (a.shift(1) <= b.shift(1)) & (a > b)


def _crosses_below(a: pd.Series, b: pd.Series) -> pd.Series:
    return (a.shift(1) >= b.shift(1)) & (a < b)


def _supertrend(h: pd.Series, l: pd.Series, c: pd.Series,
                period: int = 10, mult: float = 3.0) -> pd.Series:
    """Returns +1 (bullish) / -1 (bearish) direction series."""
    atr = _atr(h, l, c, period)
    hl2 = (h + l) / 2
    upper_basic = hl2 + mult * atr
    lower_basic = hl2 - mult * atr

    upper = upper_basic.copy()
    lower = lower_basic.copy()
    direction = pd.Series(1, index=c.index)

    for i in range(1, len(c)):
        # upper band
        if upper_basic.iloc[i] < upper.iloc[i - 1] or c.iloc[i - 1] > upper.iloc[i - 1]:
            upper.iloc[i] = upper_basic.iloc[i]
        else:
            upper.iloc[i] = upper.iloc[i - 1]
        # lower band
        if lower_basic.iloc[i] > lower.iloc[i - 1] or c.iloc[i - 1] < lower.iloc[i - 1]:
            lower.iloc[i] = lower_basic.iloc[i]
        else:
            lower.iloc[i] = lower.iloc[i - 1]
        # direction
        if direction.iloc[i - 1] == -1 and c.iloc[i] > upper.iloc[i - 1]:
            direction.iloc[i] = 1
        elif direction.iloc[i - 1] == 1 and c.iloc[i] < lower.iloc[i - 1]:
            direction.iloc[i] = -1
        else:
            direction.iloc[i] = direction.iloc[i - 1]

    return direction


def _psar(h: pd.Series, l: pd.Series, step: float = 0.02, max_step: float = 0.2) -> pd.Series:
    """Parabolic SAR. Returns +1 (bullish) / -1 (bearish)."""
    direction = pd.Series(1, index=h.index)
    psar = l.copy()
    ep = h.copy()
    af = pd.Series(step, index=h.index)

    for i in range(2, len(h)):
        prev_dir = direction.iloc[i - 1]
        prev_psar = psar.iloc[i - 1]
        prev_ep = ep.iloc[i - 1]
        prev_af = af.iloc[i - 1]

        cur_psar = prev_psar + prev_af * (prev_ep - prev_psar)

        if prev_dir == 1:
            cur_psar = min(cur_psar, l.iloc[i - 1], l.iloc[i - 2] if i >= 2 else l.iloc[i - 1])
            if l.iloc[i] < cur_psar:
                direction.iloc[i] = -1
                psar.iloc[i] = prev_ep
                ep.iloc[i] = l.iloc[i]
                af.iloc[i] = step
            else:
                direction.iloc[i] = 1
                psar.iloc[i] = cur_psar
                if h.iloc[i] > prev_ep:
                    ep.iloc[i] = h.iloc[i]
                    af.iloc[i] = min(prev_af + step, max_step)
                else:
                    ep.iloc[i] = prev_ep
                    af.iloc[i] = prev_af
        else:
            cur_psar = max(cur_psar, h.iloc[i - 1], h.iloc[i - 2] if i >= 2 else h.iloc[i - 1])
            if h.iloc[i] > cur_psar:
                direction.iloc[i] = 1
                psar.iloc[i] = prev_ep
                ep.iloc[i] = h.iloc[i]
                af.iloc[i] = step
            else:
                direction.iloc[i] = -1
                psar.iloc[i] = cur_psar
                if l.iloc[i] < prev_ep:
                    ep.iloc[i] = l.iloc[i]
                    af.iloc[i] = min(prev_af + step, max_step)
                else:
                    ep.iloc[i] = prev_ep
                    af.iloc[i] = prev_af

    return direction


def _adx_di(h: pd.Series, l: pd.Series, c: pd.Series, n: int = 14):
    """Returns (adx, plus_di, minus_di) Series."""
    prev_h, prev_l, prev_c = h.shift(1), l.shift(1), c.shift(1)
    up_move = h - prev_h
    dn_move = prev_l - l
    plus_dm = up_move.where((up_move > dn_move) & (up_move > 0), 0.0)
    minus_dm = dn_move.where((dn_move > up_move) & (dn_move > 0), 0.0)

    tr = pd.concat([(h - l).abs(), (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
    atr_n = tr.ewm(span=n, adjust=False).mean()

    plus_di = 100 * plus_dm.ewm(span=n, adjust=False).mean() / atr_n.replace(0, np.nan)
    minus_di = 100 * minus_dm.ewm(span=n, adjust=False).mean() / atr_n.replace(0, np.nan)
    dx = (100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)).fillna(0)
    adx = dx.ewm(span=n, adjust=False).mean()

    return adx.fillna(0), plus_di.fillna(0), minus_di.fillna(0)


def _ema13_exit(c: pd.Series) -> pd.Series:
    e13 = _ema(c, 13)
    return ((c.shift(1) >= e13.shift(1)) & (c < e13)).fillna(False)


# ═══════════════════════════════════════════════════════════════════════════════
# BANK A — BREAK (9 algos)
# ═══════════════════════════════════════════════════════════════════════════════

def feat_DON_BO(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Donchian N-bar channel breakout."""
    out = df.copy()
    c, h, l = out["Close"], out["High"], out["Low"]
    n = int(params.get("n", 20))
    exit_n = int(params.get("exit_n", 10))

    out["entry"] = (c > h.shift(1).rolling(n).max()).fillna(False)
    out["exit_sig"] = (c < l.shift(1).rolling(exit_n).min()).fillna(False)
    return out


def feat_BB_BREAK(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Close breaks above upper Bollinger Band."""
    out = df.copy()
    c = out["Close"]
    period = int(params.get("period", 20))
    mult = float(params.get("mult", 2.0))

    basis = _sma(c, period)
    std = c.rolling(period).std(ddof=0)
    upper = basis + mult * std

    out["entry"] = _crosses_above(c, upper).fillna(False)
    out["exit_sig"] = (c < basis).fillna(False)
    return out


def feat_KC_BREAK(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Close breaks above upper Keltner Channel."""
    out = df.copy()
    c, h, l = out["Close"], out["High"], out["Low"]
    period = int(params.get("period", 20))
    mult = float(params.get("mult", 2.0))

    ema_mid = _ema(c, period)
    atr = _atr(h, l, c, period)
    upper = ema_mid + mult * atr

    out["entry"] = _crosses_above(c, upper).fillna(False)
    out["exit_sig"] = (c < ema_mid).fillna(False)
    return out


def feat_SQZPOP(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Bollinger inside Keltner (squeeze) then pop."""
    out = df.copy()
    c, h, l = out["Close"], out["High"], out["Low"]
    length = int(params.get("length", 20))

    basis = _sma(c, length)
    std = c.rolling(length).std(ddof=0)
    bb_upper = basis + 2.0 * std
    bb_lower = basis - 2.0 * std

    ema_m = _ema(c, length)
    atr = _atr(h, l, c, length)
    kc_upper = ema_m + 2.0 * atr
    kc_lower = ema_m - 2.0 * atr

    squeeze = (bb_upper < kc_upper) & (bb_lower > kc_lower)
    was_squeezed = squeeze.shift(1, fill_value=False)
    pop_bull = ~squeeze & was_squeezed & (c > out["Open"])

    out["entry"] = pop_bull.fillna(False)
    out["exit_sig"] = _ema13_exit(c)
    return out


def feat_ATR_EXP(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Bar range > mult*ATR AND bullish close AND above EMA50."""
    out = df.copy()
    c, h, l = out["Close"], out["High"], out["Low"]
    period = int(params.get("period", 14))
    mult = float(params.get("mult", 1.5))

    atr = _atr(h, l, c, period)
    bar_range = h - l
    bull_bar = c > out["Open"]
    above_trend = c > _ema(c, 50)

    out["entry"] = (bar_range > mult * atr) & bull_bar & above_trend
    out["entry"] = out["entry"].fillna(False)
    out["exit_sig"] = _ema13_exit(c)
    return out


def feat_VOL_BO(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Volume surge + close > prior N-bar high."""
    out = df.copy()
    c, h, v = out["Close"], out["High"], out["Volume"]
    vol_n = int(params.get("vol_n", 20))
    vol_mult = float(params.get("vol_mult", 2.0))
    price_n = int(params.get("price_n", 10))

    vol_surge = v > vol_mult * _sma(v, vol_n)
    price_break = c > h.shift(1).rolling(price_n).max()

    out["entry"] = (vol_surge & price_break).fillna(False)
    out["exit_sig"] = (c < _ema(c, 21)).fillna(False)
    return out


def feat_CONSOL_BO(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """N tight bars then expansion bar."""
    out = df.copy()
    c, h, l = out["Close"], out["High"], out["Low"]
    tight_n = int(params.get("tight_n", 5))
    expand_mult = float(params.get("expand_mult", 1.5))

    atr = _atr(h, l, c, 14)
    bar_range = h - l
    tight_pct = (bar_range / c.replace(0, np.nan)).fillna(0)

    # tight if range < 3% of price for last tight_n bars
    was_tight = (tight_pct.shift(1).rolling(tight_n).max() < 0.03).fillna(False)
    expanding = bar_range > expand_mult * atr
    bull_bar = c > out["Open"]

    out["entry"] = (was_tight & expanding & bull_bar).fillna(False)
    out["exit_sig"] = (c < l.shift(1).rolling(5).min()).fillna(False)
    return out


def feat_NEW_HIGH(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Close at N-bar high (momentum continuation)."""
    out = df.copy()
    c, l = out["Close"], out["Low"]
    n = int(params.get("n", 20))
    exit_n = int(params.get("exit_n", 10))

    at_high = (c == c.rolling(n).max()).fillna(False)
    at_high_shifted = (c > c.shift(1).rolling(n - 1).max()).fillna(False)

    out["entry"] = at_high_shifted
    out["exit_sig"] = (c < c.shift(1).rolling(exit_n).min()).fillna(False)
    return out


def feat_RANGE_BO(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """N-bar tight range then close breaks above range high."""
    out = df.copy()
    c, h, l = out["Close"], out["High"], out["Low"]
    n = int(params.get("n", 10))
    pct_thresh = float(params.get("pct_thresh", 0.08))

    roll_max_h = h.shift(1).rolling(n).max()
    roll_min_l = l.shift(1).rolling(n).min()
    range_width = (roll_max_h - roll_min_l) / c.replace(0, np.nan)
    in_range = (range_width < pct_thresh).fillna(False)

    breakout = c > roll_max_h
    out["entry"] = (in_range & breakout).fillna(False)
    out["exit_sig"] = (c < _ema(c, 21)).fillna(False)
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# BANK B — TREND (9 algos)
# ═══════════════════════════════════════════════════════════════════════════════

def feat_EMA_CROSS(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Fast EMA crosses above slow EMA."""
    out = df.copy()
    c = out["Close"]
    fast = int(params.get("fast", 9))
    slow = int(params.get("slow", 21))

    e_fast = _ema(c, fast)
    e_slow = _ema(c, slow)

    out["entry"] = _crosses_above(e_fast, e_slow).fillna(False)
    out["exit_sig"] = _crosses_below(e_fast, e_slow).fillna(False)
    return out


def feat_EMA_STACK(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Three EMAs fully stacked bullish."""
    out = df.copy()
    c = out["Close"]
    fast = int(params.get("fast", 8))
    mid = int(params.get("mid", 21))
    slow = int(params.get("slow", 55))

    ef = _ema(c, fast)
    em = _ema(c, mid)
    es = _ema(c, slow)

    stacked = (ef > em) & (em > es) & (c > ef)
    was_not = ~stacked.shift(1, fill_value=False)

    out["entry"] = (stacked & was_not).fillna(False)
    out["exit_sig"] = (c < em).fillna(False)
    return out


def feat_MACD_CROSS(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """MACD line crosses above signal line."""
    out = df.copy()
    c = out["Close"]
    fast = int(params.get("fast", 12))
    slow = int(params.get("slow", 26))
    signal = int(params.get("signal", 9))

    macd_line = _ema(c, fast) - _ema(c, slow)
    signal_line = _ema(macd_line, signal)

    out["entry"] = _crosses_above(macd_line, signal_line).fillna(False)
    out["exit_sig"] = _crosses_below(macd_line, signal_line).fillna(False)
    return out


def feat_SUPERTREND(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """SuperTrend flips bullish."""
    out = df.copy()
    h, l, c = out["High"], out["Low"], out["Close"]
    period = int(params.get("period", 10))
    mult = float(params.get("mult", 3.0))

    direction = _supertrend(h, l, c, period, mult)
    out["entry"] = _crosses_above(direction, pd.Series(0, index=direction.index)).fillna(False)
    out["exit_sig"] = _crosses_below(direction, pd.Series(0, index=direction.index)).fillna(False)
    return out


def feat_ADX_TREND(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """ADX > threshold AND +DI crosses above -DI."""
    out = df.copy()
    h, l, c = out["High"], out["Low"], out["Close"]
    period = int(params.get("period", 14))
    thresh = float(params.get("thresh", 20))

    adx, plus_di, minus_di = _adx_di(h, l, c, period)
    trending = adx > thresh
    di_cross = _crosses_above(plus_di, minus_di)

    out["entry"] = (trending & di_cross).fillna(False)
    out["exit_sig"] = (_crosses_below(plus_di, minus_di) | (adx < thresh)).fillna(False)
    return out


def feat_GOLDEN(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """SMA fast crosses above SMA slow (golden cross)."""
    out = df.copy()
    c = out["Close"]
    fast = int(params.get("fast", 50))
    slow = int(params.get("slow", 200))

    sf = _sma(c, fast)
    ss = _sma(c, slow)

    out["entry"] = _crosses_above(sf, ss).fillna(False)
    out["exit_sig"] = _crosses_below(sf, ss).fillna(False)
    return out


def feat_PSAR(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Parabolic SAR flips bullish."""
    out = df.copy()
    h, l = out["High"], out["Low"]
    step = float(params.get("step", 0.02))
    max_step = float(params.get("max_step", 0.2))

    direction = _psar(h, l, step, max_step)
    out["entry"] = _crosses_above(direction, pd.Series(0, index=direction.index)).fillna(False)
    out["exit_sig"] = _crosses_below(direction, pd.Series(0, index=direction.index)).fillna(False)
    return out


def feat_PULLBACK(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Price pulls to fast EMA in uptrend (above slow EMA) then bounces."""
    out = df.copy()
    c, h, l = out["Close"], out["High"], out["Low"]
    fast = int(params.get("fast", 21))
    slow = int(params.get("slow", 55))
    touch_pct = float(params.get("touch_pct", 1.0))

    ef = _ema(c, fast)
    es = _ema(c, slow)
    uptrend = c > es
    # touched fast EMA: low came within touch_pct% of ema
    touched = l <= ef * (1 + touch_pct / 100)
    bounce = c > out["Open"]

    out["entry"] = (uptrend & touched & bounce).fillna(False)
    out["exit_sig"] = (c < es).fillna(False)
    return out


def feat_TREND_SMA(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Price above SMA AND SMA slope positive. Entry on fresh cross above SMA."""
    out = df.copy()
    c = out["Close"]
    sma_n = int(params.get("sma_n", 50))
    slope_n = int(params.get("slope_n", 10))

    sma = _sma(c, sma_n)
    sma_slope_pos = (sma - sma.shift(slope_n)) > 0
    cross_above = _crosses_above(c, sma)

    out["entry"] = (cross_above & sma_slope_pos).fillna(False)
    out["exit_sig"] = (c < sma).fillna(False)
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# BANK C — MOMENTUM (9 algos)
# ═══════════════════════════════════════════════════════════════════════════════

def feat_RSI_CROSS(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """RSI crosses above 50."""
    out = df.copy()
    c = out["Close"]
    period = int(params.get("period", 14))

    rsi = _rsi(c, period)
    mid = pd.Series(50.0, index=rsi.index)

    out["entry"] = _crosses_above(rsi, mid).fillna(False)
    out["exit_sig"] = _crosses_below(rsi, mid).fillna(False)
    return out


def feat_RSI_STRONG(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """RSI crosses above threshold AND above EMA."""
    out = df.copy()
    c = out["Close"]
    period = int(params.get("period", 14))
    threshold = float(params.get("threshold", 60))
    ema_n = int(params.get("ema_n", 21))

    rsi = _rsi(c, period)
    ema = _ema(c, ema_n)
    thresh_s = pd.Series(threshold, index=rsi.index)

    in_trend = c > ema
    cross = _crosses_above(rsi, thresh_s)

    out["entry"] = (cross & in_trend).fillna(False)
    out["exit_sig"] = ((rsi < 50) | (c < ema)).fillna(False)
    return out


def feat_ROC_MOM(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """N-bar rate of change crosses above threshold %."""
    out = df.copy()
    c = out["Close"]
    period = int(params.get("period", 10))
    threshold = float(params.get("threshold", 3.0))

    roc = c.pct_change(period) * 100
    thresh_s = pd.Series(threshold, index=roc.index)

    out["entry"] = _crosses_above(roc, thresh_s).fillna(False)
    out["exit_sig"] = _crosses_below(roc, pd.Series(0.0, index=roc.index)).fillna(False)
    return out


def feat_VOL_SURGE(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Volume surge + bullish bar + above EMA50."""
    out = df.copy()
    c, v = out["Close"], out["Volume"]
    n = int(params.get("n", 20))
    mult = float(params.get("mult", 2.0))

    vol_surge = v > mult * _sma(v, n)
    bull_bar = c > out["Open"]
    above_trend = c > _ema(c, 50)

    out["entry"] = (vol_surge & bull_bar & above_trend).fillna(False)
    out["exit_sig"] = (c < _ema(c, 21)).fillna(False)
    return out


def feat_CONSEC_BULL(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """N consecutive bullish bars + above EMA50."""
    out = df.copy()
    c = out["Close"]
    n_bars = int(params.get("n_bars", 3))

    bull_bar = (c > out["Open"]).astype(int)
    consec = bull_bar.rolling(n_bars).sum() == n_bars
    above_trend = c > _ema(c, 50)

    out["entry"] = (consec & above_trend & ~consec.shift(1, fill_value=False)).fillna(False)
    out["exit_sig"] = (c < out["Open"]).fillna(False)
    return out


def feat_OBV_TREND(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """OBV at N-bar high (volume accumulation leading price)."""
    out = df.copy()
    c, v = out["Close"], out["Volume"]
    n = int(params.get("n", 20))

    obv = _obv(c, v)
    at_obv_high = (obv == obv.rolling(n).max()).fillna(False)
    # entry when OBV breaks to new high AND price is above EMA21
    above_ema = c > _ema(c, 21)

    out["entry"] = (at_obv_high & above_ema & ~at_obv_high.shift(1, fill_value=False)).fillna(False)
    out["exit_sig"] = (obv < _sma(obv, n)).fillna(False)
    return out


def feat_STOCH_CROSS(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Stochastic %K crosses %D from below oversold level."""
    out = df.copy()
    h, l, c = out["High"], out["Low"], out["Close"]
    k_period = int(params.get("k_period", 14))
    d_period = int(params.get("d_period", 3))
    oversold = float(params.get("oversold", 25))

    k, d = _stoch(h, l, c, k_period, d_period)
    cross_up = _crosses_above(k, d)
    from_oversold = k.shift(1) < oversold

    out["entry"] = (cross_up & from_oversold).fillna(False)
    out["exit_sig"] = (k > 80).fillna(False)
    return out


def feat_MFI_CROSS(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Money Flow Index crosses above 50."""
    out = df.copy()
    h, l, c, v = out["High"], out["Low"], out["Close"], out["Volume"]
    period = int(params.get("period", 14))

    mfi = _mfi(h, l, c, v, period)
    mid = pd.Series(50.0, index=mfi.index)

    out["entry"] = _crosses_above(mfi, mid).fillna(False)
    out["exit_sig"] = _crosses_below(mfi, mid).fillna(False)
    return out


def feat_CMF_POS(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Chaikin Money Flow crosses above threshold."""
    out = df.copy()
    h, l, c, v = out["High"], out["Low"], out["Close"], out["Volume"]
    period = int(params.get("period", 20))
    threshold = float(params.get("threshold", 0.05))

    cmf = _cmf(h, l, c, v, period).fillna(0)
    thresh_s = pd.Series(threshold, index=cmf.index)

    out["entry"] = _crosses_above(cmf, thresh_s).fillna(False)
    out["exit_sig"] = (cmf < 0).fillna(False)
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# REGISTRY
# ═══════════════════════════════════════════════════════════════════════════════

ALGO_REGISTRY: dict[str, dict] = {
    # Bank A — BREAK
    "DON_BO":    {"fn": feat_DON_BO,    "bank": "A", "name": "Donchian Breakout",       "hold_bars": 30, "stop_pct": 5.0, "exit_mode": "sig"},
    "BB_BREAK":  {"fn": feat_BB_BREAK,  "bank": "A", "name": "Bollinger Breakout",      "hold_bars": 15, "stop_pct": 5.0, "exit_mode": "sig"},
    "KC_BREAK":  {"fn": feat_KC_BREAK,  "bank": "A", "name": "Keltner Breakout",        "hold_bars": 15, "stop_pct": 5.0, "exit_mode": "sig"},
    "SQZPOP":    {"fn": feat_SQZPOP,    "bank": "A", "name": "Squeeze Pop",             "hold_bars": 10, "stop_pct": 5.0, "exit_mode": "sig"},
    "ATR_EXP":   {"fn": feat_ATR_EXP,   "bank": "A", "name": "ATR Expansion",           "hold_bars": 8,  "stop_pct": 5.0, "exit_mode": "sig"},
    "VOL_BO":    {"fn": feat_VOL_BO,    "bank": "A", "name": "Volume Breakout",         "hold_bars": 12, "stop_pct": 5.0, "exit_mode": "sig"},
    "CONSOL_BO": {"fn": feat_CONSOL_BO, "bank": "A", "name": "Consolidation Breakout",  "hold_bars": 10, "stop_pct": 5.0, "exit_mode": "sig"},
    "NEW_HIGH":  {"fn": feat_NEW_HIGH,  "bank": "A", "name": "New High Close",          "hold_bars": 20, "stop_pct": 5.0, "exit_mode": "sig"},
    "RANGE_BO":  {"fn": feat_RANGE_BO,  "bank": "A", "name": "Range Breakout",          "hold_bars": 15, "stop_pct": 5.0, "exit_mode": "sig"},
    # Bank B — TREND
    "EMA_CROSS": {"fn": feat_EMA_CROSS, "bank": "B", "name": "EMA Cross",              "hold_bars": 40, "stop_pct": 7.0, "exit_mode": "sig"},
    "EMA_STACK": {"fn": feat_EMA_STACK, "bank": "B", "name": "EMA Stack",              "hold_bars": 30, "stop_pct": 7.0, "exit_mode": "sig"},
    "MACD_CROSS":{"fn": feat_MACD_CROSS,"bank": "B", "name": "MACD Cross",             "hold_bars": 25, "stop_pct": 6.0, "exit_mode": "sig"},
    "SUPERTREND":{"fn": feat_SUPERTREND,"bank": "B", "name": "SuperTrend",             "hold_bars": 40, "stop_pct": 7.0, "exit_mode": "sig"},
    "ADX_TREND": {"fn": feat_ADX_TREND, "bank": "B", "name": "ADX Trend",              "hold_bars": 20, "stop_pct": 6.0, "exit_mode": "sig"},
    "GOLDEN":    {"fn": feat_GOLDEN,    "bank": "B", "name": "Golden Cross",            "hold_bars": 90, "stop_pct":10.0, "exit_mode": "sig"},
    "PSAR":      {"fn": feat_PSAR,      "bank": "B", "name": "Parabolic SAR",           "hold_bars": 40, "stop_pct": 7.0, "exit_mode": "sig"},
    "PULLBACK":  {"fn": feat_PULLBACK,  "bank": "B", "name": "EMA Pullback",            "hold_bars": 20, "stop_pct": 5.0, "exit_mode": "sig"},
    "TREND_SMA": {"fn": feat_TREND_SMA, "bank": "B", "name": "SMA Slope Trend",         "hold_bars": 25, "stop_pct": 6.0, "exit_mode": "sig"},
    # Bank C — MOMENTUM
    "RSI_CROSS": {"fn": feat_RSI_CROSS, "bank": "C", "name": "RSI 50 Cross",           "hold_bars": 20, "stop_pct": 6.0, "exit_mode": "sig"},
    "RSI_STRONG":{"fn": feat_RSI_STRONG,"bank": "C", "name": "RSI Strong Momentum",    "hold_bars": 15, "stop_pct": 6.0, "exit_mode": "sig"},
    "ROC_MOM":   {"fn": feat_ROC_MOM,   "bank": "C", "name": "Rate of Change Mom",     "hold_bars": 15, "stop_pct": 5.0, "exit_mode": "sig"},
    "VOL_SURGE": {"fn": feat_VOL_SURGE, "bank": "C", "name": "Volume Surge",           "hold_bars": 10, "stop_pct": 5.0, "exit_mode": "sig"},
    "CONSEC_BULL":{"fn": feat_CONSEC_BULL,"bank":"C","name": "Consecutive Bull Bars",  "hold_bars": 10, "stop_pct": 5.0, "exit_mode": "sig"},
    "OBV_TREND": {"fn": feat_OBV_TREND, "bank": "C", "name": "OBV Breakout",           "hold_bars": 15, "stop_pct": 5.0, "exit_mode": "sig"},
    "STOCH_CROSS":{"fn":feat_STOCH_CROSS,"bank":"C","name": "Stochastic Cross",        "hold_bars": 12, "stop_pct": 5.0, "exit_mode": "sig"},
    "MFI_CROSS": {"fn": feat_MFI_CROSS, "bank": "C", "name": "MFI 50 Cross",           "hold_bars": 15, "stop_pct": 5.0, "exit_mode": "sig"},
    "CMF_POS":   {"fn": feat_CMF_POS,   "bank": "C", "name": "CMF Positive",           "hold_bars": 15, "stop_pct": 5.0, "exit_mode": "sig"},
}

ALL_ALGO_IDS = list(ALGO_REGISTRY.keys())
BANK_A = [k for k, v in ALGO_REGISTRY.items() if v["bank"] == "A"]
BANK_B = [k for k, v in ALGO_REGISTRY.items() if v["bank"] == "B"]
BANK_C = [k for k, v in ALGO_REGISTRY.items() if v["bank"] == "C"]


def build_features(df: pd.DataFrame, algo_id: str, params: dict | None = None) -> pd.DataFrame:
    """
    Build feature DataFrame for a given algo ID.
    Returns df with 'entry' and 'exit_sig' bool columns.
    """
    algo_id = algo_id.upper()
    if algo_id not in ALGO_REGISTRY:
        raise ValueError(f"Unknown algo: {algo_id}. Valid: {ALL_ALGO_IDS}")
    fn = ALGO_REGISTRY[algo_id]["fn"]
    return fn(df, params or {})


def compute_live_votes(df: pd.DataFrame) -> dict[str, dict]:
    """
    Compute live vote (-1, 0, +1) and score (0-1) for all 27 algos.
    Uses default parameters. Returns dict keyed by algo_id.
    """
    results: dict[str, dict] = {}
    for algo_id, meta in ALGO_REGISTRY.items():
        try:
            feat = meta["fn"](df, {})
            last_entry = bool(feat["entry"].iloc[-1]) if len(feat) > 0 else False
            last_exit = bool(feat["exit_sig"].iloc[-1]) if len(feat) > 0 else False

            if last_entry:
                vote = 1
            elif last_exit:
                vote = -1
            else:
                vote = 0

            # score = fraction of last 5 bars that were entry signals
            recent = feat["entry"].tail(5).sum()
            score = round(float(recent) / 5.0, 4)

            results[algo_id] = {
                "vote": vote,
                "score": score,
                "bank": meta["bank"],
                "name": meta["name"],
            }
        except Exception as exc:
            results[algo_id] = {"vote": 0, "score": 0.0, "bank": meta.get("bank", "?"), "name": meta.get("name", algo_id)}

    # JEDI
    total = sum(v["vote"] for v in results.values())
    results["JEDI"] = {
        "vote": 1 if total >= 9 else (-1 if total <= -9 else 0),
        "score": round(abs(total) / 27.0, 4),
        "bank": "JEDI",
        "name": "JEDI Master",
        "raw_score": total,
    }
    return results
