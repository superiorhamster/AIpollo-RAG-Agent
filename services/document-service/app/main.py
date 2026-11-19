import asyncio
import hmac
import logging
import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import PurePosixPath
from tempfile import TemporaryFile
from typing import Annotated, Literal
from uuid import UUID, uuid4

import httpx
import urllib3
from fastapi import FastAPI, Header, Request, Response
from minio import Minio
from pydantic import Field, model_validator, BaseModel, StringConstraints, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from app.storage import DOCX, PDF, filename_from, inspect_file, spool, stream_object
from rag_db import database_ready, install_database_errors, open_database
from rag_events import Event, enqueue, run_broker
from rag_http import ACCESS_COOKIE, ACCESS_FORMAT, ApiError, health_response, install_http, request_id, require_service, unauthorized, unavailable

SERVICE = "document-service"
LOG = logging.getLogger(__name__)
BASE = "/v1/workspaces/{workspace_id}/documents"
INTERNAL = "/internal/v1/workspaces/{workspace_id}/documents/{document_id}"
PUBLIC_FIELDS = "document_id, workspace_id, filename, name, media_type, size_bytes, preview_ready, created_at"


class Document(BaseModel):
    document_id: UUID
    workspace_id: UUID
    filename: str
    name: str
    media_type: str
    size_bytes: int
    preview_ready: bool
    created_at: datetime


class Rename(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200, pattern=r"^[^\x00]+$")]


class WorkspaceAccess(BaseModel):
    user_id: UUID
    role: Literal["OWNER", "EDITOR", "VIEWER"]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.database = open_database()
    app.state.bucket = os.environ["DOCUMENT_BUCKET"]
    app.state.storage = Minio(
        "minio:9000", access_key="rag-documents", secret_key=os.environ["DOCUMENT_STORAGE_PASSWORD"], secure=False,
        http_client=urllib3.PoolManager(timeout=urllib3.Timeout(connect=3, read=25), retries=False),
    )
    app.state.workspace_token = os.environ["WORKSPACE_DOCUMENT_TOKEN"]
    app.state.ingestion_token = os.environ["DOCUMENT_INGESTION_TOKEN"]
    broker = asyncio.create_task(run_broker(app.state.database, "document.lifecycle", start_workspace_cleanup, "documents"))
    cleanup = asyncio.create_task(cleanup_loop())
    try:
        async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
            app.state.client = client
            yield
    finally:
        for task in (broker, cleanup):
            task.cancel()
        await asyncio.gather(broker, cleanup, return_exceptions=True)
        await app.state.database.dispose()


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None)
install_http(app)
install_database_errors(app)


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness() -> Response:
    ready = await database_ready(app.state.database, "documents", "documents_002")
    if ready:
        try:
            ready = await run_in_threadpool(app.state.storage.bucket_exists, app.state.bucket)
        except Exception:
            ready = False
    return health_response(SERVICE, ready)


def not_found() -> ApiError:
    return ApiError(404, "not_found", "Document or workspace could not be found.")


async def access(request: Request, workspace_id: UUID, write: bool = False) -> WorkspaceAccess:
    token = request.cookies.get(ACCESS_COOKIE)
    if not token or not ACCESS_FORMAT.fullmatch(token):
        raise unauthorized()
    try:
        response = await app.state.client.get(
            f"http://workspace-service:8000/internal/v1/workspaces/{workspace_id}/document-access",
            headers={
                "X-Document-Service-Token": app.state.workspace_token,
                "X-Request-ID": request_id(request),
                "Cookie": f"{ACCESS_COOKIE}={token}",
            },
        )
        if response.status_code == 401:
            raise unauthorized()
        if response.status_code == 404:
            raise not_found()
        if response.status_code != 200:
            raise unavailable()
        identity = WorkspaceAccess.model_validate_json(response.content)
    except (httpx.HTTPError, ValidationError) as exc:
        raise unavailable() from exc
    if write and identity.role == "VIEWER":
        raise ApiError(403, "forbidden", "Your workspace role does not allow this action.")
    return identity


async def lock_workspace(connection: AsyncConnection, workspace_id: UUID) -> None:
    await connection.execute(text("""
        SELECT pg_advisory_xact_lock(hashtextextended(CAST(:ws AS text), 2002))
    """), {"ws": workspace_id})


