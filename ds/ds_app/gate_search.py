"""
gate_search.py — Systematic veto gate search.
Tests many block conditions on OOS data, ranks by Sharpe delta.
Only keeps gates that IMPROVE Sharpe >= +0.10 with pct_blocked <= 60%.
"""
from __future__ import annotations
import json, sqlite3, sys
from pathlib import Path
import numpy as np
import pandas as pd

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

from ds_app.algos_crypto import ALL_ALGO_IDS
from ds_app.sharpe_ensemble import SIGNAL_DB, REGIME_MAP, SOFT_REGIME_MULT, assign_regimes

ANNUAL = 252 * 78

def sharpe(r):
    r = r[~np.isnan(r)]
    if len(r) < 50: return None
    sd = r.std(ddof=1)
    if sd < 1e-9: return None
    return round(float(r.mean() / sd * np.sqrt(ANNUAL)), 3)

# ── load OOS ──────────────────────────────────────────────────────────────────
conn = sqlite3.connect(SIGNAL_DB)
pragma = {r[1] for r in conn.execute("PRAGMA table_info(signal_log)")}
v_cols = [f"v_{s}" for s in ALL_ALGO_IDS if f"v_{s}" in pragma]
want = ["ts","symbol","outcome_4h_pct","close","high","low","open",
        "atr_pct","squeeze","rvol","jedi_raw","volume"] + v_cols
sel = [c for c in want if c in pragma]
rows = conn.execute(
    f"SELECT {','.join(sel)} FROM signal_log WHERE outcome_4h_pct IS NOT NULL ORDER BY symbol,ts"
).fetchall()
conn.close()
df = pd.DataFrame(rows, columns=sel)
oos_cut = int(np.percentile(df["ts"].values, 70))
df = df[df["ts"] >= oos_cut].copy()
print(f"OOS bars: {len(df):,}")

# ── per-symbol enrichment ─────────────────────────────────────────────────────
parts = []
for sym, g in df.groupby("symbol"):
    g = g.sort_values("ts").reset_index(drop=False)
    h, l, c, v = g["high"].values, g["low"].values, g["close"].values, g["volume"].values
    n = len(g)

    # regime
    reg_s = assign_regimes(g)
    g["regime"] = reg_s.values

    # rolling ATR percentile (50-bar)
    atr = g["atr_pct"].fillna(0).values
    atr_pct_rank = np.zeros(n)
    for i in range(50, n):
        w = atr[i-50:i]
        atr_pct_rank[i] = (w < atr[i]).mean()
    g["atr_rank"] = atr_pct_rank   # 0-1, low = ATR below median

    # rolling RVOL percentile
    rv = g["rvol"].fillna(1.0).values
    rv_rank = np.zeros(n)
    for i in range(50, n):
        w = rv[i-50:i]
        rv_rank[i] = (w < rv[i]).mean()
    g["rvol_rank"] = rv_rank

    # RVOL trend: current - 5-bar mean (negative = declining participation)
    rv_trend = np.zeros(n)
    for i in range(5, n):
        rv_trend[i] = rv[i] - rv[i-5:i].mean()
    g["rvol_trend"] = rv_trend

    # Volume trend
    vol_ma = np.zeros(n)
    for i in range(20, n):
        vol_ma[i] = v[i-20:i].mean()
    g["vol_vs_ma"] = np.where(vol_ma > 0, v / vol_ma, 1.0)

    # ATR expansion/contraction: current ATR vs 20-bar mean
    atr_ma = np.zeros(n)
    for i in range(20, n):
        atr_ma[i] = atr[i-20:i].mean()
    g["atr_vs_ma"] = np.where(atr_ma > 0, atr / atr_ma, 1.0)

    # PDH/PDL (288-bar = 24h)
    pdh = np.full(n, np.nan); pdl = np.full(n, np.nan)
    for i in range(288, n):
        pdh[i] = h[i-288:i].max(); pdl[i] = l[i-288:i].min()
    g["pdh"] = pdh; g["pdl"] = pdl
    pd_range = pdh - pdl
    g["pct_in_pd"] = np.where(pd_range > 0, (c - pdl) / pd_range, 0.5)

    # Candle body ratio (indecision = doji)
    body = np.abs(c - g["open"].values)
    candle_range = h - l
    g["body_ratio"] = np.where(candle_range > 0, body / candle_range, 0.5)

    # RVOL exhaustion: rvol > Nth percentile of last 100 bars (buying/selling climax)
    rv_high = np.zeros(n, dtype=bool)
    for i in range(100, n):
        rv_high[i] = rv[i] > np.percentile(rv[i-100:i], 90)
    g["rvol_exhaustion"] = rv_high.astype(int)

    # UTC hour
    g["hour"] = pd.to_datetime(g["ts"], unit="s", utc=True).dt.hour.values

    parts.append(g)

