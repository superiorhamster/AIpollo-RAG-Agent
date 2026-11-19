"""Workspace-scoped Ask, Plan and Agent endpoints."""

import asyncio
import hashlib
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from datetime import datetime
from typing import Annotated
from uuid import UUID, uuid4

import httpx
from fastapi import Depends, FastAPI, Header, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from rag_db import database_ready, install_database_errors, open_database
from rag_http import ACCESS_COOKIE, ACCESS_FORMAT, ApiError, health_response, install_http, request_id, require_service, unauthorized, unavailable

from .types import Conversation, EditPlan, Objective, PlanView, RunView, StartRun, Version
from .worker import Worker, authorize

SERVICE = "agent-orchestrator"
BASE = "/v1/workspaces/{workspace_id}"
Key = Annotated[UUID, Header(alias="Idempotency-Key")]
RUN_FIELDS = (
    "run_id, interaction, conversation_id, plan_id, plan_version, "
    "status, step, result, error_code, request_id, created_at, updated_at, input->>'query' AS query"
)
TERMINAL = {"succeeded", "failed", "cancelled"}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.database = open_database()
    async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
        app.state.client = client
        worker = asyncio.create_task(Worker(app.state.database, client).loop())
        try:
            yield
        finally:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
            await app.state.database.dispose()


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
install_http(app)
install_database_errors(app)


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness() -> Response:
    return health_response(SERVICE, await database_ready(app.state.database, "orchestration", "orchestration_001"))


def missing() -> ApiError:
    return ApiError(404, "not_found", "The workspace or item could not be found.")


def stale() -> ApiError:
    return ApiError(409, "stale_plan_version", "Refresh the plan to use the current version.")


async def actor(workspace_id: UUID, request: Request) -> UUID:
    token = request.cookies.get(ACCESS_COOKIE)
    if not token or not ACCESS_FORMAT.fullmatch(token):
        raise unauthorized()
    try:
        access = await authorize(app.state.client, workspace_id, None, request_id(request),
                                 cookie=f"{ACCESS_COOKIE}={token}")
        if access.status_code == 401:
            raise unauthorized()
        if access.status_code == 404:
            raise missing()
        access.raise_for_status()
        return UUID(access.json()["user_id"])
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise unavailable() from exc


Actor = Annotated[UUID, Depends(actor)]


def digest(payload) -> str:
    return hashlib.sha256(payload.model_dump_json().encode()).hexdigest()


def scope(workspace_id: UUID, user_id: UUID, identifier: UUID) -> dict:
    return {"workspace": workspace_id, "user": user_id, "id": identifier}


async def owned_plan(connection: AsyncConnection, keys: dict, lock: bool = False):
    sql = """
        SELECT * FROM orchestration.plans WHERE plan_id=:id AND workspace_id=:workspace AND user_id=:user
    """
    result = await connection.execute(text(sql + (" FOR UPDATE" if lock else "")), keys)
    plan = result.mappings().one_or_none()
    if plan is None:
        raise missing()
    return plan


async def plan_payload(connection: AsyncConnection, plan) -> dict:
    result = await connection.execute(text("""
        SELECT v.input, a.accepted_at FROM orchestration.plan_versions v
        LEFT JOIN orchestration.acceptances a ON a.plan_id = v.plan_id AND a.version = v.version
        WHERE v.plan_id=:id AND v.version=:version
    """), {"id": plan["plan_id"], "version": plan["current_version"]})
    revision = result.mappings().one()
    return {"plan_id": plan["plan_id"], "plan_version": plan["current_version"],
            "state": "CANCELLED" if plan["cancelled"] else "ACCEPTED" if revision["accepted_at"] else "REVIEW",
            "objective": revision["input"], "accepted_at": revision["accepted_at"],
            "steps": [
                {"tool": "retrieve", "action": "Search the selected workspace sources."},
                {"tool": "compose", "action": "Write a grounded answer with verified source links."},
            ], "expected_outputs": ["Answer with citations or an insufficient-evidence result"]}


