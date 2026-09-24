import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.keys.models import Provider
from app.modules.keys.service import get_active_key_for_provider
from app.modules.providers.registry import UnsupportedProviderError, build_provider

router = APIRouter(prefix="/api/v1/providers", tags=["providers"])


@router.get("")
async def list_providers(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = []
    for provider in Provider:
        key = await get_active_key_for_provider(db, user.id, provider)
        result.append({"provider": provider, "has_active_key": key is not None})
    return result


@router.get("/{provider}/models")
async def list_models_endpoint(
    provider: Provider,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    api_key = await get_active_key_for_provider(db, user.id, provider)
    if api_key is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No active key for this provider")
    try:
        adapter = build_provider(provider, api_key)
    except UnsupportedProviderError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Live model listing isn't available for this provider yet"
        )
    try:
        return await adapter.list_models()
    except httpx.HTTPStatusError as exc:
        # Most commonly an invalid/expired/revoked key rejected by the
        # provider itself (401/403) -- a client-side problem, not ours.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Couldn't fetch models from the provider (it returned {exc.response.status_code})",
        ) from exc
