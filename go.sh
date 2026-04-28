#!/usr/bin/env bash
# MASTER LAUNCHER — runs from repo root
#
#   ./go.sh | all    → full stack: M3D :5500 · M2D :5565 · M1D :5550 · M4D :5555 · M5D :5556 + backends
#   ./go.sh none     → do not start any service (message only; safe if script is source'd)
#   ./go.sh paper    → PAPER TRADING: DS :8000 + M4D :5555 (TWS must be open on :7497)
#   ./go.sh m3d      → M3D stack only  (site :5500 · API :3300 · DS :8800 · engine)
#   ./go.sh m2d      → M2D only  :5565
#   ./go.sh m1d      → M1D only  (site :5550 · api :3330 · ds :8050)
#   ./go.sh m4d      → M4D :5555 + quant DS :8000
#   ./go.sh m5d      → M5D co-trader :5556 only
#   ./go.sh ds       → quant DS only  :8000  (star-ray, signal-log, PCA, ensemble)
#   ./go.sh site     → M3D site only
#   ./go.sh api      → M3D api only
#   ./go.sh engine   → M3D engine only
#   ./go.sh build    → M3D production build
#
# ── Ports ─────────────────────────────────────────────────────────────────────
#   M3D site :5500   React + Blueprint  (dashboard / · RenTech /mrt)
#   M3D api  :3300   Rust Axum
#   M3D ds   :8800   Django DS (M3D)
#   M2D      :5565   Svelte lean alpha machine
#   M1D site :5550   React MISSION (legacy)
#   M1D api  :3330   Rust m4d-api
#   M1D ds   :8050   Python m4d-ds (crypto worker)
#   M4D      :5555   Main combined interface shell (Vite: ./M4D/ — not m4d)
#   M5D      :5556   Co-trader / Palantir UI (Vite: ./M5D/ — not m5d)
#   DS quant :8000   JSON API; GET / → redirect /health/ (v1/… for backtest, sim, ictsmc, …)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
CMD="${1:-}"

R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; C=$'\033[0;36m'; B=$'\033[0;34m'; NC=$'\033[0m'
log() { echo -e "${C}[GO]${NC} $*"; }

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done }
trap cleanup EXIT INT TERM

# ── Port reclaim — kill any listener on a port before binding ─────────────────
_kill_port() {
  local port="$1" label="${2:-}"
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  [ -z "$pids" ] && return 0
  log "Freeing :$port ${label:+(${label})} — PID(s): $(echo "$pids" | tr '\n' ' ')"
  kill $pids 2>/dev/null || true
  sleep 0.3
}

reclaim_all_ports() {
  log "Reclaiming all stack ports…"
  # M3D
  _kill_port 5500 "M3D site"
  _kill_port 3300 "M3D api"
  _kill_port 8800 "M3D DS"
  _kill_port 3340 "mrt-api"
  # M2D
  _kill_port 5565 "M2D"
  # M1D
  _kill_port 5550 "M1D site"
  _kill_port 3330 "M1D api"
  _kill_port 8050 "M1D DS"
  # M4D + M5D + quant DS
  _kill_port 5555 "M4D"
  _kill_port 5556 "M5D co-trader"
  _kill_port 8000 "DS quant"
  sleep 0.5
}

# ── Service runners ───────────────────────────────────────────────────────────

run_m3d() {
  log "M3D starting (Rust compile ~60s)..."
  (GORT_MRT=0 "$ROOT/go3d.sh" all 2>&1 | sed "s/^/${Y}[M3D]${NC} /") &
  PIDS+=($!)
}

run_m2d() {
  log "M2D starting..."
  [ ! -d "$ROOT/M2D/node_modules" ] && (cd "$ROOT/M2D" && npm install --silent)
  (cd "$ROOT/M2D" && npm run dev 2>&1 | sed "s/^/${C}[M2D]${NC} /") &
  PIDS+=($!)
}

run_m1d() {
  log "M1D starting..."
  ("$ROOT/go4d.sh" all 2>&1 | sed "s/^/${G}[M1D]${NC} /") &
  PIDS+=($!)
}

