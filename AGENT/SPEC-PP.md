# SPEC-PP — Spec · Plan · Progress
*Distilled 2026-04-24 · Source: AGENT1/SYSTEM-SPEC.md + AGENT1/BUILDOUT-PROGRESS.md*

---

## SYSTEM VERDICT
**PROMISING** — 4/5 RenTech gates  
**Stacked Sharpe 15.86** (1,310 trades) · EUPHORIA 21.7 · Re-entry 29.7 (untapped)  
**Cost-adjusted: ~8-11** (0.30% round-trip, 40-45% haircut)  
**Paper: ACTIVE** — Alpaca + IBKR wired · Risk: single asset (BTC, not cross-validated)

---

## SHARPE BUILD STACK

```
BASELINE               1.36
+ routing              5.94  (+4.58)
+ soft regime          6.61  (+0.66)
+ HOUR_KILLS           9.18  (+2.57) ← single largest gate
+ SQZ+ATR+RVOL+JEDI   15.86  (+6.68)
DELTA OPS PADAWAN     11.19  (position mgmt)
EUPHORIA              19.83  (62.4% WR, 117 trades)
RE-ENTRY              29.72  (87 trades — mostly untapped)
IOPT EUPHORIA:        21.7   (jedi_min=10 THE FIX, seed=42)
IOPT MAX:             17.8   (jedi=8 + entry=0.35 + cis=1)
```

---

## 5 VETO GATES (SSOT: trade_quality_gate.py)

| Gate | Condition | Sharpe Delta | Trigger Rate |
|------|-----------|-------------|--------------|
| HOUR_KILLS | UTC {0,1,3,4,5,12,13,20-23} | **+2.571** | 44.2% |
| SQUEEZE_LOCK | squeeze==1 | +0.934 | 37.2% |
| ATR_RANK_LOW | atr bottom 30% of 50-bar window | +0.661 | 28.5% |
| RVOL_EXHAUSTION | rvol > 90th pct of 100 bars | +0.435 | 37.5% |
| LOW_JEDI | abs(jedi_raw) < 4 | +0.310 | 25.1% |

---

## DELTA OPS — POSITION MANAGER (delta_ops.py)

**No stops. No MM donations. Exit on invalidation only.**

```
FLAT → ENTRY:    gates clear + soft_score >= entry_thr + abs(jedi_raw) >= jedi_min
IN   → SCALE-IN: ACCEL (score↑ AND rvol↑ > 5%) → +0.5 lot
IN   → SCALE-OUT: DECEL (score↓ OR rvol↓ > 10%) → -0.5 lot
IN   → EXIT:     CIS >= cis_threshold (invalidation, not price stop)
OUT  → RE-ENTRY: CIS cleared + score >= entry_thr within reentry_window
```

| Mode | Kelly | Max Lots | Entry Thr | CIS | Sharpe |
|------|-------|----------|-----------|-----|--------|
| PADAWAN | 0.25× | 1.5 | 0.35 | 2/5 | 11.19 |
| NORMAL | 1.0× | 3.0 | 0.35 | 2/5 | 11.19 |
| **EUPHORIA** | **2.5×** | **3.0** | **0.50** | **3/5** | **19.83** |

**EUPHORIA trigger (ALL required):** jedi_raw ≥ ±18 · RVOL > 2.0 · Activity=HOT · Cross-asset=RISK_ON · soft_score ≥ 0.50 · all 5 gates clear

---

## LOT SIZING STACK (7 layers)

```
eff_lot = halo × mtf × cross_asset × capacity × oi × fear_greed × liquidations
  mtf:         AGREE=1.0 / NEUTRAL=0.75 / OPPOSE=0.50
  cross_asset: RISK_ON=1.20 / NEUTRAL=1.0 / RISK_OFF=0.70
  oi:          TREND_CONFIRM=1.15 / EXHAUSTION=0.70 / NEUTRAL=1.0
  fear_greed:  EXTREME_FEAR=1.25 / GREED=0.85 / EXTREME_GREED=0.65
```

---

## SIGNAL ROUTING (never change without walkforward re-run)

```
TRENDING  → PULLBACK · ADX_TREND · PSAR · MACD_CROSS · SUPERTREND · GOLDEN · EMA_STACK
BREAKOUT  → SQZPOP · VOL_BO · DON_BO · RANGE_BO · EMA_STACK · NEW_HIGH · SUPERTREND
RANGING   → RSI_STRONG · BB_BREAK · KC_BREAK · ATR_EXP · RSI_CROSS
RISK-OFF  → GOLDEN · ROC_MOM · OBV_TREND
ANY       → ADX_TREND (ALIVE globally) · GOLDEN (ALIVE globally)
IN SQUEEZE: ZERO signals — wait for SQZPOP
```

---

## IC MONITOR STATE (2026-04-19)

**RETIRE:** DON_BO (-0.101) · NEW_HIGH (-0.081) · RANGE_BO (-0.067) · RSI_CROSS (-0.023)  
**KILL CORR CLONES:** KC_BREAK (corr 0.966) · VOL_SURGE (corr 0.991) · BB_BREAK (corr 0.921)  
**WATCH:** SQZPOP (-0.005, was +0.033 — alarming drop) · VOL_BO (-0.054) · EMA_STACK (-0.023)  
**ALIVE GLOBALLY:** ADX_TREND · GOLDEN

---

## P0 GAPS (design — highest impact)

- [ ] MARKET page: dense panel grid (regime dial + OBI live + cross-asset + signal row + price) ALL visible simultaneously. No tab hunting.
- [ ] PULSE page: gate toggles + hour/day kills + kelly + circuit breakers + positions — ALL visible
- [ ] Compact stat-row style enforced across all pages

## P1 GAPS (DS iteration)

- [ ] EUPHORIA re_win: 4→12-24 bars (unlock re-entry 29.7)
- [ ] 3 IOPT seeds (43,44,45) for robustness check
- [ ] Quantstats tearsheet (`qs.reports.html`)
- [ ] Re-run gate_search after OBI+DR+VWAP columns land
- [ ] Re-run walkforward after killing 6 corr clones

## P2 GAPS (features)

- [ ] ghost_daemon.py — background param search every 30min
- [ ] Hard daily limit: 0.05 × equity in paper adapters
- [ ] OBI scale-in gate: `accel AND obi_ratio > 0.25`

---

## DESIGN DOCTRINE (enforce every session)

```
4-page Palantir layout: MARKET / PULSE / TRADE / STAR RAY
Panel grid (grid2/grid3/grid4) — never single column on 4K
No tabs within a page unless content is truly exclusive
Panel headers: 9px monospace ALL-CAPS, color-coded by category
Everything displayable simultaneously MUST be displayed simultaneously
F22 / Garmin G5000 aesthetic — instrument cluster, not website
```
