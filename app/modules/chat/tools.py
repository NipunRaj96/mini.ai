"""The 3 built-in agentic tools (web_search, search_docs, deep_research): their
ToolDefs plus a small executor keyed by name. Not a plugin system -- just the
minimum needed to run 3 tools that each need different per-request context
(DB session, embedder, Tavily key, ...), bundled into ToolContext.

Each tool wraps an EXISTING helper (hybrid_search, TavilyProvider, run_deep_research)
-- none of that retrieval logic is reimplemented here.
"""

import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.chat.deep_research import DeepResearchResult, run_deep_research
from app.modules.chat.service import _safe_error_message
from app.modules.docs.embedder import Embedder
from app.modules.docs.models import Chunk, Document
from app.modules.docs.service import hybrid_search, ingest_search_results
from app.modules.providers.base import ToolDef
from app.modules.search.adapters.tavily import TavilyProvider

if TYPE_CHECKING:
    # Only for typing ToolContext.judge_target -- importing chat.service for real
    # here would cycle back (service.py calls into this module), see service.py's
    # own lazy import of execute_tool for the other half of that break.
    from app.modules.chat.service import Target


WEB_SEARCH_TOOL = ToolDef(
    name="web_search",
    description=(
        "Search the web for current or factual information. Use for recent events, "
        "anything time-sensitive, or facts you aren't confident about."
    ),
    parameters={
        "type": "object",
        "properties": {"query": {"type": "string", "description": "The search query"}},
        "required": ["query"],
    },
)

SEARCH_DOCS_TOOL = ToolDef(
    name="search_docs",
    description="Search the user's own uploaded documents for relevant excerpts.",
    parameters={
        "type": "object",
        "properties": {"query": {"type": "string", "description": "The search query"}},
        "required": ["query"],
    },
)

DEEP_RESEARCH_TOOL = ToolDef(
    name="deep_research",
    description=(
        "Run a multi-round web research loop for a question that needs thorough "
        "investigation, not just one search. Slower than web_search -- only use it "
        "when a single search is unlikely to be enough."
    ),
    parameters={
        "type": "object",
        "properties": {"query": {"type": "string", "description": "The research question"}},
        "required": ["query"],
    },
)


@dataclass
class ToolContext:
    """Per-request bundle of what the 3 tools actually need. Built once by the
    router per request and reused across every target/round."""

    db: AsyncSession
    user_id: uuid.UUID
    embedder: Embedder
    format_citation: Callable[[Document, int | None], str]
    tavily_key: str | None = None
    # Called with the search's latency in ms, only when a search actually ran
    # (the model may never call the tool at all) -- mirrors chat/router.py's
    # existing _record_tavily_usage pattern, just deferred to call time.
    record_tavily_usage: Callable[[int], Awaitable[None]] | None = None
    # search_docs scoping (the sidebar's Docs checklist) -- None means unscoped,
    # matching hybrid_search's own document_ids semantics.
    document_ids: list[uuid.UUID] | None = None
    # deep_research's internal judge calls go straight through one target's
    # adapter, same as the old pre-run code did.
    judge_target: "Target | None" = None


async def _format_chunks(ctx: ToolContext, chunks: list[Chunk], empty_message: str) -> str:
    if not chunks:
        return empty_message
    blocks = []
    for chunk in chunks:
        document = await ctx.db.get(Document, chunk.document_id)
        source = ctx.format_citation(document, chunk.page_number)
        blocks.append(f"{source}\n{chunk.content}")
    return "\n\n".join(blocks)


async def _execute_web_search(args: dict, ctx: ToolContext) -> str:
    query = (args or {}).get("query")
    if not query:
        return "tool failed: no query provided"
    if not ctx.tavily_key:
        return "tool failed: no web search key available"

    start = time.monotonic()
    results = await TavilyProvider(ctx.tavily_key).search(query)
    if ctx.record_tavily_usage:
        await ctx.record_tavily_usage(int((time.monotonic() - start) * 1000))

    web_documents = await ingest_search_results(ctx.db, ctx.user_id, results, ctx.embedder)
    chunks = await hybrid_search(
        ctx.db, ctx.user_id, query, ctx.embedder, top_k=5,
        document_ids=[document.id for document in web_documents],
    )
    return await _format_chunks(ctx, chunks, "No web results found for that query.")


async def _execute_search_docs(args: dict, ctx: ToolContext) -> str:
    query = (args or {}).get("query")
    if not query:
        return "tool failed: no query provided"

    chunks = await hybrid_search(
        ctx.db, ctx.user_id, query, ctx.embedder, top_k=5,
        document_ids=ctx.document_ids, exclude_web_origin=True,
    )
    return await _format_chunks(ctx, chunks, "No matching content found in your documents.")


async def _execute_deep_research(args: dict, ctx: ToolContext) -> str:
    query = (args or {}).get("query")
    if not query:
        return "tool failed: no query provided"
    if not ctx.tavily_key or ctx.judge_target is None:
        return "tool failed: deep research unavailable"

    start = time.monotonic()
    document_ids: list[uuid.UUID] = []
    any_search_succeeded = False
    # Simplest option (see chat/tools.py docstring / task notes): the whole
    # bounded research loop runs synchronously inside this one tool call --
    # its own internal research_step progress is not interleaved with the
    # outer tool_call SSE events. Not worth the complexity for this pass.
    async for item in run_deep_research(
        ctx.db, ctx.user_id, ctx.tavily_key, ctx.embedder, ctx.judge_target, query
    ):
        if isinstance(item, DeepResearchResult):
            document_ids = item.document_ids
            any_search_succeeded = item.any_search_succeeded

    if any_search_succeeded and ctx.record_tavily_usage:
        await ctx.record_tavily_usage(int((time.monotonic() - start) * 1000))

    if not document_ids:
        return (
            "tool failed: web search unavailable"
            if not any_search_succeeded
            else "No results found for that query."
        )

    chunks = await hybrid_search(
        ctx.db, ctx.user_id, query, ctx.embedder, top_k=5, document_ids=document_ids
    )
    return await _format_chunks(ctx, chunks, "No results found for that query.")


_EXECUTORS: dict[str, Callable[[dict, ToolContext], Awaitable[str]]] = {
    "web_search": _execute_web_search,
    "search_docs": _execute_search_docs,
    "deep_research": _execute_deep_research,
}


async def execute_tool(name: str, args: dict, ctx: ToolContext) -> str:
    """Never raises -- a broken tool (Tavily down, DB hiccup, ...) must become a
    "tool failed" result message fed back to the model, not an exception that
    sinks the whole target stream. Same discipline as _safe_error_message: never
    leak a raw exception string (it can carry a query param API key) into a
    message that gets persisted and replayed as history."""
    executor = _EXECUTORS.get(name)
    if executor is None:
        return f"tool failed: unknown tool '{name}'"
    try:
        return await executor(args, ctx)
    except Exception as exc:
        return f"tool failed: {_safe_error_message(exc)}"