async def require_open(connection: AsyncConnection, workspace_id: UUID) -> None:
    await lock_workspace(connection, workspace_id)
    if await connection.scalar(text("SELECT 1 FROM documents.workspace_deletions WHERE workspace_id = :ws"),
                               {"ws": workspace_id}):
        raise not_found()


async def get_ready(connection: AsyncConnection, workspace_id: UUID, document_id: UUID) -> Document:
    result = await connection.execute(text(f"""
        SELECT {PUBLIC_FIELDS} FROM documents.items
        WHERE workspace_id = :ws AND document_id = :id AND state = 'ready'
    """), {"ws": workspace_id, "id": document_id})
    row = result.mappings().one_or_none()
    if row is None:
        raise not_found()
    return Document.model_validate(row)


def object_key(workspace_id: UUID, document_id: UUID, preview: bool = False) -> str:
    return f"{workspace_id}/{document_id}/" + ("preview.pdf" if preview else "original")


@app.get(BASE)
async def list_documents(workspace_id: UUID, request: Request) -> list[Document]:
    await access(request, workspace_id)
    async with app.state.database.connect() as connection:
        result = await connection.execute(text(f"""
            SELECT {PUBLIC_FIELDS} FROM documents.items WHERE workspace_id = :ws AND state = 'ready'
            ORDER BY created_at DESC, document_id
        """), {"ws": workspace_id})
        return [Document.model_validate(row) for row in result.mappings()]


@app.post(BASE, status_code=201)
async def upload(workspace_id: UUID, request: Request,
                 key: Annotated[UUID, Header(alias="Idempotency-Key")],
                 uploaded_name: Annotated[str, Header(alias="X-Filename")]) -> Document:
    actor = await access(request, workspace_id, write=True)
    filename = filename_from(uploaded_name)
    with TemporaryFile() as file:
        size, digest = await spool(request, file)
        media_type = await run_in_threadpool(inspect_file, file, filename)
        await access(request, workspace_id, write=True)
        params = {"ws": workspace_id, "actor": actor.user_id, "key": key, "id": uuid4(),
                  "filename": filename, "size": size, "digest": digest, "media_type": media_type}
        async with app.state.database.begin() as connection:
            await require_open(connection, workspace_id)
            await connection.execute(text("""
                INSERT INTO documents.items
                    (document_id, workspace_id, actor_id, idempotency_key, filename, name, media_type, size_bytes, sha256, state)
                VALUES (:id, :ws, :actor, :key, :filename, :filename, :media_type, :size, :digest, 'uploading')
                ON CONFLICT (workspace_id, actor_id, idempotency_key) DO NOTHING
            """), params)
            row = (await connection.execute(text("""
                SELECT document_id, sha256, filename, state FROM documents.items
                WHERE workspace_id = :ws AND actor_id = :actor AND idempotency_key = :key
            """), params)).mappings().one()
            if row["sha256"] != digest or row["filename"] != filename or row["state"] in ("deleting", "deleted"):
                raise ApiError(409, "idempotency_conflict", "This request key is unavailable for the file.")
            document_id = row["document_id"]
            if row["state"] == "ready":
                return await get_ready(connection, workspace_id, document_id)

        async with app.state.database.begin() as connection:
            await require_open(connection, workspace_id)
            state = await connection.scalar(text("SELECT state FROM documents.items WHERE document_id = :id"),
                                            {"id": document_id})
            if state == "ready":
                return await get_ready(connection, workspace_id, document_id)
            if state != "uploading":
                raise not_found()
            try:
                await run_in_threadpool(app.state.storage.put_object, app.state.bucket,
                                        object_key(workspace_id, document_id), file, size, content_type=media_type)
            except Exception as exc:
                LOG.warning("Object upload incomplete for document %s (%s)", document_id, type(exc).__name__)
                raise unavailable() from exc
            await connection.execute(text("""
                UPDATE documents.items SET state = 'ready', preview_ready = :is_pdf, updated_at = now()
                WHERE document_id = :id
            """), {"id": document_id, "is_pdf": media_type == PDF})
            await enqueue(connection, "documents", event_type="document.uploaded.v1", document_id=document_id,
                          workspace_id=workspace_id, actor_id=actor.user_id, request_id=request_id(request),
                          media_type=media_type)
            return await get_ready(connection, workspace_id, document_id)