async def add_revision(connection: AsyncConnection, plan_id: UUID, version: int, objective: Objective) -> None:
    await connection.execute(text("""
        INSERT INTO orchestration.plan_versions (plan_id, version, input)
        VALUES (:id, :version, CAST(:input AS jsonb))
    """), {"id": plan_id, "version": version, "input": objective.model_dump_json()})


@app.post(BASE + "/plans", status_code=201, response_model=PlanView)
async def create_plan(workspace_id: UUID, data: Objective, key: Key, user_id: Actor, request: Request):
    keys = scope(workspace_id, user_id, uuid4())
    async with app.state.database.begin() as connection:
        created = await connection.scalar(text("""
            INSERT INTO orchestration.plans (plan_id, workspace_id, user_id, request_id, request_key, request_hash)
            VALUES (:id, :workspace, :user, :request, :key, :hash)
            ON CONFLICT (workspace_id, user_id, request_key) DO NOTHING RETURNING plan_id
        """), {**keys, "request": request_id(request), "key": key, "hash": digest(data)})
        if created is None:
            result = await connection.execute(text("""
                SELECT * FROM orchestration.plans WHERE workspace_id=:workspace AND user_id=:user AND request_key=:key
            """), {**keys, "key": key})
            plan = result.mappings().one()
            if plan["request_hash"] != digest(data):
                raise ApiError(409, "idempotency_conflict", "The request key is already used.")
        else:
            await add_revision(connection, created, 1, data)
            plan = await owned_plan(connection, keys)
        return await plan_payload(connection, plan)


@app.get(BASE + "/plans/{plan_id}", response_model=PlanView)
async def get_plan(workspace_id: UUID, plan_id: UUID, user_id: Actor):
    async with app.state.database.connect() as connection:
        plan = await owned_plan(connection, scope(workspace_id, user_id, plan_id))
        return await plan_payload(connection, plan)


async def revise(workspace_id: UUID, plan_id: UUID, expected: int, user_id: UUID, incoming: Objective | None):
    keys = scope(workspace_id, user_id, plan_id)
    async with app.state.database.begin() as connection:
        plan = await owned_plan(connection, keys, lock=True)
        if plan["cancelled"] or plan["current_version"] != expected:
            raise stale()
        old = await plan_payload(connection, plan)
        objective = incoming or Objective.model_validate(old["objective"])
        await add_revision(connection, plan_id, expected + 1, objective)
        await connection.execute(text("UPDATE orchestration.plans SET current_version=:version WHERE plan_id=:id"),
                                 {"version": expected + 1, "id": plan_id})
        return await plan_payload(connection, await owned_plan(connection, keys))


@app.patch(BASE + "/plans/{plan_id}", response_model=PlanView)
async def edit_plan(workspace_id: UUID, plan_id: UUID, data: EditPlan, user_id: Actor):
    return await revise(workspace_id, plan_id, data.expected_version, user_id,
                        Objective.model_validate(data.model_dump()))


@app.post(BASE + "/plans/{plan_id}/regenerate", response_model=PlanView)
async def regenerate_plan(workspace_id: UUID, plan_id: UUID, data: Version, user_id: Actor):
    return await revise(workspace_id, plan_id, data.plan_version, user_id, None)


@app.post(BASE + "/plans/{plan_id}/accept", response_model=PlanView)
async def accept_plan(workspace_id: UUID, plan_id: UUID, data: Version, key: Key, user_id: Actor):
    keys = scope(workspace_id, user_id, plan_id)
    async with app.state.database.begin() as connection:
        plan = await owned_plan(connection, keys, lock=True)
        if plan["cancelled"] or data.plan_version != plan["current_version"]:
            raise stale()
        reused = await connection.scalar(text("""
            SELECT version FROM orchestration.acceptances WHERE plan_id=:id AND request_key=:key
        """), {"id": plan_id, "key": key})
        if reused is not None and reused != data.plan_version:
            raise ApiError(409, "idempotency_conflict", "The request key is already used.")
        await connection.execute(text("""
            INSERT INTO orchestration.acceptances (plan_id, version, user_id, request_key)
            VALUES (:id, :version, :user, :key) ON CONFLICT (plan_id, version) DO NOTHING
        """), {**keys, "version": data.plan_version, "key": key})
        return await plan_payload(connection, plan)


