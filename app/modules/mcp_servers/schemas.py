import uuid
from datetime import datetime

from pydantic import BaseModel


class AddMcpServerRequest(BaseModel):
    name: str
    connection_url: str
    token: str | None = None


class UpdateMcpServerRequest(BaseModel):
    name: str | None = None
    connection_url: str | None = None
    token: str | None = None
    is_active: bool | None = None


class McpServerResponse(BaseModel):
    id: uuid.UUID
    name: str
    connection_url: str
    has_token: bool
    is_active: bool
    created_at: datetime
