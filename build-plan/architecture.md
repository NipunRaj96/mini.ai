# Architecture

## Style: modular monolith

One deployable FastAPI service, internally split into modules with hard boundaries (each behind an interface). Not microservices — no independent-scaling need exists yet, and a monolith with clean seams can have any module extracted into its own service later at low cost. The most likely future extraction candidate is the multi-agent orchestration engine (Phase 6), if it ever needs to run as independent workers.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language/framework | Python 3.12, FastAPI | async-native, user's chosen language |
| Package manager | `uv` | fast, single lockfile, no extra daemon |
| DB | PostgreSQL 16 + `pgvector` | pgvector enabled from day 1 so Phase 3 (doc/RAG embeddings) needs no migration surgery |
| ORM / migrations | SQLAlchemy 2.0 (async) + Alembic | typed models, explicit migrations |
| Auth | JWT (access + refresh) + `argon2` hashing | stateless, standard; OAuth via Authlib added in slice 1b |
| Secrets at rest | `cryptography` Fernet, master key from `.env` | symmetric, no external KMS dependency yet |
| Streaming | SSE (`sse-starlette`) | simplest fit for token streaming; WebSockets introduced later only for the Phase 6 orchestration view if it needs bidirectional agent-to-agent updates |
| HTTP client | `httpx` (async) | async-native, used for all outbound provider calls |
| Background jobs | FastAPI `BackgroundTasks` | sufficient for Phase 1 (title-gen); a real queue (Arq + Redis) is introduced in Phase 3 when doc ingestion/deep research need durable, retryable jobs — not before |
| Tests | `pytest` + `pytest-asyncio` + `httpx.AsyncClient` | standard async-friendly stack |
| Stress tests | external tool (`hey` or `k6`), not an app dependency | keeps load-testing tooling out of the app's own dependency graph |

## Layout

```
app/
  core/            # settings, JWT, encryption, shared exceptions
  db/               # async session, declarative base, Alembic env
  modules/
    auth/           # signup/login/refresh, password hashing, (later) OAuth
    users/           # user profile
    keys/             # API key vault CRUD (encrypt/decrypt/mask)
    providers/         # LLMProvider protocol + concrete adapters + registry
    chat/                # conversations, messages, SSE streaming, title-gen
    usage/                # usage_events recording, cost estimation
  main.py
tests/
build-plan/
```

Each module owns its own routers, schemas (Pydantic), service class, and SQLAlchemy models. Services depend on other modules only through their public service interface — never by reaching into another module's models directly.

## SOLID mapping (so it's concrete, not just a slogan)

- **SRP** — one module = one reason to change (e.g. `keys/` only changes when key-vault behavior changes).
- **OCP** — adding a provider = adding one file to `providers/adapters/` and a registry entry. Nothing in `chat/` or `usage/` changes.
- **LSP** — every `LLMProvider` adapter is substitutable; the chat service only ever calls the protocol's methods.
- **ISP** — `LLMProvider` exposes only `stream_chat()` and `list_models()` — adapters aren't forced to implement unrelated methods.
- **DIP** — `chat/` and `usage/` depend on the `LLMProvider` abstract protocol, not on concrete `GroqProvider`/`GoogleAIStudioProvider` classes. The registry (a thin factory) is the only place that knows concrete types.

## Provider gateway (core abstraction)

```python
class LLMProvider(Protocol):
    async def list_models(self) -> list[ModelInfo]: ...
    async def stream_chat(
        self, messages: list[ChatMessage], model: str, **params
    ) -> AsyncIterator[ChatChunk]: ...
```

Concrete adapters (Phase 1a): `GoogleAIStudioProvider`, `GroqProvider`. Registry maps a `provider` enum value to an adapter instance, built once at startup from each user's decrypted key. `OpenAIProvider`, `AnthropicProvider`, `OpenRouterProvider` follow the same shape when their keys are added — no gateway changes required.

## Path to extraction later

If a module ever needs independent scaling or deployment (most likely `providers`/orchestration in Phase 6), it's extracted behind the same interface it already exposes internally — the module boundary is the future service boundary.
