import uuid
from datetime import datetime

from pydantic import BaseModel

from app.modules.keys.models import Provider


class AddKeyRequest(BaseModel):
    provider: Provider
    label: str
    api_key: str


class UpdateKeyRequest(BaseModel):
    is_active: bool | None = None


class KeyResponse(BaseModel):
    id: uuid.UUID
    provider: Provider
    label: str
    masked_key: str
    is_active: bool
    created_at: datetime
