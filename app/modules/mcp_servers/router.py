import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import limiter
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.mcp_servers.schemas import (
    AddMcpServerRequest,
    McpServerResponse,
    UpdateMcpServerRequest,
)
from app.modules.mcp_servers.service import (
    McpServerNotFoundError,
    add_mcp_server,
    delete_mcp_server,
    list_mcp_servers,
    update_mcp_server,
)

router = APIRouter(prefix="/api/v1/mcp-servers", tags=["mcp-servers"])


@router.post("", response_model=McpServerResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def add_mcp_server_endpoint(
    request: Request,
    body: AddMcpServerRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await add_mcp_server(db, user.id, body.name, body.connection_url, body.token)
    await db.commit()
    return result


@router.get("", response_model=list[McpServerResponse])
async def list_mcp_servers_endpoint(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await list_mcp_servers(db, user.id)


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_mcp_server_endpoint(
    server_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_mcp_server(db, user.id, server_id)
    except McpServerNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MCP server not found") from exc
    await db.commit()


@router.patch("/{server_id}", response_model=McpServerResponse)
async def update_mcp_server_endpoint(
    server_id: uuid.UUID,
    body: UpdateMcpServerRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to update")
    try:
        result = await update_mcp_server(db, user.id, server_id, updates)
    except McpServerNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MCP server not found") from exc
    await db.commit()
    return result
