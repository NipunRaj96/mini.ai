from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.modules.agents.router import router as agents_router
from app.modules.auth.router import router as auth_router
from app.modules.chat.router import router as chat_router
from app.modules.docs.router import router as docs_router
from app.modules.keys.router import router as keys_router
from app.modules.mcp_servers.router import router as mcp_servers_router
from app.modules.memory.router import router as memory_router
from app.modules.providers.router import router as providers_router
from app.modules.usage.router import router as usage_router

app = FastAPI(title="mini.ai")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(agents_router)
app.include_router(keys_router)
app.include_router(mcp_servers_router)
app.include_router(providers_router)
app.include_router(chat_router)
app.include_router(docs_router)
app.include_router(usage_router)
app.include_router(memory_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
