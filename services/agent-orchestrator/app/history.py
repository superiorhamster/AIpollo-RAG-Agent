"""Private, bounded Ask history shared by execution and legacy retries."""

import json
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


def input_limit() -> int:
    return min(32_000, max(4096, int(os.environ.get("RUN_MAX_INPUT_BYTES", "20000"))))


async def prior_history(connection: AsyncConnection, run: dict, max_input_bytes: int) -> list[dict[str, str]]:
    rows = await connection.execute(text("""
        SELECT input->>'query', jsonb_path_query_array(result, '$.claims[*].text'), result->>'tutor_question', run_id
        FROM orchestration.runs
        WHERE workspace_id=:workspace AND user_id=:user AND conversation_id=:conversation
          AND interaction='ASK' AND status='succeeded' AND created_at < :created AND run_id <> :run
        ORDER BY created_at DESC, run_id DESC LIMIT 6
    """), {"workspace": run["workspace_id"], "user": run["user_id"],
           "conversation": run["conversation_id"], "created": run["created_at"], "run": run["run_id"]})
    history = []
    for row in rows:
        question, answers, tutor_question = row[:3]
        turn = {"question": question, "answer": " ".join([*(answers or []), *([tutor_question] if tutor_question else [])])[:900]}
        if run.get("input", {}).get("learning"):
            turn["run_id"] = str(row[3])
        candidate = [turn, *history]
        if len(json.dumps(candidate, ensure_ascii=False).encode()) > min(4500, max_input_bytes // 3):
            break
        history = candidate
    return history


async def ordinary_learning_history(connection: AsyncConnection, run: dict, history: list[dict]) -> list[dict]:
    """Keep ordinary dialogue while withholding Plan-sourced replies from a different binding."""
    learning = run["input"].get("learning")
    if not learning or not history:
        return history
    identifiers = [turn["run_id"] for turn in history if turn.get("run_id")]
    if not identifiers:
        return history
    plan = learning["plan"]
    rows = await connection.execute(text("""
        SELECT run_id,
               jsonb_path_query_array(result, '$.claims[*] ? (!exists(@.source) || @.source != "plan").text'),
               result->>'tutor_question'
        FROM orchestration.runs
        WHERE workspace_id=:workspace AND user_id=:user AND conversation_id=:conversation
          AND run_id = ANY(CAST(:identifiers AS uuid[]))
          AND input#>>'{learning,plan,plan_id}' IS NOT NULL
          AND input#>>'{learning,plan,plan_id}' IS DISTINCT FROM :selected
          AND jsonb_path_exists(result, '$.claims[*] ? (@.source == "plan")')
    """), {"workspace": run["workspace_id"], "user": run["user_id"], "conversation": run["conversation_id"],
           "identifiers": identifiers, "selected": plan["plan_id"] if plan else None})
    safe_answers = {
        str(run_id): " ".join([*answers, *([question] if question else [])])[:900]
        for run_id, answers, question in rows
    }
    return [{**turn, "answer": safe_answers[turn["run_id"]]} if turn.get("run_id") in safe_answers else turn
            for turn in history]
