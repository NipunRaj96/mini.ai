import asyncio
import json
import time
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.modules.agents.guardrails import check_input, check_output
from app.modules.agents.models import OutputFormat
from app.modules.agents.schemas import AgentResponse
from app.modules.agents.service import AgentNotFoundError, get_agent
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.chat.deep_research import _ask_judge
from app.modules.chat.models import Message, MessageRole
from app.modules.chat.schemas import (
    AgentTarget,
    ConversationSummary,
    CreateConversationResponse,
    MessageResponse,
    SendMessageRequest,
)
from app.modules.chat.service import (
    ConversationNotFoundError,
    Target,
    ToolCallEvent,
    build_target_messages,
    create_conversation,
    delete_conversation,
    get_conversation,
    list_conversations,
    list_messages,
    send_message,
)
from app.modules.chat.title_gen import apply_generated_title
from app.modules.chat.tools import (
    DEEP_RESEARCH_TOOL,
    SEARCH_DOCS_TOOL,
    WEB_SEARCH_TOOL,
    ToolContext,
)
from app.modules.docs.embedder import FastEmbedEmbedder
from app.modules.docs.models import Document
from app.modules.keys.models import Provider, ProviderKey
from app.modules.keys.service import get_active_key_for_provider, get_active_key_row_for_provider
from app.modules.memory.service import extract_and_save_memories, get_memory_context_block
from app.modules.providers.base import ChatMessage, ToolDef
from app.modules.providers.registry import build_provider
from app.modules.usage.service import record_usage

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

# ponytail: module-level singleton -- FastEmbedEmbedder() loads an ONNX model in
# __init__, so building one per request would reload it on every use_docs=True
# message. Swap for DI if per-request embedder config is ever needed.
_docs_embedder: FastEmbedEmbedder | None = None


def _get_docs_embedder() -> FastEmbedEmbedder:
    global _docs_embedder
    if _docs_embedder is None:
        _docs_embedder = FastEmbedEmbedder()
    return _docs_embedder


def _format_source_citation(document: Document, page_number: int | None) -> str:
    if document.source_url:
        return f"[source: {document.source_url}]"
    source = f"[source: {document.filename}"
    source += f", page {page_number}]" if page_number else "]"
    return source


async def _resolve_tavily(db: AsyncSession, user_id: uuid.UUID) -> tuple[str, bool]:
    """(api_key, used_system_key). User's own Tavily key wins; else the system key --
    Tavily BYOK is optional, unlike chat-provider keys which stay strictly BYOK."""
    own_key = await get_active_key_for_provider(db, user_id, Provider.TAVILY)
    if own_key:
        return own_key, False
    return get_settings().miniai_system_tavily_api_key, True


async def _record_tavily_usage(
    db: AsyncSession, user_id: uuid.UUID, used_system_key: bool, latency_ms: int
) -> None:
    key_row = None if used_system_key else await get_active_key_row_for_provider(
        db, user_id, Provider.TAVILY
    )
    # message_id stays None: one search feeds context to potentially several
    # targets (or a whole deep-research loop), so there's no single assistant
    # message this event is "the cost of" the way a chat completion has one.
    await record_usage(
        db,
        user_id,
        key_row.id if key_row else None,
        Provider.TAVILY,
        "tavily-search",
        0,
        0,
        latency_ms,
        used_system_key=used_system_key,
    )


def _build_agent_context(agent) -> str:
    """Role/goal + an output-format instruction block. STRICT_JSON has no native
    schema-enforcement param on LLMProvider/Google/Groq adapters today (checked
    base.py + both adapters) -- schema is text-embedded as a fallback, not
    natively enforced. Follow-up: wire real structured-output support."""
    parts = [f"You are acting as: {agent.role}", f"Your primary goal: {agent.primary_goal}"]
    if agent.output_format == OutputFormat.STRUCTURED_MARKDOWN:
        parts.append(
            "Format your response as structured markdown with clear headings and bullet points."
        )
    elif agent.output_format == OutputFormat.EXECUTIVE_BRIEF:
        parts.append(
            "Format your response as an executive brief: a short summary paragraph "
            "followed by key takeaways as bullet points."
        )
    elif agent.output_format == OutputFormat.STRICT_JSON:
        if agent.json_schema:
            parts.append(
                "Output ONLY valid JSON matching this schema, with no other text, no "
                f"markdown fences, no explanation:\n{json.dumps(agent.json_schema)}"
            )
        else:
            parts.append("Output ONLY valid JSON, with no other text, no markdown fences.")
    elif agent.output_format == OutputFormat.CUSTOM and agent.output_instructions:
        parts.append(agent.output_instructions)
    return "\n\n".join(parts)


