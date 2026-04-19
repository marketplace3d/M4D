#!/usr/bin/env bash
# MASTER LAUNCHER — runs from repo root
#
#   ./go.sh          → ALL: M3D :5500 · M2D :5555 · M4D :5550 · M6D :5650 + backends
#   ./go.sh m3d      → M3D stack only  (site :5500 · API :3300 · DS :8800 · engine)
#   ./go.sh m2d      → M2D only  :5555
#   ./go.sh m4d      → M4D only  (site :5550 · api :3330 · ds :8050)
#   ./go.sh m6d      → M6D :5650 + quant DS :8000
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
#   M2D      :5555   Svelte lean alpha machine
#   M4D site :5550   React MISSION
#   M4D api  :3330   Rust m4d-api
#   M4D ds   :8050   Python m4d-ds (crypto worker)
#   M6D      :5650   M4D combined interface shell
#   DS quant :8000   Django quant DS (signal_log · star-ray · PCA · ensemble · xaigrok)
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
  _kill_port 5555 "M2D"
  # M4D
  _kill_port 5550 "M4D site"
  _kill_port 3330 "M4D api"
  _kill_port 8050 "M4D DS"
  # M6D + quant DS
  _kill_port 5650 "M6D"
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

run_m4d() {
  log "M4D starting..."
  ("$ROOT/go4d.sh" all 2>&1 | sed "s/^/${G}[M4D]${NC} /") &
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

run_m6d() {
  log "M6D starting..."
  local M6D="$ROOT/M6D"
  [ ! -d "$M6D/node_modules" ] && { echo -e "${Y}Installing M6D deps...${NC}"; (cd "$M6D" && npm install --silent); }
  (cd "$M6D" && npm run dev 2>&1 | sed "s/^/${B}[M6D]${NC} /") &
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
  echo -e "  ${C}M2D${NC}      http://localhost:5555/"
  echo -e "  ${G}M4D${NC}      http://127.0.0.1:5550/"
  echo -e "  ${G}m4d-ds${NC}   http://127.0.0.1:8050/  (crypto worker)"
  echo -e "  ${B}M6D${NC}      http://127.0.0.1:5650/  ← main interface"
  echo -e "  ${G}DS quant${NC} http://127.0.0.1:8000/  ← star-ray · PCA · signals"
  echo -e "──────────────────────────────────────────────────────"
  echo -e "  Browsers open automatically when each server is ready"
  echo ""
}

# ── Commands ──────────────────────────────────────────────────────────────────

case "$CMD" in

""| all)
  reclaim_all_ports
  run_m3d
  run_m2d
  run_m4d
  run_ds_quant
  run_m6d
  print_urls
  open_when_ready "http://127.0.0.1:5500/" 180
  open_when_ready "http://localhost:5555/"   90
  open_when_ready "http://127.0.0.1:8050/" 120
  open_when_ready "http://127.0.0.1:5550/" 120
  open_when_ready "http://127.0.0.1:8000/health/" 30
  open_when_ready "http://127.0.0.1:5650/"  90
  wait || true
  ;;

m3d)  exec "$ROOT/go3d.sh" "${2:-all}" ;;
m2d)  run_m2d; open_when_ready "http://localhost:5555/" 30; wait || true ;;
m4d)  run_m4d; open_when_ready "http://127.0.0.1:8050/" 120; open_when_ready "http://127.0.0.1:5550/" 120; wait || true ;;
m6d)
  _kill_port 8000 "DS quant"; _kill_port 5650 "M6D"
  run_ds_quant
  run_m6d
  open_when_ready "http://127.0.0.1:8000/health/" 30
  open_when_ready "http://127.0.0.1:5650/" 60
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

site|api|engine|build)
  exec "$ROOT/go3d.sh" "$CMD" "${2:-}"
  ;;

help|-h|--help)
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  ;;

*)
  echo "Unknown: $CMD" >&2; exit 1
  ;;
esac
