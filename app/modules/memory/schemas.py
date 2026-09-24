import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.memory.models import MemorySource


class AddMemoryRequest(BaseModel):
    content: str


class MemoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    content: str
    source: MemorySource
    created_at: datetime


class MemorySettingsResponse(BaseModel):
    enabled: bool


class UpdateMemorySettingsRequest(BaseModel):
    enabled: bool
