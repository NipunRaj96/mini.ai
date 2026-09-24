import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.chat.models import Conversation, Message, MessageRole
from app.modules.keys.models import Provider
from app.modules.providers.base import ChatMessage, LLMProvider, ToolDef

if TYPE_CHECKING:
    # Only for typing -- tools.py imports THIS module at load time (for
    # _safe_error_message), so service.py must not import tools.py back at
    # module level or the two would cycle. The tool loop imports it lazily,
    # inside _stream_target, once both modules are already fully loaded.
    from app.modules.chat.tools import ToolContext


class ConversationNotFoundError(Exception):
    pass


async def create_conversation(db: AsyncSession, user_id: uuid.UUID) -> Conversation:
    conversation = Conversation(user_id=user_id)
    db.add(conversation)
    await db.flush()
    return conversation


async def list_conversations(db: AsyncSession, user_id: uuid.UUID) -> list[Conversation]:
    result = await db.scalars(
        select(Conversation)
        .where(Conversation.user_id == user_id)
        .order_by(Conversation.updated_at.desc())
    )
    return list(result.all())


async def get_conversation(
    db: AsyncSession, user_id: uuid.UUID, conversation_id: uuid.UUID
) -> Conversation:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.user_id != user_id:
        raise ConversationNotFoundError(conversation_id)
    return conversation


async def list_messages(
    db: AsyncSession, user_id: uuid.UUID, conversation_id: uuid.UUID
) -> list[Message]:
    await get_conversation(db, user_id, conversation_id)
    result = await db.scalars(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
    )
    return list(result.all())


async def delete_conversation(
    db: AsyncSession, user_id: uuid.UUID, conversation_id: uuid.UUID
) -> None:
    conversation = await get_conversation(db, user_id, conversation_id)
    await db.delete(conversation)


@dataclass
class Target:
    provider: Provider
    model: str
    adapter: LLMProvider
    system_context: str | None = None
    # Set by send_message once its assistant Message is persisted -- lets a
    # caller (router.py's record_usage calls) link the usage event to the
    # exact message it billed for, without a second re-query.
    message_id: uuid.UUID | None = None


@dataclass
class TargetChunk:
    provider: Provider
    model: str
    delta: str
    finished: bool = False
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None
    # Stable public disambiguator for external consumers (e.g. the router's
    # usage tracking): provider+model alone collide when two targets share
    # the same model, so callers must key off this, not (provider, model).
    target_index: int = -1


@dataclass
class ToolCallEvent:
    """Yielded mid-stream, live, the moment a target's model requests a tool
    call -- same established shape as deep_research.py's DeepResearchStep
    (a dataclass yielded alongside the "real" chunk type, isinstance-checked
    by the caller). router.py turns this into its own `tool_call` SSE event."""

    provider: Provider
    model: str
    name: str
    arguments: dict
    target_index: int = -1


def build_target_messages(
    history_messages: list[ChatMessage],
    content: str,
    target: Target,
    system_context: str | None = None,
) -> list[ChatMessage]:
    """Provider-payload messages for one target: its own system_context (falling
    back to the shared one) + conversation history + the new user turn. Shared by
    send_message's fan-out and multi-agent round 1 (chat/router.py), which calls
    target adapters directly, bypassing persistence -- see phase 6 task 2.
    """
    effective_system_context = target.system_context or system_context
    messages = []
    if effective_system_context:
        messages.append(ChatMessage(role="system", content=effective_system_context))
    messages.extend(history_messages)
    messages.append(ChatMessage(role="user", content=content))
    return messages


_DONE = object()


def _safe_error_message(exc: Exception) -> str:
    """Never surface str(exc) here -- httpx bakes the full request URL into
    its exception text, and at least one adapter (Google AI Studio) used to
    send its API key as a query param, so a raw exception message could leak
    a secret into the SSE stream and into this turn's persisted Message row
    (which then gets replayed as history to the next provider). Only ever
    expose a generic, non-identifying summary."""
    if isinstance(exc, httpx.HTTPStatusError):
        return f"provider returned HTTP {exc.response.status_code}"
    return f"{type(exc).__name__}"


# Hard cap on the tool-call loop below -- cost/safety, a model that always
# requests a tool must never be allowed to run forever. Counts adapter
# invocations, not tool executions: the final round is reserved to force a
# text answer (its tool_calls, if any, are ignored), so at most
# MAX_TOOL_ROUNDS - 1 tool-executing rounds actually happen.
MAX_TOOL_ROUNDS = 5


