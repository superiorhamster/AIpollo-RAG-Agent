"""Requeue exhausted object cleanup after restoring storage connectivity."""

import argparse
import asyncio
from uuid import UUID

from sqlalchemy import text

from rag_db import open_database


async def retry(workspace_id: UUID) -> None:
    engine = open_database()
    try:
        async with engine.begin() as connection:
            await connection.execute(text("""
                SELECT pg_advisory_xact_lock(hashtextextended(CAST(:ws AS text), 2002))
            """), {"ws": workspace_id})
            result = await connection.execute(text("""
                UPDATE documents.items SET cleanup_attempts = 0, cleanup_after = now()
                WHERE workspace_id = :ws AND state = 'deleting' AND cleanup_attempts >= 8
            """), {"ws": workspace_id})
            print(f"Requeued {result.rowcount} document cleanup task(s).")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace_id", type=UUID)
    asyncio.run(retry(parser.parse_args().workspace_id))
