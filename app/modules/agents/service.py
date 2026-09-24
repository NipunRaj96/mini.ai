import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agents.models import Agent, OutputFormat
from app.modules.agents.schemas import ALLOWED_TOOLS, AgentResponse
from app.modules.mcp_servers.service import user_owns_all_mcp_servers


class AgentNotFoundError(Exception):
    pass


class InvalidAllowedToolError(Exception):
    pass


class InvalidMcpServerError(Exception):
    pass


def _check_allowed_tools(allowed_tools: list[str]) -> None:
    unknown = set(allowed_tools) - ALLOWED_TOOLS
    if unknown:
        raise InvalidAllowedToolError(unknown)


async def _check_mcp_server_ids(
    db: AsyncSession, user_id: uuid.UUID, mcp_server_ids: list[str]
) -> None:
    if not await user_owns_all_mcp_servers(db, user_id, mcp_server_ids):
        raise InvalidMcpServerError(mcp_server_ids)


def _to_response(agent: Agent) -> AgentResponse:
    return AgentResponse(
        id=agent.id,
        name=agent.name,
        role=agent.role,
        primary_goal=agent.primary_goal,
        output_format=agent.output_format,
        output_instructions=agent.output_instructions,
        json_schema=agent.json_schema,
        guardrail_patterns=agent.guardrail_patterns,
        allowed_tools=agent.allowed_tools,
        mcp_server_ids=agent.mcp_server_ids,
        is_deployed=agent.is_deployed,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


async def create_agent(
    db: AsyncSession,
    user_id: uuid.UUID,
    name: str,
    role: str,
    primary_goal: str,
    output_format: OutputFormat,
    output_instructions: str | None,
    json_schema: dict | None,
    guardrail_patterns: list[str],
    allowed_tools: list[str],
    mcp_server_ids: list[str],
) -> AgentResponse:
    _check_allowed_tools(allowed_tools)
    await _check_mcp_server_ids(db, user_id, mcp_server_ids)
    agent = Agent(
        user_id=user_id,
        name=name,
        role=role,
        primary_goal=primary_goal,
        output_format=output_format,
        output_instructions=output_instructions,
        json_schema=json_schema,
        guardrail_patterns=guardrail_patterns,
        allowed_tools=allowed_tools,
        mcp_server_ids=mcp_server_ids,
    )
    db.add(agent)
    await db.flush()
    return _to_response(agent)


async def list_agents(db: AsyncSession, user_id: uuid.UUID) -> list[AgentResponse]:
    rows = (await db.scalars(select(Agent).where(Agent.user_id == user_id))).all()
    return [_to_response(row) for row in rows]


async def get_agent(db: AsyncSession, user_id: uuid.UUID, agent_id: uuid.UUID) -> AgentResponse:
    agent = await db.get(Agent, agent_id)
    if agent is None or agent.user_id != user_id:
        raise AgentNotFoundError(agent_id)
    return _to_response(agent)


async def update_agent(
    db: AsyncSession, user_id: uuid.UUID, agent_id: uuid.UUID, updates: dict
) -> AgentResponse:
    agent = await db.get(Agent, agent_id)
    if agent is None or agent.user_id != user_id:
        raise AgentNotFoundError(agent_id)
    if "allowed_tools" in updates and updates["allowed_tools"] is not None:
        _check_allowed_tools(updates["allowed_tools"])
    if "mcp_server_ids" in updates and updates["mcp_server_ids"] is not None:
        await _check_mcp_server_ids(db, user_id, updates["mcp_server_ids"])
    for field, value in updates.items():
        setattr(agent, field, value)
    await db.flush()
    await db.refresh(agent)
    return _to_response(agent)


async def delete_agent(db: AsyncSession, user_id: uuid.UUID, agent_id: uuid.UUID) -> None:
    agent = await db.get(Agent, agent_id)
    if agent is None or agent.user_id != user_id:
        raise AgentNotFoundError(agent_id)
    await db.delete(agent)
    await db.flush()
