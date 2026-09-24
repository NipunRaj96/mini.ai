import uuid

import httpx

from app.core.config import get_settings
from app.db.session import async_session_factory
from app.modules.chat.models import Conversation

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
_TITLE_MODEL = "openai/gpt-oss-20b"  # verified live 2026-09-19; Groq's lineup rotates, re-check if title-gen silently falls back to truncation


def _truncate_title(first_message: str) -> str:
    stripped = first_message.strip().replace("\n", " ")
    return stripped[:40] + ("..." if len(stripped) > 40 else "")


async def generate_title(first_message: str) -> str:
    settings = get_settings()
    if not settings.miniai_system_groq_api_key:
        return _truncate_title(first_message)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                _GROQ_URL,
                headers={"Authorization": f"Bearer {settings.miniai_system_groq_api_key}"},
                json={
                    "model": _TITLE_MODEL,
                    "messages": [
                        {
                            "role": "user",
                            "content": (
                                "Generate a concise, specific 3-6 word title capturing the "
                                "actual topic or intent of this message. Skip greetings/filler "
                                "if the message has real content -- if it's purely a greeting "
                                "with no topic yet, a short neutral title like 'New Conversation' "
                                "is fine. No punctuation, no quotes, no generic filler words like "
                                f"'chat' or 'discussion'.\n\n{first_message}"
                            ),
                        }
                    ],
                    # 200 not 20: _TITLE_MODEL is a reasoning model that spends completion
                    # tokens on hidden chain-of-thought before the actual title — too low a
                    # budget returns empty content (verified live 2026-09-19).
                    "max_tokens": 200,
                },
            )
            response.raise_for_status()
            title = response.json()["choices"][0]["message"]["content"].strip()
            return title or _truncate_title(first_message)
    except Exception:
        return _truncate_title(first_message)


async def apply_generated_title(conversation_id: uuid.UUID, first_message: str) -> None:
    title = await generate_title(first_message)
    async with async_session_factory() as session:
        conversation = await session.get(Conversation, conversation_id)
        if conversation is not None:
            conversation.title = title
            await session.commit()