_DEFAULT_STYLE_PROMPT = (
    "You are mini.ai, a direct and helpful assistant. Write naturally and "
    "conversationally. Use markdown formatting where it genuinely helps clarity "
    "-- headings, bullet lists, bold, code blocks -- but don't force structure "
    "onto a short or casual answer. Be concise by default; go deeper only when "
    "the question calls for it."
)


async def _zero_cost_refusal(
    db: AsyncSession, conversation_id: uuid.UUID, content: str, refusal: str
) -> EventSourceResponse:
    """No provider call, no targets, no retrieval. Persisted as a normal
    user+assistant pair so it shows in history. Shared by the single-agent path
    and multi-agent's all-tagged-agents-refused path (Phase 6 task 2)."""
    group_id = uuid.uuid4()
    db.add(
        Message(
            conversation_id=conversation_id,
            role=MessageRole.USER,
            content=content,
            request_group_id=group_id,
        )
    )
    db.add(
        Message(
            conversation_id=conversation_id,
            role=MessageRole.ASSISTANT,
            content=refusal,
            request_group_id=group_id,
        )
    )
    await db.commit()

    async def refusal_stream():
        yield {"event": "refusal", "data": json.dumps({"text": refusal})}
        yield {"event": "done", "data": json.dumps({"conversation_id": str(conversation_id)})}

    return EventSourceResponse(refusal_stream())


async def _flag_if_violates(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    guardrail_patterns: list[str],
    provider: Provider,
    model: str,
    text: str,
) -> None:
    """Runs an agent's check_output and flags every persisted message matching
    this exact (provider, model, content) -- two targets can share all three
    (byte-identical output), and the same verdict applies to every such row."""
    if text and check_output(guardrail_patterns, text):
        matches = await db.scalars(
            select(Message).where(
                Message.conversation_id == conversation_id,
                Message.role == MessageRole.ASSISTANT,
                Message.provider == provider,
                Message.model == model,
                Message.content == text,
            )
        )
        for message in matches:
            message.flagged = True