async def _stream_target(
    target_index: int,
    target: Target,
    provider_messages: list[ChatMessage],
    queue: asyncio.Queue,
    tools: list[ToolDef] | None = None,
    tool_ctx: "ToolContext | None" = None,
) -> None:
    # queue items are (id(target), TargetChunk | ToolCallEvent | _DONE) --
    # id(target) (not provider/model) is the internal bookkeeping key, since
    # two targets can share the same provider+model (e.g. same model tagged
    # twice for comparison). target_index is stamped on each item for external use.
    #
    # No tools -> exactly today's behavior: one pass over the adapter's stream,
    # every chunk forwarded verbatim as it arrives. With tools, each round is
    # streamed live the same way (any text a round produces before deciding to
    # call a tool -- a "let me check that" preamble -- reaches the caller as-is,
    # same as a real assistant narrating its own tool use); only once a round's
    # *final* chunk carries no tool_calls is it treated as the answer and the
    # loop stops -- an earlier round's chunk.finished=True (the adapter ending
    # that round's stream to hand back tool_calls) is forwarded too, but it's
    # harmless: callers key the "last" finished chunk per target by target_index,
    # so a later round's finished chunk simply supersedes it.
    target_id = id(target)
    history = list(provider_messages)
    try:
        for round_num in range(MAX_TOOL_ROUNDS):
            last_chunk = None
            async for chunk in target.adapter.stream_chat(history, target.model, tools=tools):
                last_chunk = chunk
                await queue.put((
                    target_id,
                    TargetChunk(
                        provider=target.provider,
                        model=target.model,
                        delta=chunk.delta,
                        finished=chunk.finished,
                        input_tokens=chunk.input_tokens,
                        output_tokens=chunk.output_tokens,
                        target_index=target_index,
                    ),
                ))

            tool_calls = last_chunk.tool_calls if last_chunk else None
            if not tool_calls:
                return

            if round_num == MAX_TOOL_ROUNDS - 1:
                # Cap hit while the model is still requesting tools -- stop
                # anyway, never hang forever. Whatever text it already
                # produced this round (if any) stands as the answer.
                await queue.put((
                    target_id,
                    TargetChunk(
                        provider=target.provider,
                        model=target.model,
                        delta="\n\n(reached tool-call limit)",
                        finished=True,
                        target_index=target_index,
                    ),
                ))
                return

            history.append(ChatMessage(role="assistant", content="", tool_calls=tool_calls))
            for call in tool_calls:
                await queue.put((
                    target_id,
                    ToolCallEvent(
                        provider=target.provider,
                        model=target.model,
                        name=call.name,
                        arguments=call.arguments,
                        target_index=target_index,
                    ),
                ))
                if tool_ctx is None:
                    result = "tool failed: no tool context available"
                else:
                    from app.modules.chat.tools import execute_tool  # lazy: see import note above

                    result = await execute_tool(call.name, call.arguments, tool_ctx)
                history.append(
                    ChatMessage(role="tool", content=result, tool_call_id=call.id)
                )
    except Exception as exc:  # one target's failure must not sink the others
        await queue.put((
            target_id,
            TargetChunk(
                provider=target.provider,
                model=target.model,
                delta="",
                finished=True,
                error=_safe_error_message(exc),
                target_index=target_index,
            ),
        ))
    finally:
        await queue.put((target_id, _DONE))


async def send_message(
    db: AsyncSession,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    content: str,
    targets: list[Target],
    system_context: str | None = None,
    tools: list[ToolDef] | None = None,
    tool_ctx: "ToolContext | None" = None,
) -> AsyncIterator[TargetChunk | ToolCallEvent]:
    """Persists the user message, fans out to every target concurrently, persists each reply.

    Each target streams into a shared queue from its own task; chunks are yielded
    as they arrive, interleaved across targets. One target failing doesn't stop
    the others — it's recorded as an error and persisted as a failed message.

    tools/tool_ctx are optional and shared across every target in this call (the
    caller's use_docs/use_web_search/use_deep_research flags -- or an agent's
    allowed_tools -- apply to the whole request, not per-target). Omitted, this
    is exactly today's single-pass behavior; the multi-agent path (router.py's
    _send_multi_agent_message) never passes them.
    """
    await get_conversation(db, user_id, conversation_id)
    history = await list_messages(db, user_id, conversation_id)

    group_id = uuid.uuid4()
    db.add(
        Message(
            conversation_id=conversation_id,
            role=MessageRole.USER,
            content=content,
            request_group_id=group_id,
        )
    )
    await db.flush()

    # system_context is per-request grounding (retrieval reruns every use_docs=True
    # call) -- prepended to the provider payload only, never persisted as a Message.
    # A target's own system_context overrides the shared one for that target only.
    history_messages = [ChatMessage(role=m.role.value, content=m.content) for m in history]

    queue: asyncio.Queue = asyncio.Queue()
    tasks = [
        asyncio.create_task(
            _stream_target(
                i,
                t,
                build_target_messages(history_messages, content, t, system_context),
                queue,
                tools=tools,
                tool_ctx=tool_ctx,
            )
        )
        for i, t in enumerate(targets)
    ]

    full_text: dict[int, str] = {id(t): "" for t in targets}
    errors: dict[int, str] = {}
    remaining = len(targets)

    while remaining > 0:
        target_id, item = await queue.get()
        if item is _DONE:
            remaining -= 1
            continue
        if isinstance(item, ToolCallEvent):
            yield item
            continue
        if item.error:
            errors[target_id] = item.error
        elif item.delta:
            full_text[target_id] += item.delta
        yield item

    await asyncio.gather(*tasks)

    assistant_messages = []
    for t in targets:
        key = id(t)
        text = full_text[key] or (f"(request failed: {errors[key]})" if key in errors else "")
        message = Message(
            conversation_id=conversation_id,
            role=MessageRole.ASSISTANT,
            content=text,
            provider=t.provider,
            model=t.model,
            request_group_id=group_id,
        )
        db.add(message)
        assistant_messages.append((t, message))

    conversation = await get_conversation(db, user_id, conversation_id)
    conversation.updated_at = datetime.now(timezone.utc)
    await db.flush()

    # id is a client-side default (uuid.uuid4), populated on the object once
    # flush() runs the INSERT -- safe to read back right here.
    for t, message in assistant_messages:
        t.message_id = message.id
