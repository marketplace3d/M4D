#!/usr/bin/env bash
# M4D Django ds_app — quick checks to paste for human or CI review.
# Usage: from repo root:  ./m4d-ds/scripts/review_ds_app.sh
#     or: cd m4d-ds && ./scripts/review_ds_app.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export DJANGO_SETTINGS_MODULE=m4d_ds.settings

echo "=== M4D ds_app review bundle ==="
echo "PWD: $ROOT"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

echo "--- git (if repo) ---"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
if git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$REPO_ROOT" status -sb 2>/dev/null || true
  echo ""
  git -C "$REPO_ROOT" diff --stat m4d-ds/ 2>/dev/null | tail -n 25 || true
else
  echo "(not a git checkout or git unavailable)"
fi
echo ""

echo "--- python ---"
python3 --version
echo ""

echo "--- pip deps (m4d-ds) ---"
python3 -m pip freeze | grep -iE '^(django|vectorbt|pandas|numpy|yfinance|pillow|matplotlib|backtesting)=' || true
echo ""

echo "--- django check ---"
python3 manage.py check
echo ""

echo "--- pytest ds_app/tests ---"
python3 -m pytest ds_app/tests/ -q --tb=short
echo ""

echo "--- done (exit 0 if all steps passed) ==="
