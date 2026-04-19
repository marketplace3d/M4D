Summary:
1. Primary Request and Intent:
   The user (JR, DS/SWE, solo fintech trader) over the previous session requested:
   - Build Binance free 20-level DOM heatmap for BTC (Bookmap-style "ocean" heatmap — walls, spoofing, absorption visualization)
   - Build Polygon OBI (Order Book Imbalance) pressure panel for US stocks using existing $199/mo Polygon Stocks Advanced plan
   - Wire DOM button to CRYPTO tab (BtcChartsPage), OBI button to SPX tab (TvLwChartsPage), both also on ICT tab
   - Place DOM panel BETWEEN the two charts on BTC page (between BoomLwChart and ScalperPanel) — user explicit
   - Document entire system with ASCII visual maps in APP-DOC/
   - Create a Claude Code agent plan for mega backtest + paper trading using 2yr Polygon SQLite data
   - Put all docs and agent plan in /AGENT folder
   - Current session opens post-compaction; no new requests yet

2. Key Technical Concepts:
   - Order Book Imbalance (OBI): `bid_size/(bid_size+ask_size)` — pre-trade directional pressure signal, independent of OHLCV
   - Binance WebSocket combined stream: `wss://stream.binance.com:9443/stream?streams=${pair}@depth20@100ms/${pair}@trade`
   - Polygon.io WebSocket: `wss://socket.polygon.io/stocks` with Q.* (quotes) and T.* (trades) events
   - Trade aggressor detection: Binance `m` field (`true`=sell aggressor, `false`=buy aggressor) — 100% accurate, no inference needed
   - Canvas RAF loop for performant real-time visualization (no React re-renders in hot path)
   - Bookmap-style DOM heatmap: 10 ask rows (red, row 0=furthest/highest) + spread gap + 10 bid rows (teal, row 0=best bid)
   - Spoofing detection via walls that appear/vanish as price approaches
   - Decay-smoothed OBI ratio: `obi = obi * (1-SMOOTH) + newObi * SMOOTH`
   - Signal correlation problem: all 27 algos are OHLCV-derived → corr > 0.6 cluster → adding more barely moves Sharpe
   - WorldQuant 4-gate: Sharpe > 1.0 standalone OOS, corr < 0.3 with council, works 500+ assets, survives all 4 regimes
   - RenTech regime routing: TRENDING/RANGING/BREAKOUT/RISK-OFF → different signal subsets per regime
   - 7 uncorrelated signal slots: TREND, MOMENTUM, VOLATILITY STATE, STRUCTURE, TIMING, PARTICIPATION, PRE-TRADE FLOW
   - Squeeze Momentum = Slot 3 (volatility state — coiling vs expanding — different source from directional momentum)
   - Walk-forward validation: expanding window, OOS Sharpe > 1.5 in 10/12 windows = pass criteria
   - App routing: `spx` → TvLwChartsPage, `ict` → IctChartsPage, `crypto` → BtcChartsPage
   - M3D Rust engine: :3030, Python Django DS: :8000, M6D React: :5173

