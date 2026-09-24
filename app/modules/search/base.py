from dataclasses import dataclass
from typing import Protocol


@dataclass
class SearchResult:
    title: str
    url: str
    content: str


class SearchProvider(Protocol):
    async def search(self, query: str, max_results: int = 5) -> list[SearchResult]: ...
