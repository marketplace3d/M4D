# SOLO MASTER ORB — Operator Manual
*SoloMasterOrb.tsx · OBI Page · MaxCogViz Human-Cognitive Design*

---

## WHAT IT IS

A single visual instrument that condenses **every active signal** into one read:
direction, strength, confidence, volume, component agreement, Williams range position,
and ICT weekly/daily bias — all without reading a number.

Inspired by aviation ADI (Attitude Direction Indicator): one instrument, no ambiguity.

---

## THE ORB AT A GLANCE

```
         ┌──────────────────────────────────────────┐
         │   WEEK arrow (12 o'clock)                │
         │       ▲  (bull = green)                  │
         │                                          │
  ORB ← ─┤ ─ ─ ─ ╔══════════════╗ ─ ─ ─ → DAILY   │
  (10)   │        ║  conviction  ║        (2)       │
         │        ║    ring      ║                  │
         │   ┌────╫──────────────╫────┐             │
         │   │    ║  Kelly arc   ║    │ EMA (8)     │
         │   │ W-arc            ║    │             │
  VOL ← ─┤ ─ │ ─ ─ (hub) ─ ─ ─ │ ─ ─ → VWAP      │
         │   │   dots●●●  ──►   │    │  (4)        │
         │   │    (JEDI) BIG    │    │             │
         │   └────╫──ARROW──────╫────┘             │
         │        ║  RVOL ↗     ║                  │
         │        ╚══════════════╝                  │
         │   EMA arrow (8 o'clock)                  │
         │       ▼  (bear = red)                    │
         └──────────────────────────────────────────┘
```

---

## ELEMENT-BY-ELEMENT REFERENCE

### 1 · THE BIG CENTRAL ARROW — Primary Read

**The only thing you need to look at first.**

| Position | Meaning | Color |
|----------|---------|-------|
| Pointing RIGHT (horizontal) → | NEUTRAL · no clear bias · dead zone ±9° | Teal |
| Angled UP-RIGHT (e.g. +45°) | BULL bias, partial strength | Green |
| Pointing STRAIGHT UP (+90°) | Maximum BULL — all systems agree | Bright green |
| Angled DOWN-RIGHT (e.g. -45°) | BEAR bias, partial strength | Red |
| Pointing STRAIGHT DOWN (-90°) | Maximum BEAR — all systems agree | Bright red |

**Dead zone:** ±9° treated as horizontal. No noise below the threshold — no arrow drift.

**Rotation formula:**
```
compositeAngle = OBI_bias × 0.55 + SOLO_momentum × 0.30 + Williams_%R × 0.15
```
- OBI bias = (composite − 50) / 50  → −1..+1
- SOLO momentum = biasScore / 27    → −1..+1
- Williams = (0.5 − range_position) × 1.4 → top of range −0.7, bottom +0.7

**Animation:** 0.55s cubic-bezier spring with slight overshoot — you feel the momentum flip before reading the label.

**Angle readout:** displayed above the hub — `+47°`, `−63°`, or `—` for neutral.

---

### 2 · 6 PERIMETER SIGNAL ARROWS — Component Signals

Hexagonal layout, clockwise from top. Each represents one system:

| Clock | Signal | What it measures |
|-------|--------|-----------------|
| 12 | **WEEK** | ICT weekly bias — price vs (PWH+PWL)/2 midpoint |
| 2  | **DAILY** | ICT daily bias — price vs (PDH+PDL)/2 midpoint |
| 4  | **VWAP** | Price above/below session VWAP |
| 6  | **VOL** | Price above/below volume profile POC |
| 8  | **EMA** | EMA9 vs EMA21 cross |
| 10 | **ORB** | Opening range breakout direction |

**Arrow shapes:**
- ▲ = BULL (green triangle pointing up)
- ▼ = BEAR (red triangle pointing down)
- — = NEUTRAL (blue horizontal bar)

**Priority read:** WEEK and DAILY are the ICT primary signals. When both show ▲, the big arrow should be above +45°. If they disagree while other signals align, watch for the big arrow to be suppressed toward neutral — correct behavior.

---

### 3 · TOP/BOTTOM FLANKER ARROWS — MTF Inside Hub

Two small arrows inside the hub near the center:

| Position | Signal | Why inside hub (not perimeter) |
|----------|--------|-------------------------------|
| Top (above hub) | **Weekly bias** | Primary HTF — always the context |
| Bottom (below hub) | **Daily bias** | Intraday confirmation |

These repeat WEEK and DAILY but positioned centrally for the fastest read when the perimeter is busy.

---

### 4 · CONVICTION RING — r=58 (outermost)

The faint arc running around the outer edge.

- Full circle = 100% conviction
- 75% arc = high confidence signal
- 25% arc = early / weak signal
- Color matches SOLO direction

**Source:** SOLO confidence score (EMA trend + move strength composite).

---

### 5 · KELLY ARC — r=44 (inner ring)

The thicker glowing arc inside the main ring.

