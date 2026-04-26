#!/usr/bin/env bash
# M3D stack launcher — invoke via /Volumes/AI/AI-4D/go.sh or directly
#
#   ./go3d.sh              → ALL: api :3300 + ds :8800 + M3D site :5500 + engine
#   ./go3d.sh site         → M3D React site only (Vite :5500)
#   ./go3d.sh api          → Rust Axum API only (:3300)
#   ./go3d.sh ds           → Python Django DS only (:8800)
#   ./go3d.sh engine       → Rust engine only
#   ./go3d.sh build        → build site + api + engine
#   ./go3d.sh discover     → MRT feature discovery → MRT/data/mrt_discovery.json
#   ./go3d.sh mrt-api      → build + run mrt-api :3340 only (research JSON + discovery)
#
# Ports:  M3D site :5500  |  API :3300  |  DS :8800  |  mrt-api :3340 (default on; set GORT_MRT=0 to skip)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# Same as ./gort.sh: start MRT with `all` unless caller disables (e.g. goa.sh / go.sh used to leave this unset → no :3340).
export GORT_MRT="${GORT_MRT:-1}"
CMD="${1:-all}"
ARG2="${2:-}"

G="\033[0;32m"; Y="\033[0;33m"; C="\033[0;36m"; R="\033[0;31m"; NC="\033[0m"
log()  { echo -e "${C}[M3D]${NC} $*"; }
ok()   { echo -e "${G}[M3D]${NC} $*"; }
warn() { echo -e "${Y}[M3D]${NC} $*"; }
err()  { echo -e "${R}[M3D]${NC} $*"; }

# Piped service logs: use $'...' — BSD sed eats \\ when the pattern is built from ${G}${NC} variables.
_GO3D_SED_MRT=$'s/^/\033[0;32m[mrt]\033[0m /'
_GO3D_SED_API=$'s/^/\033[0;33m[api]\033[0m /'
_GO3D_SED_ENGINE=$'s/^/\033[0;36m[engine]\033[0m /'
_GO3D_SED_DS=$'s/^/\033[0;32m[ds]\033[0m /'
_GO3D_SED_PULSE=$'s/^/\033[0;33m[pulse]\033[0m /'
_GO3D_SED_SITE=$'s/^/\033[0;31m[site]\033[0m /'

# Cost guard: xAI pulse/news scans are OFF by default.
# Enable explicitly with:
#   M3D_NEWS_PULSE=1 ./go3d.sh all
#   M3D_NEWS_PULSE=1 ./go3d.sh ds
M3D_NEWS_PULSE="${M3D_NEWS_PULSE:-0}"

# Kill whatever is LISTENing on port $1 (stale mrt-api / api / django / vite from a prior run).
_go3d_kill_listener_on_port() {
  local p="$1"
  local label="${2:-}"
  local pids
  pids=$(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)
  [ -z "$pids" ] && return 0
  warn "Stopping ${label:-listener} on :$p (PID(s): $(echo "$pids" | tr '\n' ' '))"
  kill $pids 2>/dev/null || true
}

_go3d_reclaim_stack_ports() {
  log "Freeing dev ports from any previous run (avoids stale mrt-api without /v1/mrt/discovery)…"
  _go3d_kill_listener_on_port 3340 "mrt-api"
  _go3d_kill_listener_on_port 3300 "M3D api"
  _go3d_kill_listener_on_port 8800 "Django"
  _go3d_kill_listener_on_port 5500 "Vite"
  sleep 0.5
}

# ── dependency checks ──────────────────────────────────────────────────────────

check_node() {
  command -v node &>/dev/null || { err "node not found"; exit 1; }
  if [ ! -d "$ROOT/site/node_modules" ]; then
    log "Installing site node_modules..."
    cd "$ROOT/site" && npm install --silent
  fi
}

check_rust() {
  command -v cargo &>/dev/null || { err "cargo not found"; exit 1; }
}

check_python() {
  if [ ! -d "$ROOT/ds/.venv" ]; then
    log "Creating Python venv..."
    cd "$ROOT/ds" && python3 -m venv .venv
  fi
  # Install deps if django missing
  if ! "$ROOT/ds/.venv/bin/python" -c "import django" 2>/dev/null; then
    log "Installing DS requirements..."
    cd "$ROOT/ds" && .venv/bin/pip install -r requirements.txt -q
  fi
}

# ── individual service runners ─────────────────────────────────────────────────

run_site() {
  check_node
  cd "$ROOT/site"
  if [[ "$ARG2" == "server" ]]; then
    log "M3D site → http://localhost:5500/"
    exec npm run dev
  fi
  log "M3D site → http://localhost:5500/"
  exec npm run dev -- --open
}

