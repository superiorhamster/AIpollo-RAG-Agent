"""Exercise the approval and execution protocol against an ephemeral PostgreSQL."""

import asyncio
import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import text

from app.main import app
from app.worker import Worker
from rag_db import open_database

OWNER = uuid4()
OTHER = uuid4()
WORKSPACE = uuid4()
DOCUMENT = uuid4()
CHUNK = uuid4()
SCOPE = f"/v1/workspaces/{WORKSPACE}"
OBJECTIVE = {"query": "What did the source find?", "document_ids": [str(DOCUMENT)], "capability": "RESEARCH"}
OWNER_COOKIE = "a.b." + "c" * 43
OTHER_COOKIE = "a.b." + "d" * 43


def key():
    return {"Idempotency-Key": str(uuid4())}


def check(response, expected):
    assert response.status_code == expected, response.text
    return response.json()


async def verify():
    spec = importlib.util.spec_from_file_location("model_gateway", Path(__file__).parents[2] / "services/model-gateway/app/main.py")
    model = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(model)
    model_http = httpx.ASGITransport(app=model.app)
    database = open_database()
    app.state.database = database

    async def dependencies(request):
        service = request.url.host
        if service == "workspace-service":
            assert request.headers["X-Interaction-Service-Token"] == os.environ["WORKSPACE_INTERACTION_TOKEN"]
            delegated = request.url.params.get("user_id")
            if delegated:
                return httpx.Response(200, json={"user_id": delegated, "role": "OWNER"})
            users = {f"rag_access={OWNER_COOKIE}": OWNER, f"rag_access={OTHER_COOKIE}": OTHER}
            identity = users.get(request.headers.get("Cookie"))
            return httpx.Response(200, json={"user_id": str(identity), "role": "OWNER"}) if identity else httpx.Response(401)
        if service == "model-gateway":
            return await model_http.handle_async_request(request)
        assert service == "retrieval-service"
        return httpx.Response(200, json={"evidence": [{
            "document_id": str(DOCUMENT), "chunk_id": str(CHUNK), "name": "Fixture", "page": 2,
            "section": "Results", "text": "The fixture recorded twelve observations.", "region": None,
        }]})

    async with model.lifespan(model.app), httpx.AsyncClient(transport=httpx.MockTransport(dependencies)) as services:
        app.state.client = services
        worker = Worker(database, services)
        transport = httpx.ASGITransport(app=app)
        async with (
            httpx.AsyncClient(base_url="http://orchestrator", transport=transport, cookies={"rag_access": OWNER_COOKIE}) as owner,
            httpx.AsyncClient(base_url="http://orchestrator", transport=transport, cookies={"rag_access": OTHER_COOKIE}) as outsider,
        ):
            plan = check(await owner.post(SCOPE + "/plans", json=OBJECTIVE, headers=key()), 201)
            assert plan["state"] == "REVIEW" and set(plan["steps"][0]) == {"tool", "action"}
            route = SCOPE + "/plans/" + plan["plan_id"]
            execution = {"mode": "PLAN", "plan_id": plan["plan_id"], "plan_version": 1}
            assert check(await owner.post(SCOPE + "/runs", json=execution, headers=key()), 409)["code"] == "plan_not_accepted"
            check(await outsider.post(route + "/accept", json={"plan_version": 1}, headers=key()), 404)
            check(await outsider.post(SCOPE + "/runs", json=execution, headers=key()), 404)

            acceptance_key = key()
            accepted = check(await owner.post(route + "/accept", json={"plan_version": 1}, headers=acceptance_key), 200)
            replay = check(await owner.post(route + "/accept", json={"plan_version": 1}, headers=acceptance_key), 200)
            assert accepted["accepted_at"] == replay["accepted_at"]
            start_key = key()
            run = check(await owner.post(SCOPE + "/runs", json=execution, headers=start_key), 202)
            assert check(await owner.post(SCOPE + "/runs", json=execution, headers=start_key), 202)["run_id"] == run["run_id"]
            check(await outsider.get(SCOPE + "/runs/" + run["run_id"]), 404)
            revised = check(await owner.patch(route, json={**OBJECTIVE, "expected_version": 1}), 200)
            assert revised["plan_version"] == 2 and revised["state"] == "REVIEW"
            check(await owner.post(SCOPE + "/runs", json=execution, headers=key()), 409)
            newer = {**execution, "plan_version": 2}
            assert check(await owner.post(SCOPE + "/runs", json=newer, headers=key()), 409)["code"] == "plan_not_accepted"

            claimed = await worker.claim()
            assert str(claimed["run_id"]) == run["run_id"] and claimed["plan_version"] == 1
            await worker.execute(claimed)
            outcome = check(await owner.get(SCOPE + "/runs/" + run["run_id"]), 200)
            assert outcome["status"] == "succeeded" and outcome["plan_version"] == 1, outcome
            assert outcome["result"]["claims"][0]["citations"][0]["chunk_id"] == str(CHUNK)
            streamed = await owner.get(SCOPE + "/runs/" + run["run_id"] + "/events")
            assert streamed.status_code == 200 and str(CHUNK) in streamed.text

            ask = {"mode": "ASK", "objective": OBJECTIVE}
            first = check(await owner.post(SCOPE + "/runs", json=ask, headers=key()), 202)
            thread = SCOPE + "/conversations/" + first["conversation_id"]
            check(await outsider.get(thread), 404)
            followup = {**ask, "conversation_id": first["conversation_id"]}
            second = check(await owner.post(SCOPE + "/runs", json=followup, headers=key()), 202)
            assert second["conversation_id"] == first["conversation_id"]
            cancelled = check(await owner.post(SCOPE + "/runs/" + second["run_id"] + "/cancel"), 200)
            assert cancelled["status"] == "cancelled"
            assert len(check(await owner.get(thread), 200)) == 2
            async with database.connect() as connection:
                result = await connection.scalar(text("""
                    SELECT count(*) FROM orchestration.acceptances WHERE plan_id=CAST(:id AS uuid)
                """), {"id": plan["plan_id"]})
                assert result == 1
    await database.dispose()
    print("Plan revision gates, idempotent acceptance and start, evidence, SSE, cancellation and private conversations passed.")


if __name__ == "__main__":
    asyncio.run(verify())
