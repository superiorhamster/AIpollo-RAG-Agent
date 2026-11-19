import asyncio
import hmac
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI, Request, Response
from pydantic import BaseModel
from sqlalchemy import text

from rag_db import database_ready, install_database_errors, open_database
from rag_events import Event, run_broker
from rag_http import ApiError, health_response, install_http, require_service, unauthorized
from rag_index import ActiveIndex, GenerationSelection

from .indexing import IndexWorker

SERVICE = "ingestion-service"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
LOG = logging.getLogger(__name__)


class Job(BaseModel):
    job_id: UUID
    kind: Literal["index", "preview"]
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    attempts: int
    error_code: str | None
    updated_at: datetime


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.database = open_database()
    app.state.token = os.environ["DOCUMENT_INGESTION_TOKEN"]
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        app.state.client = client
        index = IndexWorker(app.state.database, client, app.state.token)
        tasks = (
            asyncio.create_task(run_broker(app.state.database, "ingestion.lifecycle", handle_event)),
            asyncio.create_task(preview_loop()),
            asyncio.create_task(index.index_loop()),
            asyncio.create_task(index.cleanup_loop()),
        )
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await app.state.database.dispose()


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None)
install_http(app)
install_database_errors(app)


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness() -> Response:
    return health_response(SERVICE, await database_ready(app.state.database, "ingestion", "ingestion_002"))


@app.get("/internal/v1/workspaces/{workspace_id}/documents/{document_id}/jobs", include_in_schema=False)
async def jobs(workspace_id: UUID, document_id: UUID, request: Request) -> list[Job]:
    if not hmac.compare_digest(request.headers.get("X-Ingestion-Service-Token", "").encode(),
                               app.state.token.encode()):
        raise unauthorized()
    async with app.state.database.connect() as connection:
        result = await connection.execute(text("""
            SELECT job_id, kind, status, attempts, error_code, updated_at
            FROM ingestion.jobs WHERE workspace_id = :ws AND document_id = :id ORDER BY kind
        """), {"ws": workspace_id, "id": document_id})
        return [Job.model_validate(row) for row in result.mappings()]


@app.post("/internal/v1/workspaces/{workspace_id}/active-indexes", include_in_schema=False)
async def active_indexes(workspace_id: UUID, selection: GenerationSelection, request: Request) -> list[ActiveIndex]:
    token = request.headers.get("X-Index-Service-Token", "").encode()
    if not hmac.compare_digest(token, os.environ["INGESTION_RETRIEVAL_TOKEN"].encode()):
        raise unauthorized()
    async with app.state.database.connect() as connection:
        result = await connection.execute(text("""
            SELECT document_id, index_generation
            FROM ingestion.jobs
            WHERE workspace_id = :workspace AND document_id = ANY(CAST(:documents AS uuid[]))
              AND kind = 'index' AND embedding_fingerprint = :fingerprint AND index_generation IS NOT NULL
        """), {"workspace": workspace_id, "documents": selection.document_ids, "fingerprint": selection.fingerprint})
        return [ActiveIndex.model_validate(row) for row in result.mappings()]


async def handle_event(event: Event) -> None:
    params = {"ws": event.workspace_id, "id": event.document_id, "request": event.request_id}
    async with app.state.database.begin() as connection:
        await connection.execute(text("""
            SELECT pg_advisory_xact_lock(hashtextextended(CAST(:ws AS text), 2003))
        """), params)
        if event.event_type == "workspace.deletion_requested.v1":
            await connection.execute(text("""
                INSERT INTO ingestion.cancelled_workspaces VALUES (:ws) ON CONFLICT DO NOTHING
            """), params)
            predicate = "workspace_id = :ws"
        elif event.event_type == "document.deletion_requested.v1" and event.document_id:
            await connection.execute(text("""
                INSERT INTO ingestion.cancelled_documents VALUES (:id) ON CONFLICT DO NOTHING
            """), params)
            predicate = "workspace_id = :ws AND document_id = :id"
        elif event.event_type == "document.uploaded.v1" and event.document_id:
            cancelled = await connection.scalar(text("""
                SELECT EXISTS (SELECT 1 FROM ingestion.cancelled_workspaces WHERE workspace_id = :ws)
                    OR EXISTS (SELECT 1 FROM ingestion.cancelled_documents WHERE document_id = :id)
            """), params)
            for kind in ("index", "preview") if event.media_type == DOCX else ("index",):
                await connection.execute(text("""
                    INSERT INTO ingestion.jobs (workspace_id, document_id, request_id, kind, status)
                    VALUES (:ws, :id, :request, :kind, :status)
                    ON CONFLICT (document_id, kind) DO NOTHING
                """), {**params, "kind": kind, "status": "cancelled" if cancelled else "queued"})
            return
        else:
            return
        await connection.execute(text(f"""
            UPDATE ingestion.jobs SET status = 'cancelled', lease_id = NULL, lease_until = NULL, updated_at = now()
            WHERE {predicate} AND status IN ('queued', 'running')
        """), params)
        await connection.execute(text(f"""
            UPDATE ingestion.jobs SET index_generation = NULL, embedding_fingerprint = NULL,
                status = 'cancelled', updated_at = now()
            WHERE {predicate} AND kind = 'index'
        """), params)
        await connection.execute(text("""
            INSERT INTO ingestion.index_cleanup (cleanup_id, workspace_id, document_id, request_id)
            VALUES (:event, :ws, :id, :request) ON CONFLICT DO NOTHING
        """), {**params, "event": event.event_id})


