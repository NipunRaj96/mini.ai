import uuid
from datetime import datetime

from pydantic import BaseModel

from app.modules.chat.models import MessageRole
from app.modules.keys.models import Provider


class CreateConversationResponse(BaseModel):
    id: uuid.UUID
    title: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationSummary(BaseModel):
    id: uuid.UUID
    title: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    id: uuid.UUID
    role: MessageRole
    content: str
    provider: Provider | None
    model: str | None
    request_group_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TargetSpec(BaseModel):
    provider: Provider
    model: str


class AgentTarget(BaseModel):
    """One tagged agent bound explicitly to its own provider/model -- unlike a
    raw TargetSpec, an Agent has no model of its own, so the caller states the
    pairing directly instead of leaving it to positional order (a silent
    mis-pairing hazard: wrong order = wrong agent-model match, still 200 OK)."""

    agent_id: uuid.UUID
    provider: Provider
    model: str


class SendMessageRequest(BaseModel):
    content: str
    targets: list[TargetSpec] = []
    use_docs: bool = False
    use_web_search: bool = False
    use_deep_research: bool = False
    agent_id: uuid.UUID | None = None
    agent_targets: list[AgentTarget] = []
    synthesize: bool = False
    # Scopes use_docs' hybrid_search to just these documents (the sidebar's Docs
    # checklist) -- empty means "search all the user's READY docs", matching
    # today's behavior when nothing is checked (see hybrid_search's own
    # document_ids semantics: None, not [], means unscoped).
    document_ids: list[uuid.UUID] = []