@app.post(BASE + "/plans/{plan_id}/cancel", response_model=PlanView)
async def cancel_plan(workspace_id: UUID, plan_id: UUID, user_id: Actor):
    keys = scope(workspace_id, user_id, plan_id)
    async with app.state.database.begin() as connection:
        await owned_plan(connection, keys, lock=True)
        await connection.execute(text("UPDATE orchestration.plans SET cancelled=true WHERE plan_id=:id"), keys)
        return await plan_payload(connection, await owned_plan(connection, keys))


async def pinned_objective(connection: AsyncConnection, data: StartRun, workspace_id: UUID,
                           user_id: UUID) -> Objective:
    if data.objective is not None:
        return data.objective
    keys = scope(workspace_id, user_id, data.plan_id)
    plan = await owned_plan(connection, keys, lock=True)
    if plan["cancelled"] or plan["current_version"] != data.plan_version:
        raise stale()
    payload = await plan_payload(connection, plan)
    if payload["state"] != "ACCEPTED":
        raise ApiError(409, "plan_not_accepted", "Accept this plan version before starting.")
    return Objective.model_validate(payload["objective"])


async def owned_conversation(connection: AsyncConnection, keys: dict) -> None:
    exists = await connection.scalar(text("""
        SELECT 1 FROM orchestration.conversations
        WHERE workspace_id=:workspace AND user_id=:user AND conversation_id=:id
    """), keys)
    if not exists:
        raise missing()


@app.post(BASE + "/runs", status_code=202, response_model=RunView)
async def start_run(workspace_id: UUID, data: StartRun, key: Key, user_id: Actor, request: Request):
    keys = scope(workspace_id, user_id, uuid4())
    async with app.state.database.begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 5005))"),
                                 {"key": f"{workspace_id}:{user_id}:{key}"})
        existing = await connection.execute(text(f"""
            SELECT {RUN_FIELDS}, request_hash FROM orchestration.runs
            WHERE workspace_id=:workspace AND user_id=:user AND request_key=:key
        """), {**keys, "key": key})
        replay = existing.mappings().one_or_none()
        if replay is not None:
            if replay["request_hash"] != digest(data):
                raise ApiError(409, "idempotency_conflict", "The request key is already used.")
            return {name: value for name, value in replay.items() if name != "request_hash"}
        objective = await pinned_objective(connection, data, workspace_id, user_id)
        conversation = data.conversation_id
        if data.mode == "ASK":
            if conversation:
                await owned_conversation(connection, scope(workspace_id, user_id, conversation))
            else:
                conversation = uuid4()
                await connection.execute(text("""
                    INSERT INTO orchestration.conversations (conversation_id, workspace_id, user_id)
                    VALUES (:conversation, :workspace, :user)
                """), {**keys, "conversation": conversation})
        result = await connection.execute(text(f"""
            INSERT INTO orchestration.runs (
                run_id, workspace_id, user_id, interaction, input, conversation_id, plan_id, plan_version,
                request_id, request_key, request_hash
            ) VALUES (
                :id, :workspace, :user, :mode, CAST(:input AS jsonb), :conversation, :plan, :version,
                :request, :key, :hash
            ) RETURNING {RUN_FIELDS}
        """), {**keys, "mode": data.mode, "input": objective.model_dump_json(), "conversation": conversation,
               "plan": data.plan_id, "version": data.plan_version, "request": request_id(request),
               "key": key, "hash": digest(data)})
        return dict(result.mappings().one())


async def read_run(connection: AsyncConnection, keys: dict) -> dict:
    result = await connection.execute(text(f"""
        SELECT {RUN_FIELDS} FROM orchestration.runs WHERE workspace_id=:workspace AND user_id=:user AND run_id=:id
    """), keys)
    row = result.mappings().one_or_none()
    if row is None:
        raise missing()
    return dict(row)


