"""Private, bounded Ask history shared by execution and legacy retries."""

import json
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


def input_limit() -> int:
    return min(32_000, max(4096, int(os.environ.get("RUN_MAX_INPUT_BYTES", "20000"))))


async def prior_history(connection: AsyncConnection, run: dict, max_input_bytes: int) -> list[dict[str, str]]:
    rows = await connection.execute(text("""
        SELECT input->>'query', jsonb_path_query_array(result, '$.claims[*].text'), result->>'tutor_question'
        FROM orchestration.runs
        WHERE workspace_id=:workspace AND user_id=:user AND conversation_id=:conversation
          AND interaction='ASK' AND status='succeeded' AND created_at < :created AND run_id <> :run
        ORDER BY created_at DESC, run_id DESC LIMIT 6
    """), {"workspace": run["workspace_id"], "user": run["user_id"],
           "conversation": run["conversation_id"], "created": run["created_at"], "run": run["run_id"]})
    history = []
    for question, answers, tutor_question in rows:
        turn = {"question": question, "answer": " ".join([*(answers or []), *([tutor_question] if tutor_question else [])])[:900]}
        candidate = [turn, *history]
        if len(json.dumps(candidate, ensure_ascii=False).encode()) > min(4500, max_input_bytes // 3):
            break
        history = candidate
    return history
