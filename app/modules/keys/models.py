import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Provider(str, enum.Enum):
    GOOGLE_AI_STUDIO = "google_ai_studio"
    GROQ = "groq"
    OPENROUTER = "openrouter"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    TAVILY = "tavily"
    HUGGINGFACE = "huggingface"


class ProviderKey(Base):
    __tablename__ = "provider_keys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    provider: Mapped[Provider] = mapped_column(Enum(Provider, name="provider_enum"), nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    encrypted_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