3. Files and Code Sections:

   **`M6D/src/hooks/useBinanceObiStream.ts`** (NEW)
   - Binance free WS, no auth, 20-level DOM at 100ms
   - Symbol normalization: BTC/BTCUSDT → `btcusdt`
   - Combined stream: `${pair}@depth20@100ms/${pair}@trade`
   - HISTORY_MAX=240, TRADES_MAX=200, SMOOTH=0.08
   ```typescript
   export function useBinanceObiStream(sym: string, enabled = true): BinanceObiSnapshot
   // domHistory: DomSnap[] — each snap has bids[10]+asks[10]+mid price
   // trades: BinanceTrade[] — side derived from m field (true=sell, false=buy)
   ```

   **`M6D/src/hooks/useObiStream.ts`** (NEW)
   - Polygon WS hook routing stocks/crypto/forex to correct endpoints
   - Auth flow: connected → send auth → auth_success → subscribe
   - SMOOTH=0.12, HISTORY_MAX=300, TRADES_MAX=150
   ```typescript
   export function useObiStream(sym: string, apiKey: string | undefined, enabled = true): ObiSnapshot
   // Routes: CRYPTO_SYMS → wss://socket.polygon.io/crypto (XQ.*, XT.*)
   // FOREX_MAP → wss://socket.polygon.io/forex (C.*)
   // Default stocks → wss://socket.polygon.io/stocks (Q.*, T.*)
   // ES/NQ futures → status: 'unsupported'
   ```

   **`M6D/src/components/BinanceObiPanel.tsx`** (NEW)
   - Canvas RAF loop, CANVAS_H = HEATMAP_H(90) + TRADE_H(65) = 155px
   - PRICE_COL_W=58px left axis, N_LEVELS=10 per side, SPREAD_GAP=3px
   - DOM layout: asks row 0=furthest(highest price), row 9=best ask; bids row 0=best bid, row 9=furthest
   - Cell colors: `askColor(intensity)` = rgba(210,g,g,a) red; `bidColor(intensity)` = rgba(0,g,b,a) teal
   - Trade zone: 45s window, log-scale bubble radius, m field for accurate side
   - Header: Binance orange label, mid price, DOM OBI%, bid/ask BTC depth, 10s buy/sell count
   ```typescript
   export default function BinanceObiPanel({ snap, sym }: { snap: BinanceObiSnapshot; sym: string })
   ```

   **`M6D/src/components/ObiLivePanel.tsx`** (NEW)
   - Canvas RAF loop: top 20px pressure heatmap (teal/red by OBI ratio), left 52px wall bubbles, main zone trade bubbles
   - 60s trade timeline, log-scale bubble radius, age-based alpha fade
   - Header: status dot, OBI%, pressure label, bid/ask prices+sizes, spread, trade count

   **`M6D/src/components/BinanceObiPanel.css`** and **`ObiLivePanel.css`** (NEW)
   - Dark theme: #07111e background, #0d1f3c borders, JetBrains Mono font
   - Status colors: live=#00c8a0, connecting=animated #f0a030 pulse, error=#e05050
   - Binance orange accent: #c07020

   **`M6D/src/pages/BtcChartsPage.tsx`** (MODIFIED)
   - Added: BinanceObiPanel import, useBinanceObiStream import
   - Added: `showDom` state, `bnbSnap = useBinanceObiStream(sym, showDom)`
   - Added DOM pill button before HEAT segment
   - Placed `{showDom && <BinanceObiPanel snap={bnbSnap} sym={sym} />}` BETWEEN chart-stage and ScalperPanel

   **`M6D/src/pages/TvLwChartsPage.tsx`** (MODIFIED)
   - Added: ObiLivePanel import, useObiStream import
   - Added: `showObi` state, `obiSnap = useObiStream(sym, vitePolygonKey, showObi)`
   - Added OBI pill button before HEAT segment
   - Added `{showObi && <ObiLivePanel snap={obiSnap} />}` after chart-stage

   **`M6D/src/pages/IctChartsPage.tsx`** (MODIFIED)
   - Added imports: ObiLivePanel, BinanceObiPanel, useObiStream, useBinanceObiStream
   - Added state: `showObi`, `showDom`, `isCrypto` (CRYPTO_SYMS.has(sym))
   - Added OBI pill + DOM pill (isCrypto only) in control strip
   - Added panels after chart-stage

   **`AGENT/CLAUDE-AGENT-PLAN.md`** (NEW)
   - 7-phase executable plan with full schema specs:
     - Phase 1: `signal_logger.py` — signal_log SQLite schema (27 algos + DOM + outcomes)
     - Phase 2: `mega_backtest.py` — all signals on 2yr Polygon data, WorldQuant 4-gate
     - Phase 3: `correlate.py` — Pearson/Spearman corr matrix, cluster > 0.6, keep best Sharpe per cluster
     - Phase 4: `regime.py` — sklearn TRENDING/RANGING/BREAKOUT/RISK-OFF classifier
     - Phase 5: walk-forward validation — expanding window, OOS Sharpe target > 1.5
     - Phase 6: `paper_config.py` — paper_trading_config.json output
     - Phase 7: `api/src/alpaca.rs` — Rust Alpaca paper adapter
   - Trader council gates: ICT/TTrades=timing, Marco=trap, MentFX=structure, Ali Khan=participation, MA=trend filter, Justin Werlein=kill switch

   **`APP-DOC/SYSTEM STATUS/SYSTEM-STATUS-2026-04-17.MD`** (NEW)
   - Full ASCII architecture maps: Layer 0-4 signal stack, confidence audit, DS correlation problem, path to Sharpe, TV synthesis, regime table, 7-phase pipeline diagram

   **Memory files updated:**
   - `/Users/ddd/.claude/projects/-Volumes-AI-AI-4D-M4D/memory/project_built.md`
   - `/Users/ddd/.claude/projects/-Volumes-AI-AI-4D-M4D/memory/project_paper_path.md`
   - `/Users/ddd/.claude/projects/-Volumes-AI-AI-4D-M4D/memory/project_architecture.md`