@router.post(
    "/conversations", response_model=CreateConversationResponse, status_code=status.HTTP_201_CREATED
)
async def create_conversation_endpoint(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    conversation = await create_conversation(db, user.id)
    await db.commit()
    return conversation


@router.get("/conversations", response_model=list[ConversationSummary])
async def list_conversations_endpoint(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await list_conversations(db, user.id)


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageResponse])
async def list_messages_endpoint(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await list_messages(db, user.id, conversation_id)
    except ConversationNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found") from exc


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation_endpoint(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_conversation(db, user.id, conversation_id)
    except ConversationNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found") from exc
    await db.commit()


@router.post("/conversations/{conversation_id}/messages")
@limiter.limit("20/minute")
async def send_message_endpoint(
    request: Request,
    conversation_id: uuid.UUID,
    body: SendMessageRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_conversation(db, user.id, conversation_id)
    except ConversationNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found") from exc

    if body.agent_id is not None and body.agent_targets:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Set either agent_id or agent_targets, not both"
        )

    # targets defaults to [] now that agent_targets can supply its own
    # provider/model -- but every OTHER path (plain raw fan-out, singular
    # agent_id) still needs at least one target to know what to call.
    if not body.agent_targets and not body.targets:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "targets must include at least one entry")

    # synthesize (judge/consensus) only makes sense across tagged agents --
    # same fail-loud pattern as use_deep_research + use_web_search both set,
    # rather than silently no-op-ing on a path that can't run it.
    if body.synthesize and not body.agent_targets:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "synthesize is only supported when tagging 2+ agents via agent_targets",
        )

    if body.agent_targets:
        return await _send_multi_agent_message(conversation_id, body, background_tasks, user, db)

    agent = None
    if body.agent_id is not None:
        try:
            agent = await get_agent(db, user.id, body.agent_id)
        except AgentNotFoundError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found") from exc

        refusal = check_input(agent.guardrail_patterns, body.content)
        if refusal is not None:
            return await _zero_cost_refusal(db, conversation_id, body.content, refusal)

    # An agent's allowed_tools is authoritative over the caller's own flags --
    # a caller can't grant an agent tools it wasn't configured with. Rejecting
    # (400) rather than silently dropping the flag, so a caller who thinks
    # they turned on grounding finds out immediately instead of trusting an
    # answer that never used it.
    if agent is not None:
        if body.use_docs and "docs" not in agent.allowed_tools:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Agent does not allow 'docs'")
        if body.use_web_search and "web_search" not in agent.allowed_tools:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Agent does not allow 'web_search'")
        if body.use_deep_research:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Agent invocation does not support use_deep_research"
            )
        use_docs = "docs" in agent.allowed_tools
        use_web_search = "web_search" in agent.allowed_tools
        use_deep_research = False
    else:
        use_docs = body.use_docs
        use_web_search = body.use_web_search
        use_deep_research = body.use_deep_research

    # Unlike use_docs+use_web_search (additive, each appends its own grounding
    # block), deep research IS repeated web search -- both true is ambiguous.
    if use_deep_research and use_web_search:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "use_deep_research and use_web_search are mutually exclusive",
        )

    # Fail fast: resolve every target's key BEFORE touching send_message, so a
    # missing key never leaves a user message persisted with zero replies.
    key_rows = []
    for spec in body.targets:
        key_row = await get_active_key_row_for_provider(db, user.id, spec.provider)
        if key_row is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"No active key for provider {spec.provider.value}"
            )
        key_rows.append(key_row)

    targets = []
    for spec, key_row in zip(body.targets, key_rows, strict=True):
        api_key = await get_active_key_for_provider(db, user.id, spec.provider)
        adapter = build_provider(spec.provider, api_key)
        targets.append(Target(provider=spec.provider, model=spec.model, adapter=adapter))

    context_parts = [_build_agent_context(agent)] if agent is not None else [_DEFAULT_STYLE_PROMPT]
    if user.memory_enabled:
        memory_block = await get_memory_context_block(db, user.id)
        if memory_block is not None:
            context_parts.insert(0, memory_block)
    system_context = "\n\n".join(context_parts) if context_parts else None

    # use_docs/use_web_search/use_deep_research (or, for an agent invocation,
    # its allowed_tools) no longer pre-run retrieval and stuff the results into
    # the system prompt -- they gate which tools are *available*, and the model
    # itself decides whether a given message actually needs one. use_docs is
    # additive with either of the other two; use_deep_research/use_web_search
    # stay mutually exclusive (validated above) so both are never offered together.
    available_tools: list[ToolDef] = []
    if use_docs:
        available_tools.append(SEARCH_DOCS_TOOL)
    if use_web_search:
        available_tools.append(WEB_SEARCH_TOOL)
    if use_deep_research:
        available_tools.append(DEEP_RESEARCH_TOOL)

    tool_ctx: ToolContext | None = None
    if available_tools:
        tavily_key = None
        record_tavily_usage = None
        if use_web_search or use_deep_research:
            tavily_key, used_system_tavily_key = await _resolve_tavily(db, user.id)

            async def record_tavily_usage(latency_ms: int, _used_system=used_system_tavily_key) -> None:
                await _record_tavily_usage(db, user.id, _used_system, latency_ms)

        tool_ctx = ToolContext(
            db=db,
            user_id=user.id,
            embedder=_get_docs_embedder(),
            format_citation=_format_source_citation,
            tavily_key=tavily_key,
            record_tavily_usage=record_tavily_usage,
            # `or None`: an empty selection means "nothing checked" -- unscoped,
            # not zero docs (hybrid_search treats [] as a real filter -- see its
            # docstring -- so it must never see [] for "no scoping requested").
            document_ids=body.document_ids or None,
            judge_target=targets[0] if targets else None,
        )

    is_first_message = len(await list_messages(db, user.id, conversation_id)) == 0

    async def event_stream():
        start = time.monotonic()
        # Keyed by target_index, not (provider, model) -- two targets can share
        # the same provider+model, and that pair alone can't disambiguate them.
        last_chunks: dict[int, object] = {}
        full_text: dict[int, str] = {}
        async for chunk in send_message(
            db,
            user.id,
            conversation_id,
            body.content,
            targets,
            system_context=system_context,
            tools=available_tools or None,
            tool_ctx=tool_ctx,
        ):
            if isinstance(chunk, ToolCallEvent):
                yield {
                    "event": "tool_call",
                    "data": json.dumps({"name": chunk.name, "arguments": chunk.arguments}),
                }
                continue
            if chunk.delta:
                full_text[chunk.target_index] = full_text.get(chunk.target_index, "") + chunk.delta
                yield {
                    "event": "delta",
                    "data": json.dumps(
                        {"provider": chunk.provider.value, "model": chunk.model, "text": chunk.delta}
                    ),
                }
            if chunk.finished:
                last_chunks[chunk.target_index] = chunk

        latency_ms = int((time.monotonic() - start) * 1000)
        for i, (target, key_row) in enumerate(zip(targets, key_rows, strict=True)):
            final_chunk = last_chunks.get(i)
            await record_usage(
                db,
                user.id,
                key_row.id,
                target.provider,
                target.model,
                (final_chunk.input_tokens or 0) if final_chunk else 0,
                (final_chunk.output_tokens or 0) if final_chunk else 0,
                latency_ms,
                message_id=target.message_id,
            )

        if agent is not None:
            for i, target in enumerate(targets):
                await _flag_if_violates(
                    db,
                    conversation_id,
                    agent.guardrail_patterns,
                    target.provider,
                    target.model,
                    full_text.get(i, ""),
                )

        await db.commit()

        if is_first_message:
            background_tasks.add_task(apply_generated_title, conversation_id, body.content)

        # ponytail: raw/single flow only -- multi-agent fan-out is out of scope
        # for MVP auto-extraction (an agent's own persona answering isn't really
        # "the user's own conversation" in the same sense, and it'd need its own
        # dedup-across-targets story). Add there if it proves worth the scope.
        if user.memory_enabled and body.agent_id is None:
            background_tasks.add_task(
                extract_and_save_memories, user.id, body.content, list(full_text.values()), targets[0]
            )

        yield {"event": "done", "data": json.dumps({"conversation_id": str(conversation_id)})}

    return EventSourceResponse(event_stream())