df = pd.concat(parts, ignore_index=True)

# ── soft score ────────────────────────────────────────────────────────────────
routing = json.loads(REGIME_MAP.read_text())
flat_sh: dict = {}
for rrows in routing.values():
    for r in rrows:
        s = r["algo_id"]; sh = r.get("sharpe") or 0.0
        if sh > 0: flat_sh[s] = max(flat_sh.get(s, 0.0), sh)
fs_total = sum(flat_sh.values()) or 1.0
flat_w = {s: v/fs_total for s,v in flat_sh.items()}

regimes = df["regime"].values
sigs_avail = [s for s in ALL_ALGO_IDS if f"v_{s}" in df.columns]
scores = np.zeros(len(df))
for sig in sigs_avail:
    v = df[f"v_{sig}"].fillna(0).values.astype(float)
    fw = flat_w.get(sig, 0.0)
    mm = SOFT_REGIME_MULT.get(sig, {})
    mults = np.array([mm.get(r, 1.0) for r in regimes]) if mm else np.ones(len(df))
    scores += v * fw * mults

SW_THR   = 0.06
SOFT_THR = 0.35
sw_mask   = scores >= SW_THR
soft_mask = scores >= SOFT_THR

outcomes  = df["outcome_4h_pct"].values.astype(float)
base_sw   = sharpe(outcomes[sw_mask])
base_soft = sharpe(outcomes[soft_mask])
print(f"Baseline SW(0.06):   Sharpe={base_sw}  n={int(sw_mask.sum())}")
print(f"Baseline soft(0.35): Sharpe={base_soft}  n={int(soft_mask.sum())}")

# ── derived features: MTF proxy + OI proxy + F&G proxy ───────────────────────
# MTF proxy: 4h-equivalent alignment (48 bars × 5min = 4h)
# signal direction = sign of soft_score - 0.06 (SW threshold)
# 4h trend = sign of close[i] - close[i-48]
mtf_aligned = np.zeros(len(df), dtype=bool)
for sym, idx in df.groupby("symbol").groups.items():
    idx = list(idx)
    closes = df.loc[idx, "close"].values
    sscores = scores[idx]
    for j in range(48, len(idx)):
        sig_dir  = 1 if sscores[j] >= SW_THR else 0
        tfh_dir  = 1 if closes[j] > closes[j - 48] else 0
        mtf_aligned[idx[j]] = (sig_dir == 1) and (tfh_dir == 1)

# OI proxy: volume spike as surrogate for OI trend_confirm
# High OI trend confirm = vol_vs_ma > 1.5 AND price moving (atr_vs_ma > 1.0)
oi_trend_confirm = (df["vol_vs_ma"].values > 1.5) & (df["atr_vs_ma"].values > 1.0)
# OI exhaustion proxy: rvol_exhaustion AND price near recent high
oi_exhaustion = df["rvol_exhaustion"].values.astype(bool) & (df["pct_in_pd"].fillna(0.5).values > 0.80)