@app.get(BASE + "/{document_id}")
async def detail(workspace_id: UUID, document_id: UUID, request: Request) -> Document:
    await access(request, workspace_id)
    async with app.state.database.connect() as connection:
        return await get_ready(connection, workspace_id, document_id)


@app.patch(BASE + "/{document_id}")
async def rename(workspace_id: UUID, document_id: UUID, data: Rename, request: Request) -> Document:
    await access(request, workspace_id, write=True)
    async with app.state.database.begin() as connection:
        await require_open(connection, workspace_id)
        await get_ready(connection, workspace_id, document_id)
        await connection.execute(text("""
            UPDATE documents.items SET name = :name, updated_at = now() WHERE document_id = :id
        """), {"id": document_id, "name": data.name})
        return await get_ready(connection, workspace_id, document_id)


@app.delete(BASE + "/{document_id}", status_code=202)
async def delete(workspace_id: UUID, document_id: UUID, request: Request) -> Response:
    actor = await access(request, workspace_id, write=True)
    async with app.state.database.begin() as connection:
        await require_open(connection, workspace_id)
        state = await connection.scalar(text("""
            SELECT state FROM documents.items WHERE workspace_id = :ws AND document_id = :id
        """), {"ws": workspace_id, "id": document_id})
        if state == "deleting":
            return Response(status_code=202)
        if state != "ready":
            raise not_found()
        await connection.execute(text("""
            UPDATE documents.items SET state = 'deleting', cleanup_after = now() WHERE document_id = :id
        """), {"id": document_id})
        await connection.execute(text("DELETE FROM documents.annotations WHERE document_id=:id"),
                                 {"id": document_id})
        await enqueue(connection, "documents", event_type="document.deletion_requested.v1",
                      workspace_id=workspace_id, document_id=document_id, actor_id=actor.user_id,
                      request_id=request_id(request))
    return Response(status_code=202)


@app.api_route(BASE + "/{document_id}/original", methods=["GET", "HEAD"])
async def original(workspace_id: UUID, document_id: UUID, request: Request) -> Response:
    doc = await detail(workspace_id, document_id, request)
    return await send_document(doc, request, preview=False)


@app.api_route(BASE + "/{document_id}/preview", methods=["GET", "HEAD"])
async def preview(workspace_id: UUID, document_id: UUID, request: Request) -> Response:
    doc = await detail(workspace_id, document_id, request)
    if not doc.preview_ready:
        raise ApiError(409, "preview_unavailable", "A preview is not ready.")
    return await send_document(doc, request, preview=True)


async def send_document(doc: Document, request: Request, preview: bool) -> Response:
    return await stream_object(
        app.state.storage, app.state.bucket,
        object_key(doc.workspace_id, doc.document_id, preview and doc.media_type == DOCX),
        PDF if preview else doc.media_type,
        f"{PurePosixPath(doc.filename).stem}.pdf" if preview else doc.filename, request,
        attachment=not preview,
    )


@app.get(BASE + "/{document_id}/jobs")
async def jobs(workspace_id: UUID, document_id: UUID, request: Request) -> list[dict]:
    await detail(workspace_id, document_id, request)
    try:
        response = await app.state.client.get(
            f"http://ingestion-service:8000/internal/v1/workspaces/{workspace_id}/documents/{document_id}/jobs",
            headers={"X-Ingestion-Service-Token": app.state.ingestion_token, "X-Request-ID": request_id(request)},
        )
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise unavailable() from exc


def require_ingestion(request: Request) -> None:
    token = request.headers.get("X-Ingestion-Service-Token", "").encode()
    if not hmac.compare_digest(token, app.state.ingestion_token.encode()):
        raise unauthorized()


@app.get(INTERNAL + "/original", include_in_schema=False)
async def ingestion_original(workspace_id: UUID, document_id: UUID, request: Request) -> Response:
    require_ingestion(request)
    async with app.state.database.connect() as connection:
        doc = await get_ready(connection, workspace_id, document_id)
    return await send_document(doc, request, preview=False)