run_api() {
  check_rust
  cd "$ROOT"
  log "API  → http://localhost:3300/"
  exec cargo run -p api
}

run_engine() {
  check_rust
  cd "$ROOT"
  log "Engine → 5-min loop"
  exec cargo run -p engine
}

run_ds() {
  check_python
  # Load local env vars (API keys etc.) — never commit this file
  if [ -f "$ROOT/M3D/.env.local" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ROOT/M3D/.env.local"
    set +a
    log "Loaded M3D/.env.local"
  fi
  cd "$ROOT/ds"
  log "DS   → http://localhost:8800/"
  mkdir -p data
  .venv/bin/python manage.py migrate --run-syncdb 2>/dev/null || true
  # Start pulse daemon only when explicitly enabled (cost control).
  if [ "$M3D_NEWS_PULSE" = "1" ]; then
    .venv/bin/python grok_pulse.py 2>&1 | sed "$_GO3D_SED_PULSE" &
    PULSE_PID=$!
    trap "kill $PULSE_PID 2>/dev/null" EXIT
    log "News pulse ON (M3D_NEWS_PULSE=1)"
  else
    warn "News pulse OFF (default). Set M3D_NEWS_PULSE=1 to enable."
  fi
  exec .venv/bin/python manage.py runserver 0.0.0.0:8800
}

run_build() {
  check_node; check_rust
  log "Building site..."
  cd "$ROOT/site" && npm run build
  log "Building API (release)..."
  cd "$ROOT" && cargo build --release -p api
  log "Building engine (release)..."
  cd "$ROOT" && cargo build --release -p engine
  if [ -d "$ROOT/MRT" ]; then
    log "Building MRT mrt-api + mrt-processor (release)..."
    (cd "$ROOT/MRT" && cargo build --release -p mrt-api -p mrt-processor) || {
      err "MRT release build failed"
      exit 1
    }
  fi
  ok "Build complete!"
}

run_mrt_discover() {
  check_rust
  MRT_DIR="$ROOT/MRT"
  if [ ! -d "$MRT_DIR" ]; then
    err "No MRT/ directory — add the MRT workspace first"
    exit 1
  fi
  log "MRT discover → $MRT_DIR/data/mrt_discovery.json (via MRT/gort.sh)"
  exec "$MRT_DIR/gort.sh" discover
}

run_mrt_api() {
  check_rust
  if [ ! -d "$ROOT/MRT" ]; then
    err "No MRT/ directory"
    exit 1
  fi
  log "Building mrt-api (debug)…"
  (cd "$ROOT/MRT" && cargo build -p mrt-api) || exit 1
  mkdir -p "$ROOT/MRT/data"
  export MRT_FUTURES_DB="${MRT_FUTURES_DB:-$ROOT/ds/data/futures.db}"
  export MRT_DS_DB="${MRT_DS_DB:-$ROOT/ds/data/ds.db}"
  export MRT_SNAPSHOT_PATH="${MRT_SNAPSHOT_PATH:-$ROOT/MRT/data/mrt_snapshot.json}"
  export MRT_DISCOVERY_PATH="${MRT_DISCOVERY_PATH:-$ROOT/MRT/data/mrt_discovery.json}"
  export MRT_DATA_DIR="${MRT_DATA_DIR:-$ROOT/MRT/data}"
  export MRT_PORT="${MRT_PORT:-3340}"
  _go3d_kill_listener_on_port "$MRT_PORT" "mrt-api"
  log "MRT API → http://localhost:${MRT_PORT}/"
  exec "$ROOT/MRT/target/debug/mrt-api"
}

# ── full stack ─────────────────────────────────────────────────────────────────

run_all() {
  check_node
  check_rust
  check_python

  echo ""
  log "${G}M3D Full Stack${NC} (site + API + DS + engine)"
  log "  M3D site → http://localhost:5500/"
  log "  API    → http://localhost:3300/"
  log "  DS     → http://localhost:8800/"
  log "  Engine → 5-min loop"
  echo ""

  _go3d_reclaim_stack_ports

  # ── Step 1: compile Rust sequentially (avoids Cargo lock contention) ──────
  log "Compiling Rust (api + engine)..."
  cd "$ROOT"
  cargo build -p api -p engine 2>&1 | grep -E "^(error|warning: unused)" | head -10 || true
  if ! cargo build -p api -p engine 2>/dev/null; then
    err "Rust build failed — run 'cargo build -p api -p engine' for details"
    exit 1
  fi
  ok "Rust compiled."

  MRT_PID=""
  if [ "${GORT_MRT:-0}" = "1" ] && [ -d "$ROOT/MRT" ]; then
    log "Compiling MRT (mrt-api + mrt-processor) — required for :3340 /mrt-api…"
    if ! (cd "$ROOT/MRT" && cargo build -p mrt-api -p mrt-processor); then
      err "MRT cargo build failed. Fix errors above, or skip research API: GORT_MRT=0 ./gort.sh all"
      exit 1
    fi
    ok "MRT Rust compiled."
    mkdir -p "$ROOT/MRT/data"
    export MRT_FUTURES_DB="${MRT_FUTURES_DB:-$ROOT/ds/data/futures.db}"
    export MRT_DS_DB="${MRT_DS_DB:-$ROOT/ds/data/ds.db}"
    export MRT_SNAPSHOT_PATH="${MRT_SNAPSHOT_PATH:-$ROOT/MRT/data/mrt_snapshot.json}"
    export MRT_DISCOVERY_PATH="${MRT_DISCOVERY_PATH:-$ROOT/MRT/data/mrt_discovery.json}"
    export MRT_DATA_DIR="${MRT_DATA_DIR:-$ROOT/MRT/data}"
    export MRT_PORT="${MRT_PORT:-3340}"
    MRT_BIN="$ROOT/MRT/target/debug"
    if [ ! -x "$MRT_BIN/mrt-api" ]; then
      err "mrt-api binary missing at $MRT_BIN/mrt-api after build"
      exit 1
    fi
    if [ -x "$MRT_BIN/mrt-processor" ]; then
      ("$MRT_BIN/mrt-processor" 2>/dev/null) || true
    fi
    log "MRT API → http://localhost:3340/"
    ("$MRT_BIN/mrt-api" 2>&1 | sed "$_GO3D_SED_MRT") &
    MRT_PID=$!
  fi

  mkdir -p "$ROOT/engine/data"

  # ── Step 2: start all services using compiled binaries ────────────────────
  (cd "$ROOT" && "$ROOT/target/debug/api"   2>&1 | sed "$_GO3D_SED_API") &
  API_PID=$!

  (cd "$ROOT" && "$ROOT/target/debug/engine" 2>&1 | sed "$_GO3D_SED_ENGINE") &
  ENGINE_PID=$!

  (cd "$ROOT/ds" && \
    .venv/bin/python manage.py migrate --run-syncdb 2>/dev/null || true && \
    .venv/bin/python manage.py runserver 0.0.0.0:8800 2>&1 | sed "$_GO3D_SED_DS") &
  DS_PID=$!

  # Load env for pulse daemon (go.sh may not have sourced it yet)
  if [ -f "$ROOT/M3D/.env.local" ]; then
    set -a; source "$ROOT/M3D/.env.local"; set +a
  fi
  if [ -f "$ROOT/.env.local" ]; then
    set -a; source "$ROOT/.env.local"; set +a
  fi
  PULSE_PID=""
  if [ "$M3D_NEWS_PULSE" = "1" ]; then
    (cd "$ROOT/ds" && \
      .venv/bin/python grok_pulse.py 2>&1 | sed "$_GO3D_SED_PULSE") &
    PULSE_PID=$!
    log "News pulse ON (M3D_NEWS_PULSE=1)"
  else
    warn "News pulse OFF (default). Set M3D_NEWS_PULSE=1 to enable."
  fi

  (cd "$ROOT/site" && npm run dev 2>&1 | sed "$_GO3D_SED_SITE") &
  SITE_PID=$!

  trap "kill $API_PID $ENGINE_PID $DS_PID ${PULSE_PID:-} $SITE_PID ${MRT_PID:-} 2>/dev/null; exit 0" INT TERM
  ok "All services started. Ctrl+C to stop."
  wait
}

# ── dispatch ───────────────────────────────────────────────────────────────────

case "$CMD" in
  all|"")   run_all ;;
  site)     run_site ;;
  api)      run_api ;;
  ds)       run_ds ;;
  engine)   run_engine ;;
  build)    run_build ;;
  m2d)
    M2D="$ROOT/M2D"
    [ ! -d "$M2D/node_modules" ] && (cd "$M2D" && npm install --silent)
    log "M2D → http://localhost:5555/"
    cd "$M2D" && exec npm run dev
    ;;
  discover) run_mrt_discover ;;
  mrt-api)  run_mrt_api ;;
  help|-h)  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' ;;
  *)        err "Unknown: $CMD. Use: all|site|api|ds|engine|build|m2d|discover|mrt-api"; exit 1 ;;
esac
