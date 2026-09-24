import json
from collections.abc import AsyncIterator

import httpx

from app.modules.providers.base import ChatChunk, ChatMessage, ModelInfo, ToolCall, ToolDef

_BASE_URL = "https://router.huggingface.co/v1"


def _to_wire_messages(messages: list[ChatMessage]) -> list[dict]:
    wire = []
    for m in messages:
        if m.role == "tool":
            wire.append({"role": "tool", "tool_call_id": m.tool_call_id, "content": m.content})
        elif m.role == "assistant" and m.tool_calls:
            wire.append(
                {
                    "role": "assistant",
                    "content": m.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)},
                        }
                        for tc in m.tool_calls
                    ],
                }
            )
        else:
            wire.append({"role": m.role, "content": m.content})
    return wire


def _to_wire_tools(tools: list[ToolDef]) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {"name": t.name, "description": t.description, "parameters": t.parameters},
        }
        for t in tools
    ]


class HuggingFaceProvider:
    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None):
        self._api_key = api_key
        self._client = client or httpx.AsyncClient(timeout=60.0)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"}

    async def list_models(self) -> list[ModelInfo]:
        response = await self._client.get(f"{_BASE_URL}/models", headers=self._headers())
        response.raise_for_status()
        return [
            ModelInfo(id=m["id"], display_name=m["id"], context_window=m.get("context_window"))
            for m in response.json().get("data", [])
        ]

    async def stream_chat(
        self, messages: list[ChatMessage], model: str, tools: list[ToolDef] | None = None
    ) -> AsyncIterator[ChatChunk]:
        payload = {
            "model": model,
            "messages": _to_wire_messages(messages),
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if tools:
            payload["tools"] = _to_wire_tools(tools)

        # Tool-call argument fragments stream in per-index across chunks and
        # only become valid JSON once fully concatenated -- accumulate here,
        # keyed by the `index` OpenAI's wire format uses for parallel calls.
        pending_calls: dict[int, dict] = {}

        async with self._client.stream(
            "POST", f"{_BASE_URL}/chat/completions", headers=self._headers(), json=payload
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line.removeprefix("data: ")
                if raw == "[DONE]":
                    break
                event = json.loads(raw)
                if "error" in event:
                    raise RuntimeError(
                        f"HuggingFace API error: {event['error'].get('message', event['error'])}"
                    )
                usage = event.get("usage", {}) or {}
                choices = event.get("choices", [])
                delta = ""
                finish_reason = None
                if choices:
                    choice = choices[0]
                    delta_obj = choice.get("delta", {})
                    delta = delta_obj.get("content", "") or ""
                    finish_reason = choice.get("finish_reason")

                    for frag in delta_obj.get("tool_calls") or []:
                        slot = pending_calls.setdefault(
                            frag["index"], {"id": None, "name": None, "arguments": ""}
                        )
                        if frag.get("id"):
                            slot["id"] = frag["id"]
                        fn = frag.get("function") or {}
                        if fn.get("name"):
                            slot["name"] = fn["name"]
                        if fn.get("arguments"):
                            slot["arguments"] += fn["arguments"]

                if finish_reason == "tool_calls":
                    calls = []
                    for slot in pending_calls.values():
                        try:
                            args = json.loads(slot["arguments"])
                        except json.JSONDecodeError:
                            print(
                                f"HuggingFace: skipping malformed tool call arguments for "
                                f"{slot['name']!r}: {slot['arguments']!r}"
                            )
                            continue
                        calls.append(ToolCall(id=slot["id"], name=slot["name"], arguments=args))
                    yield ChatChunk(
                        delta="",
                        finished=True,
                        input_tokens=usage.get("prompt_tokens"),
                        output_tokens=usage.get("completion_tokens"),
                        tool_calls=calls,
                    )
                    continue

                yield ChatChunk(
                    delta=delta,
                    finished=finish_reason is not None,
                    input_tokens=usage.get("prompt_tokens"),
                    output_tokens=usage.get("completion_tokens"),
                )
