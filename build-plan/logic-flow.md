# Logic Flows — Phase 1a

## Sign up

1. `POST /auth/signup` {email, password}
2. Service checks email uniqueness → hashes password (argon2) → creates `users` row
3. Issues access token (short-lived JWT) + refresh token (longer-lived, stored hashed in DB for revocation)
4. Returns both tokens to client

## Login

1. `POST /auth/login` {email, password}
2. Look up user by email → verify password hash
3. Issue new access + refresh token pair (same as signup step 3)

## Refresh

1. `POST /auth/refresh` {refresh_token}
2. Validate refresh token against stored hash + expiry
3. Rotate: issue new access + refresh pair, invalidate the old refresh token

## Add a provider API key

1. `POST /keys` {provider, label, api_key} (authenticated)
2. Service encrypts `api_key` with the Fernet master key → stores ciphertext, discards plaintext from memory immediately after
3. Response returns the key row *without* the plaintext — only `label`, `provider`, a masked suffix (e.g. `...UDbhb`), `is_active`, `created_at`

## Send a chat message (core loop)

1. `POST /chat/conversations/{id}/messages` {content, provider, model} (authenticated, SSE response)
2. Service loads conversation + message history, appends the new user message, persists it
3. Service resolves the requested `provider` → decrypts that user's key in memory → gets the registered `LLMProvider` adapter
4. Adapter's `stream_chat()` is called; each chunk is forwarded to the client over SSE as it arrives
5. On stream completion: persist the full assistant message, record a `usage_events` row (tokens/latency from the provider's response metadata), discard decrypted key from memory
6. If this was the conversation's first exchange: schedule a `BackgroundTask` for title generation

## Title generation (background)

1. Triggered after the first user+assistant exchange in a conversation
2. If `MINIAI_SYSTEM_GROQ_API_KEY` is configured → call Groq Llama-70B with a short "summarize this exchange into a 5-word title" prompt
3. If not configured, or the call fails → fall back to a truncated first-message title (first ~40 chars)
4. Update `conversations.title`
