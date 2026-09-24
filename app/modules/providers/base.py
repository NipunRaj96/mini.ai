from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol


@dataclass
class ToolDef:
    """One tool the model may call -- name/description/JSON-schema parameters,
    the same shape every provider's native or OpenAI-compatible tool-calling
    API expects. Adapters translate this into their own wire format."""

    name: str
    description: str
    parameters: dict


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class ChatMessage:
    role: Literal["user", "assistant", "system", "tool"]
    content: str
    # Set on a "tool" message: which ToolCall.id this is the result for.
    tool_call_id: str | None = None
    # Set on an "assistant" message that requested calls, so replaying it as
    # history (alongside the matching "tool" result messages) round-trips
    # correctly through providers that require the pairing.
    tool_calls: list[ToolCall] | None = None


@dataclass
class ChatChunk:
    delta: str
    finished: bool = False
    input_tokens: int | None = None
    output_tokens: int | None = None
    # Set on the chunk that ends the stream when the model chose to call
    # tools instead of (or after) producing text -- the caller executes each
    # call and continues the conversation with the results, it never reaches
    # the user as-is.
    tool_calls: list[ToolCall] | None = None


@dataclass
class ModelInfo:
    id: str
    display_name: str
    context_window: int | None = None


class LLMProvider(Protocol):
    async def list_models(self) -> list[ModelInfo]: ...

    def stream_chat(
        self, messages: list[ChatMessage], model: str, tools: list[ToolDef] | None = None
    ) -> AsyncIterator[ChatChunk]: ...
