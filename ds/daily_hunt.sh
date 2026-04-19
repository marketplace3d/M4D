#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# DAILY HUNT — M4D Signal Discovery + Regime Validation Pipeline
# Runs every morning (cron: 06:00 ET / 11:00 UTC Mon-Fri)
#
# ASSETS: ES NQ RTY CL 6E GC SI → BTC last
# CORES:  10-core Mac (parallelism via Python multiprocessing + rayon)
#
# STAGES (in order):
#   1. signal_log_builder  — populate signal_log.db from latest bars
#   2. signal_discovery    — FDR hunt on all futures symbols (parallel)
#   3. walkforward         — OOS Sharpe + regime consistency (all symbols)
#   4. ic_monitor          — IC decay check (retire dead signals)
#   5. gate_search         — find new veto gates that improve Sharpe
#   6. pca_signals         — redundancy check, retire clones
#   7. sharpe_ensemble     — re-rank + update SOFT_REGIME_MULT candidates
#   8. hunt_report         — generate ranked candidate list
#
# Usage:
#   ./daily_hunt.sh               # full run
#   ./daily_hunt.sh --quick       # skip discovery (fast: WF + IC + ensemble only)
#   ./daily_hunt.sh --sym ES      # single symbol discovery only
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

DS_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${DS_DIR}/.venv/bin/python"
LOG_DIR="${DS_DIR}/data/logs"
REPORT="${DS_DIR}/data/hunt_report.json"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p "$LOG_DIR"

# Futures-first priority, BTC last
FUTURES_SYMS="ES NQ RTY CL 6E ZN ZB GC SI"
ALL_SYMS="${FUTURES_SYMS} BTC"

# Parse flags
QUICK=0
SINGLE_SYM=""
for arg in "$@"; do
  case $arg in
    --quick)  QUICK=1 ;;
    --sym)    shift; SINGLE_SYM="${1:-ES}" ;;
  esac
