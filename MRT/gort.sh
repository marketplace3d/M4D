#!/usr/bin/env bash
# MRT — Medallion/RenTech-style signal-factory runner (processor + API).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export MRT_FUTURES_DB="${MRT_FUTURES_DB:-$ROOT/../ds/data/futures.db}"
export MRT_DS_DB="${MRT_DS_DB:-$ROOT/../ds/data/ds.db}"
export MRT_DATA_DIR="${MRT_DATA_DIR:-$ROOT/data}"
export MRT_SNAPSHOT_PATH="${MRT_SNAPSHOT_PATH:-$MRT_DATA_DIR/mrt_snapshot.json}"
export MRT_DISCOVERY_PATH="${MRT_DISCOVERY_PATH:-$MRT_DATA_DIR/mrt_discovery.json}"
export MRT_PORT="${MRT_PORT:-3340}"
export MRT_BARS_TABLE="${MRT_BARS_TABLE:-bars_5m}"

mkdir -p "$MRT_DATA_DIR"

cmd="${1:-help}"
case "$cmd" in
  process)
    cargo run --release -p mrt-processor
    ;;
  discover)
    cargo run --release -p mrt-processor -- discover
    ;;
  api)
    cargo run --release -p mrt-api
    ;;
  all)
    cargo run --release -p mrt-processor
    exec cargo run --release -p mrt-api
    ;;
  build)
    cargo build --release
    ;;
  help|"")
    echo "MRT (signal library over futures.db)"
    echo "Usage: $0 {process|discover|api|all|build}"
    echo ""
    echo "  process  — parallel scan → data/mrt_snapshot.json"
    echo "  discover — feature factory + FDR filter → data/mrt_discovery.json"
    echo "  api      — Axum :${MRT_PORT} (snapshot + db inventory)"
    echo "  all      — process then serve API (foreground)"
    echo "  build    — cargo build --release only"
    echo ""
    echo "Env: MRT_FUTURES_DB MRT_DS_DB MRT_DATA_DIR MRT_SNAPSHOT_PATH MRT_DISCOVERY_PATH MRT_PORT MRT_BARS_TABLE"
    ;;
  *)
    echo "Unknown: $cmd" >&2
    exec "$0" help
    ;;
esac
