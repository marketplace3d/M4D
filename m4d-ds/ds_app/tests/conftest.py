"""Pytest: load Django before tests that hit template rendering (avoids AppRegistryNotReady)."""
import os

import django


def pytest_configure() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "m4d_ds.settings")
    django.setup()
