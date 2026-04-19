#!/usr/bin/env bash
# Django data-science dev site — CDN React bench page (parity with Axum /opt).
#   http://127.0.0.1:8000/   ·  /mission/ (same dist — proxies /v1 → m4d-api :3030)
# Env:
#   M4D_DS_HOST (default 127.0.0.1), M4D_DS_PORT (default 8000)
#   DJANGO_ALLOWED_HOSTS (csv; defaults 127.0.0.1,localhost)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/m4d-ds"
export M4D_DS_HOST="${M4D_DS_HOST:-127.0.0.1}"
export M4D_DS_PORT="${M4D_DS_PORT:-8050}"
export DJANGO_ALLOWED_HOSTS="${DJANGO_ALLOWED_HOSTS:-127.0.0.1,localhost}"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt
python manage.py migrate --noinput
exec python manage.py runserver "${M4D_DS_HOST}:${M4D_DS_PORT}"
