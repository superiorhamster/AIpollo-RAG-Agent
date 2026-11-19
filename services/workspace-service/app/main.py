import asyncio
import json
import hmac
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Annotated, Literal
from uuid import UUID, uuid4

import httpx
from fastapi import Depends, FastAPI, Header, Request, Response
from pydantic import BaseModel, StringConstraints, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from rag_db import database_ready, install_database_errors, open_database
from rag_http import ACCESS_COOKIE, ACCESS_FORMAT, ApiError, health_response, install_http, request_id, require_service, unauthorized, unavailable

from rag_events import Event, enqueue, run_broker

from .research import Discovery, Reference, bibtex, normalize

SERVICE = "workspace-service"
MemberRole = Literal["VIEWER", "EDITOR"]
WorkspaceRole = Literal["OWNER", "VIEWER", "EDITOR"]


class Identity(BaseModel):
    user_id: UUID
    role: Literal["USER", "ADMIN"]


class WorkspaceName(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120, pattern=r"^[^\x00]+$")]


class Workspace(WorkspaceName):
    workspace_id: UUID
    role: WorkspaceRole


class MemberRoleInput(BaseModel):
    role: MemberRole


class Member(MemberRoleInput):
    user_id: UUID


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.shared_token = os.environ["AUTH_WORKSPACE_TOKEN"]
    if len(app.state.shared_token.encode()) < 32:
        raise ValueError("AUTH_WORKSPACE_TOKEN must contain at least 32 bytes.")
    app.state.document_token = os.environ["WORKSPACE_DOCUMENT_TOKEN"].encode()
    app.state.database = open_database()
    broker = asyncio.create_task(run_broker(app.state.database, "workspace.lifecycle", finish_cleanup, "workspace"))
    try:
        async with httpx.AsyncClient(
            base_url=os.environ["AUTH_URL"], timeout=2, trust_env=False,
        ) as client:
            app.state.auth = client
            async with httpx.AsyncClient(base_url="https://api.crossref.org", timeout=10, trust_env=False) as crossref:
                app.state.crossref = crossref
                yield
    finally:
        broker.cancel()
        with suppress(asyncio.CancelledError):
            await broker
        await app.state.database.dispose()


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None)
install_http(app)
install_database_errors(app)


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness() -> Response:
    try:
        ready = await database_ready(app.state.database, "workspace", "workspace_003")
        if ready:
            response = await app.state.auth.get("/readyz")
            ready = response.status_code == 200
    except httpx.HTTPError:
        ready = False
    return health_response(SERVICE, ready)


async def auth_get(request: Request, path: str, token: str | None = None) -> httpx.Response:
    headers = {
        "X-Workspace-Service-Token": app.state.shared_token,
        "X-Request-ID": request_id(request),
    }
    if token:
        headers["Cookie"] = f"{ACCESS_COOKIE}={token}"
    try:
        return await app.state.auth.get(path, headers=headers)
    except httpx.HTTPError as exc:
        raise unavailable() from exc


async def current_identity(request: Request) -> Identity:
    token = request.cookies.get(ACCESS_COOKIE)
    if not token or not ACCESS_FORMAT.fullmatch(token):
        raise unauthorized()
    response = await auth_get(request, "/internal/v1/session", token)
    if response.status_code == 401:
        raise unauthorized()
    if response.status_code != 200:
        raise unavailable()
    try:
        return Identity.model_validate_json(response.content)
    except ValidationError as exc:
        raise unavailable() from exc


Actor = Annotated[Identity, Depends(current_identity)]
WorkspaceKey = Annotated[UUID, Header(alias="Idempotency-Key")]

ACCESSIBLE = """
    SELECT w.workspace_id, w.name,
           CASE WHEN w.owner_id = :actor_id THEN 'OWNER' ELSE m.role END AS role
    FROM workspace.workspaces AS w
    LEFT JOIN workspace.memberships AS m ON m.workspace_id = w.workspace_id AND m.user_id = :actor_id
    WHERE w.deleting_at IS NULL AND (w.owner_id = :actor_id OR m.user_id IS NOT NULL)
"""


def not_found() -> ApiError:
    return ApiError(404, "not_found", "Workspace could not be found.")


def require_role(workspace: Workspace, *allowed: WorkspaceRole) -> None:
    if workspace.role not in allowed:
        raise ApiError(403, "forbidden", "Your workspace role does not allow this action.")


