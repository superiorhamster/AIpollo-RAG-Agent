"""Verify the approval contract through Gateway, broker, and the fixture models."""

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
        objective = {"query": "Academic source", "document_ids": [source], "capability": "LEARN"}
        plan = status(owner.post(base + "/plans", json=objective,
                                 headers={"Idempotency-Key": str(uuid4())}), 201).json()
        route = base + "/plans/" + plan["plan_id"]
        body = {"mode": "PLAN", "plan_id": plan["plan_id"], "plan_version": 1}
        key = {"Idempotency-Key": str(uuid4())}
        status(owner.post(base + "/runs", json=body, headers=key), 409)
        accepted = status(owner.post(route + "/accept", json={"plan_version": 1}, headers=key), 200)
        assert accepted.json()["state"] == "ACCEPTED"
        run = status(owner.post(base + "/runs", json=body, headers=key), 202).json()
        path = base + "/runs/" + run["run_id"]
        outcome = wait_for(lambda: status(owner.get(path), 200).json(),
                           lambda state: state["status"] in ("succeeded", "failed"))
        assert outcome["status"] == "succeeded", outcome
        assert outcome["result"]["claims"][0]["citations"][0]["document_id"] == source
        assert outcome["plan_version"] == 1
    print("Accepted Plan runs through the gateway and returns authorized citations.")


if __name__ == "__main__":
    verify(*sys.argv[1:])
