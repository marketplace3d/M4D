# ICTSMC OPT — Execution Queue

## Operating Doctrine (Hard Rules)
- Council + HTF alignment are mandatory for entries.
- No dumb trades: if alignment fails, force `HOLD`.
- T1 is used as TP target (not a hard gate).
- CIS is only for starter-account emergency handling.

## Next: Kelly Multiplier Path
- `ICT bias_strong` -> `1.2x` size.
- Cross-asset multiplier:
  - `RISK_ON`: `+20%`
  - `RISK_OFF`: `-30%`

## Immediate Tests
- `HK + KZ`
  - Add `v_ict_kz` to `gate_search.py`.
- `OB/FVG`
  - Test OB/FVG standalone (no T1 gate).
- `T1`
  - Keep T1 as TP target only.

## Gate Controls (Apply / Suspend Matrix)
- `HOUR_KILLS` `+2.57`
- `REGIME_ROUTING` `+0.844`
- `SQUEEZE_LOCK` `+0.934`
- `ATR_RANK_LOW` `+0.661`
- `RVOL_EXHAUSTION` `+0.435`
- `LOW_JEDI_GATE` `+0.310`
- `DAY_FILTER` `+0.729`
- `RVOL_GATE` `±0.000`
- `SCALPER_MODE` `1.896`
- `EUPHORIA_ONLY` `19.83`

## Optimization Pipeline — Iter Queue

### P0 PAPER
- Paper execution with Council+HTF lock enforced.

### P1 SIGNAL
- HMM regime (3-state Markov) for soft probability routing (`~3h`).
- Re-entry holdout validation (87 trades, separate fold) (`~1h`).
- ICT FVG exit + EQH/EQL tighter (`0.05%` not `0.2%`) (`~2h`).
- MTF confirm: 5m+1h conflict -> `-50%` size (`mtf_confirm.py`, `~2h`).
- IC decay slope monitor (14d rolling, `-0.0003` alert) (`ic_monitor.py`, `~1h`).

### P1-D COST
- Cost-adjusted Sharpe:
  - slippage `0.10%`
  - spread haircut `0.05%`
  - (`~1h`)

### P2 ALPHA
- Funding rate signal: extreme -> overextended gate.
- OBI ratio as scored signal (IC test on `useObiStream`).
- Cross-asset as Kelly multiplier: `RISK_ON +