async def accessible_workspace(connection: AsyncConnection, workspace_id: UUID, actor_id: UUID) -> Workspace:
    result = await connection.execute(text(f"{ACCESSIBLE} AND w.workspace_id = :id"),
                                      {"actor_id": actor_id, "id": workspace_id})
    row = result.mappings().one_or_none()
    if row is None:
        raise not_found()
    return Workspace.model_validate(row)


async def lock_workspace(
    connection: AsyncConnection, workspace_id: UUID, actor_id: UUID, *allowed: WorkspaceRole,
) -> Workspace:
    # Check access before locking, then re-read it under the lock in a separate statement.
    require_role(await accessible_workspace(connection, workspace_id, actor_id), *allowed)
    found = await connection.scalar(text("""
        SELECT workspace_id FROM workspace.workspaces WHERE workspace_id = :id FOR UPDATE
    """), {"id": workspace_id})
    if found is None:
        raise not_found()
    workspace = await accessible_workspace(connection, workspace_id, actor_id)
    require_role(workspace, *allowed)
    return workspace


async def write_audit(
    connection: AsyncConnection, request: Request, actor: Identity, workspace_id: UUID,
    action: str, target_user_id: UUID | None = None,
) -> None:
    await connection.execute(text("""
        INSERT INTO workspace.audit (request_id, actor_id, action, outcome, workspace_id, target_user_id)
        VALUES (:request_id, :actor_id, :action, 'succeeded', :id, :target_id)
    """), {"request_id": request_id(request), "actor_id": actor.user_id, "action": action,
           "id": workspace_id, "target_id": target_user_id})


@app.get("/v1/workspaces")
async def list_workspaces(actor: Actor) -> list[Workspace]:
    async with app.state.database.connect() as connection:
        result = await connection.execute(text(f"{ACCESSIBLE} ORDER BY w.name, w.workspace_id"),
                                          {"actor_id": actor.user_id})
        return [Workspace.model_validate(row) for row in result.mappings()]


@app.post("/v1/workspaces", status_code=201)
async def create_workspace(data: WorkspaceName, key: WorkspaceKey, request: Request, actor: Actor) -> Workspace:
    workspace_id = uuid4()
    params = {"actor_id": actor.user_id, "key": key, "id": workspace_id, "name": data.name}
    async with app.state.database.begin() as connection:
        inserted = await connection.scalar(text("""
            INSERT INTO workspace.create_receipts (actor_id, idempotency_key, workspace_id, name)
            VALUES (:actor_id, :key, :id, :name) ON CONFLICT DO NOTHING RETURNING workspace_id
        """), params)
        if inserted is None:
            result = await connection.execute(text("""
                SELECT workspace_id, name FROM workspace.create_receipts
                WHERE actor_id = :actor_id AND idempotency_key = :key
            """), params)
            receipt = result.mappings().one()
            if receipt["name"] != data.name:
                raise ApiError(409, "idempotency_conflict", "This request key was already used for another name.")
            return Workspace(workspace_id=receipt["workspace_id"], name=receipt["name"], role="OWNER")

        await connection.execute(text("""
            INSERT INTO workspace.workspaces (workspace_id, owner_id, name) VALUES (:id, :actor_id, :name)
        """), params)
        await write_audit(connection, request, actor, workspace_id, "workspace.created")
    return Workspace(workspace_id=workspace_id, name=data.name, role="OWNER")


@app.get("/v1/workspaces/{workspace_id}")
async def get_workspace(workspace_id: UUID, actor: Actor) -> Workspace:
    async with app.state.database.connect() as connection:
        return await accessible_workspace(connection, workspace_id, actor.user_id)


@app.patch("/v1/workspaces/{workspace_id}")
async def rename(workspace_id: UUID, data: WorkspaceName, request: Request, actor: Actor) -> Workspace:
    async with app.state.database.begin() as connection:
        workspace = await lock_workspace(connection, workspace_id, actor.user_id, "OWNER", "EDITOR")
        if workspace.name != data.name:
            await connection.execute(text("UPDATE workspace.workspaces SET name = :name WHERE workspace_id = :id"),
                                     {"id": workspace_id, "name": data.name})
            await write_audit(connection, request, actor, workspace_id, "workspace.renamed")
    return Workspace(workspace_id=workspace_id, name=data.name, role=workspace.role)


