from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.modules.auth.models import RefreshToken, User


class AuthError(Exception):
    pass


class EmailAlreadyRegisteredError(AuthError):
    pass


class InvalidCredentialsError(AuthError):
    pass


class InvalidRefreshTokenError(AuthError):
    pass


# A nonexistent email short-circuits `or` before ever calling verify_password
# (Argon2, deliberately slow) -- that timing gap is enough to enumerate
# registered emails from response latency alone, even with an identical error
# message. Verifying against this precomputed hash on that path costs the
# same Argon2 work as a real wrong-password attempt, closing the gap.
_DUMMY_PASSWORD_HASH = hash_password("not-a-real-password-timing-decoy")


async def signup(db: AsyncSession, email: str, password: str) -> tuple[User, str, str]:
    existing = await db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise EmailAlreadyRegisteredError(email)

    user = User(email=email, hashed_password=hash_password(password))
    db.add(user)
    await db.flush()

    access_token, refresh_token = await _issue_tokens(db, user)
    return user, access_token, refresh_token


async def login(db: AsyncSession, email: str, password: str) -> tuple[User, str, str]:
    user = await db.scalar(select(User).where(User.email == email))
    hash_to_check = user.hashed_password if user and user.hashed_password else _DUMMY_PASSWORD_HASH
    password_ok = verify_password(password, hash_to_check)
    if user is None or user.hashed_password is None or not password_ok:
        raise InvalidCredentialsError(email)

    access_token, refresh_token = await _issue_tokens(db, user)
    return user, access_token, refresh_token


async def refresh(db: AsyncSession, refresh_token: str) -> tuple[str, str]:
    token_hash = hash_refresh_token(refresh_token)
    row = await db.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash, RefreshToken.revoked.is_(False)
        )
    )
    if row is None or row.expires_at < datetime.now(timezone.utc):
        raise InvalidRefreshTokenError()

    row.revoked = True
    user = await db.get(User, row.user_id)
    access_token, new_refresh_token = await _issue_tokens(db, user)
    return access_token, new_refresh_token


async def logout(db: AsyncSession, refresh_token: str) -> None:
    token_hash = hash_refresh_token(refresh_token)
    row = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if row is not None:
        row.revoked = True


async def _issue_tokens(db: AsyncSession, user: User) -> tuple[str, str]:
    settings = get_settings()
    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(refresh_token),
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.jwt_refresh_token_expire_days),
        )
    )
    await db.flush()
    return access_token, refresh_token
