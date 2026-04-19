"""Minimal settings — local data-science dev only."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-m4d-ds-dev-not-for-production")
DEBUG = True
_allowed_hosts_raw = os.environ.get("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost")
ALLOWED_HOSTS = [h.strip() for h in _allowed_hosts_raw.split(",") if h.strip()]
# Browsers send Host: hostname:port (e.g. 127.0.0.1:8050). validate_host does not strip the port.
_ds_port = os.environ.get("M4D_DS_PORT", "8050").strip()
_extra_ports = {_ds_port, "8050", "8000"}
_extra_ports = {p for p in _extra_ports if p.isdigit()}
for _base in ("127.0.0.1", "localhost"):
    for _p in _extra_ports:
        _h = f"{_base}:{_p}"
        if _h not in ALLOWED_HOSTS:
            ALLOWED_HOSTS.append(_h)

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "ds_app",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "m4d_ds.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
            ],
        },
    },
]

WSGI_APPLICATION = "m4d_ds.wsgi.application"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
# Built MISSION app: `cd M4D && npm run build:embed`
MISSION_DIST_ROOT = REPO_ROOT / "build" / "mission"
# Forward `/v1/*` + `/health` so one embed bundle (`VITE_M4D_API_URL=/`) works on :8050.
M4D_API_UPSTREAM = os.environ.get("M4D_API_UPSTREAM", "http://127.0.0.1:3330")
