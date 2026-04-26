# ICT–TSX Operating Context (OC)

**Purpose:** Single document to align **code**, **AI Council**, and **iter-opt** on how M4D fuses ICT-style inputs into **significant liquidity levels**, **next-stop priority**, and **direction**—with explicit slots for **institutional confirmation** (CVD, depth, tape) later.

**Code entry point:** `pwa/src/lib/ictLiquiditySynthesis.ts` → `computeIctSynthesis(bars, { asset, tf, dailyBars? })`

---

## 1. What gets fused (source of truth)

| Layer | Module / function | What it contributes |
|--------|-------------------|---------------------|
| **Structure + PD** | `buildOracleSnapshot` | FVG midpoints, OB midpoints, EQH/EQL, breakers, swings, LT POC/HVNs, session PDH/PDL/ORH/ORL |
| **HTF “outer” (ERL)** | `computeMtfLevels` + daily bars in Oracle | PWH/PWL, PMH/PML, PQH/PQL, PDH/PDL (also in session path), CWH/CWL, CMH/CML |
| **Ranked targets** | `computePriceTargets` | VPOC/VA, HVN, PDH/PDL/OR, OB, LT-POC / LT-R/S — merged into unified list |
| **MMM phase + next stop** | `computeMMBrain` | ACCUMULATION / MANIPULATION / DISPLACEMENT / DISTRIBUTION; **nextStop** + **direction** from bias + phase |
| **Magnet score** | `computeCoTraderSignal` | destination, **magnetStrength** 0–100, narrative line for Council |

**You already have OB/FVG** in the chart and in the Oracle snapshot; synthesis **does not duplicate** detection—it **classifies and ranks** what Oracle + MTF + targets already produce.

---

## 2. ICT class tags (for TSX + Council)

Every level is tagged for **gravity** and **class**:

| Class | `IctLevelClass` | Typical `kind` values |
|--------|-----------------|-------------------------|
| **ERL** | External / HTF draw | PWH, PWL, PMH, PML, PQH, PQL, **PDH, PDL** |
| **IRL_RANGE** | Current week/month range edge | CWH, CWL, CMH, CML |
| **IRL_INNER** | In-range structure | FVG_*, OB_*, EQ*, ORH/ORL, BREAKER_* |
| **VALUE** | Volume acceptance | POC, HVN, LT-* (from `computePriceTargets`) |
| **MICRO** | Local swings | SWING_H, SWING_L |

**Gravity (0–100)** blends: class weight × Oracle `priority` × distance (nearer = slightly higher, capped).

---

## 3. Next stop & direction (priority rules)

1. **Primary next stop** (`primaryNextStop`): comes from **MM Brain** — same as `MMPrediction.nextStop` / `nextStopKind` / `nextStopDist` (ATR). This is the **operational** “next MM stop” in the direction the engine chose after phase logic (e.g. manipulation may flip effective direction).

2. **ERL draw** (`nextErlInBias`): nearest **ERL-class** level **above** (bull) or **below** (bear) price — the **macro “train terminus”** in bias direction. If none in book, `price` is null.

3. **Direction priority** (`direction`): `BULL` | `BEAR` | `NEUTRAL` with **strength** 0–1 from phase confidence + bias + regime.

**How to use in TSX:**  
- Scalps: weight **primaryNextStop** + nearest **IRL_INNER** with high gravity.  
- Swing: weight **nextErlInBias** + **ERL** at top of `levels` list.  
- **Co-trader `magnetStrength`** = second opinion on how “locked” the destination is.

---

## 4. Council & iter-opt payload

**String for LLMs / Council:** `councilContext` (compact: price, regime, session, direction, primary stop, ERL draw, top levels, Oracle snippet).

**Explicit gaps (institutional, to wire later):** `dataGaps[]` in the result + this list:

| Data | Status | Intended use |
|------|--------|----------------|
| CVD at level | Not fused | Absorption / false break validation |
| L2 OBI / depth | Optional (Polygon/Binance) | Confirm stop run vs real interest |
| Block/tape | Not connected | Size at PDH/PDL |
| News / macro | Not in synthesis | Veto or boost Council |

**Iter-opt loop:**  
1. Log `councilContext` + outcome (hit/miss, R).  
2. Change **one** weight in `ictLiquiditySynthesis` (gravity) or in `mmBrain` `selectNextStop` priorities—never both in one run.  
3. Compare `primaryNextStop` vs **realized** high/low of session (when backtesting).

---

## 5. API sketch (TypeScript)

```ts
import { computeIctSynthesis } from '@pwa/lib/ictLiquiditySynthesis';

const syn = computeIctSynthesis(chartBars, {
  asset: 'ES',
  tf: '1m',
  dailyBars, // optional: from same symbol, daily resolution
});

syn.levels;              // IctUnifiedLevel[] — by gravity
syn.primaryNextStop;     // MM engine
syn.nextErlInBias;      // HTF draw in bias
syn.direction;          // { bias, strength, drivers }
syn.councilContext;   // paste into Council / TSX log
syn.dataGaps;           // institutional TODOs
```

---

## 6. Changelog (doc)

| Date | Change |
|------|--------|
| 2026-04-25 | Initial OC: `ictLiquiditySynthesis.ts` + this doc |

---

*HUNTING ALPHA. SHIELDED. ITERATE ONE KNOB AT A TIME.*
