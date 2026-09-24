import httpx

from app.modules.search.base import SearchResult

_BASE_URL = "https://api.tavily.com"


class TavilyProvider:
    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None):
        self._api_key = api_key
        self._client = client or httpx.AsyncClient(timeout=60.0)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"}

    async def search(self, query: str, max_results: int = 5) -> list[SearchResult]:
        payload = {"query": query, "max_results": max_results}
        response = await self._client.post(
            f"{_BASE_URL}/search", headers=self._headers(), json=payload
        )
        response.raise_for_status()
        return [
            SearchResult(title=r["title"], url=r["url"], content=r["content"])
            for r in response.json().get("results", [])
        ]
