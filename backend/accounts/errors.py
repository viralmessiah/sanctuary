from rest_framework.response import Response
from rest_framework.views import exception_handler


def _flatten(detail):
    """Turn DRF's nested error detail into one readable sentence."""
    if isinstance(detail, dict):
        parts = []
        for key, val in detail.items():
            text = _flatten(val)
            parts.append(text if key in ("detail", "non_field_errors") else f"{key}: {text}")
        return " ".join(parts)
    if isinstance(detail, (list, tuple)):
        return " ".join(_flatten(d) for d in detail)
    return str(detail)


def api_exception_handler(exc, context):
    """Always answer with {"message": "...", "errors": ...} so the frontend can show err.message."""
    response = exception_handler(exc, context)
    if response is None:
        return None
    data = response.data
    return Response({"message": _flatten(data), "errors": data}, status=response.status_code, headers=dict(response.items()))
