#!/usr/bin/env bash
# MASTER LAUNCHER — runs from repo root
#
# Prefer ./gort.sh for one-shot M3D + MRT (:3340). This file orchestrates M2D/M4D stacks.
#
#   ./go.sh          → M3D + M2D  (default)
#   ./go.sh all      → M3D + M2D + M4D
#   ./go.sh m2d      → M2D only  :5555
#   ./go.sh m3d      → M3D stack only  site :5500 · API :3300 · DS :8800 · engine
#   ./go.sh m4d      → M4D only  :5550 · :3330 · :8050
#   ./go.sh site     → M3D site only
#   ./go.sh api      → M3D api only
#   ./go.sh ds       → M3D DS only
#   ./go.sh engine   → M3D engine only
#
# ── Ports ─────────────────────────────────────────────────────────────────────
#   M2D  :5555   Svelte lean alpha machine
#   M3D site :5500   React + Blueprint (`site/`, dashboard `/`; RenTech `/mrt`)
#   M3D  :3300   Rust API
#   M3D  :8800   Django DS
#   M4D  :5550   React MISSION
#   M4D  :3330   Rust m4d-api
#   M4D  :8050   Python m4d-ds
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"   # = M3D/
CMD="${1:-default}"

G="\033[0;32m"; Y="\033[0;33m"; C="\033[0;36m"; NC="\033[0m"
log() { echo -e "${C}[GO]${NC} $*"; }

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

run_m3d_bg() {
  log "M3D starting (Rust compile first — ~60s)..."
  ("$ROOT/go3d.sh" all 2>&1 | sed "s/^/${Y}[M3D] ${NC}/") &
  PIDS+=($!)
}

run_m2d_bg() {
  log "M2D starting..."
  [ ! -d "$ROOT/M2D/node_modules" ] && (cd "$ROOT/M2D" && npm install --silent)
  (cd "$ROOT/M2D" && npm run dev 2>&1 | sed "s/^/${C}[M2D] ${NC}/") &
  PIDS+=($!)
}

run_m4d_bg() {
  log "M4D starting (full stack via go4d.sh)..."
  ("$ROOT/go4d.sh" all 2>&1 | sed "s/^/${G}[M4D] ${NC}/") &
  PIDS+=($!)
}

# Poll via curl until server responds, then open browser (macOS)
_open_when_ready() {
  local url="$1" max="${2:-180}"
  (
    for _ in $(seq 1 "$max"); do
      code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "$url" 2>/dev/null)
      if [[ "$code" =~ ^[23] ]]; then
        open "$url" 2>/dev/null || true
        exit 0
      fi
      sleep 1
    done
    echo "[go.sh] timeout: $url" >&2
  ) &
}

print_urls() {
  local s="$1"
  echo ""
  echo -e "──────────────────────────────────────────"
  [[ "$s" == *m2d* ]] && echo -e "  ${C}M2D${NC}  http://localhost:5555/"
  [[ "$s" == *m4d* ]] && echo -e "  ${Y}m4d-ds${NC} http://127.0.0.1:8050/"
  [[ "$s" == *m3d* ]] && echo -e "  ${Y}M3D${NC}  http://127.0.0.1:5500/  (after Rust compile)"
  [[ "$s" == *m4d* ]] && echo -e "  ${G}M4D${NC}  http://127.0.0.1:5550/"
  echo -e "──────────────────────────────────────────"
  echo -e "  Browsers open when each server is ready"
  echo ""
}

case "$CMD" in

default)
  run_m3d_bg
  run_m2d_bg
  print_urls "m3d m2d"
  _open_when_ready "http://127.0.0.1:5500/" 180
  _open_when_ready "http://localhost:5555/" 90
  wait || true
  ;;

all)
  run_m3d_bg
  run_m2d_bg
  run_m4d_bg
  print_urls "m3d m2d m4d"
  _open_when_ready "http://127.0.0.1:5500/" 180
  _open_when_ready "http://127.0.0.1:8050/" 120
  _open_when_ready "http://localhost:5555/" 90
  _open_when_ready "http://127.0.0.1:5550/" 120
  wait || true
  ;;

m2d)  run_m2d_bg; _open_when_ready "http://localhost:5555/" 30; wait || true ;;
m3d)  exec "$ROOT/go3d.sh" "${2:-all}" ;;
m4d)  run_m4d_bg; _open_when_ready "http://127.0.0.1:8050/" 120; _open_when_ready "http://127.0.0.1:5550/" 120; _open_when_ready "http://localhost:5555/" 90; wait || true ;;

site|api|ds|engine|build)
  exec "$ROOT/go3d.sh" "$CMD" "${2:-}"
  ;;

help|-h|--help)
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  ;;

*)
  echo "Unknown: $CMD" >&2; exit 1
  ;;
esac
