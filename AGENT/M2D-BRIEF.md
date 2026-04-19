# M2D — Alpha Signal Surface · Brief

**:5555 · Svelte 4 + Tailwind CSS**

## Role in the System

M2D is the **gold-standard alpha execution surface**. It presents the distilled output of:
- The Rust scanner (real-time SURGE/BREAKOUT/MOM/REV/GAP via /ws/scanner)
- The Risk Gate (every signal filtered before display)
- The MoE alpha layer (expert weights, conviction, approved size)
- Stat arb + funding arb (alternative alpha sources)

**M2D is lean. No charts. No backtest. No science. Only signal → decision → size.**

The human trader sees M2D when they want to trade, not when they want to research.

---

## Pages

| Route | Name | Purpose |
|-------|------|---------|
| `/` | Dashboard | JEDI score, regime, council summary |
| `/alpha` | Alpha | MoE signals, Risk Gate status per signal, pod drawdowns |
| `/tradei` | TradeI | Real-time scanner (WS /ws/scanner), 5 tab types |
| `/xsocial` | XSocial | Grok pulse feed, trigger cards |
| `/backtest` | Backtest | Quick backtest UI (proxies to DS :8800) |
| `/rank` | Rank | Algo leaderboard (proxies to DS :8800) |

---

## Architecture

```
M2D Svelte :5555
  ├── Vite proxy /v1    → Rust API :3300
  ├── Vite proxy /ds    → Django DS :8800
  └── Vite proxy /ws    → ws://localhost:3030 ← CHECK: should be 3300

TradeI.svelte:
  WebSocket /ws/scanner → Rust scanner (real threads, 60s, 50 USDT pairs)
  NOT Python DS — Rust scanner is the live signal source

Alpha.svelte:
  fetchAlpha() → /ds/v1/risk/gate/ (signals piped through gate)
  Shows: ✓ APPROVED (green) · ⚑ FLAGGED (yellow) · ✗ REJECTED (red)
  Pod drawdowns shown per expert
  Daily P&L + HALT banner in regime strip
```

---

## Design Language

- Dark navy theme: `bg-navy-900`, `bg-navy-800`, `bg-navy-700`
- Accent: `text-cyan-400` (primary), `text-orange-400` (alerts), `text-green-400` (LONG), `text-red-400` (SHORT)
- Font: monospace for numbers and tickers
- Minimum 44px touch targets (`.mobile-touch` class)
- Status indicators: `● LIVE` (green) / `● CONNECTING` (red, animate-pulse)
- Badges: absolute positioned, `bg-orange-500`, `w-4 h-4`, `font-size: 9px`

---

## Gold Standard Target State

Every row in M2D shows:
```
SYMBOL  MKT  TYPE      PRICE    CHG%    REL_VOL  DIR   SCORE  DETAIL
BTC      ₿   SURGE    67,420   +2.34%   3.2x    LONG   ██▓░  3.2x avg vol
```

Alpha page shows:
```
EXPERT       WEIGHT  DRAWDOWN  SIGNAL    GATE
VECTOR       ████░   -0.8%     LONG 67%  ✓ APPROVED  0.04 BTC
VOLATILITY   ███░░   -1.2%     HEDGE     ⚑ FLAGGED   correlated
GHOST        ██░░░   --        --        [PENDING]
```

---

## Pending / Next Builds for M2D

1. **Stock scanner** — once Alpaca live funded, wire Alpaca IEX WS into Rust scanner → M2D TradeI `market: "stock"` tab
2. **GHOST expert UI** — show OB/FVG zones once engine has them
3. **ARB expert** — wire stat_arb.py output into MoE → show in Alpha page
4. **Entry scheduler** — click APPROVED → HALO entry modal (spread over N minutes)
5. **Flatten button** — one-click signal to close all positions (requires Alpaca live)
