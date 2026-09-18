# Roadmap

Each phase (and each sub-slice within a phase) follows the same gate before moving on: **build → automated tests pass → stress test → explicit confirmation from you → next slice.** Frontend work does not start until Phase 1–6 backend is confirmed stable.

## Phase 1 — Foundation
- **1a**: DB schema, email/password auth, encrypted API-key vault, provider gateway (Google AI Studio + Groq adapters), basic single-model SSE chat, persistence, title-gen
- **1b**: Google + GitHub OAuth on the same auth module

## Phase 2 — Model orchestration (single window, multiple models)
Tag/switch between multiple raw models (e.g. Gemini + GPT) within one conversation thread, per point 12 of the PRD.

## Phase 3 — Doc / RAG mode
Upload `.txt`/`.pdf` (+ more formats), chunk + embed via `pgvector`, grounded retrieval with source citations. Introduces the background task queue (Arq + Redis) for ingestion jobs.

## Phase 4 — Web search & deep research
Search-augmented answers and a multi-step "deep research" mode, matching ChatGPT/Claude's depth.

## Phase 5 — Agent console
Build/save/deploy custom agents: role, goal, guardrails, output format, MCP server access (per the Stitch "Agent Console Builder" screen).

## Phase 6 — Multi-agent orchestration
`@tag` one or more deployed agents (or raw models) in one thread; agents can see each other's output and collaborate under explicit latency/cost budgets. Accuracy target (>95%) needs a defined evaluation methodology — to be designed when this phase starts, not before.

## Phase 7 — Frontend
Only begins once Phases 1–6 backend are confirmed stable, tested, and stress-tested. Design reference already exists (Stitch project, "Espresso Artisan" theme).
