from django.db import models as dj
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from . import files, policies
from .models import ENTITIES, BaseEntity

SYSTEM_FIELDS = {"id", "created_by", "created_date", "updated_date"}
TEXTUAL = (dj.CharField, dj.TextField)


def editable_fields(model):
    return [f for f in model._meta.concrete_fields if f.name not in SYSTEM_FIELDS]


class EntitySerializer(serializers.ModelSerializer):
    """Base for the per-entity serializers generated below."""

    created_by_id = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()

    def get_created_by_id(self, obj):
        return str(obj.created_by_id) if obj.created_by_id else None

    def get_created_by(self, obj):
        return obj.created_by.email if obj.created_by_id else None

    # ---- input ------------------------------------------------------------------------------------
    def to_internal_value(self, data):
        data = {k: v for k, v in dict(data).items()}
        model_fields = {f.name: f for f in editable_fields(self.Meta.model)}
        for name, value in list(data.items()):
            f = model_fields.get(name)
            if f is None:
                continue
            if isinstance(f, TEXTUAL + (dj.JSONField, dj.BooleanField)):
                if value is None:
                    del data[name]  # null on a NOT NULL field == "leave it alone"
            elif value == "":
                data[name] = None  # empty form input on a number/date field
        user = self.context["request"].user
        for name in list(data):
            f = model_fields.get(name)
            if f is None:
                continue
            try:
                if isinstance(f, TEXTUAL):
                    data[name] = files.to_storage(data[name], user) if isinstance(data[name], str) else data[name]
                elif isinstance(f, dj.JSONField) and isinstance(data[name], list):
                    data[name] = [files.to_storage(v, user) for v in data[name]]
            except ValidationError as exc:  # DRF wants field-keyed errors out of to_internal_value
                raise ValidationError({name: exc.detail})
        return super().to_internal_value(data)

    def validate(self, attrs):
        if self.instance is None:  # creating: enforce the old `required` lists
            missing = [n for n in policies.REQUIRED.get(self.Meta.model.__name__, [])
                       if attrs.get(n) in (None, "") or (n == "items" and not attrs.get(n))]
            if missing:
                raise ValidationError({n: "This field is required." for n in missing})
        return attrs

    # ---- output -----------------------------------------------------------------------------------
    def to_representation(self, instance):
        data = super().to_representation(instance)
        user = self.context["request"].user
        for key, value in data.items():
            if isinstance(value, str):
                data[key] = files.to_client(value)
            elif isinstance(value, list) and value and all(isinstance(v, str) for v in value):
                data[key] = [files.to_client(v) for v in value]
        hidden = policies.HIDDEN.get(self.Meta.model.__name__)
        if hidden and not policies.is_owner_or_admin(user, instance):
            for key in hidden:
                data.pop(key, None)
        return data


def _build(model):
    names = ["id", "created_by_id", "created_by", "created_date", "updated_date"] + [f.name for f in editable_fields(model)]
    meta = type("Meta", (), {"model": model, "fields": names, "read_only_fields": ["id", "created_date", "updated_date"]})
    return type(f"{model.__name__}Serializer", (EntitySerializer,), {"Meta": meta})


SERIALIZERS = {name: _build(model) for name, model in ENTITIES.items()}
