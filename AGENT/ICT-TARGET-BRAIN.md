# ICT TARGET BRAIN — OBI Page

*Authored 2026-04-25 · M5D ObiPage.tsx · Potentially #1 success factor for daily trade targeting*

---

## CONCEPT

Price is **drawn to liquidity** — not to ATR multiples or pivot math.
Liquidity = resting stops. ICT places 2–4 levels per session. So do we.

The OBI engine (`computeOBI`) is the brain. It is **fully deterministic** — no AI/LLM needed.
Claude / local models add zero value here: they have no live bars.

---

## LEVEL HIERARCHY (priority order)

| Tier | Label | What it is | Opacity on chart |
|------|-------|------------|-----------------|
| **T1** | ranked target 1 | Highest confluence ICT level in bias direction | **80%** solid, lineWidth 2 |
| **T2–T4** | ranked targets | Next 3 confluence levels | **65%** solid, lineWidth 1 |
| **PD** | PDH / PDL | Previous Day High/Low — most-traded daily magnet | **50%** dashed |
| **PW** | PWH / PWL | Previous Week High/Low — weekly liquidity run | **50%** dashed |
| **HT** | AH / AL | Asia High/Low (8pm–midnight ET) — London sweeps these | **50%** dashed |
| **MT** | LH / LL | London killzone H/L (2–5am ET) — NY sweeps these | **50%** dashed |
| **O** | EQH / EQL | Equal Highs/Lows — buyside/sellside liquidity pools | **50%** dashed |
| **MNO** | MNO | Midnight Open (00:00 NY) — ICT anchor | **50%** dashed |

---

## ENGINE INPUTS (computeOBI)

Only real structural levels feed the rank engine — no invented math:

| Source | Levels | Why |
|--------|--------|-----|
| VWAP ±1σ/±2σ | 4 levels | Algo anchor — institutions re-enter at SD bands |
| Volume Profile | POC, VAH, VAL | Institutional volume concentration |
| ICT Structural | PDH/PDL, AH/AL, LH/LL, MNO, PWH/PWL, EQH/EQL | Where stops are parked = where price is drawn |

**Removed** (were noise): ATR multiples, ORB extensions, Fibonacci extensions, Camarilla, floor pivots

---

## RANKING LOGIC

1. Filter to levels in bias direction (BULL → above price, BEAR → below price)
2. Cluster within ATR × 0.20 tolerance (multiple systems at same price = higher confluence)
3. Rank by system count (confluence) → select top 4

Output: T1 (highest confluence) through T4 — never more than 4.

---

## CHART LINE RENDERING

- **Z-order**: structural background levels added first → ranked targets added last → targets render IN FRONT of candles
- **Colors**: T1 orange, T2 cyan, T3 purple, T4 green | structural = gold/teal
- **Opacity**: encoded as `rgba()` into LightweightCharts LineSeries color
- **Style**: solid lines for ranked targets, dashed for structural reference levels

---

## WHAT ICT ACTUALLY DOES (observed from YT daily)

1. Identify **weekly bias** (above/below PWH/PWL midpoint)
2. Identify **daily bias** (above/below PDH/PDL midpoint)
3. Find **Draw on Liquidity (DOL)** = nearest pool in bias direction (EQH or PDH or PWH)
4. Wait for **killzone** (London 3–5am ET or NY 7–10am ET)
5. Enter on **OB or FVG retracement** toward DOL
6. Target = DOL price. Stop = opposing structure. Done.

No ATR. No Fibonacci. No MA crossings. Institutional levels only.

---

## ICT BUTTON BEHAVIOR

- ICT master button activates **7 sub-layers**: OB · FVG · VP · LT · VWAP · SWG · SESS
- Active state = `ictModeOn`: all 7 on AND noisy layers (BB/SQZ/SIG) off
- First press: loads clean ICT preset
- Second press: clears all 7

---

## MTF / HTF INFLUENCE

- **MTF button** = `obiChartLines.density = 'multi'` + wide spread
- Shows OB + session + VP + swing structural lines from multi-source build
- Equivalent to "HTF line influence" — seeing what the higher-timeframe structure says

---

## NEXT BUILD (computeICTBrain)

The logical next step — pure deterministic, 150 lines:

```typescript
computeICTBrain(bars) → {
  weeklyBias: 'BULL' | 'BEAR' | 'NEUTRAL'
  dailyBias:  'BULL' | 'BEAR' | 'NEUTRAL'
  drawOnLiquidity: { price, label, confidence }   // THE target
  killzone: 'ASIA' | 'LONDON' | 'NY_AM' | 'OFF'  // are we in a valid entry window?
  entryZone: { ob: number | null, fvg: number | null }
  invalidation: number                             // stop level
}
```

Output drives OBI panel header. One target. One stop. Session timing.
