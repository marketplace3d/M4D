# ICT CO-TRADING SYSTEM — Thought Process + JEDI Integration
*Session 2026-04-25 · OBI Engine + Council + JEDI*

---

## ARE T1–T4 DIRECTION-ONLY?

**YES.** `rankTargets()` filters strictly:
- BULL bias → only levels ABOVE current price (`l.price > cur × 1.001`)
- BEAR bias → only levels BELOW current price (`l.price < cur × 0.999`)
- NEUTRAL → returns **zero targets** — no trade, no lines

T1 is always the nearest high-confluence level in the bias direction.
T2–T4 are sequentially further. ICT himself uses T1 only 90% of the time.

---

## ICT BIAS ENGINE — IMPLEMENTED ✓

`dir` is now computed from ICT-native weekly + daily midpoint logic. VWAP/EMA/ORB/VOL are kept as secondary predictors in the panel matrix but do NOT drive direction.

```typescript
weeklyBias = ict.pwh ? (cur > (pwh+pwl)/2 → 'BULL' : 'BEAR') : 'NEUTRAL'
dailyBias  = ict.pdh ? (cur > (pdh+pdl)/2 → 'BULL' : 'BEAR') : 'NEUTRAL'

dir =
  both set and agree        → weeklyBias   (STRONG — biasStrong=true)
  only weekly or only daily → that one     (WEAK — biasStrong=false)
  both set and disagree     → 'NEUTRAL'    (CAUTION — wait for alignment)
  neither set               → 'NEUTRAL'
```

`composite`: 82/18 (strong bull/bear), 65/35 (weak single-TF), 50 (neutral).  
OBI panel shows `WEEK:B/N DAILY:B/N` and `STRONG` badge when both agree.

---

## THE ICT TARGET PHILOSOPHY

ICT **never** scatters across 4–6 levels hoping one hits.
He picks **ONE** draw on liquidity (DOL) and sizes in fully at the killzone.

| What | Why |
|------|-----|
| 1 primary target (T1) | Where the most stops are parked — highest probability of being reached |
| Optional T2 | Only if T1 is a partial-fill zone (e.g. OB boundary vs. full OB sweep) |
| Never T3+ as primary | Too far, too many candles, too much noise in between |

**Rule: If T1 is not clean enough to act on, the correct answer is NO TRADE — not T2.**

---

## WHAT ARE S/R LEVELS VS T LEVELS

These are DIFFERENT concepts. Do not conflate.

| Layer | Source | What it means | Trade use |
|-------|--------|---------------|-----------|
| **T1–T4** | Confluence of ICT structural levels | Where PRICE IS DRAWN (active liquidity target) | The destination — size toward here |
| **LT R1/R2** | Liquidity Thermal (volume at price) | Where buyers/sellers WERE historically active | Potential reaction zone — watch for PA here |
| **LT S1/S2** | Same | Historical support concentration | Same — not a target, a reaction zone |
| **VWAP SD1/2** | Session VWAP bands | Where algos re-enter / distribute | Confluence if aligned with T |

**The relationship:**
- If LT R1 (historical resistance) is AT the same price as T1 (ICT liquidity target) → **maximum confluence** — this IS the trade, T1 is the target, R1 confirms it
- If R1 is NOT near any T level → R1 is just a S/R reference, not a trade target
- S/R alone without liquidity context = noise for ICT

**Bottom line:** S/R (R1/S1) are USEFUL as confluence amplifiers. When they align with T1, confidence goes up. When they don't, they're background context only. T is always the primary target.

---

## ICT LAYERS — PURPOSE OF EACH ON CHART

### Chart overlays (ICT-7 buttons)

| Layer | Button | ICT role | Trade use |
|-------|--------|----------|-----------|
| **Order Blocks** | OB | Last opposing candle before impulse move — institutional order left | Entry trigger: retrace INTO OB → entry on close above/below |
| **Fair Value Gaps** | FVG | Price imbalance — 3-candle structure with gap | Entry trigger AND partial target (price fills gap) |
| **Volume Profile** | VP | Volume at price → POC, VAH, VAL | Confirms T level (T1 = VAH = high confluence) |
| **Liquidity Thermal** | LT | 300-bar volume heatmap — broader S/R context | Background context, R1/S1 labels |
| **VWAP** | VWAP | Session/daily anchor, SD bands | OTE entry zone: price at -1σ BULL = discount entry |
| **Swing Rays** | SWG | Fractal pivots extended as rays | Identifies EQH/EQL (buyside/sellside liquidity pools) |
| **Session Levels** | SESS | PDH/PDL/OR — daily reference frame | PDH = daily T1 candidate, OR = intraday bias tool |

### OBI line overlays (LINES button)

| Line | Density | ICT meaning |
|------|---------|-------------|
| **LT POC** | 3 + 7 | Highest volume node — price magnetically returns here |
| **LT R1/R2** | 3 + 7 | Historical resistance — watch for rejection or break |
| **LT S1/S2** | 3 + 7 | Historical support — watch for bounce or break |
| **PDH/PDL** | 3 + 7 | Daily liquidity — primary ICT daily magnet |
| **PWH/PWL** | 7 only | Weekly liquidity run target |
| **AH/AL** | 7 only | Asia range — London sweep setup |
| **LH/LL** | 7 only | London range — NY sweep setup |
| **EQH/EQL** | 7 only | Equal highs/lows = buyside/sellside pools |
| **MNO** | 3 + 7 | Midnight open — ICT anchor, often T1 or bias flip |