@app.get(INTERNAL + "/index-source", include_in_schema=False)
async def index_source(workspace_id: UUID, document_id: UUID, request: Request) -> Response:
    require_ingestion(request)
    async with app.state.database.begin() as connection:
        await require_open(connection, workspace_id)
        doc = await get_ready(connection, workspace_id, document_id)
    if not doc.preview_ready:
        raise ApiError(409, "preview_unavailable", "A preview is not ready.")
    return await send_document(doc, request, preview=True)


@app.put(INTERNAL + "/preview", include_in_schema=False, status_code=204)
async def save_preview(workspace_id: UUID, document_id: UUID, request: Request) -> Response:
    require_ingestion(request)
    with TemporaryFile() as file:
        size, _ = await spool(request, file)
        if inspect_file(file, "preview.pdf") != PDF:
            raise ApiError(415, "invalid_preview", "Expected a PDF preview.")
        async with app.state.database.begin() as connection:
            await require_open(connection, workspace_id)
            doc = await get_ready(connection, workspace_id, document_id)
            if doc.media_type != DOCX:
                raise ApiError(409, "invalid_preview", "Only DOCX requires a generated preview.")
            if not doc.preview_ready:
                try:
                    await run_in_threadpool(app.state.storage.put_object, app.state.bucket,
                                            object_key(workspace_id, document_id, True), file, size, content_type=PDF)
                except Exception as exc:
                    raise unavailable() from exc
                await connection.execute(text("""
                    UPDATE documents.items SET preview_ready = true, updated_at = now() WHERE document_id = :id
                """), {"id": document_id})
    return Response(status_code=204)


async def start_workspace_cleanup(event: Event) -> None:
    if event.event_type != "workspace.deletion_requested.v1":
        return
    params = {"ws": event.workspace_id, "actor": event.actor_id, "request": event.request_id}
    async with app.state.database.begin() as connection:
        await connection.execute(text("DELETE FROM documents.annotations WHERE workspace_id=:id"),
                                 {"id": event.workspace_id})
        await lock_workspace(connection, event.workspace_id)
        created = await connection.scalar(text("""
            INSERT INTO documents.workspace_deletions (workspace_id, actor_id, request_id)
            VALUES (:ws, :actor, :request) ON CONFLICT DO NOTHING RETURNING workspace_id
        """), params)
        if created:
            await connection.execute(text("""
                UPDATE documents.items SET state = 'deleting', cleanup_after = now(), cleanup_attempts = 0
                WHERE workspace_id = :ws AND state <> 'deleted'
            """), params)


async def cleanup_one() -> None:
    async with app.state.database.begin() as connection:
        result = await connection.execute(text("""
            SELECT workspace_id, document_id FROM documents.items
            WHERE (state = 'deleting' AND cleanup_attempts < 8 AND cleanup_after <= now())
               OR (state = 'uploading' AND updated_at < now() - interval '1 hour')
            ORDER BY cleanup_after LIMIT 1
        """))
        item = result.mappings().one_or_none()
        if item is not None:
            ws, did = item["workspace_id"], item["document_id"]
            await lock_workspace(connection, ws)
            state = (await connection.execute(text("""
                SELECT cleanup_attempts FROM documents.items WHERE document_id = :id
                AND ((state = 'deleting' AND cleanup_attempts < 8 AND cleanup_after <= now())
                 OR (state = 'uploading' AND updated_at < now() - interval '1 hour'))
            """), {"id": did})).one_or_none()
            if state is not None:
                try:
                    for is_preview in (False, True):
                        await run_in_threadpool(app.state.storage.remove_object, app.state.bucket, object_key(ws, did, is_preview))
                except Exception as exc:
                    attempts = state[0] + 1
                    LOG.warning("Document cleanup attempt %s for %s (%s)", attempts, did, type(exc).__name__)
                    await connection.execute(text("""
                        UPDATE documents.items SET state = 'deleting', cleanup_attempts = :attempts,
                            cleanup_after = now() + make_interval(secs => :delay) WHERE document_id = :id
                    """), {"id": did, "attempts": attempts, "delay": min(2 ** attempts, 60)})
                else:
                    await connection.execute(text("""
                        UPDATE documents.items SET state = 'deleted', updated_at = now(),
                            name = '', filename = '', sha256 = '', size_bytes = 0, preview_ready = false
                        WHERE document_id = :id
                    """), {"id": did})

        pending = (await connection.execute(text("""
            SELECT workspace_id, actor_id, request_id FROM documents.workspace_deletions AS d
            WHERE confirmed_at IS NULL AND NOT EXISTS (
                SELECT 1 FROM documents.items AS i WHERE i.workspace_id = d.workspace_id AND i.state <> 'deleted'
            )
            LIMIT 1 FOR UPDATE OF d SKIP LOCKED
        """))).mappings().one_or_none()
        if pending is not None:
            await enqueue(connection, "documents", event_type="workspace.documents_deleted.v1", **pending)
            await connection.execute(text("""
                UPDATE documents.workspace_deletions SET confirmed_at = now() WHERE workspace_id = :ws
            """), {"ws": pending["workspace_id"]})