@app.get(BASE + "/runs/{run_id}", response_model=RunView)
async def get_run(workspace_id: UUID, run_id: UUID, user_id: Actor):
    async with app.state.database.connect() as connection:
        return await read_run(connection, scope(workspace_id, user_id, run_id))


@app.get(BASE + "/runs/{run_id}/events", response_class=StreamingResponse)
async def run_events(workspace_id: UUID, run_id: UUID, user_id: Actor, request: Request):
    keys = scope(workspace_id, user_id, run_id)
    async with app.state.database.connect() as connection:
        initial = await read_run(connection, keys)

    async def snapshots():
        last: datetime | None = None
        row = initial
        for _ in range(24):
            try:
                if await request.is_disconnected() or await actor(workspace_id, request) != user_id:
                    return
            except ApiError:
                return
            if row["updated_at"] != last:
                yield "data: " + RunView.model_validate(row).model_dump_json() + "\n\n"
                last = row["updated_at"]
            else:
                yield ": waiting\n\n"
            if row["status"] in TERMINAL:
                return
            await asyncio.sleep(2)
            async with app.state.database.connect() as connection:
                row = await read_run(connection, keys)

    return StreamingResponse(snapshots(), media_type="text/event-stream",
                             headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"})


@app.post(BASE + "/runs/{run_id}/cancel", response_model=RunView)
async def cancel_run(workspace_id: UUID, run_id: UUID, user_id: Actor):
    keys = scope(workspace_id, user_id, run_id)
    async with app.state.database.begin() as connection:
        await connection.execute(text("""
            UPDATE orchestration.runs SET status='cancelled', lease_id=NULL, lease_until=NULL, updated_at=now()
            WHERE workspace_id=:workspace AND user_id=:user AND run_id=:id AND status IN ('queued', 'running')
        """), keys)
        return await read_run(connection, keys)


@app.get(BASE + "/conversations", response_model=list[Conversation])
async def list_conversations(workspace_id: UUID, user_id: Actor):
    async with app.state.database.connect() as connection:
        rows = await connection.execute(text("""
            SELECT conversation.conversation_id, conversation.created_at,
                (SELECT input->>'query' FROM orchestration.runs
                 WHERE conversation_id=conversation.conversation_id ORDER BY created_at LIMIT 1) AS name
            FROM orchestration.conversations conversation
            WHERE workspace_id=:workspace AND user_id=:user ORDER BY created_at DESC LIMIT 50
        """), {"workspace": workspace_id, "user": user_id})
        return [dict(row) for row in rows.mappings()]


@app.get(BASE + "/conversations/{conversation_id}", response_model=list[RunView])
async def get_conversation(workspace_id: UUID, conversation_id: UUID, user_id: Actor):
    keys = scope(workspace_id, user_id, conversation_id)
    async with app.state.database.connect() as connection:
        await owned_conversation(connection, keys)
        rows = await connection.execute(text(f"""
            SELECT {RUN_FIELDS} FROM orchestration.runs
            WHERE conversation_id=:id AND workspace_id=:workspace AND user_id=:user
            ORDER BY created_at DESC LIMIT 50
        """), keys)
        return [dict(row) for row in reversed(rows.mappings().all())]


@app.get("/internal/v1/workspaces/{workspace_id}/users/{user_id}/artifact-runs/{run_id}", include_in_schema=False)
async def artifact_run(workspace_id: UUID, user_id: UUID, run_id: UUID, request: Request):
    require_service(request, "X-Artifact-Service-Token", os.environ["ORCHESTRATION_ARTIFACT_TOKEN"])
    access = await authorize(app.state.client, workspace_id, user_id, request_id(request))
    if access.status_code != 200 or access.json().get("role") not in ("OWNER", "EDITOR"):
        raise missing()
    async with app.state.database.connect() as connection:
        found = await connection.execute(text("""
            SELECT input, result FROM orchestration.runs
            WHERE run_id=:id AND workspace_id=:workspace AND user_id=:user AND status='succeeded'
        """), scope(workspace_id, user_id, run_id))
        run = found.mappings().one_or_none()
        if run is None:
            raise missing()
        return dict(run)
