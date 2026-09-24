import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.memory.schemas import (
    AddMemoryRequest,
    MemoryResponse,
    MemorySettingsResponse,
    UpdateMemorySettingsRequest,
)
from app.modules.memory.service import (
    MemoryNotFoundError,
    add_memory,
    delete_memory,
    list_memories,
)

router = APIRouter(prefix="/api/v1/memory", tags=["memory"])


@router.post("", response_model=MemoryResponse, status_code=status.HTTP_201_CREATED)
async def add_memory_endpoint(
    body: AddMemoryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    memory = await add_memory(db, user.id, body.content)
    await db.commit()
    return memory


@router.get("", response_model=list[MemoryResponse])
async def list_memories_endpoint(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await list_memories(db, user.id)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory_endpoint(
    memory_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_memory(db, user.id, memory_id)
    except MemoryNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Memory not found") from exc
    await db.commit()


@router.get("/settings", response_model=MemorySettingsResponse)
async def get_memory_settings_endpoint(user: User = Depends(get_current_user)):
    return MemorySettingsResponse(enabled=user.memory_enabled)


@router.patch("/settings", response_model=MemorySettingsResponse)
async def update_memory_settings_endpoint(
    body: UpdateMemorySettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user.memory_enabled = body.enabled
    await db.commit()
    return MemorySettingsResponse(enabled=user.memory_enabled)