# F&G proxy: rolling 5-day return as greed/fear surrogate
# Compute per symbol: close[i] vs close[i-1440] (1440 bars = 5 days at 5min)
fng_greed_proxy = np.zeros(len(df), dtype=bool)  # true = "greed" regime → reduce
for sym, idx in df.groupby("symbol").groups.items():
    idx = list(idx)
    closes = df.loc[idx, "close"].values
    for j in range(1440, len(idx)):
        ret5d = (closes[j] / closes[j - 1440]) - 1.0
        fng_greed_proxy[idx[j]] = ret5d > 0.15  # >15% 5d = extreme greed

df["mtf_aligned"]      = mtf_aligned
df["oi_trend_confirm"] = oi_trend_confirm.astype(int)
df["oi_exhaustion"]    = oi_exhaustion.astype(int)
df["fng_greed_proxy"]  = fng_greed_proxy.astype(int)

print(f"MTF aligned entries: {mtf_aligned.sum():,} of {sw_mask.sum():,} signals")

# ── gate candidates ───────────────────────────────────────────────────────────
candidates = []

# --- RVOL threshold sweep ---
for thr in [0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.80, 1.00]:
    candidates.append((f"rvol<{thr}", df["rvol"].fillna(1.0).values < thr))

# --- RVOL too high (exhaustion) ---
for thr in [2.0, 2.5, 3.0, 4.0]:
    candidates.append((f"rvol>{thr}", df["rvol"].fillna(0).values > thr))

# --- RVOL rank (relative to recent) ---
for pct in [10, 20, 30]:
    candidates.append((f"rvol_rank<{pct}pct", df["rvol_rank"].values < pct/100))

# --- ATR (flat market) ---
for pct_val in [0.0010, 0.0015, 0.0020, 0.0025, 0.0030]:
    candidates.append((f"atr<{pct_val:.4f}", df["atr_pct"].fillna(1.0).values < pct_val))

# --- ATR rank ---
for pct in [10, 20, 30]:
    candidates.append((f"atr_rank<{pct}pct", df["atr_rank"].values < pct/100))

# --- ATR contraction (vs own MA) ---
for thr in [0.5, 0.6, 0.7, 0.8]:
    candidates.append((f"atr_vs_ma<{thr}", df["atr_vs_ma"].values < thr))

# --- Jedi_raw threshold sweep ---
for thr in [2, 3, 4, 5, 6, 7, 8, 10, 12]:
    candidates.append((f"|jedi|<{thr}", np.abs(df["jedi_raw"].fillna(0).values) < thr))

# --- Squeeze ---
candidates.append(("squeeze==1", df["squeeze"].fillna(0).astype(int).values == 1))

# --- Doji (indecision candle) ---
for thr in [0.10, 0.15, 0.20, 0.25]:
    candidates.append((f"body<{thr}", df["body_ratio"].values < thr))

# --- RVOL trend (declining = no follow-through) ---
for thr in [-0.1, -0.2, -0.3, -0.5]:
    candidates.append((f"rvol_trend<{thr}", df["rvol_trend"].values < thr))

# --- Volume vs MA ---
for thr in [0.3, 0.4, 0.5, 0.6]:
    candidates.append((f"vol_vs_ma<{thr}", df["vol_vs_ma"].values < thr))

# --- Hour-of-day kills ---
for hrs in [(0, 1), (20, 21, 22, 23), (12, 13), (3, 4, 5)]:
    label = f"kill_hour_{'_'.join(map(str, hrs))}"
    candidates.append((label, np.isin(df["hour"].values, hrs)))

# --- Regime: only trade TRENDING+BREAKOUT ---
candidates.append(("regime==RANGING", df["regime"].values == "RANGING"))
candidates.append(("regime==RISK-OFF", df["regime"].values == "RISK-OFF"))
candidates.append(("regime in RANGING+RISK-OFF", np.isin(df["regime"].values, ["RANGING", "RISK-OFF"])))

# --- RVOL exhaustion (climax bar) ---
candidates.append(("rvol_exhaustion", df["rvol_exhaustion"].values.astype(bool)))

