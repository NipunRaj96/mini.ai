# Phase 1 — Foundation: Detailed Plan

## Slice 1a

**Scope:** DB schema, email/password auth, encrypted API-key vault, provider gateway (Google AI Studio + Groq adapters), single-model SSE chat, persistence, title-gen.

**Definition of done:**
- All endpoints in [api-contracts.md](api-contracts.md) (auth, keys, providers, chat, usage) implemented and covered by integration tests
- A real Google AI Studio key round-trips: save → list models → send a message → get a streamed response → conversation is titled
- Provider keys are never observable in plaintext via any API response or log
- `pytest` suite green; coverage on `modules/keys` and `modules/auth` especially (security-critical)
- Stress test passed (see below)

**Test plan:**
- Unit tests: encryption round-trip, JWT issuance/validation/expiry, password hashing, provider adapter contract (mocked HTTP)
- Integration tests: full auth flow, key CRUD, chat message round trip against a mocked provider response
- One live smoke test against the real Google AI Studio + Groq APIs (manual or a gated test), since mocked tests alone can't catch real API contract drift

**Stress test plan:**
- Tool: `hey` or `k6` (external, not an app dependency)
- Targets: auth endpoints (login/signup) and the non-streaming CRUD endpoints (keys, conversations list) — p95 latency and error rate under concurrent load
- Chat/SSE endpoint stress-tested separately for concurrent stream handling (connection count the process can sustain without degrading other requests)
- Record baseline numbers in this file once run, so regressions in later phases are visible

**What I need from you for 1a:**
- A real Google AI Studio API key to test against (you already have one from your own walkthrough)
- Optionally a personal Groq key too, if you want to test chat against Groq-hosted models specifically (separate from the system title-gen key)

## Slice 1b

**Scope:** Google + GitHub OAuth, layered onto the existing auth module (same `users` table, `hashed_password` becomes nullable for OAuth-only accounts).

**What I'll need from you for 1b:**
- Google OAuth client ID + secret (from Google Cloud Console)
- GitHub OAuth App client ID + secret (from GitHub Developer Settings)
- The redirect URI to register will be `http://localhost:<port>/auth/callback/{provider}` for local dev — I'll confirm the exact port when we get there

**Definition of done:** same shape as 1a — tests green, a real OAuth login round-trips locally, stress test on the callback endpoint.

---
*Stress test results get appended here once each slice is run, so later phases can compare against a baseline.*
