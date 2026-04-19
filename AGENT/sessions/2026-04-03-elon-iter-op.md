# Session: ELON ITER OP Command Deck
**Date:** 2026-04-03  
**Theme:** Implement Elon's 5-Step Algorithm as a live operating system for M4D

---

## DONE THIS SESSION

- [x] **LaunchPadPage.tsx** — `#launchpad` · L/H/G keyboard decisions · ↑↓ navigate · localStorage persist · progress bar · sidebar list
- [x] **proposals.json** copied to `M4D/public/` for static serving
- [x] **Nav overhaul** — removed ALGOS, TEST, MAP STUDIO; renamed LIVE WS → CRYPTO; renamed GALAXY → COUNCIL; reordered: COUNCIL → PAD → ENGINE → …
- [x] **Footplate routing fixed** — `#footplate` / `#engine` now resolve correctly
- [x] **MissionHub rewrite** — blank canvas; 3 primary cards (COUNCIL / PAD / ENGINE) + 7 secondary; links all wired
- [x] `launchpad` added to `MissionPage` type + `MISSION_NAV_ITEMS`

---

## TODO — BUILD QUEUE (priority order)

### 🔴 P0 — Bugs (ship blocker)

- [ ] **SWE-BUG-1** · SQLite concurrent write race condition  
  `m4d-ds/crypto_worker.py:85` — add `threading.Lock` around all `conn.execute/commit` paths (lines 299-313, 272-285)

- [ ] **SWE-BUG-2** · SYMBOL_BARS + BEST_PARAMS shared mutable state  
  `crypto_worker.py:325,345,411` — wrap reads/writes in lock; use `.copy()` before Optuna reads deque

- [ ] **SWE-BUG-3** · Silent bar drop on lagged broadcast channel  
  `m4d-api/src/ws_bridge.rs:234` — log + counter on `RecvError::Lagged`; alert on gap

- [ ] **SWE-BUG-4** · parse_f64 returns 0.0 on error → poisoned bars dispatched silently  
  `m4d-api/src/binance_ingest.rs:57-62` — return `Err`, propagate; skip + log poisoned bars

---

### 🟠 P1 — ITER OP infrastructure

- [ ] **PROGRESS page** (`UI-3+ARCH-2`) — new `ProgressPage.tsx` at `#progress`  
  27-algo grid · gate badges (BRS>0 ✓/✗/—) · phase bars (Charter→Backtest→OOS→Council→Automate)  
  Reads `COUNCIL_REGISTRY.md` status column · link to Sword backtest URL per algo  
  Add to nav between PAD and ENGINE

- [ ] **BUZZ page** (`UI-5`) — new `BuzzPage.tsx` at `#buzz`  
  Top 3-4 symbols by energy · per-symbol sparkline + RVOL + energy badge  
  Algo category tiles (BOOM/STRAT/LEGEND) · aggregate HeatBar seismograph  
  Add to nav after ENGINE

- [ ] **DevDrawer** (`ARCH-1`) — `DevDrawer.tsx`  
  Left panel · toggle with `D` key · tabs: DS / SWE / ARCH / DESIGNER  
  Shows proposals filtered by domain · service health per tab  
  Overlay on all pages (rendered in App.tsx above `<main>`)

- [ ] **COUNCIL gate badges** — upgrade `MissionCouncil.tsx`  
  Each of 27 tiles gets gate badge: `✓` validated / `✗` eliminated / `—` research/in-sample  
  Driven by `COUNCIL_REGISTRY.md` AM Status column  
  Bank hotkeys: `1` = Bank A · `2` = Bank B · `3` = Bank C (scroll/focus that bank)  
  Per-tile `RUN BACKTEST` button → opens Sword URL for that algo

---

### 🟡 P2 — Signal improvements (DS)

- [ ] **DS-1** · Expand mini-council 6 → 8 votes (add Darvas + Arrows)  
  `m4d-ds/ds_app/jedi_signal.py:75-85` + `algo_optimizer.py:103-104`  
  Unlocks 1.5× Kelly on true 8/8 alignment · +15-25% BRS expected

- [ ] **DS-3** · Conviction-scaled decel window  
  `jedi_signal.py:204` — `decel_window = min(ceil(conviction × 3), 3) + 1`  
  Aligns with ALGO_UNIVERSAL_RULES §4.2 · +1.2-2.1% BRS expected

- [ ] **DS-4** · Session cutoff grid: 4 discrete buckets → continuous int range 720-870 step 30  
  `algo_optimizer.py:129` — finer grid, no overfit risk

---

### 🟢 P3 — Architecture / Rust

- [ ] **SWE-3** · Exponential backoff + jitter on WS reconnect  
  Replace fixed 5s delay in `binance_ingest.rs:114-125` and `ws_bridge.rs:186-195`  
  100ms-5000ms range; prevents thundering herd on broker recovery

- [ ] **ARCH-5** · Rust Jedi params sync with React `jediAlignment.ts`  
  `m4d-engine/src/algos/registry.rs:33-66` hardcodes equal weights  
  React has tunable A/B/C bank weights (0.2/0.3/0.5) and 25% conviction floor  
  Neither talks to the other — JSON config file to sync both sides

- [ ] **UI-2** · Extract generic `<Sparkline>` from `AlgoVoteSparkline`  
  Used on PROGRESS, BUZZ, CRYPTO, ALGOS — build once, reuse everywhere

- [ ] **ARCH-4** · Fix `CONTEXT.md:89` — source path says `spec-kit/MISSION/`, actual is `M4D/`

---

## Elon 5-Step Checklist (apply before every build)
1. **Question** — does this requirement make sense from first principles?
2. **Delete** — can this step/component be removed entirely? Kill ≥10%/week.
3. **Simplify** — strip to minimum viable; no speculative abstractions.
4. **Accelerate** — go faster *only* after steps 1-3.
5. **Automate** — wire into ENGINE footplate *last*, once the loop is clean.

## Kill rule
`boom_rank_score < 0` on top-3 combos · both engines · 3+ symbols · 20-trade rolling window → eliminate immediately, no exceptions.
