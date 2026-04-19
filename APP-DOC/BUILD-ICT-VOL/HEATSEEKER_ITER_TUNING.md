# HEATSEEKER Iteration Tuning Guide

This doc is the working notebook for iterating Heatseeker before full automation.

## Objective

- Build a robust "next institutional level" engine using:
  - cumulative level-volume acceptance,
  - directional pressure,
  - PDH/PDL and Opening Range (ORH/ORL),
  - MTF confluence.
- Keep it modular: add one factor at a time, measure, keep/rollback.

## Current Modules

## 1) `TV-SUPER-OB-FVG.pine` Heatseeker V1

- Core levels:
  - PDH / PDL (previous day high/low)
  - ORH / ORL (opening range high/low)
- Direction:
  - Cumulative directional volume proxy + EMA trend delta -> `dirBias`
- Level acceptance:
  - volume summed in ATR-based band around each level
- Composite score:
  - volume acceptance + proximity + directional fit + breakout context
- Output:
  - best ranked level (`HEATSEEK`), score label, alert when price approaches

### Key Inputs To Tune (V1)

- `Cumulative Lookback Bars`
- `Level Volume Band (ATR x)`
- `Max Distance for Attraction (ATR x)`
- `Approach Alert Band (ATR x)`
- OR session/timezone

## 2) `TV-MTF-OB.pine` MTF Confidence Add-on

- New MTF confidence regime block:
  - EMA21/EMA55 directional bias across multiple TFs
  - weighted confidence score in [-1..1]
  - regime output: `BULL`, `NEUTRAL`, `BEAR`
  - label + alert on regime transition

### Weight Design (current)

- Chart TF: 1.0
- 5/10/15/30m: 1.0 each
- 1h: 1.5
- 4h/8h: 2.0
- Daily: 3.0
- Weekly: 4.0
- Monthly: 5.0

Use `Use only enabled FVG TFs` to align MTF confidence with active FVG stack.

## Iteration Protocol (Recommended)

1. Change only 1-2 parameters per run.
2. Run at least 30-50 signal observations.
3. Score each signal:
   - context alignment (0-2)
   - level quality (0-2)
   - follow-through quality (0-2)
   - adverse excursion (0-2, inverse)
4. Keep change only if:
   - fewer bad fades,
   - same or better continuation quality,
   - less end-of-session noise.

## Session Checklist

- Is MTF regime aligned with signal direction?
- Is target level high-acceptance (high cumulative band volume)?
- Is price near level with momentum, not drifting?
- If breakout, did it hold beyond level after first retest?
- If no follow-through quickly, mark as defensive exit candidate.

## Next Additions (Planned)

- MTF OR/PDH/PDL confluence score (HTF and current session overlap bonus)
- S/R channel strength feed from `TV-S&R-ZONES.pine`
- IDR/DR distance and STD level factor from `TV-IDR.pine`
- Council / voting score as additional confidence weight
- "Safety Defence Protocol" signal mode presets in Pine

## Change Log Template

Use this block per iteration:

```text
Date:
Symbol / Session:
Changed Params:
Why:
Observed Win:
Observed Failure:
Keep / Revert:
Next Test:
```

