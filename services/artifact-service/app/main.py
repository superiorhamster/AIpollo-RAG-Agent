"""Publish, read and export cited workspace artifacts."""

import json
import os
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Annotated, Literal
from uuid import UUID, uuid4

import httpx
from docx import Document
from fastapi import Depends, FastAPI, Request, Response
from pydantic import BaseModel, StringConstraints
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from rag_db import database_ready, install_database_errors, open_database
from rag_http import ACCESS_COOKIE, ACCESS_FORMAT, ApiError, health_response, install_http, request_id, unauthorized, unavailable

SERVICE = "artifact-service"
BASE = "/v1/workspaces/{workspace_id}/artifacts"
META = "artifact_id, workspace_id, user_id, run_id, name, kind, created_at, updated_at"


class ActorInfo(BaseModel):
    user_id: UUID
    role: Literal["OWNER", "EDITOR", "VIEWER"]


class Name(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150,
                                           pattern=r"^[^\x00-\x1f]+$")]


class Publish(Name):
    run_id: UUID


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.database = open_database()
    try:
        async with httpx.AsyncClient(timeout=8, trust_env=False) as client:
            app.state.client = client
            yield
    finally:
        await app.state.database.dispose()


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
install_http(app)
install_database_errors(app)


@app.get("/healthz")
async def health():
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def ready():
    return health_response(SERVICE, await database_ready(app.state.database, "artifacts", "artifacts_001"))


def missing():
    return ApiError(404, "not_found", "The artifact or workspace could not be found.")


def denied():
    return ApiError(403, "forbidden", "Your workspace role does not allow this action.")


async def access(workspace_id: UUID, request: Request) -> ActorInfo:
    token = request.cookies.get(ACCESS_COOKIE)
    if not token or not ACCESS_FORMAT.fullmatch(token):
        raise unauthorized()
    try:
        result = await app.state.client.get(
            f"http://workspace-service:8000/internal/v1/workspaces/{workspace_id}/interaction-access",
            headers={"X-Interaction-Service-Token": os.environ["WORKSPACE_INTERACTION_TOKEN"],
                     "X-Request-ID": request_id(request), "Cookie": f"{ACCESS_COOKIE}={token}"},
        )
        if result.status_code == 404:
            raise missing()
        if result.status_code == 401:
            raise unauthorized()
        result.raise_for_status()
        return ActorInfo.model_validate_json(result.content)
    except (httpx.HTTPError, ValueError) as exc:
        raise unavailable() from exc


Actor = Annotated[ActorInfo, Depends(access)]


async def visible_sources(workspace: UUID, ids: list[UUID], request: Request) -> None:
    token = request.cookies[ACCESS_COOKIE]
    try:
        response = await app.state.client.get(
            f"http://document-service:8000/v1/workspaces/{workspace}/documents",
            headers={"Cookie": f"{ACCESS_COOKIE}={token}", "X-Request-ID": request_id(request)},
        )
        if response.status_code == 404:
            raise missing()
        response.raise_for_status()
        available = {UUID(item["document_id"]) for item in response.json()}
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise unavailable() from exc
    if set(ids) - available:
        raise ApiError(409, "source_unavailable", "One or more sources were removed from the workspace.")


async def get_item(connection: AsyncConnection, workspace: UUID, identifier: UUID, lock: bool = False):
    rows = await connection.execute(text(f"""
        SELECT {META}, body, source_ids FROM artifacts.items WHERE workspace_id=:workspace AND artifact_id=:id
    """ + (" FOR UPDATE" if lock else "")), {"workspace": workspace, "id": identifier})
    item = rows.mappings().one_or_none()
    if item is None:
        raise missing()
    return item


def may_manage(item, actor: ActorInfo) -> None:
    if actor.role == "OWNER" or (actor.role == "EDITOR" and actor.user_id == item["user_id"]):
        return
    raise denied()


@app.get(BASE)
async def listing(workspace_id: UUID, _actor: Actor):
    async with app.state.database.connect() as connection:
        rows = await connection.execute(text(f"""
            SELECT {META} FROM artifacts.items WHERE workspace_id=:workspace ORDER BY created_at DESC LIMIT 100
        """), {"workspace": workspace_id})
        return [dict(item) for item in rows.mappings()]