# --- PDH/PDL middle zone (various widths) ---
for lo, hi in [(0.40, 0.60), (0.35, 0.65), (0.30, 0.70)]:
    pct = df["pct_in_pd"].fillna(0.5).values
    candidates.append((f"pdhl_{lo}-{hi}", (pct >= lo) & (pct <= hi)))

# --- MTF proxy: require 4h alignment (veto = NOT aligned) ---
candidates.append(("no_mtf_align", ~df["mtf_aligned"].values.astype(bool)))

# --- OI proxy: veto exhaustion signals (OI + price near top) ---
candidates.append(("oi_exhaustion_proxy", df["oi_exhaustion"].values.astype(bool)))

# --- OI proxy: require OI trend confirm to enter ---
candidates.append(("no_oi_trend_confirm", ~df["oi_trend_confirm"].values.astype(bool)))

# --- F&G proxy: skip entries during extreme greed (>15% 5d run) ---
candidates.append(("fng_greed_proxy", df["fng_greed_proxy"].values.astype(bool)))

# ── evaluate each candidate on SW baseline ───────────────────────────────────
print("\n--- GATE SEARCH (SW baseline) ---")
results = []
for name, veto in candidates:
    n_bl  = int((sw_mask & veto).sum())
    pct_bl = n_bl / max(int(sw_mask.sum()), 1)
    if pct_bl > 0.65: continue   # skip gates that block >65%
    fm = sw_mask & ~veto
    s  = sharpe(outcomes[fm])
    if s is None: continue
    delta = round(s - (base_sw or 0), 3)
    results.append({"gate": name, "sharpe": s, "delta": delta,
                    "pct_blocked": round(pct_bl*100,1), "n_trades": int(fm.sum())})

results.sort(key=lambda x: x["delta"], reverse=True)
print(f"{'Gate':<30} {'Sharpe':>7} {'Delta':>7} {'Blocked':>8} {'Trades':>8}")
for r in results[:30]:
    flag = " ✓" if r["delta"] > 0.10 else ("  " if r["delta"] > -0.05 else " ✗")
    print(f"{r['gate']:<30} {r['sharpe']:>7.3f} {r['delta']:>+7.3f} {r['pct_blocked']:>7.1f}% {r['n_trades']:>8,}{flag}")

# ── best combo: greedy forward selection ─────────────────────────────────────
keepers = [r for r in results if r["delta"] > 0.10 and r["pct_blocked"] <= 50]
print(f"\n--- FORWARD SELECTION ({len(keepers)} candidates pass threshold) ---")

combined_veto = np.zeros(len(df), dtype=bool)
combo_sharpe  = base_sw
selected      = []
for r in sorted(keepers, key=lambda x: x["delta"], reverse=True):
    name = r["gate"]
    veto = dict(candidates)[name]
    trial = combined_veto | veto
    s = sharpe(outcomes[sw_mask & ~trial])
    if s is not None and s > combo_sharpe + 0.05:
        combined_veto = trial
        combo_sharpe  = s
        selected.append((name, round(s, 3)))
        print(f"  ADD {name:30s} → Sharpe={s:.3f}")
    else:
        print(f"  SKIP {name:30s}  (no additive gain, s={s})")

print(f"\nFINAL COMBO   Sharpe={combo_sharpe:.3f}  trades={int((sw_mask & ~combined_veto).sum()):,}")
print(f"Baseline SW:  Sharpe={base_sw:.3f}")
print(f"Selected gates: {[s[0] for s in selected]}")

# ── stacked: soft routing + optimal gates ────────────────────────────────────
stacked = sharpe(outcomes[soft_mask & ~combined_veto])
print(f"\nSTACKED soft(0.35)+optimal_gates  Sharpe={stacked}  trades={int((soft_mask & ~combined_veto).sum()):,}")

out = {
    "base_sw": base_sw, "base_soft": base_soft,
    "top_gates": results[:20],
    "selected_gates": selected,
    "combined_sw_sharpe": combo_sharpe,
    "stacked_sharpe": stacked,
}
(_DS_ROOT / "data" / "gate_search_report.json").write_text(json.dumps(out, indent=2))
print("\ngate_search_report.json written")
