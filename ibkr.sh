#!/usr/bin/env bash
# Run ds_app/ibkr_paper.py with any Python that has ib_insync installed.
# Default: ds/.venv/bin/python. Override:
#   IBKR_PYTHON=/usr/bin/python3 ./ibkr.sh test
#   IBKR_PYTHON=python3 ./ibkr.sh run PADAWAN FUTURES --dry
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PY="${IBKR_PYTHON:-$ROOT/ds/.venv/bin/python}"
cd "$ROOT/ds"
exec "$PY" ds_app/ibkr_paper.py "$@"