@app.delete("/v1/workspaces/{workspace_id}", status_code=202)
async def delete_workspace(workspace_id: UUID, request: Request, actor: Actor) -> Response:
    async with app.state.database.begin() as connection:
        existing = await connection.scalar(text("""
            SELECT 1 FROM workspace.workspaces
            WHERE workspace_id = :id AND owner_id = :actor_id AND deleting_at IS NOT NULL
        """), {"id": workspace_id, "actor_id": actor.user_id})
        if not existing:
            try:
                await lock_workspace(connection, workspace_id, actor.user_id, "OWNER")
            except ApiError as exc:
                if exc.status_code != 404 or not await connection.scalar(text("""
                    SELECT 1 FROM workspace.workspaces
                    WHERE workspace_id = :id AND owner_id = :actor_id AND deleting_at IS NOT NULL
                """), {"id": workspace_id, "actor_id": actor.user_id}):
                    raise
                return Response(status_code=202)
            await connection.execute(text("""
                UPDATE workspace.workspaces SET deleting_at = now() WHERE workspace_id = :id
            """), {"id": workspace_id})
            await write_audit(connection, request, actor, workspace_id, "workspace.deleted")
            await enqueue(connection, "workspace", event_type="workspace.deletion_requested.v1",
                          workspace_id=workspace_id, actor_id=actor.user_id, request_id=request_id(request))
    return Response(status_code=202)


async def finish_cleanup(event: Event) -> None:
    if event.event_type != "workspace.documents_deleted.v1":
        return
    async with app.state.database.begin() as connection:
        await connection.execute(text("""
            DELETE FROM workspace.workspaces WHERE workspace_id = :id AND deleting_at IS NOT NULL
        """), {"id": event.workspace_id})


@app.get("/internal/v1/workspaces/{workspace_id}/document-access", include_in_schema=False)
async def document_access(workspace_id: UUID, request: Request) -> dict[str, str]:
    token = request.headers.get("X-Document-Service-Token", "").encode()
    if not hmac.compare_digest(token, app.state.document_token):
        raise unauthorized()
    actor = await current_identity(request)
    async with app.state.database.connect() as connection:
        workspace = await accessible_workspace(connection, workspace_id, actor.user_id)
    return {"role": workspace.role, "user_id": str(actor.user_id)}


@app.get("/v1/workspaces/{workspace_id}/members")
async def list_members(workspace_id: UUID, actor: Actor) -> list[Member]:
    async with app.state.database.begin() as connection:
        await lock_workspace(connection, workspace_id, actor.user_id, "OWNER")
        result = await connection.execute(text("""
            SELECT user_id, role FROM workspace.memberships WHERE workspace_id = :id ORDER BY user_id
        """), {"id": workspace_id})
        return [Member.model_validate(row) for row in result.mappings()]


def require_collaborator(actor: Identity, user_id: UUID) -> None:
    if user_id == actor.user_id:
        raise ApiError(409, "fixed_owner", "The owner role cannot be changed here.")


@app.put("/v1/workspaces/{workspace_id}/members/{user_id}")
async def set_member(workspace_id: UUID, user_id: UUID, data: MemberRoleInput, request: Request, actor: Actor) -> Member:
    async with app.state.database.begin() as connection:
        await lock_workspace(connection, workspace_id, actor.user_id, "OWNER")
        require_collaborator(actor, user_id)
        user = await auth_get(request, f"/internal/v1/users/{user_id}")
        if user.status_code == 404:
            raise ApiError(404, "not_found", "Account could not be found.")
        if user.status_code != 204:
            raise unavailable()
        changed = await connection.scalar(text("""
            INSERT INTO workspace.memberships (workspace_id, user_id, role) VALUES (:id, :user_id, :role)
            ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role
            WHERE workspace.memberships.role <> excluded.role RETURNING user_id
        """), {"id": workspace_id, "user_id": user_id, "role": data.role})
        if changed:
            await write_audit(connection, request, actor, workspace_id, "membership.granted", user_id)
    return Member(user_id=user_id, role=data.role)


@app.delete("/v1/workspaces/{workspace_id}/members/{user_id}", status_code=204)
async def remove_member(workspace_id: UUID, user_id: UUID, request: Request, actor: Actor) -> Response:
    async with app.state.database.begin() as connection:
        await lock_workspace(connection, workspace_id, actor.user_id, "OWNER")
        require_collaborator(actor, user_id)
        removed = await connection.scalar(text("""
            DELETE FROM workspace.memberships WHERE workspace_id = :id AND user_id = :user_id RETURNING user_id
        """), {"id": workspace_id, "user_id": user_id})
        if removed:
            await write_audit(connection, request, actor, workspace_id, "membership.revoked", user_id)
    return Response(status_code=204)