run_ds_quant() {
  log "DS quant starting on :8000 (signal_log · star-ray · PCA · ensemble · xaigrok)..."
  local DS="$ROOT/ds"
  if [ ! -d "$DS/.venv" ]; then
    log "Creating ds/.venv..."
    python3 -m venv "$DS/.venv"
    "$DS/.venv/bin/pip" install -q -r "$DS/requirements.txt" || \
      echo -e "${R}[DS] pip install had errors — Django may still run${NC}" >&2
  fi
  (
    cd "$DS"
    .venv/bin/python manage.py migrate --noinput -v 0 2>/dev/null || true
    .venv/bin/python manage.py runserver 127.0.0.1:8000 2>&1 | sed "s/^/${G}[DS]${NC} /"
  ) &
  PIDS+=($!)
}

run_m4d() {
  log "M4D starting (./M4D/)…"
  local M4D_APP="$ROOT/M4D"
  if [ ! -f "$M4D_APP/package.json" ]; then
    echo -e "${R}[GO] Skip M4D: no $M4D_APP/package.json (expected folder M4D at repo root)${NC}" >&2
    return 0
  fi
  [ ! -d "$M4D_APP/node_modules" ] && { echo -e "${Y}Installing M4D deps...${NC}"; (cd "$M4D_APP" && npm install --silent); }
  (cd "$M4D_APP" && npm run dev 2>&1 | sed "s/^/${B}[M4D]${NC} /") &
  PIDS+=($!)
}

run_m5d() {
  log "M5D co-trader starting (./M5D/) :5556…"
  local M5D_APP="$ROOT/M5D"
  if [ ! -f "$M5D_APP/package.json" ]; then
    echo -e "${R}[GO] Skip M5D: no $M5D_APP/package.json (expected folder M5D at repo root)${NC}" >&2
    return 0
  fi
  [ ! -d "$M5D_APP/node_modules" ] && { echo -e "${Y}Installing M5D deps...${NC}"; (cd "$M5D_APP" && npm install --silent); }
  (cd "$M5D_APP" && npm run dev 2>&1 | sed "s/^/${C}[M5D]${NC} /") &
  PIDS+=($!)
}

# Poll until ready, then open browser
open_when_ready() {
  local url="$1" max="${2:-180}"
  (
    for _ in $(seq 1 "$max"); do
      code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "$url" 2>/dev/null || echo "000")
      [[ "$code" =~ ^[23] ]] && { open "$url" 2>/dev/null || true; exit 0; }
      sleep 1
    done
    echo -e "${R}[GO] timeout waiting for $url${NC}" >&2
  ) &
}

print_urls() {
  echo ""
  echo -e "──────────────────────────────────────────────────────"
  echo -e "  ${Y}M3D${NC}      http://127.0.0.1:5500/   (after Rust compile)"
  echo -e "  ${C}M2D${NC}      http://127.0.0.1:5565/"
  echo -e "  ${G}M1D${NC}      http://127.0.0.1:5550/"
  echo -e "  ${G}m4d-ds${NC}   http://127.0.0.1:8050/  (crypto worker)"
  echo -e "  ${B}M4D${NC}      http://127.0.0.1:5555/  ← main interface"
  echo -e "  ${C}M5D${NC}      http://127.0.0.1:5556/  ← co-trader Palantir UI"
  echo -e "  ${G}DS quant${NC} http://127.0.0.1:8000/  (→ /health/ JSON)  API /v1/…"
  echo -e "──────────────────────────────────────────────────────"
  echo -e "  Browsers open automatically when each server is ready"
  echo ""
}

# ── Commands ──────────────────────────────────────────────────────────────────

case "$CMD" in

none|noop|_)
  # return first so `source go.sh` does not kill the parent shell; || exit for ./go.sh
  log "No services started. Full stack: ${Y}./go.sh${NC} or ${Y}./go.sh all${NC} · M4D+DS: ${Y}./go.sh m4d${NC} · M5D: ${Y}./go.sh m5d${NC}"
  return 0 2>/dev/null || exit 0
  ;;

""|all)
  reclaim_all_ports
  run_m3d
  run_m2d
  run_m1d
  run_m4d
  run_m5d
  run_ds_quant
  print_urls
  open_when_ready "http://127.0.0.1:5500/" 180
  open_when_ready "http://127.0.0.1:5565/"   90
  open_when_ready "http://127.0.0.1:8050/" 120
  open_when_ready "http://127.0.0.1:5550/" 120
  open_when_ready "http://127.0.0.1:8000/health/" 30
  open_when_ready "http://127.0.0.1:5555/"  90
  open_when_ready "http://127.0.0.1:5556/"  90
  wait || true
  ;;

