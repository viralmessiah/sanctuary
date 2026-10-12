from django import forms
from django.contrib import admin

from .models import User


class UserAdminForm(forms.ModelForm):
    new_password = forms.CharField(required=False, widget=forms.PasswordInput, help_text="Leave blank to keep the current password.")

    class Meta:
        model = User
        fields = ("email", "full_name", "role", "user_type", "data", "is_active", "is_staff", "is_superuser")

    def save(self, commit=True):
        user = super().save(commit=False)
        if self.cleaned_data.get("new_password"):
            user.set_password(self.cleaned_data["new_password"])
        elif not user.pk:
            user.set_unusable_password()
        if commit:
            user.save()
        return user


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    form = UserAdminForm
    ordering = ("-created_date",)
    list_display = ("email", "full_name", "role", "user_type", "is_active", "created_date")
    list_filter = ("role", "user_type", "is_active")
    search_fields = ("email", "full_name")
    fields = ("email", "new_password", "full_name", "role", "user_type", "data", "is_active", "is_staff", "is_superuser")