@app.get("/internal/v1/workspaces/{workspace_id}/interaction-access", include_in_schema=False)
async def interaction_access(workspace_id: UUID, request: Request, user_id: UUID | None = None) -> dict[str, str]:
    require_service(request, "X-Interaction-Service-Token", os.environ["WORKSPACE_INTERACTION_TOKEN"])
    if user_id is None:
        user_id = (await current_identity(request)).user_id
    else:
        response = await auth_get(request, f"/internal/v1/users/{user_id}")
        if response.status_code == 404:
            raise not_found()
        if response.status_code != 204:
            raise unavailable()
    async with app.state.database.connect() as connection:
        workspace = await accessible_workspace(connection, workspace_id, user_id)
    return {"role": workspace.role, "user_id": str(user_id)}


REFERENCES = "/v1/workspaces/{workspace_id}/references"


@app.post(REFERENCES + "/discover", response_model=list[Reference])
async def discover(workspace_id: UUID, data: Discovery, actor: Actor) -> list[Reference]:
    async with app.state.database.connect() as connection:
        await accessible_workspace(connection, workspace_id, actor.user_id)
    params = {"query.bibliographic": data.query, "rows": "10", "select": "DOI,title,author,issued"}
    if email := os.environ.get("CROSSREF_MAILTO"):
        params["mailto"] = email
    try:
        response = await app.state.crossref.get("/works", params=params,
                                                 headers={"User-Agent": "SuperAgenticRAG/1.0"})
        response.raise_for_status()
        results = []
        for entry in response.json()["message"]["items"]:
            try:
                results.append(normalize(entry))
            except (ValueError, KeyError, TypeError):
                continue
        return results
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise ApiError(503, "discovery_unavailable", "Crossref is temporarily unavailable.") from exc


@app.get(REFERENCES, response_model=list[Reference])
async def references(workspace_id: UUID, actor: Actor) -> list[Reference]:
    async with app.state.database.connect() as connection:
        await accessible_workspace(connection, workspace_id, actor.user_id)
        rows = await connection.execute(text("""
            SELECT doi, title, authors, publication_year, tags FROM workspace.reference_items
            WHERE workspace_id=:id ORDER BY title, doi LIMIT 500
        """), {"id": workspace_id})
        return [Reference.model_validate(row) for row in rows.mappings()]


@app.post(REFERENCES, response_model=Reference, status_code=201)
async def save_reference(workspace_id: UUID, data: Reference, actor: Actor) -> Reference:
    async with app.state.database.begin() as connection:
        await lock_workspace(connection, workspace_id, actor.user_id, "OWNER", "EDITOR")
        await connection.execute(text("""
            INSERT INTO workspace.reference_items (workspace_id, doi, title, authors, publication_year, tags)
            VALUES (:workspace, :doi, :title, CAST(:authors AS jsonb), :year, CAST(:tags AS jsonb))
            ON CONFLICT (workspace_id, doi) DO UPDATE SET title=EXCLUDED.title,
              authors=EXCLUDED.authors, publication_year=EXCLUDED.publication_year, tags=EXCLUDED.tags
        """), {"workspace": workspace_id, "doi": data.doi, "title": data.title,
               "authors": json.dumps(data.authors), "year": data.publication_year, "tags": json.dumps(data.tags)})
    return data


@app.get(REFERENCES + "/export")
async def export_references(workspace_id: UUID, actor: Actor) -> Response:
    data = bibtex(await references(workspace_id, actor))
    return Response(data, media_type="application/x-bibtex",
                    headers={"Content-Disposition": "attachment; filename=references.bib"})


@app.post(REFERENCES + "/remove", status_code=204)
async def remove_reference(workspace_id: UUID, data: Reference, actor: Actor) -> Response:
    async with app.state.database.begin() as connection:
        await lock_workspace(connection, workspace_id, actor.user_id, "OWNER", "EDITOR")
        await connection.execute(text("DELETE FROM workspace.reference_items WHERE workspace_id=:ws AND doi=:doi"),
                                 {"ws": workspace_id, "doi": data.doi})
    return Response(status_code=204)
