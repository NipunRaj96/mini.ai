# mini.ai — Product Requirements

## Vision

A single, craftsman-grade workspace for talking to *any* model from *any* provider, building your own agents, and letting multiple models/agents collaborate on one problem in one window — without vendor lock-in, without hidden platform billing, and without the sterile "generic AI wrapper" feel.

## Target user

Power users, AI researchers/builders, and technical teams who already hold their own provider API keys (or can get free ones) and want one interface instead of five separate provider dashboards/chat UIs.

## Core principles

- **BYOK (bring your own key), strictly.** mini.ai never bills the user or exposes them to platform-side model cost. The one deliberate exception: chat-title generation uses a mini.ai-owned Groq key (see [security.md](security.md)) because it's an internal system convenience, not a user-facing capability.
- **One provider interface, many providers.** Adding a new model provider must never require touching chat, agent, or orchestration code — only a new adapter (see [architecture.md](architecture.md)).
- **Backend correctness before frontend polish.** No UI work starts until the backend for a phase is built, tested, and stress-tested.

## User journey (target end state)

1. User lands on mini.ai, sees a sign-in prompt plus a short guide on where to get a free API key (Google AI Studio, Groq, OpenRouter).
2. User signs up (email/password, or Google/GitHub OAuth) and pastes at least one provider API key.
3. Once a key is saved, the user can pick any model that provider offers from a top-right model dropdown, bound by that provider's own rate limits.
4. User can add more provider keys any time under Settings → API Keys.
5. Every new conversation gets an auto-generated title from its first message (Groq Llama-70B), exactly like ChatGPT/Claude's title behavior.
6. A **Docs** mode (NotebookLM-style): upload `.txt`/`.pdf` (+ more formats later), query them with grounded, sourced answers.
7. **Web search** and **deep research** modes, matching the depth/behavior of ChatGPT/Claude's equivalents.
8. An **Agent Console** (left sidebar) to define, save, and deploy custom agents (role, goal, guardrails, output format, MCP tool access).
9. In chat, an **agent mode** lets the user `@tag` one or more deployed agents (e.g. `@complianceBot`, `@HRbot`) to act on a request.
10. **Multi-agent orchestration**: tagged agents can see each other's output and collaborate, bounded by explicit latency/cost budgets, targeting >95% task accuracy (accuracy methodology to be defined when we reach Phase 6 — flagged as an open question, not a Phase 1 concern).
11. The same tagging/dropdown model works for raw models too — e.g. Gemini and GPT-5 answering in the same thread, not just agents.

## Explicit non-goals (for now)

- No frontend work until backend phases are validated.
- No multi-tenancy/organizations — single-user personal tool for now (see [architecture.md](architecture.md)).
- No cloud deployment target chosen yet — local/self-hosted (Docker Compose) only.
- No platform-wide billing or platform-provided model keys, aside from the documented Groq title-gen exception.

## Roadmap

See [roadmap.md](roadmap.md) for the phase-by-phase build order and the test → stress-test → confirm gate applied to each slice.
