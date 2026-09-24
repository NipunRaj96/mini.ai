# mini.ai

**In plain terms:** mini.ai is a website you can run yourself where you type
in your own AI keys (from Google, Groq, OpenAI, etc. — most have a free
tier) and then chat with those models. Unlike ChatGPT or Claude's own apps,
you're not locked into one company's model, one subscription, or one way of
using it. You can ask multiple models the same question at once, build your
own "agents" with a specific personality and job, and let a few of them
argue with each other and then have a judge model pick the best answer.

I got tired of paying for five different chat subscriptions when half the
value of each one is just "talk to a model." mini.ai is my answer: one
workspace, bring your own API keys, talk to whatever model you want —
Gemini, Groq, OpenAI, Anthropic, OpenRouter, Hugging Face — and actually own
the thing instead of renting it.

It started as a simple BYOK ("bring your own key") chat UI and grew into
something a bit more interesting: you can define your own agents (a role, a
goal, guardrails, which tools they're allowed to touch), tag a handful of
them into one conversation, and watch them actually respond to each other
before a judge model synthesizes a final answer. It's not a chatbot. It's
closer to a small room full of models you get to assemble yourself.

## What can you actually do with it? (a few concrete examples)

- **"Should I take this job offer?"** — tag 3 different models (or 3 of your
  own custom agents with different personalities, e.g. an optimist and a
  skeptic) into one message. Each one answers independently, then each one
  sees what the others said and responds for real, and a judge model reads
  all of it and gives you one synthesized, reasoned verdict — instead of you
  manually comparing three separate chat tabs.
- **"What does this 40-page PDF actually say about X?"** — upload the
  document, ask your question, and the model decides on its own whether it
  needs to search the file before answering (you can watch it happen live).
  The answer comes with a clickable citation showing exactly which page it
  pulled from.
- **"What's the latest news on X?"** — the model can search the web itself,
  mid-conversation, without you having to flip a "web search" switch first.
  You watch it type its own search query, read the results, and answer —
  live, not a black box.
- **"Build me a research agent that always double-checks itself before
  answering."** — the Agent Console lets you define a saved persona (a
  role, a goal, rules it must never break, which tools it's allowed to use)
  and reuse it in any conversation like a pinned character, not a one-off
  prompt you retype every time.
- **"I don't want to pay for GPT-Plus AND Claude Pro AND Gemini Advanced
  just to compare answers."** — add your own free-tier keys for whichever
  providers you want, and pay each provider directly for only what you
  actually use. No middleman subscription markup.
- **"Remember that I prefer short answers."** — tell mini.ai something about
  yourself once, or let it quietly notice patterns across conversations, and
  it carries that into future chats — the same idea as ChatGPT/Claude's own
  memory feature, except it's yours and you can turn it off entirely.

## What it actually does (the feature list)

- **BYOK, no lock-in.** Add your own keys for Google AI Studio, Groq,
  OpenRouter, OpenAI, Anthropic, Hugging Face, and Tavily. Nothing routes
  through a middleman API — your key talks directly to the provider.
- **Multi-model, one thread.** Tag two or three raw models in the same
  message and watch them answer side by side.
- **Agents you actually build.** The Agent Console lets you define a
  persona (role, primary goal, output format, guardrail patterns, which
  tools it can use), save it, and deploy it like a first-class chat target.
- **Multi-agent collaboration.** Tag several agents into one turn and they
  run in two rounds — round one is each agent forming an independent
  opinion, round two is each agent seeing what the others said and
  responding for real. Turn on "synthesize" and a judge model reads all of
  it and gives you a single reasoned verdict instead of three answers to
  reconcile yourself.
- **Real agentic tool use.** The model itself decides, mid-answer, whether
  it needs to search the web, search your documents, or run a deeper
  multi-round research pass — the same way Claude or ChatGPT decide to use
  a tool on their own, not a checkbox you have to pre-flip. You see it
  happen live.
- **Docs / RAG.** Upload files, they get chunked and embedded locally (no
  extra API cost for that part), and any chat can ground itself in them —
  answers come with real page-level citations.
- **Deep research.** A bounded, multi-round research loop that searches,
  reads, and refines its own query up to three times before answering — you
  watch each round happen instead of staring at a spinner.
- **Persistent memory.** Like ChatGPT/Claude's memory, but yours: write
  facts about yourself directly, or let the model quietly pick up durable
  details across conversations (your role, preferences, how you like
  answers phrased). One toggle turns the whole thing off if you'd rather it
  forgot everything the moment you close the tab.
- **Usage, actually visible.** Every request's tokens, latency, and
  estimated cost land in a dashboard instead of a black box you find out
  about at the end of the month.

## Why it's built the way it is

A few decisions that shaped this more than anything else:

- **Your key never becomes my liability.** Provider keys are encrypted at
  rest and only ever decrypted in-process to make the one call they're
  needed for. I don't want to be a company that gets breached and leaks
  everyone's OpenAI key.
- **BYOK is the one place I bent the rule.** Everything else in this app
  tries to avoid unnecessary abstraction, but the provider layer is a real
  interface (`LLMProvider`) on purpose — Gemini, Groq, and Hugging Face all
  stream chat completions (and now tool calls) slightly differently, and
  that's exactly the kind of variation worth isolating behind one seam.
- **Backend first, then frontend, in that order, on purpose.** The API was
  built, tested, and stress-tested (300 concurrent requests, zero errors)
  before a single line of UI existed. The frontend is a client of a
  contract that was already proven to work, not the other way around.
- **Nothing ships untested against a real provider.** Mocked tests catch
  logic bugs; they don't catch a provider's SSE stream using `\r\n` instead
  of `\n`, or a 429 arriving mid-stream after other answers already sent.
  Every phase of this got a pass against real Gemini/Groq/Hugging Face
  traffic before being called done.

## Tech stack

**Backend** — Python, FastAPI (async), PostgreSQL + `pgvector` for
embeddings, SQLAlchemy 2.0 + Alembic, Redis + `arq` for background jobs
(document ingestion), Server-Sent Events for streaming, JWT auth,
`fastembed` for local embeddings, dependency management via
[`uv`](https://docs.astral.sh/uv/).

**Frontend** — React 19 + TypeScript, Vite, Tailwind CSS v4 (token-based
theming, dark mode only), React Router. No heavier framework — this is a
client app talking to a REST + SSE API, it doesn't need one.

**Infra** — Docker Compose for local Postgres/Redis, Alembic migrations,
a single script to run the whole stack.

## Getting started

```bash
# install
uv sync
cd frontend && npm install && cd ..

# configure
cp .env.example .env
# fill in DATABASE_URL, JWT_SECRET_KEY, ENCRYPTION_MASTER_KEY

# infra + migrations
docker compose up -d
uv run alembic upgrade head

# run everything (API + background worker + frontend)
./scripts/dev.sh
```

Backend at `localhost:8000/docs`, frontend at `localhost:5173`. Ctrl+C stops
all three processes `dev.sh` starts. Add your own provider keys from the
Settings page once you're in — nothing works without at least one.

## Status

Backend and frontend are both feature-complete for the current scope:
multi-provider chat, agent console, multi-agent collaboration with
judge/consensus, real agentic tool use (web search / doc search / deep
research, model's own choice), docs/RAG with citations, persistent memory,
and a settings/usage dashboard. Tested end-to-end against real provider
traffic, not just mocks, and independently security-reviewed before launch.

There's plenty still worth doing — this is a project I keep iterating on,
not a finished product with a version-1.0 stamp on it. Connecting external
tool servers (MCP) is the next natural step on top of the tool-calling
groundwork already in place.

## License

MIT — see [`LICENSE`](LICENSE).

## Author

Nipun Kumar
