import uuid
from datetime import datetime

from pydantic import BaseModel

from app.modules.docs.models import DocumentStatus


class DocumentResponse(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    status: DocumentStatus
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
