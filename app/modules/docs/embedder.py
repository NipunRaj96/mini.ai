import asyncio
from typing import Protocol

from fastembed import TextEmbedding


class Embedder(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class FastEmbedEmbedder:
    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        self._model = TextEmbedding(model_name=model_name)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return await asyncio.to_thread(lambda: [v.tolist() for v in self._model.embed(texts)])
