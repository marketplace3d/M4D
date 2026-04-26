# ICT NEXT TARGET SYSTEM — Build Distillation
*Session 2026-04-25 · M5D/src/pages/ObiPage.tsx*

---

## WHAT WAS BUILT

A complete ICT-native price target engine for the OBI page. Deterministic — no AI/LLM calls. Pure structural liquidity logic.

---

## THE CORE INSIGHT

**Price is drawn to liquidity.** Liquidity = resting stops above equal highs / below equal lows / at key daily-weekly reference prices. ICT places 2–4 structural levels per session. The engine does the same.

Everything that is NOT a liquidity pool was stripped:
- ❌ ATR multiples from price — invented math, no institutional basis
- ❌ Fibonacci extensions — not ICT targets  
- ❌ Camarilla pivots — not ICT
- ❌ ORB extensions (t1u/t2u) — not ICT
- ❌ Classic floor trader pivots — not ICT

---

## ICT LEVEL HIERARCHY

| Priority | Label | Definition | Chart opacity |
|----------|-------|-----------|---------------|
| T1 | Ranked target 1 | Highest-confluence institutional level in bias direction | 80% solid orange |
| T2–T4 | Ranked targets | Next 3 by confluence | 65% solid |
| PD | PDH / PDL | Previous Day High/Low — most-traded daily magnet | 50% dashed gold |
| PW | PWH / PWL | Previous Week High/Low — weekly liquidity run | 50% dashed gold |
| HT | AH / AL | Asia session High/Low (8pm–midnight ET) — London sweeps these | 50% dashed gold |
| MT | LH / LL | London killzone High/Low (2–5am ET) — NY sweeps these | 50% dashed gold |
| O | EQH / EQL | Equal Highs/Lows — buyside/sellside liquidity pools | 50% dashed gold |
| — | MNO | Midnight Open (00:00 NY) — ICT anchor price | 50% dashed gold |

---

## ENGINE INPUTS (computeOBI)

Only inputs that map to real institutional levels:

| Input | Levels computed | Why it survives |
|-------|----------------|----------------|
| `bVWAP` | ±1σ, ±2σ | Algo anchor — institutions re-enter at SD bands |
| `bVolProfile` | POC, VAH, VAL | Volume concentration = institutional interest |
| `bICTLevels` | PDH/PDL, AH/AL, LH/LL, MNO, PWH/PWL, EQH/EQL | Stop clusters = liquidity pools |

---

## TIMESTAMP ENGINE (bICTLevels)

Uses real bar timestamps (Unix seconds) — not index math.

```typescript
NY_OFF = 5 * 3600  // EST = UTC-5 (no DST — close enough for level grouping)

nyHour(t)      → NY hour 0–23
nyDayStart(t)  → midnight boundary in NY time
nyWeekStart(t) → Sunday midnight boundary

// Level windows:
PDH/PDL  = yesterday full day (ds === yest)
AH/AL    = yesterday NY hour 20–23 (8pm–midnight = Asia session)
LH/LL    = today NY hour 2–5 (London killzone)
MNO      = first bar at hour 0 today (midnight open)
PWH/PWL  = bars in [lastWeekStart, thisWeekStart)
EQH/EQL  = swing pivots within ATR×0.18 tolerance, min 2 pivots at same level
```

---

## CHART LINE SYSTEM

Three independent controls, all in one `chartLtHeatTargets` memo:

| Control | What it shows | Opacity | Style |
|---------|--------------|---------|-------|
| **LINES** button | Structural ICT levels (PDH/PDL/PW/AH/EQ...) | 50% | dashed, w1 |
| **◎** button | Ranked targets T1–T4 | 80%/65% | solid, w2/w1 |
| **3/7** density | 3=PD+MNO only · 7=all structural | — | — |

**Z-order**: structural levels added first (behind candles), ranked targets added last (in front). LightweightCharts renders later `addSeries()` on top.

**Opacity encoding**: `rgba(r,g,b,alpha)` passed directly to LWC LineSeries `color`. No LWC-specific opacity API needed.

---

## BUTTON STRIP LAYOUT

```
[LINES][◎][3/7]  [ICT]  [OB][FVG][VP][LT][VWAP][SWG][SESS]  [ICHI][MAs]dim  [BOOM][SIG][STR/BAL]  [MIN][HEAT][OBI][DEF][⚙]
```

### ICT button behaviour
- Knocks on the 7 sub-buttons (OB/FVG/VP/LT/VWAP/SWG/SESS) — does NOT lock them
- Each of the 7 can still be toggled individually after ICT activates them
- Active state = `ictModeOn`: all 7 on AND noisy layers (BB/KC/SQZ/SIG) off
- First press → clean ICT preset (strips noise, enables 7)
- Second press → clears all 7

### LINES/◎/3/7 semantics
- **LINES** and **◎** are fully independent — can be on in any combination
- Pressing LINES does NOT affect ◎ (targets) and vice versa
- **3** = Previous Day only (PDH/PDL + MNO) — clean, focused
- **7** = Full structural picture (adds PW/Asia/London/EQH/EQL)

### BOOM button (merged)
- Single button = SQZ + purple tint + SIG arrows
- KC always forced off (user doesn't want Keltner visual)
- Secondary: SIG (arrows only) + STR/BAL (filter toggle)

---

## FILES CHANGED

| File | Change |
|------|--------|
| `M5D/src/pages/ObiPage.tsx` | Full rewrite of OBI engine + button strip |
| `M5D/src/components/BoomLwChart.tsx` | Extended `HeatTarget` type: `color`, `opacity`, `lineWidth`, `lineStyle` |
| `pwa/src/lib/computePriceTargets.ts` | No change needed (used for LT but not main OBI targets) |

---

## WHAT computeOBI RETURNS

```typescript
{
  dir:       'BULL' | 'BEAR' | 'NEUTRAL'
  composite: number          // 0–100 bull/bear vote count
  targets:   ObiTarget[]    // T1–T4, ranked by confluence
  stop:      number          // 1.5×ATR from entry
  entry:     number          // current close
  rr:        number          // R:R to T1
  atrVal:    number
  preds:     { id, dir }[]  // 6 directional predictors
  ict:       ICTLevels       // all raw structural levels
}
```

---

## NEXT: computeICTBrain

The engine knows WHERE the levels are. Next: which ONE is the draw on liquidity.

```typescript
computeICTBrain(bars) → {
  weeklyBias:      'BULL' | 'BEAR' | 'NEUTRAL'
  dailyBias:       'BULL' | 'BEAR' | 'NEUTRAL'
  drawOnLiquidity: { price, label, confidence }   // the single target
  killzone:        'ASIA' | 'LONDON' | 'NY_AM' | 'OFF'
  entryZone:       { ob: number | null, fvg: number | null }
  invalidation:    number
}
```

Drives OBI panel header. One target. One stop. Session timing. No ML.

---

## ICT DAILY PROCESS (observed from YT)

1. Weekly bias: above/below PWH/PWL midpoint → BULL/BEAR for week
2. Daily bias: PDH/PDL midpoint relative to price → confirms or qualifies weekly  
3. Identify DOL (Draw on Liquidity): nearest liquidity pool in bias direction
   - BULL → nearest EQH or PDH or PWH above price
   - BEAR → nearest EQL or PDL or PWL below price
4. Wait for killzone: London (2–5am ET) or NY AM (7–10am ET)
5. Enter on OB or FVG retracement toward DOL
6. Target = DOL. Stop = opposing structure swing.

**That's the complete system.** 2–4 levels. No ATR math.
