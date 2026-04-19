#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# daily_hunt.sh — M4D Autonomous Daily Pipeline
#
# RUNS EVERY WEEKDAY AT 06:00 ET (11:00 UTC) — before NY open
# Stages run sequentially; each writes JSON to ds/data/
# DS server must be running on :8000 (or use --offline for direct Python)
#
# USAGE:
#   ./daily_hunt.sh              # full pipeline via DS API (:8000 must be up)
#   ./daily_hunt.sh --offline    # direct Python (no server required)
#   ./daily_hunt.sh --quick      # skip signal_logger (use existing signal_log.db)
#   ./daily_hunt.sh --stage IC   # run single stage only
#
# CRON (add via: crontab -e)
#   30 10 * * 1-5 cd /Volumes/AI/AI-4D/M4D && ./daily_hunt.sh >> logs/hunt.log 2>&1
#
# STAGES:
#   0. signal_logger  — recompute signal_log.db from futures bars (skip with --quick)
#   1. IC             — regime IC monitor → retire/watch decisions
#   2. WF             — walkforward 41-fold OOS validation
#   3. ENSEMBLE       — soft-routed vs equal-weight Sharpe comparison
#   4. GATE           — gate search, stacked Sharpe
#   5. PCA            — correlation cluster check (retire clones)
#   6. CROSS          — cross-asset regime (risk-on / risk-off)
#   7. SUMMARY        — print daily briefing to terminal
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DS_DIR="$ROOT/ds"
DATA_DIR="$ROOT/ds/data"
LOG_DIR="$ROOT/logs"
DS_URL="http://127.0.0.1:8000"
PYTHON="python3"

mkdir -p "$LOG_DIR" "$DATA_DIR"

R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; C=$'\033[0;36m'; B=$'\033[0;34m'; NC=$'\033[0m'
NOW=$(date '+%Y-%m-%d %H:%M:%S')

log()  { echo -e "${C}[HUNT]${NC} $*"; }
ok()   { echo -e "${G}[OK]${NC}   $*"; }
fail() { echo -e "${R}[FAIL]${NC} $*"; }
warn() { echo -e "${Y}[WARN]${NC} $*"; }
sep()  { echo -e "${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

sep
log "M4D DAILY HUNT · $NOW"
sep

# ── Parse args ─────────────────────────────────────────────────────────────────
OFFLINE=false
QUICK=false
SINGLE_STAGE=""
for arg in "$@"; do
  case "$arg" in
    --offline) OFFLINE=true ;;
    --quick)   QUICK=true ;;
    --stage)   shift; SINGLE_STAGE="${2:-}" ;;
    *) [[ "$arg" =~ ^[A-Z]+$ ]] && SINGLE_STAGE="$arg" ;;
  esac
done

# ── DS server check ────────────────────────────────────────────────────────────
if ! $OFFLINE; then
  if ! curl -sf "$DS_URL/health/" > /dev/null 2>&1; then
    warn "DS server not responding at $DS_URL — switching to --offline mode"
    OFFLINE=true
  else
    ok "DS server live at $DS_URL"
  fi
fi

# ── Stage runner ───────────────────────────────────────────────────────────────
run_api() {
  local name="$1" endpoint="$2"
  log "Stage $name → POST $endpoint"
  local t0=$SECONDS
  if curl -sf -X POST "$DS_URL$endpoint" -o /dev/null; then
    ok "$name done in $((SECONDS - t0))s"
    return 0
  else
    fail "$name API call failed: $endpoint"
    return 1
  fi
}

run_py() {
  local name="$1" module="$2" fn="${3:-run}"
  log "Stage $name → python $module.$fn()"
  local t0=$SECONDS
  cd "$DS_DIR"
  if $PYTHON -c "
import sys; sys.path.insert(0, '.')
from $module import $fn
$fn()
" 2>&1; then
    ok "$name done in $((SECONDS - t0))s"
    return 0
  else
    fail "$name python call failed"
    return 1
  fi
  cd "$ROOT"
}