done

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  M4D DAILY HUNT  ${TIMESTAMP}  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Stage 0: Verify signal_log has recent data ───────────────────────────────
echo "▶ [0/7] Checking signal_log.db freshness..."
LAST_TS=$(${PYTHON} -c "
import sqlite3, pathlib, datetime
db = pathlib.Path('data/signal_log.db')
if not db.exists(): print('MISSING'); exit()
conn = sqlite3.connect(db)
try:
    last = conn.execute('SELECT MAX(ts) FROM signal_log').fetchone()[0]
    if last:
        dt = datetime.datetime.fromtimestamp(last, tz=datetime.timezone.utc)
        age_h = (datetime.datetime.now(tz=datetime.timezone.utc) - dt).total_seconds() / 3600
        print(f'{dt.strftime(\"%Y-%m-%d %H:%M\")} UTC  ({age_h:.1f}h ago)')
    else:
        print('EMPTY')
except Exception as e:
    print(f'ERROR: {e}')
" 2>/dev/null)
echo "   signal_log last bar: ${LAST_TS}"

# ── Stage 0.5: Refresh signal_log (incremental — last 2 days only) ───────────
echo ""
echo "▶ [0.5/7] signal_logger — incremental refresh (1m bars, all CME symbols)..."
SINCE=$(date -u -v-2d +"%Y-%m-%d" 2>/dev/null || date -u -d "2 days ago" +"%Y-%m-%d")
${PYTHON} ds_app/signal_logger.py --tf 1m --since "${SINCE}" \
  2>&1 | tee "${LOG_DIR}/signal_logger.log" | grep -E "\[|Done\." | tail -8

# ── Stage 1: Signal Discovery (futures first, BTC last) ──────────────────────
if [ "$QUICK" -eq 0 ]; then
  if [ -n "$SINGLE_SYM" ]; then
    echo ""
    echo "▶ [1/7] Signal discovery — ${SINGLE_SYM} only..."
    ${PYTHON} -m ds_app.signal_discovery --sym "${SINGLE_SYM}" \
      2>&1 | tee "${LOG_DIR}/discovery_${SINGLE_SYM}.log" | tail -5
  else
    echo ""
    echo "▶ [1/7] Signal discovery — all symbols (10-core)..."
    echo "   Order: ${ALL_SYMS}"
    # Run futures in parallel (background), then BTC
    PIDS=()
    for SYM in ${FUTURES_SYMS}; do
      ${PYTHON} -m ds_app.signal_discovery --sym "${SYM}" \
        > "${LOG_DIR}/discovery_${SYM}.log" 2>&1 &
      PIDS+=($!)
      echo "   Launched ${SYM} (PID $!)"
    done
    # Wait for all futures to complete
    for PID in "${PIDS[@]}"; do
      wait "$PID" && echo "   ✓ PID ${PID} done" || echo "   ✗ PID ${PID} failed"
    done
    # BTC last (sequential)
    echo "   Running BTC discovery..."
    ${PYTHON} -m ds_app.signal_discovery --sym BTC \
      2>&1 | tee "${LOG_DIR}/discovery_BTC.log" | tail -3

    # Print FDR winners across all symbols
    echo ""
    echo "   FDR WINNERS:"
    for SYM in ${ALL_SYMS}; do
      LOG="${LOG_DIR}/discovery_${SYM}.log"
      if [ -f "$LOG" ]; then
        SURV=$(grep "FDR survivors:" "$LOG" 2>/dev/null | tail -1 | grep -oE '[0-9]+' | head -1)
        echo "   ${SYM}: ${SURV:-?} survivors"
      fi
    done
  fi
fi

# ── Stage 2: Walk-Forward Validation ─────────────────────────────────────────
echo ""
echo "▶ [2/7] Walk-forward (all symbols, 41 folds)..."
${PYTHON} -m ds_app.walkforward 2>&1 | tee "${LOG_DIR}/walkforward.log" | grep -E "Fold|OOS|regime|GATE|✓|✗" | tail -12
# Print gate summary
${PYTHON} -c "
import json, pathlib
p = pathlib.Path('data/walkforward_report.json')
if p.exists():
    d = json.loads(p.read_text())
    s = d.get('summary',{})
    gates = d.get('rentech_gates',{})
    print(f'   OOS Sharpe: mean={s.get(\"oos_sharpe\",{}).get(\"mean\",\"?\"):.2f}  std={s.get(\"oos_sharpe\",{}).get(\"std\",\"?\"):.2f}  pct_pos={s.get(\"oos_sharpe\",{}).get(\"pct_positive\",\"?\")*100:.0f}%')
    print(f'   IS  Sharpe: mean={s.get(\"is_sharpe\",{}).get(\"mean\",\"?\"):.2f}')
    for gate, val in gates.items():
        icon = \"✓\" if val else \"✗\"
        print(f'   {icon} {gate}')
    rg = d.get(\"regime_summary\",{})
    for regime, rv in rg.items():
        icon = \"✓\" if rv.get(\"mean_sharpe\",0) > 0 else \"✗\"
        print(f'   {icon} {regime}: sharpe={rv.get(\"mean_sharpe\",0):.1f}  pct_pos={rv.get(\"pct_positive\",0)*100:.0f}%')
" 2>/dev/null

# ── Stage 3: IC Decay Monitor ────────────────────────────────────────────────
echo ""
echo "▶ [3/7] IC decay monitor..."
${PYTHON} -m ds_app.ic_monitor 2>&1 | tee "${LOG_DIR}/ic_monitor.log" | grep -E "RETIRE|ALIVE|HOT|SLOW|decay" | head -10
${PYTHON} -c "
import json, pathlib
p = pathlib.Path('data/ic_monitor.json')
if p.exists():
    d = json.loads(p.read_text())
    for sig, info in (d.get('signals',d) if isinstance(d.get('signals',d),dict) else {}).items():
        if isinstance(info, dict) and info.get('lifecycle') in ('RETIRE','SLOW'):
            print(f'   ⚠  {sig}: {info.get(\"lifecycle\")}  ic={info.get(\"ic_recent\",\"?\")}')
" 2>/dev/null

# ── Stage 4: Gate Search ─────────────────────────────────────────────────────
echo ""
echo "▶ [4/7] Gate search (Sharpe-improving veto gates)..."
${PYTHON} -m ds_app.gate_search 2>&1 | tee "${LOG_DIR}/gate_search.log" | tail -5

# ── Stage 5: PCA Redundancy ──────────────────────────────────────────────────
echo ""
echo "▶ [5/7] PCA redundancy check..."
${PYTHON} -m ds_app.pca_signals 2>&1 | tee "${LOG_DIR}/pca.log" | grep -E "KILL|SURVIVE|clone|loading" | head -8

# ── Stage 6: Sharpe Ensemble (re-rank + update weights) ──────────────────────
echo ""
echo "▶ [6/7] Sharpe ensemble + regime routing..."
${PYTHON} -m ds_app.sharpe_ensemble 2>&1 | tee "${LOG_DIR}/ensemble.log" | grep -E "Sharpe|delta|IMPROVED|DEGRADED" | head -8
${PYTHON} -c "
import json, pathlib
p = pathlib.Path('data/routed_ensemble_report.json')
if p.exists():
    d = json.loads(p.read_text())
    print(f'   equal_weight: {d.get(\"equal_weight\",{}).get(\"sharpe\",\"?\"):.3f}')
    print(f'   soft_routed:  {d.get(\"soft_routed\",{}).get(\"sharpe\",\"?\"):.3f}  ({d.get(\"soft_routing_verdict\",\"?\")})')
    print(f'   hard_routed:  {d.get(\"hard_routed\",{}).get(\"sharpe\",\"?\"):.3f}  ({d.get(\"hard_routing_verdict\",\"?\")})')
" 2>/dev/null

# ── Stage 7: Generate Hunt Report ────────────────────────────────────────────
echo ""
echo "▶ [7/7] Generating hunt_report.json..."
${PYTHON} -c "
import json, pathlib, datetime

# Aggregate FDR winners from all discovery runs
all_winners = []
log_dir = pathlib.Path('data/logs')
disc_path = pathlib.Path('data/signal_discovery.json')

# Pull from most recent signal_discovery.json (updated by each run)
if disc_path.exists():
    d = json.loads(disc_path.read_text())
    winners = d.get('top_signals', [])
    for w in winners:
        w['source'] = d.get('symbol', '?')
        all_winners.append(w)

# Pull walkforward regime table
wf_path = pathlib.Path('data/walkforward_report.json')
wf_regimes = {}
if wf_path.exists():
    wf = json.loads(wf_path.read_text())
    wf_regimes = wf.get('regime_summary', {})

# Assemble report
report = {
    'generated_at': datetime.datetime.utcnow().isoformat(),
    'asset_priority': ['ES','NQ','RTY','CL','6E','GC','SI','BTC'],
    'n_fdr_winners': len(all_winners),
    'top_candidates': sorted(all_winners, key=lambda x: -abs(x.get('ic',0)))[:20],
    'regime_summary': wf_regimes,
    'action_items': [],
}

# Flag BREAKOUT if still broken
bo = wf_regimes.get('BREAKOUT', {})
if bo.get('mean_sharpe', 0) < -5:
    report['action_items'].append({
        'priority': 'HIGH',
        'action': 'SUPPRESS_BREAKOUT',
        'detail': f'BREAKOUT regime Sharpe={bo[\"mean_sharpe\"]:.1f} — set SOFT_REGIME_MULT[*][BREAKOUT]=0.05',
    })

# Flag OOS decay
wf_s = {}
if wf_path.exists():
    wf_s = json.loads(wf_path.read_text()).get('summary', {})
is_s = wf_s.get('is_sharpe', {}).get('mean', 0)
oos_s = wf_s.get('oos_sharpe', {}).get('mean', 0)
if is_s > 0 and oos_s / is_s < 0.6:
    report['action_items'].append({
        'priority': 'WARN',
        'action': 'IS_OOS_DECAY',
        'detail': f'IS={is_s:.2f} → OOS={oos_s:.2f} ({oos_s/is_s*100:.0f}%) — tighten regime routing',
    })

pathlib.Path('data/hunt_report.json').write_text(json.dumps(report, indent=2))
print(f'   ✓ hunt_report.json  ({len(report[\"top_candidates\"])} candidates, {len(report[\"action_items\"])} action items)')
for item in report['action_items']:
    print(f'   [{item[\"priority\"]}] {item[\"action\"]}: {item[\"detail\"]}')
" 2>/dev/null

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  HUNT COMPLETE — see data/hunt_report.json              ║"
echo "║  The machine hunts. You decide what gets promoted.      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
