import json
from collections.abc import AsyncIterator

import httpx

from app.modules.providers.base import ChatChunk, ChatMessage, ModelInfo, ToolCall, ToolDef

_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


def _to_wire_contents(messages: list[ChatMessage]) -> list[dict]:
    # Gemini's functionResponse wants the ORIGINAL FUNCTION NAME, not the
    # call id ChatMessage.tool_call_id carries -- recover it from the
    # matching assistant ToolCall earlier in the same history.
    call_names = {
        tc.id: tc.name for m in messages if m.role == "assistant" and m.tool_calls for tc in m.tool_calls
    }
    contents = []
    for m in messages:
        if m.role == "system":
            continue
        if m.role == "tool":
            name = call_names.get(m.tool_call_id, m.tool_call_id)
            contents.append(
                {
                    "role": "function",
                    "parts": [{"functionResponse": {"name": name, "response": {"content": m.content}}}],
                }
            )
        elif m.role == "assistant" and m.tool_calls:
            contents.append(
                {
                    "role": "model",
                    "parts": [
                        {"functionCall": {"name": tc.name, "args": tc.arguments}} for tc in m.tool_calls
                    ],
                }
            )
        else:
            contents.append(
                {"role": "model" if m.role == "assistant" else "user", "parts": [{"text": m.content}]}
            )
    return contents


class GoogleAIStudioProvider:
    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None):
        self._api_key = api_key
        self._client = client or httpx.AsyncClient(timeout=60.0)

    def _headers(self) -> dict[str, str]:
        # Header, not a `?key=` query param -- a query param ends up in
        # httpx's exception message (and thus logs/SSE/persisted messages)
        # on any failed request, leaking the raw key. See providers/router.py's
        # equivalent pattern for the other adapters.
        return {"x-goog-api-key": self._api_key}

    async def list_models(self) -> list[ModelInfo]:
        response = await self._client.get(f"{_BASE_URL}/models", headers=self._headers())
        response.raise_for_status()
        data = response.json()
        return [
            ModelInfo(
                id=m["name"].removeprefix("models/"),
                display_name=m.get("displayName", m["name"]),
                context_window=m.get("inputTokenLimit"),
            )
            for m in data.get("models", [])
            if "generateContent" in m.get("supportedGenerationMethods", [])
        ]

    async def stream_chat(
        self, messages: list[ChatMessage], model: str, tools: list[ToolDef] | None = None
    ) -> AsyncIterator[ChatChunk]:
        contents = _to_wire_contents(messages)
        system_messages = [m.content for m in messages if m.role == "system"]

        payload: dict = {"contents": contents}
        if system_messages:
            payload["systemInstruction"] = {"parts": [{"text": "\n".join(system_messages)}]}
        if tools:
            payload["tools"] = [
                {
                    "functionDeclarations": [
                        {"name": t.name, "description": t.description, "parameters": t.parameters}
                        for t in tools
                    ]
                }
            ]

        # Gemini sends each functionCall as a complete part (unlike OpenAI's
        # fragmented streaming), so no cross-chunk string accumulation is
        # needed -- just collect the parts as they arrive.
        collected_calls: list[ToolCall] = []

        url = f"{_BASE_URL}/models/{model}:streamGenerateContent"
        async with self._client.stream(
            "POST", url, params={"alt": "sse"}, headers=self._headers(), json=payload
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                event = json.loads(line.removeprefix("data: "))
                candidates = event.get("candidates", [])
                if not candidates:
                    continue
                parts = candidates[0].get("content", {}).get("parts", [])
                text = "".join(p.get("text", "") for p in parts if "text" in p)
                for p in parts:
                    fc = p.get("functionCall")
                    if fc:
                        collected_calls.append(
                            ToolCall(id=f"call_{len(collected_calls)}", name=fc["name"], arguments=fc.get("args", {}))
                        )
                finish_reason = candidates[0].get("finishReason")
                usage = event.get("usageMetadata", {})
                yield ChatChunk(
                    delta=text,
                    finished=finish_reason is not None,
                    input_tokens=usage.get("promptTokenCount"),
                    output_tokens=usage.get("candidatesTokenCount"),
                    tool_calls=collected_calls if finish_reason is not None and collected_calls else None,
                )
