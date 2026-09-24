import uuid

from arq.connections import create_pool
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import limiter
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.docs.schemas import DocumentResponse
from app.modules.docs.service import (
    DocumentNotFoundError,
    create_document,
    delete_document,
    get_document,
    list_documents,
)
from app.worker import WorkerSettings

router = APIRouter(prefix="/api/v1/docs", tags=["docs"])

# extension -> canonical content_type we trust, since UploadFile.content_type is
# client-supplied and not validated by FastAPI.
_ALLOWED_EXTENSIONS = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

# Bounds memory/Redis usage per upload -- raw_bytes gets serialized whole into
# an arq job arg (stored in Redis until a worker picks it up), so an unbounded
# upload is a direct memory-exhaustion vector against both the API process
# and Redis, not just the eventual parser.
_MAX_UPLOAD_BYTES = 25 * 1024 * 1024


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def upload_document_endpoint(
    request: Request,
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    filename = file.filename or ""
    ext = filename[filename.rfind(".") :].lower() if "." in filename else ""
    content_type = _ALLOWED_EXTENSIONS.get(ext)
    if content_type is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only .txt, .md, .pdf, and .docx files are supported"
        )

    # Read one byte past the cap so an oversized file is never fully buffered.
    raw_bytes = await file.read(_MAX_UPLOAD_BYTES + 1)
    if len(raw_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"File exceeds the {_MAX_UPLOAD_BYTES // (1024 * 1024)}MB upload limit",
        )
    document = await create_document(db, user.id, filename, content_type)
    await db.commit()

    # ponytail: pool-per-request, no app-lifespan wiring for a job queue this
    # small. Upgrade to a shared app.state pool if upload volume ever makes
    # per-request connection setup a bottleneck.
    pool = await create_pool(WorkerSettings.redis_settings)
    try:
        await pool.enqueue_job("process_document", str(document.id), raw_bytes, content_type)
    finally:
        await pool.aclose()

    return document


@router.get("", response_model=list[DocumentResponse])
async def list_documents_endpoint(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await list_documents(db, user.id)


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document_endpoint(
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_document(db, user.id, document_id)
    except DocumentNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found") from exc


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document_endpoint(
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_document(db, user.id, document_id)
    except DocumentNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found") from exc
    await db.commit()
