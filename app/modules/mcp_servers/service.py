import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import encrypt_secret
from app.modules.mcp_servers.models import McpServer
from app.modules.mcp_servers.schemas import McpServerResponse


class McpServerNotFoundError(Exception):
    pass


def _to_response(server: McpServer) -> McpServerResponse:
    return McpServerResponse(
        id=server.id,
        name=server.name,
        connection_url=server.connection_url,
        has_token=server.encrypted_token is not None,
        is_active=server.is_active,
        created_at=server.created_at,
    )


async def add_mcp_server(
    db: AsyncSession, user_id: uuid.UUID, name: str, connection_url: str, token: str | None
) -> McpServerResponse:
    server = McpServer(
        user_id=user_id,
        name=name,
        connection_url=connection_url,
        encrypted_token=encrypt_secret(token) if token else None,
    )
    db.add(server)
    await db.flush()
    return _to_response(server)


async def list_mcp_servers(db: AsyncSession, user_id: uuid.UUID) -> list[McpServerResponse]:
    rows = (await db.scalars(select(McpServer).where(McpServer.user_id == user_id))).all()
    return [_to_response(row) for row in rows]


async def get_mcp_server(
    db: AsyncSession, user_id: uuid.UUID, server_id: uuid.UUID
) -> McpServerResponse:
    server = await db.get(McpServer, server_id)
    if server is None or server.user_id != user_id:
        raise McpServerNotFoundError(server_id)
    return _to_response(server)


async def delete_mcp_server(db: AsyncSession, user_id: uuid.UUID, server_id: uuid.UUID) -> None:
    server = await db.get(McpServer, server_id)
    if server is None or server.user_id != user_id:
        raise McpServerNotFoundError(server_id)
    await db.delete(server)
    await db.flush()


async def update_mcp_server(
    db: AsyncSession, user_id: uuid.UUID, server_id: uuid.UUID, updates: dict
) -> McpServerResponse:
    server = await db.get(McpServer, server_id)
    if server is None or server.user_id != user_id:
        raise McpServerNotFoundError(server_id)
    if "token" in updates:
        token = updates.pop("token")
        server.encrypted_token = encrypt_secret(token) if token else None
    for field, value in updates.items():
        setattr(server, field, value)
    await db.flush()
    await db.refresh(server)
    return _to_response(server)


async def user_owns_all_mcp_servers(
    db: AsyncSession, user_id: uuid.UUID, server_ids: list[str]
) -> bool:
    if not server_ids:
        return True
    unique_ids = set(server_ids)
    rows = (
        await db.scalars(
            select(McpServer.id).where(
                McpServer.user_id == user_id, McpServer.id.in_(unique_ids)
            )
        )
    ).all()
    return {str(row) for row in rows} == unique_ids
