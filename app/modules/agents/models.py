import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, JSON, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class OutputFormat(str, enum.Enum):
    STRUCTURED_MARKDOWN = "structured_markdown"
    STRICT_JSON = "strict_json"
    EXECUTIVE_BRIEF = "executive_brief"
    CUSTOM = "custom"


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    primary_goal: Mapped[str] = mapped_column(Text, nullable=False)
    output_format: Mapped[OutputFormat] = mapped_column(
        Enum(OutputFormat, name="output_format_enum"), default=OutputFormat.STRUCTURED_MARKDOWN
    )
    output_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    json_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    guardrail_patterns: Mapped[list[str]] = mapped_column(JSON, default=list)
    allowed_tools: Mapped[list[str]] = mapped_column(JSON, default=list)
    mcp_server_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_deployed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
