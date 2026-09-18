# Security Model — Phase 1a

## Password storage

`argon2` hashing (via `passlib` or `argon2-cffi`), never reversible, never logged.

## Session model

Short-lived JWT access token (default 30 min) + longer-lived refresh token (default 30 days, stored hashed in DB so it can be revoked). Access tokens are never persisted server-side; refresh rotation invalidates the previous refresh token on use.

## API key vault

- User-supplied provider keys are encrypted at rest with Fernet (`cryptography` lib), using `ENCRYPTION_MASTER_KEY` from `.env`.
- Decrypted only in memory, only for the duration of a single provider call, then discarded.
- Never returned in full by any API response — only a masked suffix and metadata (`label`, `provider`, `created_at`, `is_active`).
- Never logged, in any log level.

## System-owned Groq key (BYOK exception)

mini.ai holds one platform-owned Groq API key, used **exclusively** for background chat-title generation — never exposed to users, never used for user-requested chat/completions, never returned via any API response.

- Lives only in `.env` (`MINIAI_SYSTEM_GROQ_API_KEY`), which is gitignored and never committed.
- If this key is ever exposed (committed by accident, leaked in a log, shared outside the team), it must be rotated immediately at [console.groq.com](https://console.groq.com) and `.env` updated — treat exposure as a live-incident, not a cleanup task.
- If unset, the app degrades gracefully to a truncated-first-message title (see [logic-flow.md](logic-flow.md)) — title generation is never a hard dependency.

## Transport / API hardening (Phase 1a baseline)

- All secrets-bearing endpoints (`/auth/*`, `/keys`) require HTTPS in any non-local environment (local dev over plain HTTP is fine).
- Login/signup endpoints get basic rate limiting to blunt credential-stuffing (exact mechanism decided during 1a implementation — e.g. `slowapi`).
- SQL injection surface is closed by construction: all queries go through SQLAlchemy's parameterized query builder, no raw string interpolation into SQL.
- CORS is locked to explicit allowed origins once a frontend exists; wide open only for local API testing.

## Deferred (not Phase 1a)

- OAuth token handling (Google/GitHub) — Phase 1b, will follow the same "never log, never return raw tokens" rule.
- Per-request rate limiting beyond auth endpoints — revisit once real usage patterns exist.
- Cloud KMS for the encryption master key — revisit if/when a cloud deployment target is chosen.
