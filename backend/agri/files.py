"""File uploads. Public files are readable by anyone holding the (unguessable) URL; private files
(KYC documents) are only reachable through short-lived signed links that the entity API hands out to
users who may read the record that references them (see serializers.py)."""
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.core import signing
from django.http import FileResponse, Http404, HttpResponse
from rest_framework.decorators import api_view, parser_classes, throttle_classes
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from .models import StoredFile

# extension -> (content type, inline-safe?, magic-number check)
ALLOWED = {
    ".jpg": ("image/jpeg", True, (b"\xff\xd8\xff",)),
    ".jpeg": ("image/jpeg", True, (b"\xff\xd8\xff",)),
    ".png": ("image/png", True, (b"\x89PNG\r\n\x1a\n",)),
    ".gif": ("image/gif", True, (b"GIF87a", b"GIF89a")),
    ".webp": ("image/webp", True, (b"RIFF",)),
    ".pdf": ("application/pdf", True, (b"%PDF",)),
    ".csv": ("text/csv", False, None),
    ".txt": ("text/plain", False, None),
    ".doc": ("application/msword", False, None),
    ".docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", False, (b"PK",)),
    ".xls": ("application/vnd.ms-excel", False, None),
    ".xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", False, (b"PK",)),
}
PRIVATE_PREFIX = "private:"
PRIVATE_URL_RE = re.compile(r"/api/files/private/([0-9a-fA-F-]{36})/")
_signer = signing.TimestampSigner(salt="agri.private-file")


class UploadThrottle(UserRateThrottle):
    scope = "upload"


def absolute(path):
    """Prefix with PUBLIC_BASE_URL when the API lives on another origin than the frontend."""
    return f"{settings.PUBLIC_BASE_URL}{path}" if settings.PUBLIC_BASE_URL else path


def public_url(stored):
    return absolute(f"/media/{stored.id}/{_safe_name(stored.original_name)}")


def private_signed_url(file_id):
    return absolute(f"/api/files/private/{file_id}/?s={_signer.sign(str(file_id))}")


def _safe_name(name):
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(name).name).strip("._") or "file"
    return stem[:100]


@api_view(["POST"])
@parser_classes([MultiPartParser])
@throttle_classes([UploadThrottle])
def upload(request):
    """POST multipart `file` (+ optional `private=true`). Returns {file_url} or, for private, {file_uri}."""
    upload = request.FILES.get("file")
    if upload is None:
        raise ValidationError({"file": "No file provided."})
    if upload.size > settings.MAX_UPLOAD_BYTES:
        raise ValidationError({"file": f"File too large (max {settings.MAX_UPLOAD_BYTES // (1024 * 1024)} MB)."})
    ext = Path(upload.name).suffix.lower()
    if ext not in ALLOWED:
        raise ValidationError({"file": "Unsupported file type."})
    content_type, _, magic = ALLOWED[ext]
    head = upload.read(16)
    upload.seek(0)
    if magic and not any(head.startswith(m) for m in magic):
        raise ValidationError({"file": "File content doesn't match its extension."})

    private = str(request.data.get("private", "")).lower() in ("1", "true", "yes")
    file_id = uuid.uuid4()
    rel = Path("private" if private else "public") / f"{file_id}{ext}"
    dest = settings.UPLOAD_ROOT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as out:
        for chunk in upload.chunks():
            out.write(chunk)
    stored = StoredFile.objects.create(id=file_id, owner=request.user, original_name=_safe_name(upload.name),
                                       content_type=content_type, size=upload.size, path=str(rel), is_private=private)
    if private:
        return Response({"file_uri": f"{PRIVATE_PREFIX}{stored.id}"}, status=201)
    return Response({"file_url": public_url(stored)}, status=201)


def _serve(stored):
    path = settings.UPLOAD_ROOT / stored.path
    if not path.is_file():
        raise Http404
    _, inline_ok, _ = ALLOWED.get(Path(stored.path).suffix.lower(), (None, False, None))
    response = FileResponse(open(path, "rb"), content_type=stored.content_type)
    disposition = "inline" if inline_ok else "attachment"
    response["Content-Disposition"] = f'{disposition}; filename="{_safe_name(stored.original_name)}"'
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
    response["Cache-Control"] = "private, max-age=300" if stored.is_private else "public, max-age=86400"
    return response


def serve_public(request, file_id, name=None):
    stored = StoredFile.objects.filter(pk=file_id, is_private=False).first()
    if stored is None:
        raise Http404
    return _serve(stored)


def serve_private(request, file_id):
    try:
        ok = _signer.unsign(request.GET.get("s", ""), max_age=settings.PRIVATE_FILE_URL_TTL) == str(file_id)
    except signing.BadSignature:
        ok = False
    if not ok:
        return HttpResponse("Link invalid or expired.", status=403, content_type="text/plain")
    stored = StoredFile.objects.filter(pk=file_id, is_private=True).first()
    if stored is None:
        raise Http404
    return _serve(stored)


# --- helpers used by the entity serializers ------------------------------------------------------------
def to_client(value):
    """Stored `private:<id>` -> signed URL the browser can open directly."""
    if isinstance(value, str) and value.startswith(PRIVATE_PREFIX):
        return private_signed_url(value[len(PRIVATE_PREFIX):])
    return value


def to_storage(value, user):
    """Signed URL (round-tripped from the client) -> canonical `private:<id>`. Users may only reference
    private files they uploaded themselves (admins: any)."""
    if not isinstance(value, str):
        return value
    match = PRIVATE_URL_RE.search(value)
    if match:
        value = f"{PRIVATE_PREFIX}{match.group(1).lower()}"
    if value.startswith(PRIVATE_PREFIX):
        file_id = value[len(PRIVATE_PREFIX):]
        try:
            stored = StoredFile.objects.filter(pk=uuid.UUID(file_id), is_private=True).first()
        except ValueError:  # malformed uuid
            stored = None
        is_admin = getattr(user, "role", None) == "admin"
        if stored is None or (not is_admin and stored.owner_id != user.pk):
            raise ValidationError("Referenced file does not exist or isn't yours.")
    return value