# ── Stage 0: signal_logger ─────────────────────────────────────────────────────
run_stage0() {
  [[ "$QUICK" == true ]] && { warn "Stage SIGNAL skipped (--quick)"; return 0; }
  log "Stage SIGNAL — recomputing signal_log.db (5m bars, all symbols)"
  local t0=$SECONDS
  cd "$DS_DIR"
  if $PYTHON ds_app/signal_logger.py 2>&1; then
    ok "signal_logger done in $((SECONDS - t0))s"
  else
    fail "signal_logger failed — hunting with stale signal_log.db"
  fi
  cd "$ROOT"
}

# ── Stage 1: IC Monitor ────────────────────────────────────────────────────────
run_stage_IC() {
  if $OFFLINE; then
    run_py "IC" "ds_app.ic_monitor" "run_ic_monitor"
  else
    run_api "IC" "/v1/ic/run/"
  fi
  # Print retire alerts
  local ic_file="$DATA_DIR/ic_monitor.json"
  if [[ -f "$ic_file" ]]; then
    local retires
    retires=$($PYTHON -c "
import json
d = json.load(open('$ic_file'))
alerts = d.get('retire_alerts', [])
print(' '.join(alerts) if alerts else 'none')
" 2>/dev/null || echo "parse-error")
    if [[ "$retires" != "none" && "$retires" != "parse-error" ]]; then
      warn "IC RETIRE ALERTS: $retires"
    else
      ok "IC: no new retires"
    fi
  fi
}

# ── Stage 2: Walk-Forward ──────────────────────────────────────────────────────
run_stage_WF() {
  if $OFFLINE; then
    run_py "WF" "ds_app.walkforward" "run_walkforward"
  else
    run_api "WF" "/v1/walkforward/run/"
  fi
  local wf_file="$DATA_DIR/walkforward_report.json"
  if [[ -f "$wf_file" ]]; then
    $PYTHON -c "
import json
d = json.load(open('$wf_file'))
s = d.get('summary', {}).get('oos_sharpe', {})
print(f\"  WF OOS Sharpe mean={s.get('mean',0):.3f}  pos_folds={s.get('pct_positive',0)*100:.0f}%\")
" 2>/dev/null || true
  fi
}

# ── Stage 3: Ensemble ─────────────────────────────────────────────────────────
run_stage_ENSEMBLE() {
  if $OFFLINE; then
    run_py "ENSEMBLE" "ds_app.sharpe_ensemble" "build_routed_ensemble"
  else
    run_api "ENSEMBLE" "/v1/ai/ensemble/run/"
  fi
  local ens_file="$DATA_DIR/routed_ensemble_report.json"
  if [[ -f "$ens_file" ]]; then
    $PYTHON -c "
import json
d = json.load(open('$ens_file'))
soft = d.get('soft_routed', {})
delta = d.get('soft_routing_delta', 0)
print(f\"  SOFT Sharpe={soft.get('sharpe',0):.3f}  delta={delta:+.3f}\")
" 2>/dev/null || true
  fi
}

# ── Stage 4: Gate Search ──────────────────────────────────────────────────────
run_stage_GATE() {
  if $OFFLINE; then
    run_py "GATE" "ds_app.trade_quality_gate" "run_gate_search"
  else
    run_api "GATE" "/v1/gate/run/"
  fi
  local gate_file="$DATA_DIR/gate_search_report.json"
  if [[ -f "$gate_file" ]]; then
    $PYTHON -c "
import json
d = json.load(open('$gate_file'))
print(f\"  GATE stacked_sharpe={d.get('stacked_sharpe',0):.3f}\")
" 2>/dev/null || true
  fi
}

# ── Stage 5: PCA ──────────────────────────────────────────────────────────────
run_stage_PCA() {
  if $OFFLINE; then
    run_py "PCA" "ds_app.pca_analysis" "run_pca"
  else
    run_api "PCA" "/v1/ai/pca/run/"
  fi
  local pca_file="$DATA_DIR/pca_report.json"
  if [[ -f "$pca_file" ]]; then
    $PYTHON -c "
import json
d = json.load(open('$pca_file'))
pairs = d.get('high_corr_pairs', [])
kill  = [p for p in pairs if p.get('corr', 0) >= 0.9]
print(f\"  PCA dims_80={d.get('dims_80','?')}  high_corr_pairs={len(pairs)}  kill_candidates={len(kill)}\")
if kill:
    for p in kill[:3]:
        print(f\"    KILL {p['a']} ↔ {p['b']}  corr={p['corr']:.3f}\")
" 2>/dev/null || true
  fi
}

# ── Stage 6: Cross-Asset ──────────────────────────────────────────────────────
run_stage_CROSS() {
  if $OFFLINE; then
    run_py "CROSS" "ds_app.cross_asset" "run_cross_asset"
  else
    run_api "CROSS" "/v1/cross/run/"
  fi
  local cross_file="$DATA_DIR/cross_asset_report.json"
  if [[ -f "$cross_file" ]]; then
    $PYTHON -c "
import json
d = json.load(open('$cross_file'))
print(f\"  CROSS regime={d.get('regime','?')}  composite={d.get('composite',0):+.3f}\")
" 2>/dev/null || true
  fi
}

# ── Stage 7: Summary briefing ──────────────────────────────────────────────────
run_stage_SUMMARY() {
  sep
  log "DAILY BRIEFING — $NOW"
  sep
  $PYTHON -c "
import json, os, pathlib
DATA = pathlib.Path('$DATA_DIR')

def load(fn):
    p = DATA / fn
    return json.loads(p.read_text()) if p.exists() else {}

wf   = load('walkforward_report.json')
ens  = load('routed_ensemble_report.json')
gate = load('gate_search_report.json')
ic   = load('ic_monitor.json')
pca  = load('pca_report.json')
cross= load('cross_asset_report.json')

print()
print('  ENSEMBLE  soft_sharpe =', round(ens.get('soft_routed',{}).get('sharpe',0),3))
print('  WALKFWD   oos_sharpe  =', round(wf.get('summary',{}).get('oos_sharpe',{}).get('mean',0),3))
print('  GATE      stacked     =', round(gate.get('stacked_sharpe',0),3))
print('  PCA       dims_80     =', pca.get('dims_80','?'))
print('  CROSS     regime      =', cross.get('regime','?'))
print()

# Retire alerts
alerts = ic.get('retire_alerts', [])
if alerts:
    print(f'  ⚠  RETIRE: {\" \".join(alerts)}')
else:
    print('  ✓  IC: no retire signals')

# High-corr pairs to kill
kill = [p for p in pca.get('high_corr_pairs',[]) if p.get('corr',0)>=0.9]
if kill:
    print(f'  ⚠  KILL CORR: {\" \".join(p[\"a\"]+\"+\"+p[\"b\"] for p in kill[:3])}')
print()
" 2>/dev/null || warn "Summary parse failed — check individual JSON files"
  sep
}

# ── Main execution ─────────────────────────────────────────────────────────────
TOTAL_START=$SECONDS
STAGES=(SIGNAL IC WF ENSEMBLE GATE PCA CROSS SUMMARY)
FAILED=()

if [[ -n "$SINGLE_STAGE" ]]; then
  log "Single stage mode: $SINGLE_STAGE"
  case "$SINGLE_STAGE" in
    SIGNAL)   run_stage0 ;;
    IC)       run_stage_IC ;;
    WF)       run_stage_WF ;;
    ENSEMBLE) run_stage_ENSEMBLE ;;
    GATE)     run_stage_GATE ;;
    PCA)      run_stage_PCA ;;
    CROSS)    run_stage_CROSS ;;
    SUMMARY)  run_stage_SUMMARY ;;
    *)        fail "Unknown stage: $SINGLE_STAGE"; exit 1 ;;
  esac
else
  # Full pipeline
  run_stage0     || FAILED+=(SIGNAL)
  run_stage_IC   || FAILED+=(IC)
  run_stage_WF   || FAILED+=(WF)
  run_stage_ENSEMBLE || FAILED+=(ENSEMBLE)
  run_stage_GATE || FAILED+=(GATE)
  run_stage_PCA  || FAILED+=(PCA)
  run_stage_CROSS || FAILED+=(CROSS)
  run_stage_SUMMARY
fi

sep
ELAPSED=$((SECONDS - TOTAL_START))
if [[ ${#FAILED[@]} -eq 0 ]]; then
  ok "ALL STAGES COMPLETE in ${ELAPSED}s"
else
  warn "COMPLETED with failures: ${FAILED[*]} — check logs above"
fi
sep
