"""ds_project URL configuration."""
from django.urls import path, include

urlpatterns = [
    path("", include("ds_app.urls")),
]
