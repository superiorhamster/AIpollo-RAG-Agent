"""Exercise model migration selection and publication against PostgreSQL."""

import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from sqlalchemy import text

from app.indexing import IndexJob, IndexWorker
from app.reindex import reindex
from rag_db import open_database
from rag_index import Chunk, EmbeddingConfig, IndexBatch

OLD, NEW = "a" * 64, "b" * 64


class Reindex(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.database = open_database()
        self.workspace = uuid4()

    async def asyncTearDown(self):
        await self.database.dispose()

    async def seed(self, *, status="succeeded", fingerprint=OLD, kind="index", deleted=False):
        job, document, generation = uuid4(), uuid4(), uuid4()
        async with self.database.begin() as connection:
            await connection.execute(text("""
                INSERT INTO ingestion.jobs (job_id, workspace_id, document_id, request_id,
                    kind, status, attempts, embedding_fingerprint, index_generation)
                VALUES (:id,:workspace,:document,:request,:kind,:status,3,:fingerprint,:generation)
            """), {"id": job, "workspace": self.workspace, "document": document, "request": uuid4(),
                   "kind": kind, "status": status, "fingerprint": fingerprint, "generation": generation})
            if deleted:
                await connection.execute(text("INSERT INTO ingestion.cancelled_documents VALUES (:document)"),
                                         {"document": document})
        return job

    async def stored(self, job):
        async with self.database.connect() as connection:
            rows = await connection.execute(text("SELECT * FROM ingestion.jobs WHERE job_id=:id"), {"id": job})
            return dict(rows.mappings().one())

    async def test_dry_run_selection_apply_and_idempotency(self):
        old = await self.seed()
        failed = await self.seed(status="failed", fingerprint=NEW)
        for options in ({"status": "running"}, {"status": "queued"}, {"status": "cancelled"},
                        {"fingerprint": NEW}, {"deleted": True}, {"kind": "preview"}):
            await self.seed(**options)
        before = await self.stored(old)
        eligible = await reindex(self.database, NEW, workspace=self.workspace)
        self.assertEqual({j["job_id"] for j in eligible}, {old, failed})
        self.assertTrue({old, failed}.issubset({j["job_id"] for j in await reindex(self.database, NEW)}))
        self.assertEqual(await self.stored(old), before)
        eligible = await reindex(self.database, NEW, workspace=self.workspace, apply=True)
        self.assertEqual({j["job_id"] for j in eligible}, {old, failed})
        current = await self.stored(old)
        self.assertEqual((current["status"], current["attempts"]), ("queued", 0))
        self.assertEqual(current["index_generation"], before["index_generation"])
        self.assertEqual(current["embedding_fingerprint"], OLD)
        self.assertEqual(await reindex(self.database, NEW, workspace=self.workspace, apply=True), [])

    async def test_cancelled_workspace_and_workspace_scope(self):
        await self.seed()
        self.assertEqual(await reindex(self.database, NEW, workspace=uuid4(), apply=True), [])
        async with self.database.begin() as connection:
            await connection.execute(text("INSERT INTO ingestion.cancelled_workspaces VALUES (:workspace)"),
                                     {"workspace": self.workspace})
        self.assertEqual(await reindex(self.database, NEW, workspace=self.workspace, apply=True), [])

    async def test_only_successful_final_publication_replaces_generation(self):
        job = await self.seed()
        original = await self.stored(job)
        await reindex(self.database, NEW, workspace=self.workspace, apply=True)
        lease, generation = uuid4(), uuid4()
        async with self.database.begin() as connection:
            await connection.execute(text("""
                UPDATE ingestion.jobs SET status='running', lease_id=:lease,
                    lease_until=now()+interval '6 minutes' WHERE job_id=:job
            """), {"job": job, "lease": lease})
        batch = IndexBatch(config=EmbeddingConfig(fingerprint=NEW, dimensions=3), generation=generation,
                           offset=0, chunks=[Chunk(text="Tài liệu tiếng Việt.", page=1)], vectors=[[1., 2., 3.]])
        index_job = IndexJob(job, self.workspace, original["document_id"], uuid4(), lease, 1)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
            with patch.dict("os.environ", {"MODEL_EMBEDDING_TOKEN": "fixture", "INGESTION_RETRIEVAL_TOKEN": "fixture"}):
                worker = IndexWorker(self.database, client, "fixture")
            await worker.publish(index_job, batch, False)
            row = await self.stored(job)
            self.assertEqual((row["index_generation"], row["embedding_fingerprint"]),
                             (original["index_generation"], OLD))
            await worker.publish(index_job, batch, True)
            row = await self.stored(job)
            self.assertEqual((row["status"], row["index_generation"], row["embedding_fingerprint"]),
                             ("succeeded", generation, NEW))


if __name__ == "__main__":
    unittest.main()
