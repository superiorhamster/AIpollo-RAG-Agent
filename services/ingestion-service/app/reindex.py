"""Queue all existing sources on a restore rehearsal stack before model cutover."""

import asyncio

from sqlalchemy import text

from rag_db import open_database


async def queue_existing() -> None:
    database = open_database()
    try:
        async with database.begin() as connection:
            changed = await connection.execute(text("""
                UPDATE ingestion.jobs AS j
                SET status='queued', attempts=0, next_attempt=now(), error_code=NULL, updated_at=now()
                WHERE kind='index' AND status IN ('succeeded', 'failed')
                  AND NOT EXISTS (SELECT 1 FROM ingestion.cancelled_workspaces c WHERE c.workspace_id=j.workspace_id)
                  AND NOT EXISTS (SELECT 1 FROM ingestion.cancelled_documents c WHERE c.document_id=j.document_id)
            """))
        print(f"Queued {changed.rowcount} documents.")
    finally:
        await database.dispose()


if __name__ == "__main__":
    asyncio.run(queue_existing())
