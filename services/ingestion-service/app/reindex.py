"""Requeue active documents for the configured model without deleting published indexes."""

import argparse
import asyncio
import json
import os
from uuid import UUID

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from rag_db import open_database
from rag_index import EmbeddingConfig

ELIGIBLE = """
    kind = 'index' AND status IN ('succeeded', 'failed')
    AND (status = 'failed' OR embedding_fingerprint IS DISTINCT FROM :fingerprint)
    AND NOT EXISTS (SELECT 1 FROM ingestion.cancelled_workspaces c WHERE c.workspace_id = jobs.workspace_id)
    AND NOT EXISTS (SELECT 1 FROM ingestion.cancelled_documents c WHERE c.document_id = jobs.document_id)
"""


async def reindex(database: AsyncEngine, fingerprint: str, *, apply: bool = False,
                  workspace: UUID | None = None) -> list[dict]:
    params = {"fingerprint": fingerprint, "workspace": workspace}
    selected = []
    async with database.connect() as connection:
        rows = await connection.execute(text("SELECT DISTINCT workspace_id FROM ingestion.jobs WHERE " + ELIGIBLE
                                             + " AND (CAST(:workspace AS uuid) IS NULL OR workspace_id=CAST(:workspace AS uuid))"), params)
        workspaces = rows.scalars().all()
    for workspace_id in workspaces:
        async with database.begin() as connection:
            # Match lifecycle deletion and publication lock ordering, then lock eligible jobs.
            await connection.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(CAST(:workspace AS text), 2003))"),
                                     {"workspace": workspace_id})
            rows = await connection.execute(text("SELECT job_id, workspace_id, status FROM ingestion.jobs WHERE "
                                                 + ELIGIBLE + " AND workspace_id=:workspace FOR UPDATE SKIP LOCKED"),
                                            {**params, "workspace": workspace_id})
            jobs = [dict(row) for row in rows.mappings()]
            if apply and jobs:
                await connection.execute(text("""
                    UPDATE ingestion.jobs SET status='queued', attempts=0, next_attempt=now(),
                        lease_id=NULL, lease_until=NULL, error_code=NULL, request_id=gen_random_uuid(), updated_at=now()
                    WHERE job_id=ANY(CAST(:jobs AS uuid[]))
                """), {"jobs": [job["job_id"] for job in jobs]})
            selected.extend(jobs)
    return selected


async def run(apply: bool, workspace: UUID | None) -> None:
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        response = await client.get("http://model-gateway:8000/internal/v1/embedding-config",
                                    headers={"X-Embedding-Service-Token": os.environ["MODEL_EMBEDDING_TOKEN"]})
        response.raise_for_status()
        config = EmbeddingConfig.model_validate_json(response.content)
    database = open_database()
    try:
        jobs = await reindex(database, config.fingerprint, apply=apply, workspace=workspace)
        print(json.dumps({"apply": apply, "fingerprint": config.fingerprint,
                          "eligible_jobs": len(jobs), "workspaces": len({j["workspace_id"] for j in jobs})}))
    finally:
        await database.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Requeue jobs; default is dry run")
    parser.add_argument("--workspace", type=UUID, help="Limit to one workspace; default is all active workspaces")
    args = parser.parse_args()
    asyncio.run(run(args.apply, args.workspace))