async def cleanup_loop() -> None:
    while True:
        try:
            await cleanup_one()
        except Exception as exc:
            LOG.warning("Document cleanup could not progress (%s)", type(exc).__name__)
        await asyncio.sleep(0.5)


@app.get("/internal/v1/workspaces/{workspace_id}/retrieval-sources", include_in_schema=False)
async def retrieval_sources(workspace_id: UUID, request: Request) -> list[Document]:
    require_service(request, "X-Retrieval-Service-Token", os.environ["DOCUMENT_RETRIEVAL_TOKEN"])
    async with app.state.database.connect() as connection:
        result = await connection.execute(text(f"""
            SELECT {PUBLIC_FIELDS} FROM documents.items WHERE workspace_id = :ws AND state = 'ready'
        """), {"ws": workspace_id})
        return [Document.model_validate(row) for row in result.mappings()]

class AnnotationInput(BaseModel):
    page: int = Field(ge=1, le=100_000)
    body: str = Field(default="", max_length=3000)
    region: tuple[float, float, float, float] | None = None

    @model_validator(mode="after")
    def require_content(self):
        if not self.body.strip() and self.region is None:
            raise ValueError("Add a note or a highlight")
        if self.region:
            left, top, right, bottom = self.region
            if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
                raise ValueError("The region must be a valid normalized rectangle")
        return self


class AnnotationView(AnnotationInput):
    annotation_id: UUID
    created_at: datetime


ANNOTATIONS = BASE + "/{document_id}/annotations"


@app.get(ANNOTATIONS, response_model=list[AnnotationView])
async def list_annotations(workspace_id: UUID, document_id: UUID, request: Request):
    actor = await access(request, workspace_id)
    async with app.state.database.connect() as connection:
        await get_ready(connection, workspace_id, document_id)
        rows = await connection.execute(text("""
            SELECT annotation_id, page, body, region, created_at FROM documents.annotations
            WHERE workspace_id=:ws AND document_id=:doc AND user_id=:user ORDER BY page, created_at LIMIT 500
        """), {"ws": workspace_id, "doc": document_id, "user": actor.user_id})
        return [dict(row) for row in rows.mappings()]


@app.post(ANNOTATIONS, status_code=201, response_model=AnnotationView)
async def annotate(workspace_id: UUID, document_id: UUID, data: AnnotationInput, request: Request):
    actor = await access(request, workspace_id)
    async with app.state.database.begin() as connection:
        await require_open(connection, workspace_id)
        await get_ready(connection, workspace_id, document_id)
        result = await connection.execute(text("""
            INSERT INTO documents.annotations (annotation_id, workspace_id, document_id, user_id, page, body, region)
            VALUES (:id, :ws, :doc, :user, :page, :body, CAST(:region AS jsonb))
            RETURNING annotation_id, page, body, region, created_at
        """), {"id": uuid4(), "ws": workspace_id, "doc": document_id, "user": actor.user_id,
               "page": data.page, "body": data.body.strip(), "region": json.dumps(data.region)})
        return dict(result.mappings().one())


@app.delete(ANNOTATIONS + "/{annotation_id}", status_code=204)
async def remove_annotation(workspace_id: UUID, document_id: UUID, annotation_id: UUID, request: Request):
    actor = await access(request, workspace_id)
    async with app.state.database.begin() as connection:
        await get_ready(connection, workspace_id, document_id)
        await connection.execute(text("""
            DELETE FROM documents.annotations WHERE workspace_id=:ws AND document_id=:doc
                AND user_id=:user AND annotation_id=:id
        """), {"ws": workspace_id, "doc": document_id, "user": actor.user_id, "id": annotation_id})
    return Response(status_code=204)
