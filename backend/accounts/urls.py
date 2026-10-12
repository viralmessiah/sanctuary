from django.urls import path

from . import views

urlpatterns = [
    path("register/", views.register),
    path("verify-otp/", views.verify_otp),
    path("resend-otp/", views.resend_otp),
    path("login/", views.login),
    path("logout/", views.logout),
    path("me/", views.me),
    path("reset-password-request/", views.reset_password_request),
    path("reset-password/", views.reset_password),
    path("invite-user/", views.invite_user),
    path("invite-employee/", views.invite_employee),
    path("google/start/", views.google_start),
    path("google/callback/", views.google_callback),
]
