import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.chat.service import Target
from app.modules.docs.embedder import Embedder
from app.modules.docs.service import hybrid_search, ingest_search_results
from app.modules.providers.base import ChatMessage
from app.modules.search.adapters.tavily import TavilyProvider

# Bounded loop, not a general agent (that's phase 6) -- never infinite, never re-negotiable.
MAX_DEEP_RESEARCH_ROUNDS = 3


@dataclass
class DeepResearchStep:
    """One round's progress, yielded live right after that round's search+ingest
    completes -- sources_found is the round's real search result URLs, not a guess."""

    round: int
    query: str
    sources_found: list[str]


@dataclass
class DeepResearchResult:
    """Terminal item yielded once run_deep_research's loop ends -- same payload
    the function used to just return."""

    document_ids: list[uuid.UUID]
    any_search_succeeded: bool


async def _ask_judge(judge_target: Target, prompt: str) -> str:
    """Single-shot, throwaway call straight to one target's adapter.

    Deliberately bypasses chat.service.send_message's fan-out/persistence -- this
    is an internal control-flow question, not a user-visible turn, and must never
    show up in conversation history.
    """
    text = ""
    async for chunk in judge_target.adapter.stream_chat(
        [ChatMessage(role="user", content=prompt)], judge_target.model
    ):
        text += chunk.delta
    return text


async def run_deep_research(
    db: AsyncSession,
    user_id: uuid.UUID,
    tavily_key: str,
    embedder: Embedder,
    judge_target: Target,
    query: str,
) -> AsyncIterator[DeepResearchStep | DeepResearchResult]:
    """Search -> ingest -> judge, repeated up to MAX_DEEP_RESEARCH_ROUNDS times.

    Each round searches Tavily with the current query (the original question on
    round 1, the judge's refined follow-up thereafter), ingests the results, and
    accumulates their Document ids. The judge then decides whether to stop or
    hand back a refined query -- skipped on the final round since there's no
    round left to spend it on.

    Yields a DeepResearchStep right after each round's search+ingest completes
    (for live progress streaming), then a single terminal DeepResearchResult
    with all accumulated document ids and whether any round's search actually
    succeeded. A search failure stops the loop early, same as hitting the round
    cap; an all-rounds-failed run leaves the caller to fall back to Task 4's
    honest-degradation system_context.
    """
    document_ids: list[uuid.UUID] = []
    excerpts: list[str] = []
    any_search_succeeded = False
    search_query = query

    for round_num in range(MAX_DEEP_RESEARCH_ROUNDS):
        # Whole round (search + ingest + retrieve) is one unit, same as Task 4's
        # use_web_search block -- any failure in it must degrade this round, not
        # 500 the request. A DB hiccup on hybrid_search is exactly as recoverable
        # as a Tavily timeout, so it gets the same treatment.
        try:
            results = await TavilyProvider(tavily_key).search(search_query)
            new_documents = await ingest_search_results(db, user_id, results, embedder)
            new_ids = [document.id for document in new_documents]
            round_chunks = await hybrid_search(
                db, user_id, search_query, embedder, top_k=5, document_ids=new_ids
            )
        except Exception as exc:
            # ponytail: broad catch on purpose, same reasoning as Task 4's web
            # search -- a flaky round must degrade, never 500 the whole request.
            print(f"deep research round {round_num + 1} failed for query {search_query!r}: {exc!r}")
            break

        any_search_succeeded = True
        document_ids.extend(new_ids)
        excerpts.extend(chunk.content for chunk in round_chunks)
        yield DeepResearchStep(
            round=round_num + 1, query=search_query, sources_found=[r.url for r in results]
        )

        if round_num == MAX_DEEP_RESEARCH_ROUNDS - 1:
            break  # round cap hit -- stop without spending another judge call

        try:
            judge_reply = await _ask_judge(
                judge_target,
                "Given these search result excerpts:\n\n"
                + "\n\n".join(excerpts)
                + f"\n\nDoes this fully answer: '{query}'? "
                "Reply with exactly 'ENOUGH' if yes, or a single refined follow-up "
                "search query if not.",
            )
        except Exception as exc:
            # A flaky judge shouldn't discard research that already found something
            # useful -- treat it the same as the judge saying ENOUGH.
            print(f"deep research judge call failed on round {round_num + 1}: {exc!r}")
            break

        if judge_reply.strip().upper() == "ENOUGH":
            break
        search_query = judge_reply.strip()

    yield DeepResearchResult(document_ids, any_search_succeeded)
