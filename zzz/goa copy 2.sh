#!/usr/bin/env bash
# goa.sh — start all 3 sites: M3D :5500 · M2D :5555 · M4D :5550 (+ mrt-api :3340 via go3d; GORT_MRT=0 to skip)
# Ctrl+C tears everything down.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; C=$'\033[0;36m'; NC=$'\033[0m'

PIDS=()
kill_children() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done }
trap kill_children EXIT INT TERM

_open_when_ready() {
  local url="$1" timeout="${2:-120}"
  (
    local i=0
    while [ $i -lt "$timeout" ]; do
      code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "$url" 2>/dev/null || echo "000")
      if [[ "$code" =~ ^[23] ]]; then
        open "$url" 2>/dev/null || true
        exit 0
      fi
      sleep 1; i=$((i+1))
    done
  ) &
}

echo ""
echo -e "  ${Y}M3D${NC}  http://127.0.0.1:5500/"
echo -e "  ${C}M2D${NC}  http://localhost:5555/"
echo -e "  ${G}M4D${NC}  http://127.0.0.1:5550/"
echo -e "  ${G}DS${NC}   http://127.0.0.1:8050/  (m4d-ds)"
echo -e "  Browsers open when each server is ready"
echo ""

# ── M3D (Rust compile first, then Vite) ──────────────────────────────────────
echo "Starting M3D stack (site :5500 + …)..."
("$ROOT/go3d.sh" all 2>&1 | sed "s/^/${Y}[M3D] ${NC}/") &
PIDS+=($!)

# ── M2D (Svelte/Vite) ────────────────────────────────────────────────────────
echo "Starting M2D..."
[ ! -d "$ROOT/M2D/node_modules" ] && (cd "$ROOT/M2D" && npm install --silent)
(cd "$ROOT/M2D" && npm run dev 2>&1 | sed "s/^/${C}[M2D] ${NC}/") &
PIDS+=($!)

# ── M4D (React + m4d-api Rust + Django) ──────────────────────────────────────
echo "Starting M4D..."
("$ROOT/go4d.sh" all 2>&1 | sed "s/^/${G}[M4D] ${NC}/") &
PIDS+=($!)

# ── Open browsers when ready ─────────────────────────────────────────────────
_open_when_ready "http://127.0.0.1:5500/" 180
_open_when_ready "http://127.0.0.1:8050/" 120
_open_when_ready "http://localhost:5555/" 90
_open_when_ready "http://127.0.0.1:5550/" 120

wait || true