m3d)  exec "$ROOT/go3d.sh" "${2:-all}" ;;
m2d)  run_m2d; open_when_ready "http://127.0.0.1:5565/" 30; wait || true ;;
m1d)  run_m1d; open_when_ready "http://127.0.0.1:8050/" 120; open_when_ready "http://127.0.0.1:5550/" 120; wait || true ;;
m4d)
  _kill_port 8000 "DS quant"; _kill_port 5555 "M4D"
  run_ds_quant
  run_m4d
  open_when_ready "http://127.0.0.1:8000/health/" 30
  open_when_ready "http://127.0.0.1:5555/" 60
  wait || true
  ;;

m5d)
  _kill_port 5556 "M5D"
  run_m5d
  open_when_ready "http://127.0.0.1:5556/" 40
  wait || true
  ;;
paper)
  _kill_port 8000 "DS quant"; _kill_port 5555 "M4D"
  run_ds_quant
  run_m4d
  echo ""
  echo -e "  ${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ${Y}PAPER TRADING MODE${NC}  (TWS must be open on :7497)"
  echo -e "  ${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ${C}M4D UI${NC}      http://127.0.0.1:5555/"
  echo -e "  ${G}DS API${NC}      http://127.0.0.1:8000/"
  echo ""
  echo -e "  ${Y}TEST TWS:${NC}   curl http://localhost:8000/v1/ibkr/test/"
  echo -e "  ${Y}DRY RUN:${NC}    curl -X POST 'http://localhost:8000/v1/ibkr/run/?mode=PADAWAN&asset=FUTURES&dry=1'"
  echo -e "  ${Y}LIVE RUN:${NC}   curl -X POST 'http://localhost:8000/v1/ibkr/run/?mode=PADAWAN&asset=FUTURES'"
  echo -e "  ${Y}STATUS:${NC}     curl http://localhost:8000/v1/ibkr/status/"
  echo -e "  ${Y}HUNT:${NC}       ./daily_hunt.sh --quick"
  echo ""
  open_when_ready "http://127.0.0.1:8000/health/" 30
  open_when_ready "http://127.0.0.1:5555/" 60
  # Test TWS connection once DS is ready
  (
    for _ in $(seq 1 30); do
      code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "http://127.0.0.1:8000/health/" 2>/dev/null || echo "000")
      if [[ "$code" =~ ^[23] ]]; then
        result=$(curl -s http://localhost:8000/v1/ibkr/test/ 2>/dev/null)
        if echo "$result" | grep -q '"connected": true'; then
          echo -e "  ${G}[IBKR]${NC} TWS connected ✓ $(echo "$result" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"account={d[\"accounts\"][0]}  equity={d[\"equity\"]:.0f} {d[\"currency\"]}")')"
        else
          echo -e "  ${R}[IBKR]${NC} TWS not connected — open TWS → API → port 7497"
        fi
        break
      fi
      sleep 1
    done
  ) &
  wait || true
  ;;

ds)
  _kill_port 8000 "DS quant"
  run_ds_quant
  log "DS quant → http://127.0.0.1:8000/"
  log "  health:   http://127.0.0.1:8000/health/"
  log "  star-ray: http://127.0.0.1:8000/api/star-report/"
  log "  signals:  http://127.0.0.1:8000/v1/signals/"
  wait || true
  ;;

lock-on)
  curl -s -X POST "http://127.0.0.1:8000/v1/control/halt-lock/" \
    -H "Content-Type: application/json" \
    -d '{"halt_lock":true,"lock_key":"terminal","updated_by":"go.sh"}'
  echo
  ;;

lock-off)
  curl -s -X POST "http://127.0.0.1:8000/v1/control/halt-lock/" \
    -H "Content-Type: application/json" \
    -d '{"halt_lock":false,"lock_key":"terminal","updated_by":"go.sh"}'
  echo
  ;;

lock-status)
  curl -s "http://127.0.0.1:8000/v1/control/halt-lock/"
  echo
  ;;

site|api|engine|build)
  exec "$ROOT/go3d.sh" "$CMD" "${2:-}"
  ;;

help|-h|--help)
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  ;;

*)
  echo "Unknown: $CMD" >&2; exit 1
  ;;
esac