4. Errors and Fixes:
   - **Write tool rejected for README.md and project_architecture.md**: "File has not been read yet." Fixed by: (1) using Bash heredoc `cat > /path << 'EOF'` for README.md, (2) reading with Read tool first before writing for memory files.
   - **DOM button not visible on BTC page**: User said "I CAN'T SEE THE WALLS ON BTC YET — WHICH CHART — IS THERE A DOM TO PRESS?" Root cause: DOM was wired only to IctChartsPage but user was on CRYPTO tab (BtcChartsPage, route `crypto`). Fixed by adding DOM button + BinanceObiPanel to BtcChartsPage. DOM placement confirmed: BETWEEN chart-stage div and ScalperPanel, not at page bottom.
   - TypeScript: `npx tsc --noEmit` returned clean (no errors) after all modifications.

5. Problem Solving:
   - **Finding correct page for BTC DOM**: Discovered app routing by grepping App.tsx — route `crypto` → BtcChartsPage. DOM was on wrong page for BTC use case.
   - **Non-crypto DOM for stocks**: Honest answer: Binance = crypto only. Polygon $199/mo plan gives real-time NBBO (top of book, not 20-level) for stocks. Full stock DOM requires IBKR TWS API — documented as future step.
   - **Correlation insight**: Identified that all 27 algos + most TV indicators are OHLCV-derived → corr > 0.6 cluster → adding more barely moves Sharpe. Independent signals: DOM OBI (built), Sentiment (slot), CoT CFTC (free, not built), dark pool. This is the key strategic insight driving the AGENT plan.
   - **7-slot architecture**: Established 7 uncorrelated signal dimensions that maximize Sharpe without redundancy.

6. All User Messages:
   - "ONLY crypto ??? DO YOU WANT TO DEEP VIZ THE LIMIT ORDERS ON BTC AND TEST TRADING AND BOTS AND LATER BUY THE IQ DATA OR VISUALLY TRADE WITH BOOKMAP OR DEEPCHART... WHAT TO DO..... SEEMS REALLY GOOD FOR TRADERS ... IS IT USEFULL FOR ALGOS"
   - "wow high alpha for free non crypto also... WE HAVE A LT LAYER IN ICT PAGE WHICH SEEMS TO HAVE LEVEL DATA BUT NOT TIME/INTERVAL POST TRADE DATA...... IF WE HAVE ES YOU COULD BUILD THERE LATER.... FOR NOW YOU COULD DO A GRANULAR LAYER ON SPX PAGE FOR AVAILABLE EXCHANGE STOCK GRANULAR DATA HEAT!!! LIVE!!! TO SHOW BUILDING LIMIT ORDERS IF IN ANY WAY POSSIBLE ... THIS WE COULD ALGO TRADE"
   - "WHAT ASSETS ON POLYGON/MASSIVE ///// THIS MAY BE ALL WE NEED COMBINING WEAKER SIGNALS... MANY ...... NOT TO STRONG A BRITTLE SIGNAL >>> GREAT >>> You're not seeing 20 depth levels — you're seeing the net weight of buyer vs seller pressure accumulating in real time."
   - "gated LIMIT ORDER BUBBLES AND TRADE BUBLES AND PRESSURE ////// YES BUILD IT"
   - "do A BINANCE ONE ON BTC ////// [Polygon pricing details]"
   - "I CANT SEE THE WALLS ON THE BTC YET --- WOULD LOVE TO SEE SPOOFERS... WHICH CHART ... IS THERE A DOM TO PRESS? //////// WE STARTED THIS TO ALSO SEE AS YOU SAID ... NON CRYPTO BINANCE ON THE CHARTS !!!!!"
   - "I DONT KNOW WHY ITS ON THE ICT PAGE BUT LEAVE IT ITS COOL .... NEED THIS ON BTC BETWEEN THE TWO CHARTS"
   - "IM NOT PAYING FOR FOR POLY/MASSIVE. TILL I SEE PAPER WINS AFTER SOME HOW COMBINING ALL ALGOS.///// NOT SURE TO TRADE WITH ALPACA OR IBKR BUT THAT DATA WOULD BE WINNING TO CONFIRM DIRECTION AND ENERGY FOR GO.... ////// GREAT WORK"
   - "PLEASE DOCUMENT THIS AND USE VIZ TEXT ALSO .... RECORD CONTEXT / STATUS... WE IM NOT CONFIDENT IN THE POWER OF THE SYSTEM YET as I have many algos..."
   - "THERE ARE NEW LAYERS OF ALGO ... LAST TIME IT WAS PROVEN TRADERS ON YT RIZDOM... NOW ITS THE BEST TV INDICATORS COMBINED .... BUT IF WE RUN ALL AND CORRELATE OR ENSEMBLE & REGIME ..... I HAVE A RENTECH AND WORLDQUANT PAGE BUILT OUT ON M3D ... TV>>>> APP-DOC/TV INDI AUTOMATES/TV INDI AUTOMATES"
   - "i HOPE YOU ARE NOT SMOKING SOMETHING as you are really sharp today.... I CONCUR WITH YOUR ANALYSIS .... THE RIGHT COMBINATION WILL BE GREAT TO WATCH... MAKE SURE YOU RECORD YOUR TEXT MAPS"
   - "THE SQUEEZE MOMENTUM WAS HIS BEST TV INDICATOR... AND I STARTED WITH BOOM EXPANSION CONFIRMATIONS.. NOT SURE ONE INDICATOR MIGHT REPLACE MY 7 SLOTS NEED TO THINK OF THIS CLEANLY AS ADDING DIFF UNCORRELATED DIMS..... I DO WANT TO KEEP ADDING THE PROVEN..."
   - "PUT THIS AND YOUR DOCS IN / AGENT FOLDER ////////// WE COULD BE CLOSE ... THE BIG TEST IS COMBINE AND TRADE THIS ON PAPER .... MAKE A PLAN FOR CLAUDE CODE TO STREAMLINE AND RUN THIS ON ANY SIM/PAPER OR MEGA BACK TEST ... WE HAVE 2YR POLYGON DATA IN SQLITE.... THIS COULD BECOME AN ENGINE TUNING EXERCISE... MOVING.... IM STARTING MY GRANDFATHERS STEAM ENGINE"