### Ranked target lines (◎ button)

| Line | Meaning |
|------|---------|
| **T1** | Primary DOL — where ICT sizes in, 80% opacity orange |
| **T2** | Secondary — only relevant if T1 is a zone boundary |
| **T3/T4** | Background — consider only after T1/T2 swept |

---

## OPT CO-TRADING THOUGHT PROCESS

The M4D system trades TWO parallel signals simultaneously:

### Signal A — JEDI/Council (27 algos, 500 assets, 5m loop)
- Identifies WHICH assets have the highest alpha score
- Identifies REGIME (bull/bear/neutral market structure)
- Outputs: JEDI score, council votes, asset ranking

### Signal B — OBI Engine (ICT structure, current TF bars)
- Identifies WHERE price is going on the selected instrument
- Outputs: bias direction, T1 target, ICT structural context

### The Co-Trade Trigger (BOTH must align)

```
COUNCIL says:   asset X has JEDI > threshold  AND  regime = BULL
OBI says:       dir = BULL  AND  T1 exists  AND  killzone = ACTIVE
Entry model:    price retrace to OB or FVG  between current and T1
Position:       size = (account × risk%) / (entry - stop)
Target:         T1 price
Stop:           below last swing low (BEAR) / above swing high (BULL)
```

**If either signal is NEUTRAL → no trade.**
This is the filter. JEDI alone = direction without target. OBI alone = target without asset selection.
Together = full thesis.

---

## HOW TO FEED OBI INTO JEDI/COUNCIL

### Currently missing connection:

The JEDI score is a composite of 27 algo votes. It does NOT know about ICT structural levels. The OBI engine knows structure but doesn't know JEDI regime.

### The bridge — proposed `ObiJediSignal`:

```typescript
type ObiJediSignal = {
  asset:       string
  obiDir:      'BULL' | 'BEAR' | 'NEUTRAL'
  jediAligned: boolean   // OBI dir matches JEDI regime
  t1Price:     number
  t1Confidence: number   // 0–100
  killzoneNow: boolean   // London or NY AM active
  entryZone:   { low: number; high: number } | null  // OB or FVG retracement range
  rr:          number    // T1 R:R
  fireReady:   boolean   // ALL conditions met
}
```

`fireReady = obiDir !== NEUTRAL && jediAligned && killzoneNow && rr >= 2.0`

This becomes the COUNCIL FIRE vote for the instrument.

### Implementation path:

1. `computeICTBrain(bars)` → `{ weeklyBias, dailyBias, dol, killzone, entryZone, invalidation }`
2. Compare `dol.dir` with `JEDI regime` from `/v1/council`
3. If aligned + killzone active → emit `fireReady = true`
4. Council panel shows ICT instrument as FIRE tier
5. Order panel uses `entryZone` for limit, `dol.price` as target, `invalidation` as stop

---

## DO WE ALWAYS HAVE A PRIORITIZED DIRECTION?

**No — and that is correct.**

| State | What it means | Action |
|-------|---------------|--------|
| `BULL` with T1 | Clear upside target + bias | Trade |
| `BEAR` with T1 | Clear downside target + bias | Trade |
| `NEUTRAL` | No directional consensus | NO TRADE — wait |
| `BULL` no T1 | Bias exists but no clean target | NO TRADE — wait for structural level to appear |

NEUTRAL is valuable information. It means the market is in balance — no institutional bias detectable at this TF. The correct response is to do nothing, wait for London or NY killzone to break the range and establish direction.

ICT does not force trades. If he's not seeing clear PD/PW level interaction with a clean OB entry, he steps away. This is the most underrated part of his edge.

---

## JEDI FIRE CRITERIA (proposed additions)

Current JEDI FIRE = council composite above threshold in regime.

Add OBI gate:
```
FIRE upgrade conditions:
  +1 tier if T1 aligns with LT R1/S1 (S/R confluence)
  +1 tier if killzone is active (London or NY AM)
  +1 tier if T1 is PDH/PDL or PWH/PWL (institutional level, not just math)
  -1 tier if OBI dir = NEUTRAL
  -1 tier if T1 distance < 0.5 ATR (too close, not a real target)
```

---

## SUMMARY — THE ONE DECISION TREE

```
1. JEDI regime BULL or BEAR?              No → wait
2. OBI dir matches JEDI?                  No → wait (conflict)
3. T1 exists (structural level ahead)?   No → wait
4. T1 is ICT level (PDH/EQH/PWH)?        No → lower confidence
5. Killzone active (London/NY AM)?        No → queue, don't force
6. Entry zone present (OB or FVG)?        No → wait for retest
7. R:R >= 2.0?                            No → skip
   ↓ ALL YES
8. FIRE — size in at OB/FVG, target T1, stop below invalidation
```

This is the complete co-trading thought process.
Nothing fires unless the full stack confirms.
