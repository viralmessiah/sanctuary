from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from agri import files


def health(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("agri.urls")),
    path("media/<uuid:file_id>/", files.serve_public),
    path("media/<uuid:file_id>/<str:name>", files.serve_public),
]
