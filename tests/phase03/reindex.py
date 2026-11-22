"""Exercise model migration selection and publication against PostgreSQL."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from sqlalchemy import text

from app.indexing import FailedSource, IndexJob, IndexWorker, ParserBusy
from app.reindex import reindex
from rag_db import open_database
from rag_index import EmbeddingConfig, IndexBatch
from rag_index import IndexedChunk as Chunk

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

    async def test_generation_preserves_legacy_and_stores_stable_segment_ids(self):
        import hashlib
        import json
        from uuid import uuid5

        from app.indexing import INDEX_REVISION, citation_generation
        from rag_index import Segment, point_id, segment_id

        document = uuid4()
        fingerprint = "a" * 64
        chunk = Chunk(text="First. Second.", page=1)
        serialized = json.dumps([chunk.model_dump(mode="json", exclude={"citation_segments_v1"})], ensure_ascii=False)
        version = hashlib.sha256(serialized.encode()).hexdigest()
        expected = uuid5(document, f"{INDEX_REVISION}:{fingerprint}:{version}")
        self.assertEqual(citation_generation(document, fingerprint, [chunk])[0], expected)

        draft = chunk.model_copy(update={"citation_segments_v1": [
            Segment(start=0, end=6, page=1),
            Segment(start=7, end=14, page=1, ordinal=1),
        ]})
        generation, resolved = citation_generation(document, fingerprint, [draft])
        self.assertNotEqual(generation, expected)
        self.assertEqual(citation_generation(document, fingerprint, resolved)[0], generation)
        self.assertEqual([entry.id for entry in resolved[0].citation_segments_v1],
                         [segment_id(point_id(generation, 0), n) for n in range(2)])
        self.assertEqual(resolved[0].text, chunk.text)

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

    async def running(self):
        identifier = await self.seed()
        row = await self.stored(identifier)
        lease = uuid4()
        async with self.database.begin() as connection:
            await connection.execute(text("UPDATE ingestion.jobs SET status='running',attempts=1,lease_id=:lease,lease_until=now()+interval '1 hour' WHERE job_id=:job"),
                                     {"lease": lease, "job": identifier})
        return IndexJob(identifier, self.workspace, row['document_id'], uuid4(), lease, 1)

    async def test_cpu_batch_preserves_ordinals_and_atomic_publication(self):
        job = await self.running()
        batches = []
        def upstream(request):
            import json
            data = json.loads(request.content)
            if request.url.host == 'model-gateway':
                self.assertEqual(len(data['texts']), 1)
                self.assertEqual(request.extensions['timeout']['read'], 75)
                return httpx.Response(200, json={'vectors': [[1., 2., 3.]]})
            batches.append(data)
            return httpx.Response(204)
        with patch.dict('os.environ', {'INGESTION_EMBED_BATCH_SIZE': '1', 'MODEL_EMBEDDING_TOKEN': 'fixture', 'INGESTION_RETRIEVAL_TOKEN': 'fixture'}):
            async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
                worker = IndexWorker(self.database, client, 'fixture')
                worker.read_chunks = AsyncMock(return_value=[Chunk(text=f'Tài liệu {i}', page=i) for i in (1, 2, 3)])
                await worker.run(job, EmbeddingConfig(fingerprint=NEW, dimensions=3))
        self.assertEqual([batch['offset'] for batch in batches], [0, 1, 2])
        row = await self.stored(job.job_id)
        self.assertEqual((row['status'], row['embedding_fingerprint']), ('succeeded', NEW))

    async def test_parser_timeout_is_terminal_and_busy_is_bounded_retry(self):
        for failure, expected in ((FailedSource('parse_timeout'), 'failed'), (ParserBusy(20), 'queued')):
            job = await self.running()
            original = await self.stored(job.job_id)
            with patch.dict('os.environ', {'MODEL_EMBEDDING_TOKEN': 'fixture', 'INGESTION_RETRIEVAL_TOKEN': 'fixture'}):
                async with httpx.AsyncClient() as client:
                    worker = IndexWorker(self.database, client, 'fixture')
                    worker.read_chunks = AsyncMock(side_effect=failure)
                    await worker.run(job, EmbeddingConfig(fingerprint=NEW, dimensions=3))
            saved = await self.stored(job.job_id)
            self.assertEqual(saved['status'], expected)
            self.assertEqual(saved['index_generation'], original['index_generation'])
            self.assertEqual(saved['embedding_fingerprint'], original['embedding_fingerprint'])
            self.assertEqual(saved['attempts'], 1)

    async def test_shutdown_releases_only_the_owned_lease_without_losing_publication(self):
        job = await self.running()
        before = await self.stored(job.job_id)
        entered = asyncio.Event()
        async def pending(_job):
            entered.set()
            await asyncio.Future()
        with patch.dict('os.environ', {'MODEL_EMBEDDING_TOKEN': 'fixture', 'INGESTION_RETRIEVAL_TOKEN': 'fixture'}):
            async with httpx.AsyncClient() as client:
                worker = IndexWorker(self.database, client, 'fixture')
                worker.read_chunks = pending
                task = asyncio.create_task(worker.run(job, EmbeddingConfig(fingerprint=NEW, dimensions=3)))
                await entered.wait()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                saved = await self.stored(job.job_id)
                self.assertEqual((saved['status'], saved['attempts']), ('queued', 0))
                self.assertEqual(saved['index_generation'], before['index_generation'])
                async with self.database.begin() as connection:
                    await connection.execute(text("UPDATE ingestion.jobs SET status='cancelled', lease_id=NULL WHERE job_id=:job"), {'job': job.job_id})
                await worker.release(job)
                self.assertEqual((await self.stored(job.job_id))['status'], 'cancelled')


if __name__ == "__main__":
    unittest.main()
