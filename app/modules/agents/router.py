import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.agents.schemas import AgentResponse, CreateAgentRequest, UpdateAgentRequest
from app.modules.agents.service import (
    AgentNotFoundError,
    InvalidAllowedToolError,
    InvalidMcpServerError,
    create_agent,
    delete_agent,
    get_agent,
    list_agents,
    update_agent,
)

router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
async def create_agent_endpoint(
    body: CreateAgentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await create_agent(
            db,
            user.id,
            body.name,
            body.role,
            body.primary_goal,
            body.output_format,
            body.output_instructions,
            body.json_schema,
            body.guardrail_patterns,
            body.allowed_tools,
            body.mcp_server_ids,
        )
    except InvalidAllowedToolError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown tool(s): {exc}") from exc
    except InvalidMcpServerError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown MCP server(s): {exc}") from exc
    await db.commit()
    return result


@router.get("", response_model=list[AgentResponse])
async def list_agents_endpoint(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await list_agents(db, user.id)


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent_endpoint(
    agent_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_agent(db, user.id, agent_id)
    except AgentNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found") from exc


@router.patch("/{agent_id}", response_model=AgentResponse)
async def update_agent_endpoint(
    agent_id: uuid.UUID,
    body: UpdateAgentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    updates = body.model_dump(exclude_unset=True)
    try:
        result = await update_agent(db, user.id, agent_id, updates)
    except AgentNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found") from exc
    except InvalidAllowedToolError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown tool(s): {exc}") from exc
    except InvalidMcpServerError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown MCP server(s): {exc}") from exc
    await db.commit()
    return result


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent_endpoint(
    agent_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_agent(db, user.id, agent_id)
    except AgentNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found") from exc
    await db.commit()
