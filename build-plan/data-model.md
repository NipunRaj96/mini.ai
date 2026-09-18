# Data Model — Phase 1a

Only what Phase 1a needs. Later phases extend this via new Alembic migrations, not speculative columns added now.

## `users`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| email | text, unique, not null | |
| hashed_password | text, nullable | null once OAuth-only signup exists (1b) |
| created_at | timestamptz | |
| updated_at | timestamptz | |

## `provider_keys`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| user_id | uuid, fk → users.id | |
| provider | enum(`google_ai_studio`, `groq`, `openrouter`, `openai`, `anthropic`) | extend enum as adapters are added |
| label | text | user-facing nickname, e.g. "personal gemini key" |
| encrypted_key | bytea | Fernet ciphertext, never returned in full via API |
| is_active | boolean, default true | |
| created_at | timestamptz | |

## `conversations`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| user_id | uuid, fk → users.id | |
| title | text, nullable | filled by title-gen background task |
| created_at | timestamptz | |
| updated_at | timestamptz | |

## `messages`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| conversation_id | uuid, fk → conversations.id | |
| role | enum(`user`, `assistant`, `system`) | |
| content | text | |
| provider | enum, nullable | which provider answered (assistant messages only) |
| model | text, nullable | e.g. `gemini-2.0-flash` |
| created_at | timestamptz | |

## `usage_events`
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| user_id | uuid, fk → users.id | |
| provider_key_id | uuid, fk → provider_keys.id | |
| model | text | |
| input_tokens | int | |
| output_tokens | int | |
| latency_ms | int | |
| cost_estimate_usd | numeric(10,6), nullable | from a static per-model pricing table, refreshed manually |
| created_at | timestamptz | |

## Indexes

- `provider_keys(user_id)`, `conversations(user_id, updated_at desc)`, `messages(conversation_id, created_at)`, `usage_events(user_id, created_at)`

## Reserved for later phases (not built now)

- `documents` / `document_chunks` (+ `pgvector` embedding column) — Phase 3
- `agents` / `agent_deployments` — Phase 5
- `orchestration_runs` — Phase 6

Listed here only so future migrations have a named home to design against — no tables or columns for these exist yet.
