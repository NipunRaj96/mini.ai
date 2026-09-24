import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_factory
from app.modules.auth.models import User
from app.modules.chat.service import Target
from app.modules.memory.models import MemorySource, UserMemory
from app.modules.providers.base import ChatMessage

# ponytail: flat cap on the number of stored memories per user, not a sliding
# window or importance-scored retention scheme -- 40 is plenty of context for
# one user and keeps the injected block bounded. Revisit if that stops holding.
MAX_MEMORIES = 40


class MemoryNotFoundError(Exception):
    pass


async def list_memories(db: AsyncSession, user_id: uuid.UUID) -> list[UserMemory]:
    rows = await db.scalars(
        select(UserMemory)
        .where(UserMemory.user_id == user_id)
        .order_by(UserMemory.created_at.desc())
    )
    return list(rows.all())


async def add_memory(
    db: AsyncSession,
    user_id: uuid.UUID,
    content: str,
    source: MemorySource | str = MemorySource.MANUAL,
) -> UserMemory | None:
    source = MemorySource(source)
    existing = await list_memories(db, user_id)

    # Dedup only applies to auto-extracted memories -- a manual add is an
    # explicit user action and always succeeds untouched. Cheap substring
    # check (case-insensitive, either direction), not semantic dedup.
    if source == MemorySource.AUTO:
        content_lower = content.lower()
        for memory in existing:
            existing_lower = memory.content.lower()
            if content_lower in existing_lower or existing_lower in content_lower:
                return None

    if len(existing) >= MAX_MEMORIES:
        # Evict the single oldest auto-sourced memory to make room -- never a
        # manual one. If everything is manual, just let it grow past the cap.
        oldest_auto = next(
            (memory for memory in reversed(existing) if memory.source == MemorySource.AUTO), None
        )
        if oldest_auto is not None:
            await db.delete(oldest_auto)
            await db.flush()

    memory = UserMemory(user_id=user_id, content=content, source=source)
    db.add(memory)
    await db.flush()
    return memory


async def delete_memory(db: AsyncSession, user_id: uuid.UUID, memory_id: uuid.UUID) -> None:
    memory = await db.get(UserMemory, memory_id)
    if memory is None or memory.user_id != user_id:
        raise MemoryNotFoundError(memory_id)
    await db.delete(memory)
    await db.flush()


async def get_memory_context_block(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    user = await db.get(User, user_id)
    if user is None or not user.memory_enabled:
        return None
    memories = await list_memories(db, user_id)
    if not memories:
        return None
    lines = "\n".join(f"- {memory.content}" for memory in memories)
    return (
        "What you know about this user from past interactions (use only if genuinely "
        "relevant to the current message, don't force it into unrelated replies):\n"
        f"{lines}"
    )


async def extract_and_save_memories(
    user_id: uuid.UUID, message: str, answers: list[str], target: Target
) -> None:
    """Best-effort, fire-and-forget: a throwaway extraction call straight to
    `target`'s adapter (same bypass-persistence pattern as deep_research.py's
    _ask_judge), run as a BackgroundTask after the response has already been
    streamed. Opens its own DB session since the request's session is gone by
    the time this runs. Any failure (bad JSON, provider error, whatever) is
    logged and swallowed -- same isolation convention as every other
    best-effort call in chat/router.py (judge calls, web search, deep research).
    """
    try:
        # Re-check here, not just at the scheduling call site -- this runs as a
        # BackgroundTask after the response is gone, and the user could disable
        # memory in the gap between scheduling and this actually running.
        async with async_session_factory() as guard_session:
            user = await guard_session.get(User, user_id)
            if user is None or not user.memory_enabled:
                return

        prompt = (
            "Based on this exchange, extract 0-3 short, durable facts about the user: "
            "identity, stated preferences, communication style, or recurring context. "
            "Do NOT include transient details specific to this one exchange. "
            "Output ONLY a JSON array of strings, nothing else -- an empty array if "
            "nothing durable stands out.\n\n"
            f"User: {message}\n\n" + "\n\n".join(answers)
        )
        text = ""
        async for chunk in target.adapter.stream_chat(
            [ChatMessage(role="user", content=prompt)], target.model
        ):
            text += chunk.delta

        facts = json.loads(text)
        if not isinstance(facts, list) or not facts:
            return

        async with async_session_factory() as session:
            for fact in facts:
                if isinstance(fact, str) and fact.strip():
                    await add_memory(session, user_id, fact.strip(), source=MemorySource.AUTO)
            await session.commit()
    except Exception as exc:
        print(f"memory extraction failed: {exc!r}")
