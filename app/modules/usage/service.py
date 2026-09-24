import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.chat.models import Message
from app.modules.keys.models import Provider
from app.modules.usage.models import UsageEvent

# USD per 1K tokens (input, output). Update manually as providers change pricing.
# llama-3.3-70b-versatile removed 2026-09-19: Groq deprecated it, no replacement priced yet
# (unknown models return None cost — no fabricated numbers).
_PRICING: dict[str, tuple[Decimal, Decimal]] = {
    "gemini-2.0-flash": (Decimal("0.000075"), Decimal("0.0003")),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> Decimal | None:
    pricing = _PRICING.get(model)
    if pricing is None:
        return None
    input_rate, output_rate = pricing
    return (Decimal(input_tokens) / 1000 * input_rate) + (
        Decimal(output_tokens) / 1000 * output_rate
    )


async def record_usage(
    db: AsyncSession,
    user_id: uuid.UUID,
    provider_key_id: uuid.UUID | None,
    provider: Provider,
    model: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
    used_system_key: bool = False,
    message_id: uuid.UUID | None = None,
) -> UsageEvent:
    event = UsageEvent(
        user_id=user_id,
        provider_key_id=provider_key_id,
        message_id=message_id,
        provider=provider,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        latency_ms=latency_ms,
        cost_estimate_usd=estimate_cost(model, input_tokens, output_tokens),
        used_system_key=used_system_key,
    )
    db.add(event)
    await db.flush()
    return event


async def get_usage_summary(db: AsyncSession, user_id: uuid.UUID) -> dict:
    rows = (await db.scalars(select(UsageEvent).where(UsageEvent.user_id == user_id))).all()

    by_provider: dict[str, dict] = {}
    for row in rows:
        bucket = by_provider.setdefault(
            row.provider.value,
            {"provider": row.provider.value, "input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": Decimal(0)},
        )
        bucket["input_tokens"] += row.input_tokens
        bucket["output_tokens"] += row.output_tokens
        bucket["estimated_cost_usd"] += row.cost_estimate_usd or Decimal(0)

    return {
        "total_input_tokens": sum(r.input_tokens for r in rows),
        "total_output_tokens": sum(r.output_tokens for r in rows),
        "estimated_cost_usd": sum((r.cost_estimate_usd or Decimal(0)) for r in rows),
        "by_provider": list(by_provider.values()),
    }


async def get_usage_events(
    db: AsyncSession, user_id: uuid.UUID, limit: int = 50, offset: int = 0
) -> list[dict]:
    """Per-event detail for the settings page: what each message cost. Left
    outer join on messages -- message_id is nullable (e.g. Tavily search
    events), so those rows must still come back with conversation_id=None
    rather than being dropped."""
    rows = (
        await db.execute(
            select(UsageEvent, Message.conversation_id)
            .outerjoin(Message, UsageEvent.message_id == Message.id)
            .where(UsageEvent.user_id == user_id)
            .order_by(UsageEvent.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    return [
        {
            "id": event.id,
            "message_id": event.message_id,
            "conversation_id": conversation_id,
            "provider": event.provider.value,
            "model": event.model,
            "cost_estimate_usd": event.cost_estimate_usd,
            "latency_ms": event.latency_ms,
            "created_at": event.created_at,
        }
        for event, conversation_id in rows
    ]