@app.post(BASE, status_code=201)
async def publish(workspace_id: UUID, data: Publish, actor: Actor, request: Request):
    if actor.role == "VIEWER":
        raise denied()
    try:
        response = await app.state.client.get(
            f"http://agent-orchestrator:8000/internal/v1/workspaces/{workspace_id}"
            f"/users/{actor.user_id}/artifact-runs/{data.run_id}",
            headers={"X-Artifact-Service-Token": os.environ["ORCHESTRATION_ARTIFACT_TOKEN"],
                     "X-Request-ID": request_id(request)},
        )
        if response.status_code == 404:
            raise missing()
        response.raise_for_status()
        source = response.json()
        body = source["result"]
        ids = sorted({UUID(cite["document_id"]) for claim in body["claims"] for cite in claim["citations"]})
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise unavailable() from exc
    if not ids:
        raise ApiError(409, "empty_artifact", "There is no grounded output to save.")
    await visible_sources(workspace_id, ids, request)
    async with app.state.database.begin() as connection:
        params = {"id": uuid4(), "workspace": workspace_id, "user": actor.user_id, "run": data.run_id,
                  "name": data.name, "kind": source["input"].get("task", "answer"),
                  "body": json.dumps(body, ensure_ascii=False), "sources": ids}
        found = await connection.execute(text(f"""
            INSERT INTO artifacts.items (artifact_id, workspace_id, user_id, run_id, name, kind, body, source_ids)
            VALUES (:id, :workspace, :user, :run, :name, :kind, CAST(:body AS jsonb), CAST(:sources AS uuid[]))
            ON CONFLICT (workspace_id, run_id) DO NOTHING RETURNING {META}
        """), params)
        item = found.mappings().one_or_none()
        if item is None:
            found = await connection.execute(text(f"""
                SELECT {META} FROM artifacts.items WHERE workspace_id=:workspace AND run_id=:run
            """), params)
            item = found.mappings().one()
        return dict(item)


@app.get(BASE + "/{artifact_id}")
async def detail(workspace_id: UUID, artifact_id: UUID, actor: Actor, request: Request):
    async with app.state.database.connect() as connection:
        item = await get_item(connection, workspace_id, artifact_id)
    await visible_sources(workspace_id, item["source_ids"], request)
    return {**dict(item), "can_manage": actor.role == "OWNER" or (
        actor.role == "EDITOR" and actor.user_id == item["user_id"]
    )}


@app.patch(BASE + "/{artifact_id}")
async def rename(workspace_id: UUID, artifact_id: UUID, data: Name, actor: Actor):
    async with app.state.database.begin() as connection:
        item = await get_item(connection, workspace_id, artifact_id, lock=True)
        may_manage(item, actor)
        found = await connection.execute(text(f"""
            UPDATE artifacts.items SET name=:name, updated_at=now()
            WHERE workspace_id=:workspace AND artifact_id=:id RETURNING {META}
        """), {"workspace": workspace_id, "id": artifact_id, "name": data.name})
        return dict(found.mappings().one())


@app.delete(BASE + "/{artifact_id}", status_code=204)
async def delete(workspace_id: UUID, artifact_id: UUID, actor: Actor):
    async with app.state.database.begin() as connection:
        item = await get_item(connection, workspace_id, artifact_id, lock=True)
        may_manage(item, actor)
        await connection.execute(text("""
            DELETE FROM artifacts.items WHERE workspace_id=:workspace AND artifact_id=:id
        """), {"workspace": workspace_id, "id": artifact_id})
    return Response(status_code=204)


def citation_text(citation: dict) -> str:
    return f'{citation["name"]}, page {citation["page"]}'


def make_docx(name: str, claims: list[dict]) -> bytes:
    document = Document()
    clean = lambda value: re.sub(r"[^\x09\x0a\x0d\x20-\ud7ff\ue000-\ufffd\U00010000-\U0010ffff]", "", value)
    document.add_heading(clean(name), 0)
    for claim in claims:
        document.add_paragraph(clean(claim["text"]))
        for key, value in claim.get("fields", {}).items():
            document.add_paragraph(clean(f"{key.title()}: {value}"))
        document.add_paragraph(clean("; ".join(citation_text(item) for item in claim["citations"])))
    with BytesIO() as data:
        document.save(data)
        return data.getvalue()


@app.get(BASE + "/{artifact_id}/export/{format}")
async def export(workspace_id: UUID, artifact_id: UUID, format: Literal["md", "docx"],
                 actor: Actor, request: Request):
    item = await detail(workspace_id, artifact_id, actor, request)
    claims = item["body"]["claims"]
    if format == "docx":
        data = await run_in_threadpool(make_docx, item["name"], claims)
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        lines = [f'# {item["name"]}', ""]
        for claim in claims:
            lines.extend([claim["text"], ""])
            lines.extend(f"- **{key.title()}** {value}" for key, value in claim.get("fields", {}).items())
            lines.extend(["", *["- " + citation_text(item) for item in claim["citations"]], ""])
        data, mime = "\n".join(lines).encode(), "text/markdown"
    return Response(data, media_type=mime,
                    headers={"Content-Disposition": f'attachment; filename="artifact-{artifact_id}.{format}"'})
