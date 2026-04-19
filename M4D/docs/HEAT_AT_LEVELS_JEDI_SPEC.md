# Heat at Levels — IQ130+ signal brief

**Purpose:** One dense mental model for *where price is obliged to interact* and *what counts as a high-signal target* — vol at price, structure, and **SIG** (breakout) alignment. Full detail lives in code comments and Pine; this file stays short.

---

## 1. Heat layers (Mission chart toggles)

| Button | Engine | Meaning |
|--------|--------|---------|
| **FVG** | `showFvg` | Fair-value gap bands — horizontal heat, magnet / invalidation context |
| **VP** | `showPoc` | Volume-at-price heat + **VPOC** — where business was done |
| **VWAP** | `showVwap` | Session VWAP + ±1σ — trend/read; magnet on mean reversion days |
| **OB / SWG / SESS** | order blocks, swings, OR·PDH·PDL | Structural anchors, not gradient heat but *same price stations* |

**Rule:** Heat is *per band*; merge mentally (or in automation) by **overlapping prices within ε** (`max(tick, k·ATR)`).

---

## 2. SIG — targets on expansion (not every touch)

**SIG** arrows encode **squeeze box break + RVOL + ATR expansion** (`boomChartBuild` + council path). They are **event targets**: liquidity release and follow-through, not “all levels.”

- **BAL / STR** — density vs confirmation strictness (Mission **SIG BAL | SIG STR** pill).
- **Sliders** — RVOL floor, ATR expansion floor, break distance as ATR fraction (⚙ panel).
- **DEF** — defence profile: tightens those floors and softens SOLO conviction (capital-protection mode).

**IQ130+ read:** Prefer trades when a **hot station** (FVG ∩ VP ∩ VWAP or session line) **coincides with** or **immediately precedes** a SIG-qualified break — *confluence + expansion*, not either alone.

---

## 3. Fusion sketch (for JEDI / automation)

Normalized features in `[0,1]`, then squash:

`Heat ≈ w_vp·VP + w_fvg·FVG + w_sess·session + w_ob·OB + w_rvol·touch_rvol`

Outputs: `heatByPriceBin[]`, `topLevels[]`, optional **0–100** score for alerts (Pine `SRHeat`-style or bridge).

---

## 4. Repo map

| Area | Path |
|------|------|
| Chart assembly | `pwa/src/lib/boomChartBuild.ts` |
| Controls / persistence | `pwa/src/lib/chartControls.ts` |
| Mission UI strip | `M4D/src/pages/TvLwChartsPage.tsx` |
| Levels primitives | `fvgZones.ts`, `volumeProfileHeatPrimitive.ts`, `sessionLevels.ts`, `orderBlocks.ts` |
| Pine reference | `APPS/BUILD-ICT-VOL/pine-ICT-TV-IN/TV-S&R-ZONES.pine`, `HEATSEEKER_ITER_TUNING.md` |

*Bump in commit message when fusion weights or contracts change.*
