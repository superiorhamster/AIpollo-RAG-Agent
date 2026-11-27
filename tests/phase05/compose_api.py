"""Verify Learning Plans through the Gateway, worker, and deterministic model fixture."""

import sys
from pathlib import Path
from uuid import uuid4

tests = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(tests))

from phase03.api import ACCOUNT, client, job, status, wait_for


def verify(workspace, source):
    base = f"/v1/workspaces/{workspace}"
    with client() as owner:
        status(owner.post("/v1/auth/login", json=ACCOUNT), 200)
        assert wait_for(lambda: job(owner, base + "/documents", source),
                        lambda state: state in ("succeeded", "failed")) == "succeeded"

        def ask(query, sources=(), *, conversation=None, revision=0, action=None, days=None):
            body = {"mode": "ASK", "objective": {
                "query": query, "document_ids": list(sources), "capability": "LEARN",
            }, "selection_revision": revision}
            if conversation is not None:
                body["conversation_id"] = conversation
            if action is not None:
                body["learning_action"] = action
            if days is not None:
                body["learning_days"] = days
            run = status(owner.post(base + "/runs", json=body,
                                    headers={"Idempotency-Key": str(uuid4())}), 202).json()
            path = base + "/runs/" + run["run_id"]
            outcome = wait_for(lambda: status(owner.get(path), 200).json(),
                               lambda state: state["status"] in ("succeeded", "failed", "cancelled"))
            assert outcome["status"] == "succeeded", outcome
            return outcome

        created = ask("Make a plan to study the academic source", [source], action="create", days=2)
        plan_id = created["result"]["learning_plan_id"]
        assert not created["result"].get("learning_card"), created
        plan_path = f"{base}/learning-plans/{plan_id}"
        conversation = created["conversation_id"]
        selection_path = f"{base}/conversations/{conversation}/learning-plan"
        selection = status(owner.get(selection_path), 200).json()
        assert selection["selected_plan_id"] == plan_id, selection
        revision = selection["selection_revision"]
        original = status(owner.get(plan_path), 200).json()
        assert original["blueprint"]["days"] == 2, original
        assert [item["day"] for item in original["blueprint"]["objectives"]] == [1, 2]
        assert all(item["progress"] == "pending" for item in original["blueprint"]["objectives"])

        grounded = ask("Academic source", [source], conversation=conversation, revision=revision)["result"]
        citations = [entry for claim in grounded["claims"] for entry in claim["citations"]]
        assert citations and all(entry["document_id"] == source and entry["page"] >= 1 for entry in citations), grounded

        def edit():
            result = ask("Rename the plan", conversation=conversation, revision=revision, action="edit")["result"]
            path = f"{base}/learning-cards/{result['learning_card']}"
            card = status(owner.get(path), 200).json()
            assert card["kind"] == "edit" and card["status"] == "pending", card
            assert card["payload"]["changes"] == [{
                "field": "title", "before": original["blueprint"]["title"],
                "after": "Updated fixture learning plan",
            }], card
            assert status(owner.get(plan_path), 200).json() == original
            return path

        assert status(owner.put(edit(), json={"outcome": "rejected"}), 200).json()["status"] == "rejected"
        assert status(owner.get(plan_path), 200).json() == original
        assert status(owner.put(edit(), json={"outcome": "accepted"}), 200).json()["status"] == "accepted"
        edited = status(owner.get(plan_path), 200).json()
        assert edited["content_version"] == original["content_version"] + 1
        assert edited["blueprint"] == {**original["blueprint"], "title": "Updated fixture learning plan"}

        plan_only = ask("What is in my plan?", conversation=conversation, revision=revision)["result"]
        assert plan_only["source_state"] == "zero" and plan_only["claims"][0]["source"] == "plan", plan_only
        assert not plan_only["claims"][0]["citations"], plan_only
        completion = ask("I completed my first objective.", conversation=conversation, revision=revision)["result"]
        completion_path = f"{base}/learning-cards/{completion['learning_card']}"
        card = status(owner.get(completion_path), 200).json()
        assert card["kind"] == "completion" and card["status"] == "pending", card
        assert card["payload"]["objective"] == edited["blueprint"]["objectives"][0]["goal"], card
        assert status(owner.get(plan_path), 200).json() == edited
        assert status(owner.put(completion_path, json={"outcome": "accepted"}), 200).json()["status"] == "accepted"
        completed = status(owner.get(plan_path), 200).json()
        assert completed["content_version"] == edited["content_version"]
        assert completed["state_revision"] == edited["state_revision"] + 1
        first, second = edited["blueprint"]["objectives"]
        assert completed["blueprint"]["objectives"] == [{**first, "progress": "completed"}, second]

        cleared = status(owner.put(selection_path, json={
            "selected_plan_id": None, "selection_revision": revision,
        }), 200).json()
        assert cleared["selected_plan_id"] is None, cleared
        no_plan = ask("What is in my plan?", conversation=conversation, revision=cleared["selection_revision"])["result"]
        assert no_plan["source_state"] == "zero", no_plan
        assert no_plan["claims"] and all(claim["source"] == "general" for claim in no_plan["claims"]), no_plan
        assert not no_plan.get("learning_card"), no_plan

    print("Learning Plan Create, scoped citations, Edit decisions, Completion, and No Plan passed through the Gateway.")


if __name__ == "__main__":
    verify(*sys.argv[1:])
