import uuid
from datetime import datetime

from pydantic import BaseModel

from app.modules.agents.models import OutputFormat

ALLOWED_TOOLS = {"web_search", "docs"}


class CreateAgentRequest(BaseModel):
    name: str
    role: str
    primary_goal: str
    output_format: OutputFormat = OutputFormat.STRUCTURED_MARKDOWN
    output_instructions: str | None = None
    json_schema: dict | None = None
    guardrail_patterns: list[str] = []
    allowed_tools: list[str] = []
    mcp_server_ids: list[str] = []


class UpdateAgentRequest(BaseModel):
    name: str | None = None
    role: str | None = None
    primary_goal: str | None = None
    output_format: OutputFormat | None = None
    output_instructions: str | None = None
    json_schema: dict | None = None
    guardrail_patterns: list[str] | None = None
    allowed_tools: list[str] | None = None
    mcp_server_ids: list[str] | None = None
    is_deployed: bool | None = None


class AgentResponse(BaseModel):
    id: uuid.UUID
    name: str
    role: str
    primary_goal: str
    output_format: OutputFormat
    output_instructions: str | None
    json_schema: dict | None
    guardrail_patterns: list[str]
    allowed_tools: list[str]
    mcp_server_ids: list[str]
    is_deployed: bool
    created_at: datetime
    updated_at: datetime
