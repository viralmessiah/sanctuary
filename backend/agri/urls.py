from django.urls import path

from . import api, files, integrations

urlpatterns = [
    path("messaging/recipients/", api.MessageRecipients.as_view()),
    path("messaging/start/", api.StartConversation.as_view()),
    path("entities/<str:name>/", api.EntityList.as_view()),
    path("entities/<str:name>/query/", api.EntityQuery.as_view()),
    path("entities/<str:name>/bulk-create/", api.EntityBulkCreate.as_view()),
    path("entities/<str:name>/bulk-update/", api.EntityBulkUpdate.as_view()),
    path("entities/<str:name>/delete-many/", api.EntityDeleteMany.as_view()),
    path("entities/FinancingRequest/<uuid:pk>/accrue-interest/", api.AccrueLoanInterest.as_view()),
    path("finance/interest-portfolio/", api.InterestPortfolio.as_view()),
    path("entities/<str:name>/<uuid:pk>/", api.EntityDetail.as_view()),
    path("files/upload/", files.upload),
    path("files/private/<uuid:file_id>/", files.serve_private),
    path("integrations/send-email/", integrations.send_email),
    path("integrations/ussd/", integrations.ussd_callback),
]
