#!/usr/bin/env bash
# Runs the whole stack: Postgres+Redis (docker), migrations, backend, arq
# worker, frontend. Ctrl+C stops everything.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d
uv run alembic upgrade head

uv run uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!
uv run arq app.worker.WorkerSettings &
WORKER_PID=$!
(cd frontend && npm run dev) &
FRONTEND_PID=$!

trap 'kill $BACKEND_PID $WORKER_PID $FRONTEND_PID 2>/dev/null' EXIT INT TERM
wait
