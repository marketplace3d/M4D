# M4D AGENT TEAMS — Delta Force Swarm Protocol
## Claude Code Experimental Agent Teams — Enabled

> `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in `~/.claude/settings.json`
> Each teammate = independent Claude Code process, full context, parallel execution.
> Lead = this session. Teammates self-claim tasks, report to task list, lead synthesizes.

---

## When to Spawn a Team vs Run Solo

| Task | Solo | Team |
|------|------|------|
| Single algo backtest | ✅ Solo | |
| Optuna optimize one signal | ✅ Solo | |
| LEGEND scan 15 symbols | ✅ Solo (`run_swarm`) | |
| Scan 500 symbols × 9 Bank C signals | | ✅ Team |
| Build + validate all 27 algo features | | ✅ Team |
| Full council registry update | | ✅ Team |
| OOS validation across all active charters | | ✅ Team |
| Oracle Bootstrap compliance audit | | ✅ Team |

**Rule:** If the task has 3+ independent workstreams that can run simultaneously → spawn a team.

---

## Team Configurations

### TEAM ALPHA — Full Council Scan (27 algos × N symbols)

```
Lead:       ORACLE LEAD (this session) — synthesizes, updates COUNCIL_REGISTRY.md
Teammate 1: BANK A ANALYST — scan 9 BOOM algos (NS/CI/BQ/CC/WH/SA/HK/GO/EF)
Teammate 2: BANK B ANALYST — scan 9 STRAT algos (8E/VT/MS/DP/WS/RV/HL/AI/VK)
Teammate 3: BANK C ANALYST — scan 9 LEGEND algos (SE/IC/WN/CA/TF/RT/MM/OR/DV)
Teammate 4: SHADOW VALIDATOR — run IC/PSR/correlation checks on results
```

**Spawn prompt for each teammate:**
> "You are BANK A ANALYST on the M4D council team. Read ORACLE_BOOTSTRAP.md then COUNCIL_REGISTRY.md.
> Your job: run /cache/?action=swarm&signal=ema_ribbon&interval=1d&period=2y on LEGEND_UNIVERSE_T1.
> Score each result with boom_rank_score. Report top 5 with URLs to task list.
> Do not ask for approval. Execute, verify, log."

---

### TEAM BRAVO — LEGEND Scanner (find next 1–6M trade)

```
Lead:       ORACLE LEAD — final signal card
Teammate 1: COMPRESSION SCOUT — /cache/?action=scan — finds coiled symbols
Teammate 2: BANK C SCORER — runs all 9 LEGEND algos on compressed candidates
Teammate 3: BANK A CONFIRMER — runs 9 BOOM energy checks on top LEGEND candidates
Teammate 4: MACRO GATE — BIG LONG check: VIX regime, SPY state, sector RS
```

Each teammate loads ORACLE_BOOTSTRAP.md automatically (it's in read order in CLAUDE.md).

---

### TEAM CHARLIE — Parallel Optuna (mega param seek)

```
Lead:       ORACLE LEAD — merges results, picks champion params
Teammate 1: OB_FVG OPTIMIZER — /algo-optimize/?signal=ob_fvg&n_trials=150
Teammate 2: STAGE2 OPTIMIZER — /algo-optimize/?signal=stage2&n_trials=150
Teammate 3: CHOC_BOS OPTIMIZER — /algo-optimize/?signal=choc_bos&n_trials=150
Teammate 4: EMA_RIBBON OPTIMIZER — /algo-optimize/?signal=ema_ribbon&n_trials=150
Teammate 5: KC_BREAKOUT OPTIMIZER — /algo-optimize/?signal=kc_breakout&n_trials=150
```

All 5 run simultaneously. Lead gets 5× the search throughput.

---

### TEAM DELTA — Oracle Bootstrap Audit

```
Lead:       ORACLE LEAD — final compliance report
Teammate 1: CODE AUDITOR — checks algo_signals.py for lagging indicators, leakage
Teammate 2: DOC AUDITOR — checks all spec-kit/docs for contradictions, stale content
Teammate 3: BASHER — hits each registered algo with live data, checks kill rule
Teammate 4: CLEANER — identifies dead code, ZZZ folders ready for deletion, duplicate params
```

---

## Spawn Command (from this terminal)

Claude Code agent teams launch naturally — just describe what you want:

```
"Spawn a team of 4 analysts. Assign:
- Teammate 1: run ATR compression scan on LEGEND_UNIVERSE_T1, 1d bars, 2y period
- Teammate 2: run stage2 swarm on same universe
- Teammate 3: run choc_bos swarm on same universe
- Teammate 4: synthesize top candidates where compression + 2+ LEGEND signals agree
Read ORACLE_BOOTSTRAP.md first. No approval needed. Execute."
```

---

## Known Limitations (working around them)

| Limitation | Workaround |
|-----------|------------|
| No session resumption | Save results to `agent/sessions/YYYY-MM-DD-teamname.md` before closing |
| Task status can lag | Lead explicitly polls: "Teammate 1 — confirm task complete + paste result URL" |
| Shutdown slow | Let teammates finish current tool call; don't force-kill |
| No nested teams | Use `run_swarm_multisignal()` in Python for sub-signal parallelism instead |
| Costly (tokens × teammates) | Only spawn when genuine parallelism saves > 30min of serial work |

---

## Cost vs Speed Rule

```
3 teammates × 200k tokens each = 600k tokens
vs serial: 1 session × 600k tokens = same cost, 3× slower

Parallelism is free in wall-clock time. Cost is identical.
Spawn when the task has independent workstreams.
```

---

## Integration with bar_cache.py

All teammates share the same SQLite cache at `~/.m4d_cache/bars.sqlite`.

Teammate 1 fetches SPY 1d → caches it.
Teammates 2–4 get it instantly from cache.

No duplicate downloads. No race conditions (SQLite handles concurrent reads safely).

---

*Agent teams = the Delta Force in digital form. Each operator independent, all reporting to lead, cache shared, results synthesized. This is the machine that builds the machine.*
