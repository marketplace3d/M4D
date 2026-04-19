#!/usr/bin/env bash
# W3D launcher — isolated root app
#
#   ./go3w.sh         → run W3D dev server (opens browser when ready)
#   ./go3w.sh dev     → same as default
#   ./go3w.sh server  → run dev server without auto-open
#   ./go3w.sh build   → production build
#   ./go3w.sh preview → preview production build
#
# Port: W3D dev :5600

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
W3D_DIR="$ROOT/W3D"
CMD="${1:-dev}"
READY_TIMEOUT="${GO3W_READY_TIMEOUT:-120}"

C="\033[0;36m"; G="\033[0;32m"; R="\033[0;31m"; NC="\033[0m"
log() { echo -e "${C}[W3D]${NC} $*"; }
ok()  { echo -e "${G}[W3D]${NC} $*"; }
err() { echo -e "${R}[W3D]${NC} $*"; }

check_node() {
  command -v node >/dev/null 2>&1 || { err "node not found"; exit 1; }
  [ -d "$W3D_DIR" ] || { err "Missing W3D/ directory at $W3D_DIR"; exit 1; }
  if [ ! -d "$W3D_DIR/node_modules" ]; then
    log "Installing W3D dependencies..."
    (cd "$W3D_DIR" && npm install)
  fi
}

open_when_ready() {
  local url="$1"
  local max="$2"
  (
    for _ in $(seq 1 "$max"); do
      code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "$url" 2>/dev/null || true)
      if [[ "$code" =~ ^[23] ]]; then
        open "$url" 2>/dev/null || true
        exit 0
      fi
      sleep 1
    done
    echo "[go3w.sh] timeout waiting for $url" >&2
  ) &
}

run_dev() {
  check_node
  log "Starting W3D dev server → http://127.0.0.1:5600/"
  open_when_ready "http://127.0.0.1:5600/" "$READY_TIMEOUT"
  cd "$W3D_DIR"
  exec npm run dev -- --host 127.0.0.1 --port 5600
}

run_server() {
  check_node
  log "Starting W3D dev server (no auto-open) → http://127.0.0.1:5600/"
  cd "$W3D_DIR"
  exec npm run dev -- --host 127.0.0.1 --port 5600
}

run_build() {
  check_node
  log "Building W3D..."
  cd "$W3D_DIR"
  npm run build
  ok "Build complete."
}

run_preview() {
  check_node
  log "Previewing W3D build → http://127.0.0.1:5601/"
  open_when_ready "http://127.0.0.1:5601/" "$READY_TIMEOUT"
  cd "$W3D_DIR"
  exec npm run preview -- --host 127.0.0.1 --port 5601
}

case "$CMD" in
  dev|"") run_dev ;;
  server) run_server ;;
  build) run_build ;;
  preview) run_preview ;;
  help|-h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) err "Unknown: $CMD. Use: dev|server|build|preview"; exit 1 ;;
esac
#!/usr/bin/env bash
# W3D launcher — isolated W3D root app
#
#   ./go3w.sh           → W3D dev server (:5600)
#   ./go3w.sh dev       → same as default
#   ./go3w.sh build     → production build
#   ./go3w.sh preview   → preview built app (:5601)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
W3D_DIR="$ROOT/W3D"
CMD="${1:-dev}"

C="\033[0;36m"
G="\033[0;32m"
R="\033[0;31m"
NC="\033[0m"
log() { echo -e "${C}[W3D]${NC} $*"; }
ok() { echo -e "${G}[W3D]${NC} $*"; }
err() { echo -e "${R}[W3D]${NC} $*"; }

ensure_w3d() {
  [ -d "$W3D_DIR" ] || { err "Missing $W3D_DIR"; exit 1; }
  command -v node >/dev/null || { err "node not found"; exit 1; }
  if [ ! -d "$W3D_DIR/node_modules" ]; then
    log "Installing W3D dependencies..."
    (cd "$W3D_DIR" && npm install)
  fi
}

run_dev() {
  ensure_w3d
  log "W3D dev → http://127.0.0.1:5600/"
  cd "$W3D_DIR"
  exec npm run dev -- --host 127.0.0.1 --port 5600
}

run_build() {
  ensure_w3d
  cd "$W3D_DIR"
  log "Building W3D..."
  npm run build
  ok "Build complete."
}

run_preview() {
  ensure_w3d
  cd "$W3D_DIR"
  log "W3D preview → http://127.0.0.1:5601/"
  exec npm run preview -- --host 127.0.0.1 --port 5601
}

case "$CMD" in
  dev|"") run_dev ;;
  build) run_build ;;
  preview) run_preview ;;
  help|-h|--help)
    sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    err "Unknown: $CMD. Use dev|build|preview"
    exit 1
    ;;
esac
