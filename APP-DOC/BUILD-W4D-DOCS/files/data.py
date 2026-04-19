"""
data.py — synthetic universe generator

Produces a realistic multi-instrument universe with:
  - Price paths: regime-switching GBM with cross-sectional correlation
  - Volume: correlated with volatility
  - Fundamentals: EP, BP, ROE, earnings surprise
  - Sector assignments
  - Market-wide regime states
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from dataclasses import dataclass


SECTORS = ["Technology", "Financials", "Healthcare", "Industrials",
           "Energy", "Consumer", "Materials", "Utilities", "Real Estate"]


@dataclass
class Universe:
    prices:     pd.DataFrame   # (T, N) close prices
    highs:      pd.DataFrame   # (T, N)
    lows:       pd.DataFrame   # (T, N)
    volumes:    pd.DataFrame   # (T, N)
    returns:    pd.DataFrame   # (T, N) simple daily returns
    fwd_ret_1d: pd.DataFrame   # (T, N) next-day return (for IC calc)
    fwd_ret_5d: pd.DataFrame   # (T, N) next-5d return
    fwd_ret_21d:pd.DataFrame   # (T, N) next-21d return
    fundamentals: pd.DataFrame # MultiIndex (date, instrument) × factor
    sectors:    pd.Series      # instrument → sector
    market_features: pd.DataFrame  # (T, 5) for regime classifier
    dates:      pd.DatetimeIndex
    instruments:list[str]


def generate_universe(
    n_instruments: int = 100,
    n_days:        int = 756,   # ~3 years
    start:         str = "2021-01-04",
    seed:          int = 42,
) -> Universe:
    rng  = np.random.default_rng(seed)
    dates = pd.bdate_range(start, periods=n_days)
    inst  = [f"STK_{i:03d}" for i in range(n_instruments)]

    # ── Sector assignment ─────────────────────────────────────────────
    n_sec = len(SECTORS)
    sec_arr = [SECTORS[i % n_sec] for i in range(n_instruments)]
    sectors = pd.Series(sec_arr, index=inst, name="sector")

    # ── Regime path ───────────────────────────────────────────────────
    # Four distinct regimes across the 3-year window
    regime_vol = np.ones(n_days) * 0.15
    regime_drift = np.ones(n_days) * 0.0003
    # Risk-off episode: days 200–280
    regime_vol[200:280]   = 0.28
    regime_drift[200:280] = -0.001
    # Crisis spike: days 400–440
    regime_vol[400:440]   = 0.45
    regime_drift[400:440] = -0.003
    # Recovery / trending: days 440–580
    regime_drift[440:580] = 0.0008

    # ── Market factor (common shock) ─────────────────────────────────
    mkt_shocks = rng.standard_normal(n_days) * regime_vol / np.sqrt(252)
    mkt_return = pd.Series(mkt_shocks + regime_drift, index=dates)

    # ── Individual instrument returns ─────────────────────────────────
    betas    = 0.5 + rng.uniform(0, 1.0, n_instruments)  # β ∈ [0.5, 1.5]
    idio_vol = 0.08 + rng.uniform(0, 0.12, n_instruments) # idio vol ∈ [8%, 20%] ann

    # Sector factor
    sec_idx = np.array([SECTORS.index(s) for s in sec_arr])
    sec_shocks = rng.standard_normal((n_days, n_sec)) * 0.005
    sec_ret = sec_shocks[:, sec_idx]   # (T, N)

    idio_shocks = rng.standard_normal((n_days, n_instruments))
    idio_ret    = idio_shocks * (idio_vol / np.sqrt(252))

    ret_mat = (betas[np.newaxis, :] * mkt_return.values[:, np.newaxis]
               + sec_ret + idio_ret)

    # ── Price paths ───────────────────────────────────────────────────
    start_prices = 20 + rng.uniform(0, 80, n_instruments)
    log_prices   = np.log(start_prices) + np.cumsum(ret_mat, axis=0)
    price_mat    = np.exp(log_prices)

    # ── OHLC ─────────────────────────────────────────────────────────
    intraday_range = abs(rng.standard_normal((n_days, n_instruments))) * \
                     (regime_vol[:, np.newaxis] / np.sqrt(252)) * 0.7
    high_mat  = price_mat * (1 + intraday_range * 0.6)
    low_mat   = price_mat * (1 - intraday_range * 0.6)

    # ── Volume ────────────────────────────────────────────────────────
    avg_vol  = 1_000_000 * (1 + rng.uniform(0, 4, n_instruments))
    vol_mult = 1 + 2 * abs(ret_mat) * np.sqrt(252) / 0.2
    vol_mat  = (avg_vol[np.newaxis, :] * vol_mult *
                rng.lognormal(0, 0.3, (n_days, n_instruments)))

    # ── Forward returns ───────────────────────────────────────────────
    ret_df = pd.DataFrame(ret_mat, index=dates, columns=inst)

    def fwd(n):
        return ret_df.shift(-n).rolling(n).sum().shift(-(n-1)) if n > 1 else ret_df.shift(-1)

    fwd1  = ret_df.shift(-1)
    fwd5  = ret_df.rolling(5).sum().shift(-5)
    fwd21 = ret_df.rolling(21).sum().shift(-21)

    # ── Fundamentals (quarterly, interpolated daily) ─────────────────
    fund_records = []
    for i, sym in enumerate(inst):
        ep  = 0.04 + rng.uniform(-0.02, 0.04)   # earnings yield
        bp  = 0.8  + rng.uniform(-0.4,  0.6)    # book/price
        roe = 0.10 + rng.uniform(-0.05, 0.15)   # return on equity
        for t in dates:
            noise = rng.standard_normal(3) * [0.005, 0.05, 0.01]
            esurp = rng.standard_normal() * 0.02  # earnings surprise
            fund_records.append({
                "date": t, "instrument": sym,
                "ep":        ep + noise[0],
                "bp":        max(0.1, bp + noise[1]),
                "roe":       roe + noise[2],
                "earn_surp": esurp,
            })
    fundamentals = pd.DataFrame(fund_records).set_index(["date", "instrument"])

    # ── Market features for regime classifier ─────────────────────────
    rv20 = ret_df.std(axis=1).rolling(20).mean() * np.sqrt(252)
    vov  = rv20.rolling(60).std().fillna(0.02)
    mom60= mkt_return.rolling(60).sum().fillna(0)
    bond_noise = rng.standard_normal(n_days) * 0.02
    corr = pd.Series(bond_noise, index=dates).rolling(60).mean().fillna(0)
    cred = pd.Series(rng.standard_normal(n_days) * 0.3, index=dates)

    mkt_feat = pd.DataFrame({
        "realised_vol_20d":  rv20.fillna(0.15),
        "vol_of_vol_60d":    vov,
        "momentum_60d":      mom60,
        "cross_asset_corr":  corr,
        "credit_spread_chg": cred,
    }, index=dates)

    return Universe(
        prices      = pd.DataFrame(price_mat,  index=dates, columns=inst),
        highs       = pd.DataFrame(high_mat,   index=dates, columns=inst),
        lows        = pd.DataFrame(low_mat,    index=dates, columns=inst),
        volumes     = pd.DataFrame(vol_mat,    index=dates, columns=inst),
        returns     = ret_df,
        fwd_ret_1d  = fwd1,
        fwd_ret_5d  = fwd5,
        fwd_ret_21d = fwd21,
        fundamentals= fundamentals,
        sectors     = sectors,
        market_features = mkt_feat,
        dates       = dates,
        instruments = inst,
    )