- Angular span = Kelly % (gate × conviction → optimal position size fraction)
- Starts at ~7 o'clock, sweeps clockwise
- Glows in direction color
- Short arc = small bet. Full arc (320°) = maximum edge detected

**Source:** `gate × (conviction / 100) × 320°`

---

### 6 · WILLIAMS %R ARC — r=28 (innermost arc)

The arc that sits closest to the hub. Colors:

| Color | Meaning | Williams insight |
|-------|---------|-----------------|
| Cyan | Price near BOTTOM of 50-bar range | More likely UP day (Williams bullish) |
| Red  | Price near TOP of 50-bar range | More likely DOWN day (Williams bearish) |
| No arc | Price in middle of range | No range-position edge |

**The Williams edge (Larry Williams):**
> "If a market closes near the top of its recent range, it is more likely to be a down-trending day tomorrow."

When the Williams arc disagrees with the big arrow: reduced confidence — the big arrow angle will be pulled toward neutral by the 15% weighting.

When Williams arc AGREES with big arrow direction: the 15% adds to the composite — angle will be pushed further toward ±90°.

---

### 7 · JEDI ALIGNMENT DOTS — 3 dots above hub

Three small dots at the top of the hub area.

| State | Meaning |
|-------|---------|
| All 3 lit in green | OBI direction agrees with SOLO direction (strong) |
| All 3 lit in amber | OBI agrees with SOLO but direction is uncertain |
| 1 lit | Partial OBI signal detected |
| All dim | OBI NEUTRAL or opposing SOLO |

**Source:** `jediAlign = OBI.dir === 'BULL' ? +0.85 : 'BEAR' ? −0.85 : 0`  
Dots light up proportionally to `|jediAlign|`.

---

### 8 · RVOL BOTTOM ARROW — rotating meter

The small arrow at the bottom of the orb.

| Position | Meaning |
|----------|---------|
| Pointing RIGHT (0°) | Normal volume (1× average) |
| Tilted slightly down | Below-average volume (tape drying up) |
| Tilted UP toward 90° | Hot tape (2× average = full vertical) |

Use this to filter entries: a strong directional big arrow + RVOL pointing up = institutional participation confirmed.

---

### 9 · HUB CORE

| Element | Meaning |
|---------|---------|
| Large outer circle (r=18) | Hub boundary, glows in ring color |
| Small filled dot (r=5) | Direction dot — green (bull) / red (bear) / teal (neutral) |
| White center dot (r=2) | Lock point — always at pivot |

---

### 10 · SOLO BADGE

Bottom badge label. Color matches big arrow (not ring color). This is the final color confirmation: if badge is green and arrow points up, system is in agreement.

---

## SIGNAL PRIORITY HIERARCHY

```
1st  BIG ARROW angle   ← full composite read, the ONE signal
2nd  WEEK + DAILY (12/2 o'clock + flankers)  ← ICT institutional bias
3rd  Williams arc (innermost)  ← range position confirms or fades
4th  JEDI dots  ← OBI structural alignment
5th  Kelly arc  ← how much edge is here
6th  Conviction ring  ← signal confidence
7th  RVOL bottom arrow  ← volume confirms the move
8th  Remaining 4 perimeter arrows (4/6/8/10)  ← secondary technical
```

---

## TRADE FILTER USING THE ORB ALONE

```
Arrow > +45° AND WEEK/DAILY both ▲ AND Williams arc cyan      → STRONG BULL setup
Arrow < -45° AND WEEK/DAILY both ▼ AND Williams arc red       → STRONG BEAR setup
Arrow horizontal (—) regardless of other signals              → NO TRADE — wait
WEEK ▲ but DAILY ▼ (or vice versa)                          → CAUTION — big arrow suppressed toward neutral
RVOL below 1× (slight down tilt)                             → size down, tape not participating
```

---

## FUTURE WIRING (reserved props)

| Prop | Currently wired to | Future |
|------|--------------------|--------|
| `xaiSentiment` | Williams %R | Grok/XAI real-time sentiment |
| `jediAlign` | OBI dir agreement | Full JEDI 27-algo council vote |
| `signalArrows` | OBI preds (6) | Expanded to 27 algo dots |
| `score` | SOLO biasScore | Council composite score |

When live order book is added: a 7th perimeter position (between ORB and WEEK) will show **ORDER WALL** direction — the actual institutional bid/offer imbalance at level. This is the highest-alpha signal possible and will be the final piece of the co-trading system.

---

## DESIGN PHILOSOPHY — MaxCogViz

**One instrument, total information density, zero reading time.**

The human eye processes spatial/angular information faster than text or numbers. The rotating arrow exploits this: you know direction before your conscious mind registers it. The perimeter arrows create a spatial pattern — "all pointing same way" registers instantly as consensus. The concentric rings give depth (conviction → kelly → williams → jedi) without crowding the primary read.

Target cognitive load: **sub-100ms** from orb glance to trade decision.
