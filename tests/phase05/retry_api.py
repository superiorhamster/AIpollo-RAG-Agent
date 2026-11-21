"""Verify retry authorization, immutable context and idempotency against PostgreSQL."""

import asyncio
import hashlib
import json
import os
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
from sqlalchemy import text

from app.main import app, actor
from app.worker import ASK_COMPLETION_UNAVAILABLE, Worker
from rag_db import open_database


class RetryApi(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.database = open_database()
        app.state.database = self.database
        self.workspace, self.user, self.conversation = uuid4(), uuid4(), uuid4()
        self.objective = dict(query="Phòng đó cần adapter gì?", document_ids=[str(uuid4())],
                              capability="LEARN", task="answer")
        app.dependency_overrides[actor] = lambda: self.user
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://review")
        self.route = f"/v1/workspaces/{self.workspace}/runs"

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        await self.database.dispose()

    async def seed(self, *, snapshot=None, status="failed", error=ASK_COMPLETION_UNAVAILABLE,
                   objective=None, created=None, interaction="ASK", result=None):
        run_id = uuid4()
        async with self.database.begin() as connection:
            await connection.execute(text("""
                INSERT INTO orchestration.conversations (conversation_id, workspace_id, user_id)
                VALUES (:id,:workspace,:user) ON CONFLICT DO NOTHING
            """), {"id": self.conversation, "workspace": self.workspace, "user": self.user})
            await connection.execute(text("""
                INSERT INTO orchestration.runs (run_id, workspace_id, user_id, interaction, input,
                    conversation_id, request_id, request_key, request_hash, status, error_code,
                    history_snapshot, created_at, result)
                VALUES (:id,:workspace,:user,:mode,CAST(:input AS jsonb),:conversation,:request,:key,
                    'fixture',:status,:error,CAST(:history AS jsonb),:created,CAST(:result AS jsonb))
            """), {"id": run_id, "workspace": self.workspace, "user": self.user, "mode": interaction,
                   "input": json.dumps(objective or self.objective), "conversation": self.conversation,
                   "request": uuid4(), "key": uuid4(), "status": status, "error": error,
                   "history": json.dumps(snapshot) if snapshot is not None else None,
                   "created": created or datetime.now(timezone.utc), "result": json.dumps(result)})
        return run_id

    async def retry(self, original, *, body=None, key=None, route=None):
        return await self.client.post(route or self.route, headers={"Idempotency-Key": str(key or uuid4())},
                                      json=body or {"mode": "ASK", "objective": self.objective,
                                          "conversation_id": str(self.conversation), "retry_of_run_id": str(original)})

    async def stored(self, run_id):
        async with self.database.connect() as connection:
            rows = await connection.execute(text("SELECT * FROM orchestration.runs WHERE run_id=:id"),
                                            {"id": run_id})
            return dict(rows.mappings().one())

    async def test_later_turns_and_repeated_retries_preserve_snapshot(self):
        history = [{"question": "Nói về phòng B4-201.", "answer": "Phòng B4-201."}]
        original = await self.seed(snapshot=history)
        await self.seed(status="succeeded", error=None, objective={**self.objective, "query": "Phòng B2-302?"},
                        result={"claims": [{"text": "Phòng B2-302."}]})
        response = await self.retry(original)
        self.assertEqual(response.status_code, 202, response.text)
        fresh = response.json()
        self.assertEqual(fresh["retry_of_run_id"], str(original))
        self.assertNotIn("history_snapshot", fresh)
        self.assertEqual((await self.stored(fresh["run_id"]))["history_snapshot"], history)
        async with self.database.begin() as connection:
            await connection.execute(text("""
                UPDATE orchestration.runs SET status='failed', error_code=:error WHERE run_id=:id
            """), {"id": fresh["run_id"], "error": ASK_COMPLETION_UNAVAILABLE})
        repeated = await self.retry(fresh["run_id"])
        self.assertEqual(repeated.status_code, 202, repeated.text)
        self.assertEqual((await self.stored(repeated.json()["run_id"]))["history_snapshot"], history)

    async def test_legacy_cutoff_and_empty_snapshot(self):
        now = datetime.now(timezone.utc)
        await self.seed(status="succeeded", error=None, created=now - timedelta(seconds=3),
                        objective={**self.objective, "query": "B4-201?"}, result={"claims": [{"text": "B4-201."}]})
        legacy = await self.seed(created=now - timedelta(seconds=2))
        await self.seed(status="succeeded", error=None, created=now - timedelta(seconds=1),
                        objective={**self.objective, "query": "B2-302?"}, result={"claims": [{"text": "B2-302."}]})
        response = await self.retry(legacy)
        self.assertEqual(response.status_code, 202, response.text)
        expected = [{"question": "B4-201?", "answer": "B4-201."}]
        self.assertEqual((await self.stored(legacy))["history_snapshot"], expected)
        self.assertEqual((await self.stored(response.json()["run_id"]))["history_snapshot"], expected)
        empty = await self.seed(snapshot=[])
        response = await self.retry(empty)
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual((await self.stored(response.json()["run_id"]))["history_snapshot"], [])

    async def test_missing_cross_user_cross_workspace_and_unauthorized(self):
        original = await self.seed(snapshot=[])
        self.assertEqual((await self.retry(uuid4())).status_code, 404)
        self.assertEqual((await self.retry(original, route=f"/v1/workspaces/{uuid4()}/runs")).status_code, 404)
        app.dependency_overrides[actor] = lambda: uuid4()
        self.assertEqual((await self.retry(original)).status_code, 404)
        app.dependency_overrides.clear()
        self.assertEqual((await self.retry(original)).status_code, 401)

    async def test_rejects_ineligible_runs_and_context_changes(self):
        for changes in ({"status": "succeeded"}, {"status": "cancelled"}, {"status": "running"},
                        {"error": "time_limit"}, {"interaction": "AGENT"}):
            with self.subTest(changes=changes):
                original = await self.seed(snapshot=[] if changes.get("interaction") != "AGENT" else None, **changes)
                self.assertEqual((await self.retry(original)).status_code, 409)
        original = await self.seed(snapshot=[])
        base = {"mode": "ASK", "objective": self.objective, "conversation_id": str(self.conversation),
                "retry_of_run_id": str(original)}
        for body in ({**base, "objective": {**self.objective, "query": "A different question"}},
                     {**base, "objective": {**self.objective, "document_ids": [str(uuid4())]}},
                     {**base, "conversation_id": str(uuid4())}):
            self.assertEqual((await self.retry(original, body=body)).status_code, 409)
        self.assertEqual((await self.retry(original, body={**base, "mode": "AGENT"})).status_code, 422)

    async def test_idempotent_replay_and_conflict(self):
        original = await self.seed(snapshot=[])
        key = uuid4()
        first, second = await self.retry(original, key=key), await self.retry(original, key=key)
        self.assertEqual(first.status_code, 202, first.text)
        self.assertEqual(first.json()["run_id"], second.json()["run_id"])
        different = await self.seed(snapshot=[])
        self.assertEqual((await self.retry(different, key=key)).status_code, 409)

    async def test_concurrent_replay_creates_one_run(self):
        original, key = await self.seed(snapshot=[]), uuid4()
        responses = await asyncio.gather(*(self.retry(original, key=key) for _ in range(2)))
        self.assertEqual([r.status_code for r in responses], [202, 202])
        self.assertEqual(responses[0].json()["run_id"], responses[1].json()["run_id"])

    async def test_pre_migration_request_hash_still_replays(self):
        original, key = await self.seed(snapshot=[]), uuid4()
        # Exact pre-retry StartRun serialization, including its original null fields.
        old_objective = {"document_ids": self.objective["document_ids"], "query": self.objective["query"],
                         "capability": "LEARN", "task": "answer"}
        old_payload = json.dumps({"mode": "ASK", "objective": old_objective, "plan_id": None,
                                  "plan_version": None, "conversation_id": str(self.conversation)},
                                 ensure_ascii=False, separators=(",", ":"))
        async with self.database.begin() as connection:
            await connection.execute(text("UPDATE orchestration.runs SET request_key=:key, request_hash=:hash WHERE run_id=:id"),
                                     {"key": key, "hash": hashlib.sha256(old_payload.encode()).hexdigest(), "id": original})
        response = await self.client.post(self.route, headers={"Idempotency-Key": str(key)},
                                          json={"mode": "ASK", "objective": self.objective,
                                                "conversation_id": str(self.conversation)})
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(response.json()["run_id"], str(original))

    async def test_plan_approval_and_version_invariants_survive_migration(self):
        plans = f"/v1/workspaces/{self.workspace}/plans"
        response = await self.client.post(plans, json=self.objective, headers={"Idempotency-Key": str(uuid4())})
        self.assertEqual(response.status_code, 201, response.text)
        plan = response.json()
        self.assertEqual(plan["state"], "REVIEW")
        self.assertTrue(plan["expected_outputs"])
        self.assertTrue(all(set(step) == {"tool", "action"} for step in plan["steps"]))
        route = plans + "/" + plan["plan_id"]
        body = {"mode": "PLAN", "plan_id": plan["plan_id"], "plan_version": 1}

        async def execute(payload):
            return await self.client.post(self.route, json=payload, headers={"Idempotency-Key": str(uuid4())})

        self.assertEqual((await execute(body)).status_code, 409)
        accept_key = {"Idempotency-Key": str(uuid4())}
        first = await self.client.post(route + "/accept", json={"plan_version": 1}, headers=accept_key)
        second = await self.client.post(route + "/accept", json={"plan_version": 1}, headers=accept_key)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), second.json())
        owner = self.user
        app.dependency_overrides[actor] = lambda: uuid4()
        self.assertEqual((await self.client.post(route + "/accept", json={"plan_version": 1}, headers=accept_key)).status_code, 404)
        self.assertEqual((await execute(body)).status_code, 404)
        app.dependency_overrides[actor] = lambda: owner
        run = await execute(body)
        self.assertEqual(run.status_code, 202, run.text)
        stored = await self.stored(run.json()["run_id"])
        self.assertEqual((str(stored["plan_id"]), stored["plan_version"]), (plan["plan_id"], 1))
        edited = await self.client.patch(route, json={**self.objective, "query": "Updated question", "expected_version": 1})
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual((edited.json()["plan_version"], edited.json()["state"]), (2, "REVIEW"))
        self.assertEqual((await execute(body)).status_code, 409)
        self.assertEqual((await execute({**body, "plan_version": 2})).status_code, 409)
        accepted = await self.client.post(route + "/accept", json={"plan_version": 2},
                                          headers={"Idempotency-Key": str(uuid4())})
        self.assertEqual(accepted.status_code, 200)
        regenerated = await self.client.post(route + "/regenerate", json={"plan_version": 2})
        self.assertEqual(regenerated.status_code, 200, regenerated.text)
        self.assertEqual((regenerated.json()["plan_version"], regenerated.json()["state"]), (3, "REVIEW"))
        self.assertEqual((await execute({**body, "plan_version": 2})).status_code, 409)
        self.assertEqual((await execute({**body, "plan_version": 3})).status_code, 409)

    async def test_worker_executes_ask_with_a_read_only_database_mapping(self):
        identifier = await self.seed(status="running", error=None)
        async with self.database.begin() as connection:
            await connection.execute(text("""
                UPDATE orchestration.runs SET lease_id=:lease, lease_until=now()+interval '6 minutes',
                    step='retrieve' WHERE run_id=:id
            """), {"id": identifier, "lease": uuid4()})
            rows = await connection.execute(text("SELECT * FROM orchestration.runs WHERE run_id=:id"), {"id": identifier})
            run = rows.mappings().one()
        citation = {"document_id": self.objective["document_ids"][0], "chunk_id": str(uuid4()),
                    "name": "synthetic.pdf", "page": 1, "text": "Phòng B4-201.", "section": "", "region": None}

        def upstream(request):
            if request.url.host == "workspace-service":
                return httpx.Response(200)
            if request.url.host == "retrieval-service":
                return httpx.Response(200, json={"evidence": [citation]})
            return httpx.Response(200, json={"text": json.dumps({"claims": [
                {"text": "Phòng B4-201.", "evidence": [citation["chunk_id"]]},
            ]})})

        with patch.dict(os.environ, {"MODEL_CHAT_TOKEN": "fixture", "RETRIEVAL_INTERACTION_TOKEN": "fixture",
                                     "WORKSPACE_INTERACTION_TOKEN": "fixture", "RUN_MAX_COST_MICRO_USD": "0"}):
            async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
                await Worker(self.database, client).execute(run)
        saved = await self.stored(identifier)
        self.assertEqual(saved["status"], "succeeded", saved["error_code"])
        self.assertEqual(saved["history_snapshot"], [])
        self.assertEqual(saved["result"]["claims"][0]["citations"], [citation])
        self.assertIsNone(run["history_snapshot"])


if __name__ == "__main__":
    unittest.main()