7. Pending Tasks:
   - **P0-1 CRITICAL**: Build `ds/ds_app/signal_logger.py` — runs against `ds/data/ds.db` (2yr Polygon SQLite), outputs `signal_log.db` with full Phase 1 schema (id, timestamp, symbol, timeframe, jedi_score, obi_ratio, dom_pressure, all 27 algo scores, squeeze_state, killzone_active, rvol, icx levels, OHLCV, outcome_1h_pct, outcome_4h_pct, outcome_1d_pct)
   - **P0-2**: Build `ds/ds_app/mega_backtest.py` — score all signals on 2yr Polygon data, apply WorldQuant 4-gate
   - **P0-3**: Build `ds/ds_app/correlate.py` — correlation matrix, cluster > 0.6, kill redundant, output surviving_signals.json
   - **P0-4**: Build `ds/ds_app/regime.py` — TRENDING/RANGING/BREAKOUT/RISK-OFF classifier (sklearn or numpy)
   - **P0-5**: Walk-forward validation — expanding window, OOS Sharpe > 1.5 in 10/12 windows
   - **P0-6**: Alpaca paper adapter in Rust (`api/src/alpaca.rs`)
   - **Future**: IBKR DOM integration for stocks (ES/NQ futures DOM)
   - **Future**: Wire OBI ratio as 28th algo input to council voting

8. Current Work:
   Session ended after completing AGENT documentation package. The last items built were:
   - `AGENT/CLAUDE-AGENT-PLAN.md` — complete 7-phase engine tuning plan
   - `AGENT/README.md` — via Bash heredoc
   - Updated 3 memory files (project_built, project_paper_path, project_architecture)
   - User signed off: "IM STARTING MY GRANDFATHERS STEAM ENGINE" — session complete
   
   New session opens with /compact — no new user requests yet. System is clean (TypeScript passes), all DOM/OBI panels operational on BTC/SPX/ICT pages.

9. Optional Next Step:
   Execute Phase 1 of AGENT/CLAUDE-AGENT-PLAN.md — the first item on P0 critical path:
   
   > "Phase 1 — SIGNAL LOGGER: Build ds/ds_app/signal_logger.py. Run against all symbols in ds.db, all available history. Output: signal_log.db"
   
   Specifically: build `ds/ds_app/signal_logger.py` that reads from `ds/data/ds.db` (2yr Polygon OHLCV), computes all 27 algo signal states + squeeze + killzone + RVOL + ICX proximity metrics per bar, writes to `signal_log.db` with outcome fields (outcome_1h_pct, outcome_4h_pct, outcome_1d_pct) computed from future price. This is the prerequisite for all correlation analysis and paper trading that follows.
   
   **Wait for user to confirm before proceeding** — they signed off last session; confirm this is still the intended next action.