async def _round1_fanout(
    history_messages: list[ChatMessage], content: str, targets: list[Target]
) -> list[str]:
    """Draft round, one per participant, called straight against each target's
    adapter -- deliberately bypasses send_message's persistence/usage-recording,
    same bypass pattern as deep_research.py's judge calls, since this text is
    discarded scaffolding for round 2, never a real turn. Concurrent via gather,
    same latency shape as the real fan-out's queue-based concurrency."""

    async def _one(target: Target) -> str:
        text = ""
        messages = build_target_messages(history_messages, content, target)
        try:
            async for chunk in target.adapter.stream_chat(messages, target.model):
                text += chunk.delta
        except Exception as exc:  # one participant's failure must not sink round 1
            # Exception type only, not str(exc) -- avoids leaking internal error
            # detail (URLs, connection errno, etc.) into another participant's prompt.
            return f"(round 1 failed: {type(exc).__name__})"
        return text

    # return_exceptions=True is defense-in-depth: _one already catches everything,
    # but this keeps a future _one that forgets to just as safe.
    return list(await asyncio.gather(*(_one(t) for t in targets), return_exceptions=True))


async def _send_multi_agent_message(
    conversation_id: uuid.UUID,
    body: SendMessageRequest,
    background_tasks: BackgroundTasks,
    user: User,
    db: AsyncSession,
) -> EventSourceResponse:
    """agent_targets path (Phase 6): each tagged agent states its own
    provider/model explicitly (AgentTarget) -- no positional pairing with a
    separate list, which used to risk a silent agent/model mis-pairing on
    reorder. body.targets (if any) join the same participant list unchanged,
    raw and personaless, same as Phase 2's plain multi-target fan-out.

    <2 total participants after guardrail drops: single fan-out, persisted
    immediately -- identical to today's single-agent/single-target behavior.
    >=2: an unpersisted round 1 (direct adapter calls) followed by a real,
    persisted round 2 where each participant sees the others' round-1 answers.
    """
    for flag_name, enabled in (
        ("use_docs", body.use_docs),
        ("use_web_search", body.use_web_search),
        ("use_deep_research", body.use_deep_research),
    ):
        if enabled:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{flag_name} is not supported with agent_targets"
            )

    # Fail fast, before any key lookups or provider calls: judge/consensus mode
    # is worthless without genuinely independent opinions, so gate it on the
    # user having keys for at least 3 distinct providers active right now.
    if body.synthesize:
        distinct_providers = (
            await db.scalars(
                select(ProviderKey.provider)
                .where(ProviderKey.user_id == user.id, ProviderKey.is_active.is_(True))
                .distinct()
            )
        ).all()
        if len(distinct_providers) < 3:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "judge/consensus mode needs at least 3 distinct provider keys for "
                f"meaningful diversity -- you have {len(distinct_providers)}",
            )

    # Fail fast, same pattern as every other module: load every tagged agent
    # before doing any work (guardrail checks, key lookups, provider calls).
    tagged: list[tuple[AgentTarget, AgentResponse]] = []
    for agent_target in body.agent_targets:
        try:
            agent = await get_agent(db, user.id, agent_target.agent_id)
        except AgentNotFoundError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found") from exc
        tagged.append((agent_target, agent))

    survivors: list[tuple[AgentTarget, AgentResponse]] = []
    refusal_text: str | None = None
    for agent_target, agent in tagged:
        refusal = check_input(agent.guardrail_patterns, body.content)
        if refusal is not None:
            # Dropped, not the whole request -- zero cost: no key lookup, no
            # provider call, no Target ever built for this agent.
            refusal_text = refusal
            continue
        survivors.append((agent_target, agent))

    leftover_specs = list(body.targets)

    if not survivors and not leftover_specs:
        return await _zero_cost_refusal(db, conversation_id, body.content, refusal_text)

    # Fail fast: resolve keys only for the specs that will actually be used.
    # AgentTarget and TargetSpec both carry .provider/.model, so both kinds of
    # spec can be walked the same way here.
    specs_needed = [at for at, _ in survivors] + leftover_specs
    key_rows = []
    for spec in specs_needed:
        key_row = await get_active_key_row_for_provider(db, user.id, spec.provider)
        if key_row is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"No active key for provider {spec.provider.value}"
            )
        key_rows.append(key_row)

    targets: list[Target] = []
    labels: list[str] = []
    agent_by_index: dict[int, AgentResponse] = {}
    for agent_target, agent in survivors:
        api_key = await get_active_key_for_provider(db, user.id, agent_target.provider)
        adapter = build_provider(agent_target.provider, api_key)
        agent_by_index[len(targets)] = agent
        targets.append(
            Target(
                provider=agent_target.provider,
                model=agent_target.model,
                adapter=adapter,
                system_context=_build_agent_context(agent),
            )
        )
        labels.append(agent.name)
    for spec in leftover_specs:
        api_key = await get_active_key_for_provider(db, user.id, spec.provider)
        adapter = build_provider(spec.provider, api_key)
        targets.append(
            Target(
                provider=spec.provider,
                model=spec.model,
                adapter=adapter,
                system_context=_DEFAULT_STYLE_PROMPT,
            )
        )
        labels.append(f"{spec.provider.value}/{spec.model}")

    # Same injection as the raw/single-agent flow, but appended into each
    # target's own system_context -- for a leftover/raw target (no agent
    # context at all), memory becomes its only system_context, which is fine.
    if user.memory_enabled:
        memory_block = await get_memory_context_block(db, user.id)
        if memory_block is not None:
            for target in targets:
                target.system_context = (
                    f"{target.system_context}\n\n{memory_block}"
                    if target.system_context
                    else memory_block
                )

    is_first_message = len(await list_messages(db, user.id, conversation_id)) == 0

    async def _record_and_flag(full_text: dict[int, str], last_chunks: dict[int, object], start: float):
        latency_ms = int((time.monotonic() - start) * 1000)
        for i, (target, key_row) in enumerate(zip(targets, key_rows, strict=True)):
            final_chunk = last_chunks.get(i)
            await record_usage(
                db,
                user.id,
                key_row.id,
                target.provider,
                target.model,
                (final_chunk.input_tokens or 0) if final_chunk else 0,
                (final_chunk.output_tokens or 0) if final_chunk else 0,
                latency_ms,
                message_id=target.message_id,
            )
        for i, target in enumerate(targets):
            agent = agent_by_index.get(i)
            if agent is not None:
                await _flag_if_violates(
                    db,
                    conversation_id,
                    agent.guardrail_patterns,
                    target.provider,
                    target.model,
                    full_text.get(i, ""),
                )

    if len(targets) >= 2:
        # Round 1: unpersisted draft, straight to each adapter (see
        # _round1_fanout). Round 2's system_context = each participant's own
        # persona (if any) + what everyone else answered in round 1.
        history = await list_messages(db, user.id, conversation_id)
        history_messages = [ChatMessage(role=m.role.value, content=m.content) for m in history]
        round1_texts = await _round1_fanout(history_messages, body.content, targets)

        for i, target in enumerate(targets):
            collaborators = "\n\n".join(
                f"{labels[j]}: {round1_texts[j]}" for j in range(len(targets)) if j != i
            )
            collab_block = (
                "Here is what your collaborators answered:\n\n"
                + collaborators
                + "\n\nGive your final answer, taking their input into account."
            )
            target.system_context = (
                f"{target.system_context}\n\n{collab_block}" if target.system_context else collab_block
            )

    async def event_stream():
        start = time.monotonic()
        last_chunks: dict[int, object] = {}
        full_text: dict[int, str] = {}
        async for chunk in send_message(db, user.id, conversation_id, body.content, targets):
            # This path never passes `tools=`, so a ToolCallEvent can't
            # actually occur -- guard anyway since send_message's return
            # type is now a union, so a future change here fails loudly
            # instead of an AttributeError on .delta.
            if isinstance(chunk, ToolCallEvent):
                continue
            if chunk.delta:
                full_text[chunk.target_index] = full_text.get(chunk.target_index, "") + chunk.delta
                yield {
                    "event": "delta",
                    "data": json.dumps(
                        {"provider": chunk.provider.value, "model": chunk.model, "text": chunk.delta}
                    ),
                }
            if chunk.finished:
                last_chunks[chunk.target_index] = chunk

        await _record_and_flag(full_text, last_chunks, start)

        # 2+ final answers is what makes a judge meaningful -- 1 (or 0, if
        # everything failed) is a no-op, same shape as synthesize=False.
        if body.synthesize and len(targets) >= 2:
            judge_target = targets[0]
            # Same lookup shape as _flag_if_violates: (conversation, provider,
            # model, content) identifies the just-persisted row for target 0,
            # so the judge message can share its request_group_id. created_at
            # ordering isn't reliable here -- server_default timestamps can
            # tie with an earlier turn in the same test/transaction.
            group_id = await db.scalar(
                select(Message.request_group_id).where(
                    Message.conversation_id == conversation_id,
                    Message.role == MessageRole.ASSISTANT,
                    Message.provider == judge_target.provider,
                    Message.model == judge_target.model,
                    Message.content == full_text.get(0, ""),
                )
            )
            answers_block = "\n\n".join(
                f"{labels[i]}: {full_text.get(i, '')}" for i in range(len(targets))
            )
            try:
                judge_text = await _ask_judge(
                    judge_target,
                    "Multiple AI agents were each asked the same question. Here is each "
                    "agent's final answer:\n\n"
                    + answers_block
                    + "\n\nSynthesize the best combined answer, or pick the single "
                    "strongest answer and say why, naming which agent(s) you drew from.",
                )
            except Exception as exc:
                # A flaky judge model must not sink round 2's already-streamed answers --
                # same isolation as _round1_fanout and deep_research.py's own judge call.
                # Degrades to no synthesis message, same shape as synthesize=False.
                print(f"judge/consensus call failed: {exc!r}")
                judge_text = None
            if judge_text is not None:
                db.add(
                    Message(
                        conversation_id=conversation_id,
                        role=MessageRole.ASSISTANT,
                        content=judge_text,
                        provider=judge_target.provider,
                        model=judge_target.model,
                        request_group_id=group_id,
                    )
                )
                yield {
                    "event": "delta",
                    "data": json.dumps(
                        {
                            "provider": judge_target.provider.value,
                            "model": judge_target.model,
                            "text": judge_text,
                        }
                    ),
                }

        await db.commit()

        if is_first_message:
            background_tasks.add_task(apply_generated_title, conversation_id, body.content)

        yield {"event": "done", "data": json.dumps({"conversation_id": str(conversation_id)})}

    return EventSourceResponse(event_stream())
