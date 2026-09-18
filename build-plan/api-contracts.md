# API Contracts — Phase 1a

Base path: `/api/v1`. All endpoints except `/auth/signup`, `/auth/login`, `/auth/refresh` require `Authorization: Bearer <access_token>`.

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/signup` | `{email, password}` | `{access_token, refresh_token}` |
| POST | `/auth/login` | `{email, password}` | `{access_token, refresh_token}` |
| POST | `/auth/refresh` | `{refresh_token}` | `{access_token, refresh_token}` |
| POST | `/auth/logout` | `{refresh_token}` | `204` |
| GET | `/auth/me` | — | `{id, email, created_at}` |

## Provider keys

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/keys` | `{provider, label, api_key}` | `{id, provider, label, masked_key, is_active, created_at}` |
| GET | `/keys` | — | `[{id, provider, label, masked_key, is_active, created_at}]` |
| DELETE | `/keys/{id}` | — | `204` |
| PATCH | `/keys/{id}` | `{is_active?}` | `{id, provider, label, masked_key, is_active}` |

## Providers / models

| Method | Path | Response |
|---|---|---|
| GET | `/providers` | `[{provider, has_active_key}]` — which providers the user has a usable key for |
| GET | `/providers/{provider}/models` | `[{id, display_name, context_window}]` — fetched live from the provider, cached briefly |

## Chat

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/chat/conversations` | `{}` | `{id, title: null, created_at}` |
| GET | `/chat/conversations` | — | `[{id, title, updated_at}]` (most recent first) |
| GET | `/chat/conversations/{id}/messages` | — | `[{id, role, content, provider, model, created_at}]` |
| POST | `/chat/conversations/{id}/messages` | `{content, provider, model}` | `text/event-stream` — SSE chunks, final event carries the persisted message id |
| DELETE | `/chat/conversations/{id}` | — | `204` |

## Usage

| Method | Path | Response |
|---|---|---|
| GET | `/usage/summary` | `{total_input_tokens, total_output_tokens, estimated_cost_usd, by_provider: [...]}` |

## Error shape (all endpoints)

```json
{"error": {"code": "string_error_code", "message": "human readable"}}
```
