from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.usage.service import get_usage_events, get_usage_summary

router = APIRouter(prefix="/api/v1/usage", tags=["usage"])


@router.get("/summary")
async def usage_summary_endpoint(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await get_usage_summary(db, user.id)


@router.get("/events")
async def usage_events_endpoint(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await get_usage_events(db, user.id, limit=limit, offset=offset)
