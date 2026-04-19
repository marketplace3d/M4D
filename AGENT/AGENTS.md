# Agent Rules — M3D / M2D / M4D System

## 0. Before Writing Any Code

1. Read `NORTH-STAR.md` — understand what winning looks like
2. Read `AWARENESS.md` — find where the relevant code lives
3. Read `SYSTEM-MAP.md` — understand data flow before touching a layer
4. Read the site brief for your task: `M2D-BRIEF.md` / `M3D-BRIEF.md` / `M4D-BRIEF.md`

**Never** derive algo logic from UI code. Always trace to `COUNCIL.md` or `council-algos.v1.json`.

---

## 1. Code Rules

- Tight, modular, minimal imports. No speculative abstractions.
- Build what is asked — nothing more. No extra config, no extra error handling.
- No backwards-compat shims. No feature flags. No docstrings on code you didn't change.
- Prefer editing existing files over creating new ones.
- Simple algos only. 1 signal family, 2-3 params. If it can't be explained in one sentence, it's too complex.

## 2. Language-Specific Rules

### Rust (api/ engine/)
- api/ and engine/ are in the Cargo workspace. m4d-api/ and m4d-engine/ are NOT.
- rusqlite 0.31 (api) — do not upgrade. Conflicts with m4d-engine 0.32.
- Real threads via tokio::spawn — no blocking in async context.
- For scanner work: see `api/src/scanner.rs` — extend here, do not duplicate.

### Python (ds/)
- Venv at `ds/.venv` (python3.11). Never use system Python or conda for M3D DS.
- Required packages: backtesting, yfinance, ccxt, vectorbt, scipy, statsmodels, multiprocess, databento, requests.
- pandas-ta is dead — do not try to install it. Use numpy/pandas directly for indicators.
- xAI Grok: POST to `/v1/responses` with `input` field. Model: `grok-4.20-reasoning`.
- All views must load `.env.local` — views.py does this at import time already.

### Svelte (M2D/)
- class: with Tailwind slash syntax BREAKS. Use inline ternary:
  - BAD:  `class:bg-green-950/15={cond}`
  - GOOD: `class="{cond ? 'bg-green-950/15' : ''}"`
- WS connects to `/ws/*` — Vite proxies to `:3030` (verify port is `:3300` in vite.config.js).

### TypeScript / React (site/ M4D/)
- Types live in `site/src/types/index.ts` — align with `api/src/models.rs`.
- Blueprint dark theme vars: `--bg-dark: #1c2127`, `--bg-panel: #252a31`.
- Use `height: '100%'` not `'100vh'` for page containers.

---

## 3. Data Rules

- JEDI is a score (−27..+27), not a binary gate. Never binarize it.
- Databento prices: `f/1e9 if f > 1_000_000 else f` (fixed-point detection).
- Databento end date: always `date.today() - timedelta(days=1)`.
- Binance klines: timestamps are milliseconds — divide by 1000.
- Walk-forward IS/OOS split is 75/25. Min 10 trades per window.
- rank_score = IS_sharpe × 0.6 + OOS_sharpe × 0.4.

---

## 4. Safety Rules

**Never trade without Risk Gate approval.** Always pipe signals through `risk_gate.py`.

When building any execution or auto-trading feature:
1. Check DAILY_HALT first — if triggered, all trading stops.
2. Position sizing must be conviction-scaled (not flat-size).
3. Correlated longs > 5 → FLAGGED minimum.
4. Any POD drawdown > −3% → kill that expert's allocation.
5. Flatten logic must be reachable from the UI in one action.

---

## 5. Session Hygiene

- After non-trivial work: add one line to `AGENT/CHANGELOG_AI.md` (newest first).
- Deep dives → `AGENT/sessions/YYYY-MM-DD-topic.md`.
- Never commit: secrets, `.env`, `.db` files, API keys.
- Update `NORTH-STAR.md` success table when something ships.

---

## 6. Agent Teams Protocol

When a task has 3+ independent workstreams → spawn a team.

| Task | Solo | Team |
|------|------|------|
| Single algo backtest | ✓ | |
| Build one scanner alert type | ✓ | |
| Full 27-algo rank across 10 assets | | ✓ |
| OOS validation all charters | | ✓ |
| Multi-model MaxCogViz (Grok + Claude + Gemini) | | ✓ |

Team structure for council work:
```
Lead:       ORACLE LEAD — synthesizes, updates CHANGELOG_AI
Teammate 1: BANK A (BOOM) — 9 entry precision algos
Teammate 2: BANK B (STRAT) — 9 structure algos
Teammate 3: BANK C (LEGEND) — 9 swing algos
Teammate 4: VALIDATOR — IS/OOS, correlation, IC checks
```

---

## 7. What NOT to Build

- Dark pool detection — never backtested well
- Order book imbalance from Binance — not available on free tier
- True HFT (< 1s) — not the architecture; minimum 1m bars
- Equal algo weights in production — regime-specific weights are provably different
- Any feature requiring ANTHROPIC_API_KEY or GOOGLE_GEMINI_KEY until those keys are in .env.local
