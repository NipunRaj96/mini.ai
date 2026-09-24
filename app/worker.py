import uuid

from arq.connections import RedisSettings

from app.core.config import get_settings
from app.db.session import async_session_factory
from app.modules.docs.embedder import FastEmbedEmbedder
from app.modules.docs.service import ingest_document

# The worker is a separate process from the FastAPI app — it never imports the routers
# that transitively pull in every model module, so SQLAlchemy's mapper never sees
# `users`/`conversations`/etc. and FK resolution fails at flush time. Import every
# model module explicitly, same reason app/db/migrations/env.py does it.
from app.modules.auth import models as _auth_models  # noqa: F401
from app.modules.chat import models as _chat_models  # noqa: F401
from app.modules.docs import models as _docs_models  # noqa: F401
from app.modules.keys import models as _keys_models  # noqa: F401
from app.modules.usage import models as _usage_models  # noqa: F401


async def ping(ctx) -> str:
    return "pong"


async def process_document(ctx, document_id: str, raw_bytes: bytes, content_type: str) -> None:
    async with async_session_factory() as session:
        embedder = FastEmbedEmbedder()
        await ingest_document(session, uuid.UUID(document_id), raw_bytes, content_type, embedder)


class WorkerSettings:
    functions = [ping, process_document]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
