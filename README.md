# mini.ai

A single, craftsman-grade workspace for talking to any model from any provider, building your own agents, and letting multiple models and agents collaborate in one window — bring your own keys, no platform lock-in.

## Status

**Phase 1a (Foundation) — in progress.** Backend-first: no frontend work happens until Phases 1–6 of the backend are built, tested, and stress-tested. See [`build-plan/roadmap.md`](build-plan/roadmap.md) for the full plan.

## What it does (target)

- BYOK across providers (Google AI Studio, Groq, OpenRouter, OpenAI, Anthropic, ...) — pick any model you have a key for from a single dropdown
- Chat history with automatic, ChatGPT-style thread titling
- Docs mode — NotebookLM-style grounded Q&A over your uploaded files
- Web search & deep research modes
- Agent Console — define, save, and deploy your own agents (role, goal, guardrails, tools)
- Multi-agent orchestration — `@tag` agents or raw models in one thread and have them collaborate

See [`build-plan/PRD.md`](build-plan/PRD.md) for the full product spec.

## Tech stack

Python 3.12 · FastAPI (async) · PostgreSQL + pgvector · SQLAlchemy 2.0 + Alembic · `uv` · SSE streaming · JWT auth. Full rationale in [`build-plan/architecture.md`](build-plan/architecture.md).

## Repo structure

```
app/                 # backend source (modular monolith — see build-plan/architecture.md)
tests/                # pytest suite
build-plan/            # PRD, architecture, data model, logic flows, security, API contracts, roadmap
.env.example             # copy to .env and fill in — see below
```

## Setup (local dev)

```bash
# 1. Install dependencies
uv sync

# 2. Configure environment
cp .env.example .env
# fill in DATABASE_URL, JWT_SECRET_KEY, ENCRYPTION_MASTER_KEY (see .env.example for how)

# 3. Start Postgres (with pgvector) — docker-compose.yml added in slice 1a
docker compose up -d db

# 4. Run migrations
uv run alembic upgrade head

# 5. Run the API
uv run uvicorn app.main:app --reload
```

## Documentation

Everything beyond this README lives in [`build-plan/`](build-plan/):

- [`PRD.md`](build-plan/PRD.md) — product vision, user journey, non-goals
- [`architecture.md`](build-plan/architecture.md) — stack, module layout, SOLID mapping, provider gateway design
- [`data-model.md`](build-plan/data-model.md) — schema, phase by phase
- [`logic-flow.md`](build-plan/logic-flow.md) — request/response sequences for core flows
- [`security.md`](build-plan/security.md) — auth, encryption, secret-handling rules
- [`api-contracts.md`](build-plan/api-contracts.md) — endpoint reference
- [`roadmap.md`](build-plan/roadmap.md) — phase order and the test/stress-test gate applied to each
- [`phase-1-foundation.md`](build-plan/phase-1-foundation.md) — current phase's detailed task breakdown and what's needed from the project owner
