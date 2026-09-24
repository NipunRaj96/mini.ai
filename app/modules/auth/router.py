from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import limiter
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.auth.schemas import (
    LoginRequest,
    RefreshRequest,
    SignupRequest,
    TokenResponse,
    UserResponse,
)
from app.modules.auth.service import (
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
    login,
    logout,
)
from app.modules.auth.service import refresh as refresh_tokens
from app.modules.auth.service import signup

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def signup_endpoint(request: Request, body: SignupRequest, db: AsyncSession = Depends(get_db)):
    try:
        _, access_token, refresh_token = await signup(db, body.email, body.password)
    except EmailAlreadyRegisteredError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered") from exc
    await db.commit()
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login_endpoint(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    try:
        _, access_token, refresh_token = await login(db, body.email, body.password)
    except InvalidCredentialsError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password") from exc
    await db.commit()
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_endpoint(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        access_token, refresh_token = await refresh_tokens(db, body.refresh_token)
    except InvalidRefreshTokenError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token"
        ) from exc
    await db.commit()
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout_endpoint(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    await logout(db, body.refresh_token)
    await db.commit()


@router.get("/me", response_model=UserResponse)
async def me_endpoint(user: User = Depends(get_current_user)):
    return user
