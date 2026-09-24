import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import limiter
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.keys.schemas import AddKeyRequest, KeyResponse, UpdateKeyRequest
from app.modules.keys.service import (
    KeyNotFoundError,
    add_key,
    delete_key,
    list_keys,
    set_key_active,
)

router = APIRouter(prefix="/api/v1/keys", tags=["keys"])


@router.post("", response_model=KeyResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def add_key_endpoint(
    request: Request,
    body: AddKeyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await add_key(db, user.id, body.provider, body.label, body.api_key)
    await db.commit()
    return result


@router.get("", response_model=list[KeyResponse])
async def list_keys_endpoint(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await list_keys(db, user.id)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_key_endpoint(
    key_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_key(db, user.id, key_id)
    except KeyNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Key not found") from exc
    await db.commit()


@router.patch("/{key_id}", response_model=KeyResponse)
async def update_key_endpoint(
    key_id: uuid.UUID,
    body: UpdateKeyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.is_active is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to update")
    try:
        result = await set_key_active(db, user.id, key_id, body.is_active)
    except KeyNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Key not found") from exc
    await db.commit()
    return result
