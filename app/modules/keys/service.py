import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decrypt_secret, encrypt_secret
from app.modules.keys.models import Provider, ProviderKey
from app.modules.keys.schemas import KeyResponse


class KeyNotFoundError(Exception):
    pass


def _mask(api_key: str) -> str:
    suffix_len = 6 if len(api_key) > 6 else 2
    return "..." + api_key[-suffix_len:]


def _to_response(key: ProviderKey, plaintext_for_mask: str | None = None) -> KeyResponse:
    masked = (
        _mask(plaintext_for_mask)
        if plaintext_for_mask
        else _mask(decrypt_secret(key.encrypted_key))
    )
    return KeyResponse(
        id=key.id,
        provider=key.provider,
        label=key.label,
        masked_key=masked,
        is_active=key.is_active,
        created_at=key.created_at,
    )


async def add_key(
    db: AsyncSession, user_id: uuid.UUID, provider: Provider, label: str, api_key: str
) -> KeyResponse:
    key = ProviderKey(
        user_id=user_id, provider=provider, label=label, encrypted_key=encrypt_secret(api_key)
    )
    db.add(key)
    await db.flush()
    return _to_response(key, plaintext_for_mask=api_key)


async def list_keys(db: AsyncSession, user_id: uuid.UUID) -> list[KeyResponse]:
    rows = (await db.scalars(select(ProviderKey).where(ProviderKey.user_id == user_id))).all()
    return [_to_response(row) for row in rows]


async def delete_key(db: AsyncSession, user_id: uuid.UUID, key_id: uuid.UUID) -> None:
    key = await db.get(ProviderKey, key_id)
    if key is None or key.user_id != user_id:
        raise KeyNotFoundError(key_id)
    await db.delete(key)
    await db.flush()


async def set_key_active(
    db: AsyncSession, user_id: uuid.UUID, key_id: uuid.UUID, is_active: bool
) -> KeyResponse:
    key = await db.get(ProviderKey, key_id)
    if key is None or key.user_id != user_id:
        raise KeyNotFoundError(key_id)
    key.is_active = is_active
    await db.flush()
    return _to_response(key)


async def get_active_key_row_for_provider(
    db: AsyncSession, user_id: uuid.UUID, provider: Provider
) -> ProviderKey | None:
    return await db.scalar(
        select(ProviderKey).where(
            ProviderKey.user_id == user_id,
            ProviderKey.provider == provider,
            ProviderKey.is_active.is_(True),
        )
    )


async def get_active_key_for_provider(
    db: AsyncSession, user_id: uuid.UUID, provider: Provider
) -> str | None:
    key = await get_active_key_row_for_provider(db, user_id, provider)
    return decrypt_secret(key.encrypted_key) if key else None
