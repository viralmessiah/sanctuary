from django.contrib import admin

from .models import ENTITY_MODELS, StoredFile

for model in ENTITY_MODELS:
    admin.site.register(model, type(f"{model.__name__}Admin", (admin.ModelAdmin,), {
        "list_display": ("__str__", "created_by", "created_date"),
        "readonly_fields": ("created_by", "created_date", "updated_date"),
        "list_per_page": 50,
    }))


@admin.register(StoredFile)
class StoredFileAdmin(admin.ModelAdmin):
    list_display = ("original_name", "is_private", "size", "owner", "created_date")
    list_filter = ("is_private",)
