"""Drive the durable index jobs created by Phase 02."""

import asyncio
import hashlib
import json
import logging
import os
from dataclasses import dataclass
from uuid import UUID, uuid4, uuid5

import httpx
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from rag_telemetry import operation
from rag_index import EMBED_BATCH, MAX_CHUNKS, MAX_PDF_BYTES, Chunk, EmbeddingConfig, EmbeddingResult, IndexBatch

LOG = logging.getLogger(__name__)
INDEX_REVISION = "docling-2.150.1-page-v1"
chunk_list = TypeAdapter(list[Chunk])


class FailedSource(Exception):
    def __init__(self, code: str):
        self.code = code


class RemovedSource(Exception):
    pass


class MissingModel(Exception):
    pass


@dataclass(frozen=True)
class IndexJob:
    job_id: UUID
    workspace_id: UUID
    document_id: UUID
    request_id: UUID
    lease_id: UUID
    attempts: int


class IndexWorker:
    def __init__(self, database: AsyncEngine, client: httpx.AsyncClient, document_token: str):
        self.database = database
        self.client = client
        self.document_token = document_token
        self.embedding_token = os.environ["MODEL_EMBEDDING_TOKEN"]
        self.index_token = os.environ["INGESTION_RETRIEVAL_TOKEN"]

    async def embedding_config(self) -> EmbeddingConfig | None:
        response = await self.client.get("http://model-gateway:8000/internal/v1/embedding-config",
                                         headers={"X-Embedding-Service-Token": self.embedding_token})
        if response.status_code == 503:
            return None
        response.raise_for_status()
        return EmbeddingConfig.model_validate_json(response.content)

    async def claim(self) -> IndexJob | None:
        async with self.database.begin() as connection:
            await connection.execute(text("""
                UPDATE ingestion.jobs SET status = 'failed', error_code = 'preview_failed', updated_at = now()
                WHERE kind = 'index' AND status = 'queued' AND EXISTS (
                    SELECT 1 FROM ingestion.jobs p WHERE p.document_id = jobs.document_id
                        AND p.kind = 'preview' AND p.status = 'failed'
                )
            """))
            await connection.execute(text("""
                UPDATE ingestion.jobs SET status = 'failed', error_code = 'worker_interrupted',
                    lease_id = NULL, lease_until = NULL, updated_at = now()
                WHERE kind = 'index' AND status = 'running' AND lease_until < now() AND attempts >= 3
            """))
            result = await connection.execute(text("""
                WITH candidate AS (
                    SELECT j.job_id FROM ingestion.jobs j
                    WHERE j.kind = 'index' AND j.attempts < 3 AND (
                        (j.status = 'queued' AND j.next_attempt <= now()) OR
                        (j.status = 'running' AND j.lease_until < now())
                    ) AND NOT EXISTS (
                        SELECT 1 FROM ingestion.jobs p WHERE p.document_id = j.document_id
                            AND p.kind = 'preview' AND p.status <> 'succeeded'
                    ) ORDER BY j.next_attempt, j.job_id LIMIT 1 FOR UPDATE SKIP LOCKED
                )
                UPDATE ingestion.jobs j SET status = 'running', lease_id = :lease, error_code = NULL,
                    lease_until = now() + interval '6 minutes', attempts = j.attempts + 1, updated_at = now()
                FROM candidate WHERE j.job_id = candidate.job_id
                RETURNING j.job_id, j.workspace_id, j.document_id, j.request_id, j.lease_id, j.attempts
            """), {"lease": uuid4()})
            selected = result.mappings().one_or_none()
            return IndexJob(**selected) if selected else None

    async def read_chunks(self, job: IndexJob) -> list[Chunk]:
        request_headers = {"X-Request-ID": str(job.request_id)}
        document_headers = {**request_headers, "X-Ingestion-Service-Token": self.document_token}
        url = (
            f"http://document-service:8000/internal/v1/workspaces/{job.workspace_id}"
            f"/documents/{job.document_id}/index-source"
        )
        async with self.client.stream("GET", url, headers=document_headers, timeout=30) as source:
            if source.status_code == 404:
                raise RemovedSource
            source.raise_for_status()
            data = bytearray()
            async for piece in source.aiter_bytes():
                if len(data) + len(piece) > MAX_PDF_BYTES:
                    raise FailedSource("file_too_large")
                data.extend(piece)
        parsed = await self.client.post(
            "http://document-parser:8000/internal/v1/parse", content=bytes(data), timeout=130,
            headers={**request_headers, "Content-Type": "application/pdf"},
        )
        if parsed.status_code in (413, 415, 422):
            code = parsed.json().get("code")
            accepted = ("no_text", "too_many_chunks", "file_too_large")
            raise FailedSource(code if code in accepted else "parse_failed")
        parsed.raise_for_status()
        chunks = chunk_list.validate_json(parsed.content)
        if not chunks or len(chunks) > MAX_CHUNKS:
            raise FailedSource("parse_failed")
        return chunks

    async def embed(self, job: IndexJob, config: EmbeddingConfig, texts: list[str]) -> list[list[float]]:
        response = await self.client.post(
            "http://model-gateway:8000/internal/v1/embeddings", timeout=30,
            headers={"X-Embedding-Service-Token": self.embedding_token, "X-Request-ID": str(job.request_id)},
            json={"texts": texts, "fingerprint": config.fingerprint},
        )
        if response.status_code == 409 or (
            response.status_code == 503 and response.json().get("code") == "model_unavailable"
        ):
            raise MissingModel
        response.raise_for_status()
        vectors = EmbeddingResult.model_validate_json(response.content).vectors
        if len(vectors) != len(texts) or any(len(vector) != config.dimensions for vector in vectors):
            raise FailedSource("invalid_embedding")
        return vectors

    async def publish(self, job: IndexJob, batch: IndexBatch, final: bool) -> None:
        async with self.database.begin() as connection:
            await connection.execute(text("""
                SELECT pg_advisory_xact_lock(hashtextextended(CAST(:workspace AS text), 2003))
            """), {"workspace": job.workspace_id})
            active = await connection.scalar(text("""
                SELECT job_id FROM ingestion.jobs
                WHERE job_id = :job AND lease_id = :lease AND status = 'running' AND lease_until > now()
                FOR UPDATE
            """), {"job": job.job_id, "lease": job.lease_id})
            if not active:
                raise RemovedSource
            response = await self.client.put(
                f"http://retrieval-service:8000/internal/v1/workspaces/{job.workspace_id}"
                f"/documents/{job.document_id}/index-batch",
                headers={"X-Index-Service-Token": self.index_token, "X-Request-ID": str(job.request_id)},
                json=batch.model_dump(mode="json"), timeout=30,
            )
            response.raise_for_status()
            if final:
                await connection.execute(text("""
                    UPDATE ingestion.jobs SET status = 'succeeded', index_generation = :generation,
                        embedding_fingerprint = :fingerprint, updated_at = now(), error_code = NULL,
                        lease_id = NULL, lease_until = NULL
                    WHERE job_id = :job
                """), {"job": job.job_id, "generation": batch.generation, "fingerprint": batch.config.fingerprint})

    async def run(self, job: IndexJob, config: EmbeddingConfig) -> None:
        try:
            async with asyncio.timeout(330):
                chunks = await self.read_chunks(job)
                serialized = json.dumps([chunk.model_dump(mode="json") for chunk in chunks], ensure_ascii=False)
                version = hashlib.sha256(serialized.encode()).hexdigest()
                generation = uuid5(job.document_id, f"{INDEX_REVISION}:{config.fingerprint}:{version}")
                for offset in range(0, len(chunks), EMBED_BATCH):
                    selected = chunks[offset:offset + EMBED_BATCH]
                    texts = [f"{chunk.section}\n{chunk.text}"[:1800] if chunk.section else chunk.text
                             for chunk in selected]
                    vectors = await self.embed(job, config, texts)
                    batch = IndexBatch(config=config, generation=generation, offset=offset, chunks=selected,
                                       vectors=vectors)
                    await self.publish(job, batch, offset + len(selected) == len(chunks))
            return
        except RemovedSource:
            status, code, delay, restore_attempt = "cancelled", None, 0, False
        except MissingModel:
            status, code, delay, restore_attempt = "queued", "model_unavailable", 60, True
        except FailedSource as exc:
            status, code, delay, restore_attempt = "failed", exc.code, 0, False
        except (httpx.HTTPError, ValidationError, TimeoutError, ValueError):
            status = "queued" if job.attempts < 3 else "failed"
            code, delay, restore_attempt = "index_dependency_unavailable", 4 ** job.attempts, False

        async with self.database.begin() as connection:
            await connection.execute(text("""
                UPDATE ingestion.jobs SET status = :status, error_code = :error,
                    attempts = attempts - :restore_attempt, next_attempt = now() + make_interval(secs => :delay),
                    lease_id = NULL, lease_until = NULL, updated_at = now()
                WHERE job_id = :job AND lease_id = :lease AND status = 'running'
            """), {"status": status, "error": code, "restore_attempt": int(restore_attempt),
                   "delay": delay, "job": job.job_id, "lease": job.lease_id})

    async def index_loop(self) -> None:
        while True:
            delay = 1
            try:
                config = await self.embedding_config()
                if config is None:
                    delay = 5
                else:
                    job = await self.claim()
                    if job is not None:
                        with operation("ingestion.index", str(job.request_id)):
                            await self.run(job, config)
            except Exception as exc:
                LOG.warning("Index worker could not progress (%s)", type(exc).__name__)
            await asyncio.sleep(delay)

    async def cleanup_one(self) -> None:
        async with self.database.begin() as connection:
            result = await connection.execute(text("""
                SELECT cleanup_id, workspace_id, document_id, request_id, attempts
                FROM ingestion.index_cleanup
                WHERE attempts < 8 AND next_attempt <= now()
                ORDER BY next_attempt, cleanup_id LIMIT 1 FOR UPDATE SKIP LOCKED
            """))
            item = result.mappings().one_or_none()
            if item is None:
                return
            path = f"/internal/v1/workspaces/{item['workspace_id']}"
            if item["document_id"]:
                path += f"/documents/{item['document_id']}"
            try:
                response = await self.client.delete(
                    "http://retrieval-service:8000" + path + "/index", timeout=45,
                    headers={"X-Index-Service-Token": self.index_token, "X-Request-ID": str(item["request_id"])},
                )
                response.raise_for_status()
            except httpx.HTTPError:
                attempts = item["attempts"] + 1
                await connection.execute(text("""
                    UPDATE ingestion.index_cleanup SET attempts = :attempts,
                        next_attempt = now() + make_interval(secs => :delay) WHERE cleanup_id = :id
                """), {"attempts": attempts, "delay": min(2 ** attempts, 300), "id": item["cleanup_id"]})
            else:
                await connection.execute(text("DELETE FROM ingestion.index_cleanup WHERE cleanup_id = :id"),
                                         {"id": item["cleanup_id"]})

    async def cleanup_loop(self) -> None:
        while True:
            try:
                await self.cleanup_one()
            except Exception as exc:
                LOG.warning("Index cleanup could not progress (%s)", type(exc).__name__)
            await asyncio.sleep(1)
