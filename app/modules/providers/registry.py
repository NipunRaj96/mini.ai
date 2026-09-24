from app.modules.keys.models import Provider
from app.modules.providers.adapters.google_ai_studio import GoogleAIStudioProvider
from app.modules.providers.adapters.groq import GroqProvider
from app.modules.providers.adapters.huggingface import HuggingFaceProvider
from app.modules.providers.base import LLMProvider

_ADAPTERS: dict[Provider, type] = {
    Provider.GOOGLE_AI_STUDIO: GoogleAIStudioProvider,
    Provider.GROQ: GroqProvider,
    Provider.HUGGINGFACE: HuggingFaceProvider,
}


class UnsupportedProviderError(Exception):
    pass


def build_provider(provider: Provider, api_key: str) -> LLMProvider:
    adapter_cls = _ADAPTERS.get(provider)
    if adapter_cls is None:
        raise UnsupportedProviderError(provider)
    return adapter_cls(api_key=api_key)