async def claim_preview():
    async with app.state.database.begin() as connection:
        await connection.execute(text("""
            UPDATE ingestion.jobs SET status = 'failed', lease_id = NULL, lease_until = NULL,
                error_code = 'worker_interrupted', updated_at = now()
            WHERE kind = 'preview' AND status = 'running' AND lease_until < now() AND attempts >= 3
        """))
        result = await connection.execute(text("""
            WITH candidate AS (
                SELECT job_id FROM ingestion.jobs
                WHERE kind = 'preview' AND attempts < 3 AND (
                    (status = 'queued' AND next_attempt <= now()) OR
                    (status = 'running' AND lease_until < now())
                ) ORDER BY next_attempt LIMIT 1 FOR UPDATE SKIP LOCKED
            )
            UPDATE ingestion.jobs AS j SET status = 'running', lease_id = :lease,
                lease_until = now() + interval '2 minutes', attempts = attempts + 1, updated_at = now()
            FROM candidate WHERE j.job_id = candidate.job_id
            RETURNING j.job_id, workspace_id, document_id, request_id, lease_id, attempts
        """), {"lease": uuid4()})
        return result.mappings().one_or_none()


async def convert(item) -> tuple[str, str | None]:
    base = f"http://document-service:8000/internal/v1/workspaces/{item['workspace_id']}/documents/{item['document_id']}"
    headers = {"X-Ingestion-Service-Token": app.state.token, "X-Request-ID": str(item["request_id"])}
    source = await app.state.client.get(base + "/original", headers=headers, timeout=25)
    if source.status_code == 404:
        return "cancelled", None
    source.raise_for_status()
    converted = await app.state.client.post(
        "http://document-converter:8000/convert", content=source.content, timeout=55,
        headers={"Content-Type": DOCX, "X-Request-ID": headers["X-Request-ID"]},
    )
    if converted.status_code in (413, 415, 422):
        return "failed", "conversion_failed"
    converted.raise_for_status()
    saved = await app.state.client.put(base + "/preview", headers=headers, content=converted.content, timeout=28)
    if saved.status_code == 404:
        return "cancelled", None
    saved.raise_for_status()
    return "succeeded", None


async def execute_preview(item) -> None:
    try:
        async with asyncio.timeout(105):
            status, error = await convert(item)
    except (httpx.HTTPError, TimeoutError):
        status, error = ("queued" if item["attempts"] < 3 else "failed"), "preview_dependency_unavailable"

    async with app.state.database.begin() as connection:
        await connection.execute(text("""
            UPDATE ingestion.jobs SET status = :status, error_code = :error,
                next_attempt = now() + make_interval(secs => :delay), lease_id = NULL,
                lease_until = NULL, updated_at = now()
            WHERE job_id = :id AND lease_id = :lease AND status = 'running'
        """), {"status": status, "error": error, "id": item["job_id"],
               "lease": item["lease_id"], "delay": 2 ** item["attempts"]})


async def preview_loop() -> None:
    while True:
        try:
            item = await claim_preview()
            if item is not None:
                await execute_preview(item)
        except Exception as exc:
            LOG.warning("Preview worker could not progress (%s)", type(exc).__name__)
        await asyncio.sleep(0.5)


@app.get("/internal/v1/admin/jobs", include_in_schema=False)
async def admin_jobs(request: Request):
    require_service(request, "X-Admin-Service-Token", os.environ["ADMIN_DOMAIN_TOKEN"])
    async with app.state.database.connect() as connection:
        rows = await connection.execute(text("""
            SELECT job_id, workspace_id, document_id, kind, status, attempts, error_code, updated_at
            FROM ingestion.jobs ORDER BY updated_at DESC LIMIT 150
        """))
        return [dict(row) for row in rows.mappings()]


@app.post("/internal/v1/admin/jobs/{job_id}/retry", status_code=204, include_in_schema=False)
async def admin_retry(job_id: UUID, request: Request):
    require_service(request, "X-Admin-Service-Token", os.environ["ADMIN_DOMAIN_TOKEN"])
    async with app.state.database.begin() as connection:
        selected = await connection.scalar(text("""
            UPDATE ingestion.jobs j SET status='queued', attempts=0, error_code=NULL,
                next_attempt=now(), updated_at=now()
            WHERE job_id=:id AND status='failed'
              AND NOT EXISTS (SELECT 1 FROM ingestion.cancelled_workspaces c WHERE c.workspace_id=j.workspace_id)
              AND NOT EXISTS (SELECT 1 FROM ingestion.cancelled_documents c WHERE c.document_id=j.document_id)
            RETURNING job_id
        """), {"id": job_id})
        if not selected:
            raise ApiError(409, "job_not_retryable", "Only failed jobs for active documents can be retried.")
    return Response(status_code=204)
