#!/usr/bin/env bash
# go500.sh — 500-asset 1m loop engine (M3D Rust)
# Runs: M3D engine · 200-bar ring buffer · 60s tick · JEDI + Lance tier output
# Output: engine/data/algo_day.json  |  engine/data/algo_state.db
# Requires: M3D Rust compiled (./go3d.sh build) or runs cargo build first
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
M3D="$ROOT/M3D"

C=$'\033[0;36m'; G=$'\033[0;32m'; NC=$'\033[0m'
log() { echo -e "${C}[go500]${NC} $*"; }
ok()  { echo -e "${G}[go500]${NC} $*"; }

log "500-asset 1m loop — M3D Rust engine"
log "  Output → $M3D/engine/data/algo_day.json"
log "  DB     → $M3D/engine/data/algo_state.db"
echo ""

mkdir -p "$M3D/engine/data"

# Build if binary missing or source newer
BIN="$M3D/target/debug/engine"
if [ ! -f "$BIN" ]; then
  log "Binary not found — building engine..."
  cd "$M3D" && cargo build -p engine
  ok "Build complete."
fi

cd "$M3D"
exec cargo run -p engine
