"""Exercise manual Learning Plan writes against a migrated QA database."""

import asyncio
import json
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from sqlalchemy import text

from app.main import actor, app
from app import learning_store
from app.learning_blueprint import BLUEPRINT_LIMIT
from app.worker import Worker
from rag_db import open_database
from rag_http import ApiError


class LearningPlanApi(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.database = open_database()
        app.state.database = self.database
        self.addAsyncCleanup(self.database.dispose)
        self.owner = uuid4()
        self.workspace = uuid4()
        self.path = f"/v1/workspaces/{self.workspace}/learning-plans"
        app.dependency_overrides[actor] = lambda: self.owner
        self.addCleanup(app.dependency_overrides.pop, actor)
        flags = patch.dict("os.environ", {"LEARNING_PLANS_ENABLED": "true"})
        flags.start()
        self.addCleanup(flags.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://qa")
        self.addAsyncCleanup(self.client.aclose)
        self.blueprint = {
            "title": "Review fractions", "days": 1,
            "objectives": [{"day": 1, "goal": "Compare fractions", "activities": ["Draw a comparison"]}],
        }

    async def test_manual_lifecycle_replay_and_isolation(self):
        key = {"Idempotency-Key": str(uuid4())}
        first, duplicate = await asyncio.gather(*[
            self.client.post(self.path, json=self.blueprint, headers=key) for _ in range(2)
        ])
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(duplicate.json(), first.json())
        plan = first.json()
        path = f"{self.path}/{plan['plan_id']}"
        self.assertEqual(len((await self.client.get(self.path)).json()), 1)
        with patch.object(self, "owner", uuid4()):
            self.assertEqual((await self.client.get(path)).status_code, 404)
            self.assertEqual((await self.client.put(path, json={"revision": 1, "blueprint": plan["blueprint"]})).status_code, 404)
            self.assertEqual((await self.client.request("DELETE", path, json={"revision": 1})).status_code, 404)
        no_op = await self.client.put(path, json={"revision": 1, "blueprint": plan["blueprint"]})
        self.assertEqual(no_op.json(), plan)
        plan["blueprint"]["objectives"][0]["progress"] = "completed"
        updates = await asyncio.gather(*[
            self.client.put(path, json={"revision": 1, "blueprint": plan["blueprint"]}) for _ in range(2)
        ])
        self.assertEqual(sorted(response.status_code for response in updates), [200, 409])
        progress = (await self.client.get(path)).json()
        self.assertEqual((progress["content_version"], progress["state_revision"]), (1, 2))
        self.assertEqual(progress["blueprint"]["objectives"][0]["progress"], "completed")
        progress["blueprint"]["title"] = "Compare fractions visually"
        edit = await self.client.put(path, json={"revision": 2, "blueprint": progress["blueprint"]})
        self.assertEqual(edit.status_code, 200, edit.text)
        self.assertEqual((edit.json()["content_version"], edit.json()["state_revision"]), (2, 3))
        self.assertEqual((await self.client.request("DELETE", path, json={"revision": 3})).status_code, 204)
        self.assertEqual((await self.client.post(self.path, json=self.blueprint, headers=key)).status_code, 404)
        self.assertEqual((await self.client.get(self.path)).json(), [])
        async with self.database.connect() as connection:
            events = await connection.scalars(text("""
                SELECT kind FROM orchestration.learning_plan_events WHERE workspace_id=:workspace
                ORDER BY state_revision
            """), {"workspace": self.workspace})
            self.assertEqual(events.all(), ["created", "progress_changed", "edited", "deleted"])

    async def test_feature_flag_and_legacy_routes(self):
        legacy = self.path.replace("learning-plans", "plans")
        self.assertEqual((await self.client.post(legacy, json={})).status_code, 404)
        with patch.dict("os.environ", {"LEARNING_PLANS_ENABLED": "false"}):
            self.assertEqual((await self.client.get(self.path)).status_code, 404)

    async def test_conversation_selection_is_private_and_revision_bound(self):
        plan = await self.client.post(self.path, json=self.blueprint, headers={"Idempotency-Key": str(uuid4())})
        self.assertEqual(plan.status_code, 201, plan.text)
        plan_id = plan.json()["plan_id"]
        conversations = [uuid4(), uuid4()]
        async with self.database.begin() as connection:
            for conversation in conversations:
                await connection.execute(text("""
                    INSERT INTO orchestration.conversations (conversation_id, workspace_id, user_id)
                    VALUES (:conversation, :workspace, :owner)
                """), {"conversation": conversation, "workspace": self.workspace, "owner": self.owner})
        first, second = [
            f"/v1/workspaces/{self.workspace}/conversations/{conversation}/learning-plan"
            for conversation in conversations
        ]
        initial = {"selected_plan_id": None, "selection_revision": 0, "unavailable": False}
        self.assertEqual((await self.client.get(first)).json(), initial)
        selected = await self.client.put(first, json={"selected_plan_id": plan_id, "selection_revision": 0})
        self.assertEqual(selected.json(), {**initial, "selected_plan_id": plan_id, "selection_revision": 1})
        self.assertEqual((await self.client.get(second)).json(), initial)
        cleared = await self.client.put(second, json={"selected_plan_id": None, "selection_revision": 0})
        self.assertEqual(cleared.json(), {**initial, "selection_revision": 1})
        stale = await self.client.put(first, json={"selected_plan_id": None, "selection_revision": 0})
        self.assertEqual(stale.status_code, 409)
        with patch.object(self, "owner", uuid4()):
            self.assertEqual((await self.client.get(first)).status_code, 404)
        deleted = await self.client.request("DELETE", f"{self.path}/{plan_id}", json={"revision": 1})
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual((await self.client.get(first)).json(), {
            **initial, "selection_revision": 1, "unavailable": True,
        })

    async def run_ask(self, *, output, sources=(), conversation=None, revision=0, action=None, days=None,
                      revoke_before_publish=False, keep_no_plan=False, inspect_context=None,
                      expected_error=None, finish_reason="stop", retrieved=(), retrieval_status=200, retry_of=None):
        endpoint = f"/v1/workspaces/{self.workspace}/runs"
        response = await self.client.post(endpoint, headers={"Idempotency-Key": str(uuid4())}, json={
            "mode": "ASK", "objective": {"query": "Help me study fractions", "document_ids": list(sources)},
            "conversation_id": conversation, "selection_revision": None if retry_of else revision, "learning_action": action,
            "learning_days": days, "citation_mode": "chunk",
            "retry_of_run_id": retry_of,
        })
        self.assertEqual(response.status_code, 202, response.text)
        identifier = response.json()["run_id"]
        if keep_no_plan:
            conversation_id = response.json()["conversation_id"]
            selected = await self.client.put(
                f"/v1/workspaces/{self.workspace}/conversations/{conversation_id}/learning-plan",
                json={"selected_plan_id": None, "selection_revision": revision},
            )
            self.assertEqual(selected.status_code, 200, selected.text)
        async with self.database.begin() as connection:
            row = await connection.execute(text("""
                UPDATE orchestration.runs SET status='running', lease_id=:lease, lease_until=now()+interval '1 minute'
                WHERE run_id=:run RETURNING *
            """), {"run": identifier, "lease": uuid4()})
            run = row.mappings().one()
        traffic = []
        generated = False

        def upstream(request):
            nonlocal generated
            host = request.url.host
            traffic.append(host)
            if host == "workspace-service":
                return httpx.Response(404 if revoke_before_publish and generated else 200)
            if host == "retrieval-service":
                return httpx.Response(retrieval_status, json={"evidence": list(retrieved)})
            payload = json.loads(request.content)
            if payload["max_tokens"] == 512:
                return httpx.Response(200, json={"text": '{"query":"Find fraction comparisons"}'})
            context = json.loads(payload["messages"][-1]["content"])
            if run["input"]["learning"]["plan"]:
                self.assertIn("current_plan", context)
            if inspect_context:
                inspect_context(context)
            generated = True
            return httpx.Response(200, json={"text": json.dumps(output), "finish_reason": finish_reason})

        with patch.dict("os.environ", {
            "WORKSPACE_INTERACTION_TOKEN": "fixture", "RETRIEVAL_INTERACTION_TOKEN": "fixture",
            "MODEL_CHAT_TOKEN": "fixture", "RUN_MAX_COST_MICRO_USD": "0",
        }):
            async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
                await Worker(self.database, client).execute(run)
        self.assertEqual("retrieval-service" in traffic, bool(sources))
        finished = (await self.client.get(f"{endpoint}/{identifier}")).json()
        self.assertEqual(finished["status"], "failed" if revoke_before_publish or expected_error else "succeeded", finished)
        if expected_error:
            self.assertEqual(finished["error_code"], expected_error)
            self.assertIsNone(finished["result"])
        return finished

    async def test_fixed_duration_retry_coalesces_and_recovers_without_resurrection(self):
        original = await self.run_ask(action="create", days=2, output={"reply": "Wrong duration.", "plan": self.blueprint},
                                      expected_error="invalid_model_output")
        endpoint = f"/v1/workspaces/{self.workspace}/runs"
        async def retry(parent):
            return await self.client.post(endpoint, headers={"Idempotency-Key": str(uuid4())}, json={
                "mode": "ASK", "objective": {"query": "Help me study fractions", "document_ids": []},
                "retry_of_run_id": parent,
            })

        first, other = await asyncio.gather(retry(original["run_id"]), retry(original["run_id"]))
        self.assertEqual((first.status_code, other.status_code), (202, 202))
        self.assertEqual(first.json()["run_id"], other.json()["run_id"])
        def assert_binding(context):
            self.assertEqual(context["duration"], 2)
            self.assertEqual(context["query"], "Help me study fractions")
            self.assertEqual(context["source_state"], "zero")
        valid = {**self.blueprint, "days": 2, "objectives": [
            *self.blueprint["objectives"], {"day": 2, "goal": "Compare mixed numbers", "activities": []},
        ]}
        saved = await self.run_ask(output={"reply": "Two days.", "plan": valid}, retry_of=original["run_id"],
                                   inspect_context=assert_binding)
        plan_id = saved["result"]["learning_plan_id"]
        for parent in (original["run_id"], saved["run_id"]):
            recovered = await retry(parent)
            self.assertEqual(recovered.status_code, 202, recovered.text)
            self.assertEqual(recovered.json()["run_id"], saved["run_id"])
        all_plans = (await self.client.get(self.path)).json()
        self.assertEqual([(plan["plan_id"], plan["blueprint"]["days"]) for plan in all_plans], [(plan_id, 2)])
        self.assertEqual((await self.client.request("DELETE", self.path + "/" + plan_id, json={"revision": 1})).status_code, 204)
        self.assertEqual((await retry(original["run_id"])).status_code, 404)
        self.assertEqual((await self.client.get(self.path)).json(), [])

    async def test_generation_failures_leave_no_plan_or_event(self):
        over = {**self.blueprint, "title": "界" * BLUEPRINT_LIMIT}
        manual = await self.client.post(self.path, headers={"Idempotency-Key": str(uuid4())}, json=over)
        self.assertEqual(manual.status_code, 422, manual.text)
        await self.run_ask(action="create", output={"reply": "Valid prefix.", "plan": self.blueprint},
                           finish_reason="length", expected_error="learning_output_capacity")
        await self.run_ask(action="create", output={"reply": "Over capacity.", "plan": over},
                           expected_error="invalid_model_output")
        await self.run_ask(action="create", days=2, output={"reply": "Wrong duration.", "plan": self.blueprint},
                           expected_error="invalid_model_output")
        self.assertEqual((await self.client.get(self.path)).json(), [])
        async with self.database.connect() as connection:
            count = await connection.scalar(text("""
                SELECT count(*) FROM orchestration.learning_plan_events WHERE workspace_id=:workspace
            """), {"workspace": self.workspace})
        self.assertEqual(count, 0)
        created = await self.run_ask(action="create", output={"reply": "Valid Plan.", "plan": self.blueprint})
        plan_path = self.path + "/" + created["result"]["learning_plan_id"]
        plan = (await self.client.get(plan_path)).json()
        proposal = {**plan["blueprint"], "title": over["title"]}
        manual_edit = await self.client.put(plan_path, json={"revision": 1, "blueprint": proposal})
        self.assertEqual(manual_edit.status_code, 422, manual_edit.text)
        await self.run_ask(action="edit", conversation=created["conversation_id"], revision=1,
                           output={"reply": "Long title.", "plan": proposal}, expected_error="invalid_model_output")
        unknown = {**plan["blueprint"], "objectives": [
            {**plan["blueprint"]["objectives"][0], "id": str(uuid4())}
        ]}
        await self.run_ask(action="edit", conversation=created["conversation_id"], revision=1,
                           output={"reply": "Unknown objective.", "plan": unknown}, expected_error="invalid_model_output")
        self.assertEqual((await self.client.get(plan_path)).json(), plan)
        async with self.database.connect() as connection:
            count = await connection.scalar(text("""
                SELECT count(*) FROM orchestration.learning_plan_cards WHERE workspace_id=:workspace
            """), {"workspace": self.workspace})
        self.assertEqual(count, 0)

    async def test_source_scope_and_failure_are_independent_of_plan(self):
        created = await self.run_ask(action="create", output={"reply": "Study fractions.", "plan": self.blueprint})
        def unexpected_context(_):
            self.fail("Unusable retrieval must stop before Answer generation")
        options = {"conversation": created["conversation_id"], "revision": 1, "sources": [str(uuid4())],
                   "output": None, "inspect_context": unexpected_context}
        await self.run_ask(**options, retrieved=[{"document_id": str(uuid4())}], expected_error="invalid_evidence_scope")
        await self.run_ask(**options, retrieval_status=404, expected_error="source_unavailable")
        await self.run_ask(**options, retrieval_status=503, expected_error="interaction_unavailable")

    async def test_completion_accept_is_atomic_and_binds_displayed_objective(self):
        draft = {**self.blueprint, "objectives": [*self.blueprint["objectives"],
                 {"day": 1, "goal": "Explain equivalent fractions", "activities": []}]}
        created = await self.run_ask(action="create", output={"reply": "Study fractions.", "plan": draft})
        plan_url = self.path + "/" + created["result"]["learning_plan_id"]
        snapshot = (await self.client.get(plan_url)).json()
        first, second = snapshot["blueprint"]["objectives"]
        output = {"claims": [{"text": "Let's consider the first goal.", "source": "plan", "evidence": []}],
                  "suggestion": second["id"], "unsupported_parts": [], "readiness": "ready"}
        card_base = f"/v1/workspaces/{self.workspace}/learning-cards/"
        async def create_card():
            run = await self.run_ask(output=output, conversation=created["conversation_id"], revision=1)
            return card_base + run["result"]["learning_card"]

        reject_url = await create_card()
        rejected = await self.client.put(reject_url, json={"outcome": "rejected"})
        self.assertEqual(rejected.json()["status"], "rejected")
        self.assertEqual((await self.client.get(plan_url)).json(), snapshot)

        accept_url = await create_card()
        card = (await self.client.get(accept_url)).json()
        self.assertEqual(card["payload"]["objective"], second["goal"])
        self.assertEqual((await self.client.get(plan_url)).json(), snapshot)
        with patch.object(self, "owner", uuid4()):
            self.assertEqual((await self.client.put(accept_url, json={"outcome": "accepted"})).status_code, 404)
        wrong_workspace = accept_url.replace(str(self.workspace), str(uuid4()))
        self.assertEqual((await self.client.put(wrong_workspace, json={"outcome": "accepted"})).status_code, 404)
        revise = learning_store.revise_learning_plan
        async def fail_after_writes(*args, **kwargs):
            await revise(*args, **kwargs)
            raise ApiError(503, "synthetic_failure", "Stop before commit.")

        async def event_count():
            async with self.database.connect() as connection:
                return await connection.scalar(text("""
                    SELECT count(*) FROM orchestration.learning_plan_events WHERE workspace_id=:workspace
                """), {"workspace": self.workspace})
        before_events = await event_count()
        with patch.object(learning_store, "revise_learning_plan", fail_after_writes):
            failed = await self.client.put(accept_url, json={"outcome": "accepted"})
        self.assertEqual(failed.status_code, 503, failed.text)
        self.assertEqual((await self.client.get(accept_url)).json(), card)
        self.assertEqual((await self.client.get(plan_url)).json(), snapshot)
        self.assertEqual(await event_count(), before_events)
        accepted = await asyncio.gather(*[self.client.put(accept_url, json={"outcome": "accepted"}) for _ in range(2)])
        self.assertTrue(all(response.status_code == 200 for response in accepted))
        after = (await self.client.get(plan_url)).json()
        self.assertEqual(after["blueprint"]["objectives"], [first, {**second, "progress": "completed"}])
        self.assertEqual(after["content_version"], snapshot["content_version"])
        self.assertEqual(after["state_revision"], snapshot["state_revision"] + 1)
        self.assertEqual(await event_count(), before_events + 2)

    async def test_create_does_not_publish_after_membership_revocation(self):
        run = await self.run_ask(output={"reply": "Study fractions.", "plan": self.blueprint},
                                 action="create", revoke_before_publish=True)
        self.assertEqual(run["error_code"], "workspace_access_revoked")
        self.assertIsNone(run["result"])
        self.assertEqual((await self.client.get(self.path)).json(), [])

    async def test_delayed_create_respects_explicit_no_plan(self):
        run = await self.run_ask(output={"reply": "Study fractions.", "plan": self.blueprint},
                                 action="create", keep_no_plan=True)
        self.assertTrue(run["result"]["learning_plan_id"])
        path = f"/v1/workspaces/{self.workspace}/conversations/{run['conversation_id']}/learning-plan"
        self.assertEqual((await self.client.get(path)).json(), {
            "selected_plan_id": None, "selection_revision": 1, "unavailable": False,
        })

    async def test_retry_remains_bound_and_stale_edit_skips_model(self):
        generated = await self.run_ask(output={"reply": "Study fractions.", "plan": self.blueprint}, action="create")
        identifier = generated["result"]["learning_plan_id"]
        conversation = generated["conversation_id"]
        workspace = f"/v1/workspaces/{self.workspace}"
        objective = {"query": "Rename my plan.", "document_ids": []}
        initial = await self.client.post(f"{workspace}/runs", json={
            "mode": "ASK", "objective": objective, "conversation_id": conversation,
            "selection_revision": 1, "learning_action": "edit", "citation_mode": "chunk",
        }, headers={"Idempotency-Key": str(uuid4())})
        self.assertEqual(initial.status_code, 202, initial.text)
        original = initial.json()["run_id"]
        async with self.database.begin() as connection:
            await connection.execute(text("""
                UPDATE orchestration.runs SET status='failed', error_code='invalid_model_output',
                    history_snapshot=CAST('[]' AS jsonb)
                WHERE run_id=:run
            """), {"run": original})
        selected = await self.client.put(f"{workspace}/conversations/{conversation}/learning-plan", json={
            "selected_plan_id": None, "selection_revision": 1,
        })
        self.assertEqual(selected.status_code, 200, selected.text)
        path = f"{self.path}/{identifier}"
        plan = (await self.client.get(path)).json()
        changed = await self.client.put(path, json={
            "revision": 1, "blueprint": {**plan["blueprint"], "title": "Manual change"},
        })
        self.assertEqual(changed.status_code, 200, changed.text)
        retry = await self.client.post(f"{workspace}/runs", json={
            "mode": "ASK", "objective": objective, "retry_of_run_id": original,
        }, headers={"Idempotency-Key": str(uuid4())})
        self.assertEqual(retry.status_code, 202, retry.text)
        run_id = retry.json()["run_id"]
        async with self.database.begin() as connection:
            row = await connection.execute(text("""
                UPDATE orchestration.runs SET status='running', lease_id=:lease, lease_until=now()+interval '1 minute'
                WHERE run_id=:run RETURNING *
            """), {"run": run_id, "lease": uuid4()})
            bound = row.mappings().one()
        self.assertEqual(bound["input"]["learning"]["plan"]["plan_id"], identifier)
        self.assertEqual(bound["input"]["citation_mode"], "chunk")
        self.assertEqual(bound["input"]["learning"]["plan"]["state_revision"], 1)

        def upstream(request):
            self.assertEqual(request.url.host, "workspace-service")
            return httpx.Response(200)

        with patch.dict("os.environ", {"WORKSPACE_INTERACTION_TOKEN": "fixture"}):
            async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
                await Worker(self.database, client).execute(bound)
        failed = (await self.client.get(f"{workspace}/runs/{run_id}")).json()
        self.assertEqual(failed["error_code"], "stale_learning_plan")

    async def test_ask_combinations_generation_and_card_lifecycle(self):
        ordinary = {"claims": [{"text": "Start with equal denominators.", "source": "general", "evidence": []}],
                    "suggestion": None, "unsupported_parts": []}
        document = str(uuid4())
        sourced = await self.run_ask(output=ordinary, sources=[document])
        self.assertTrue(sourced["result"]["insufficient_evidence"])
        unsourced = await self.run_ask(output=ordinary)
        self.assertEqual(unsourced["result"]["source_state"], "zero")
        self.assertEqual(unsourced["result"]["claims"][0]["source"], "general")
        created = await self.run_ask(output={"reply": "Start with visual comparisons.", "plan": self.blueprint},
                                     action="create", days=1)
        plan_path = f"{self.path}/{created['result']['learning_plan_id']}"
        plan = (await self.client.get(plan_path)).json()
        conversation = created["conversation_id"]
        selection_path = f"/v1/workspaces/{self.workspace}/conversations/{conversation}/learning-plan"
        self.assertEqual((await self.client.get(selection_path)).json()["selected_plan_id"], plan["plan_id"])
        recall = {"claims": [{"text": "Your plan covers comparison.", "source": "plan", "evidence": []}],
                  "suggestion": None, "unsupported_parts": ["No matching passage."], "readiness": "not_assessed"}
        for sources, expected in (([], "zero"), ([document], "empty")):
            result = await self.run_ask(output=recall, sources=sources, conversation=conversation, revision=1)
            self.assertEqual(result["result"]["source_state"], expected)
            self.assertEqual(result["result"]["claims"][0]["source"], "plan")
        completion = await self.run_ask(output={**recall, "readiness": "ready",
            "suggestion": plan["blueprint"]["objectives"][0]["id"]}, conversation=conversation, revision=1)
        completion_id = completion["result"]["learning_card"]
        edited = await self.run_ask(output={"reply": "A title change.", "plan": {
            **plan["blueprint"], "title": "Visual fractions",
        }}, conversation=conversation, revision=1, action="edit")
        base = f"/v1/workspaces/{self.workspace}/learning-cards"
        card_path = f"{base}/{edited['result']['learning_card']}"
        card = (await self.client.get(card_path)).json()
        self.assertEqual(card["payload"]["changes"], [{
            "field": "title", "before": self.blueprint["title"], "after": "Visual fractions",
        }])
        accepted = await asyncio.gather(*[
            self.client.put(card_path, json={"outcome": "accepted"}) for _ in range(2)
        ])
        self.assertTrue(all(item.status_code == 200 for item in accepted))
        self.assertEqual((await self.client.get(f"{base}/{completion_id}")).json()["status"], "invalidated")
        self.assertEqual((await self.client.get(plan_path)).json()["content_version"], 2)

        await self.run_ask(output={**recall, "claims": [*recall["claims"], {
            "text": "You said Thursday works.", "source": "conversation", "evidence": [],
        }]}, conversation=conversation, revision=1)
        cleared = await self.client.put(selection_path, json={"selected_plan_id": None, "selection_revision": 1})
        self.assertEqual(cleared.status_code, 200)

        def no_plan_context(context):
            self.assertIsNone(context["current_plan"])
            self.assertEqual(context["tagged"], [])
            self.assertIn("You said Thursday works.", [turn["assistant"] for turn in context["qa"]])
            self.assertNotIn("Your plan covers comparison.", json.dumps(context["qa"]))

        await self.run_ask(output=ordinary, conversation=conversation, revision=2, inspect_context=no_plan_context)


if __name__ == "__main__":
    unittest.main()
