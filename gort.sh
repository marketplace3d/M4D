#!/usr/bin/env bash
# GORT — single entry to start M3D science stack + MRT research API.
#
#   ./gort.sh           → same as ./gort.sh all
#   ./gort.sh all       → M3D stack (site :5500, api :3300, ds :8800, engine 5m) + mrt-api (:3340)
#   ./gort.sh site|api|ds|engine|build|discover|mrt-api|m2d  → go3d.sh (mrt-api = :3340 only; discover = FDR scan)
#
# Env: GORT_MRT=0 to skip MRT when using a custom go3d wrapper.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export GORT_MRT="${GORT_MRT:-1}"
exec "$ROOT/go3d.sh" "${1:-all}" "${2:-}"
