"""Store an index generation in Qdrant using stable point identifiers."""

import asyncio
import hmac
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from http.cookiejar import CookieJar, DefaultCookiePolicy
from uuid import UUID, uuid5

import httpx
from fastapi import FastAPI, Request, Response

from rag_http import ApiError, health_response, install_http, request_id, require_service, unauthorized, unavailable
from rag_runtime import RuntimeBudgets
from rag_index import MAX_CHUNKS, EmbeddingConfig, IndexBatch

from .search import SearchRequest, SearchResult, delegated_search, search

SERVICE = "retrieval-service"
PREFIX = "rag_chunks_"


class RejectCookies(DefaultCookiePolicy):
    def set_ok(self, cookie, request) -> bool:
        return False


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    RuntimeBudgets.from_env()  # Reject invalid deadline combinations before serving traffic.
    app.state.token = os.environ["INGESTION_RETRIEVAL_TOKEN"].encode()
    async with httpx.AsyncClient(
        base_url=os.environ.get("QDRANT_URL", "http://qdrant:6333"),
        timeout=httpx.Timeout(8, connect=3), trust_env=False,
    ) as client, httpx.AsyncClient(
        timeout=10, trust_env=False, cookies=CookieJar(policy=RejectCookies()),
    ) as services:
        app.state.services = services
        app.state.qdrant = client
        app.state.prepared = set()
        yield


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
install_http(app)


def verify_caller(request: Request) -> None:
    if not hmac.compare_digest(request.headers.get("X-Index-Service-Token", "").encode(), app.state.token):
        raise unauthorized()


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness():
    try:
        response = await app.state.qdrant.get("/readyz", timeout=2)
        ready = response.status_code == 200
    except httpx.HTTPError:
        ready = False
    return health_response(SERVICE, ready)


async def prepare(config: EmbeddingConfig, headers: dict[str, str]) -> str:
    name = PREFIX + config.fingerprint
    path = f"/collections/{name}"
    if name in app.state.prepared:
        return path
    client = app.state.qdrant
    existing = await client.get(path, headers=headers)
    if existing.status_code == 404:
        created = await client.put(path, headers=headers, json={
            "vectors": {"size": config.dimensions, "distance": "Cosine", "on_disk": True},
            "on_disk_payload": True,
        })
        if created.status_code != 409:
            created.raise_for_status()
        existing = await client.get(path, headers=headers)
    existing.raise_for_status()
    params = existing.json()["result"]["config"]["params"]["vectors"]
    if params["size"] != config.dimensions or params["distance"] != "Cosine":
        raise ValueError("Existing vector collection has a different schema")
    fields = {
        "workspace_id": "keyword", "document_id": "keyword", "generation": "keyword",
        "text": {"type": "text", "tokenizer": "word", "lowercase": True, "scoring": {"type": "bm25"}},
    }
    for field, schema in fields.items():
        if field not in existing.json()["result"]["payload_schema"]:
            response = await client.put(path + "/index", params={"wait": "true"}, headers=headers,
                                        json={"field_name": field, "field_schema": schema})
            response.raise_for_status()
    app.state.prepared.add(name)
    return path


@app.put("/internal/v1/workspaces/{workspace_id}/documents/{document_id}/index-batch", status_code=204)
async def index_batch(workspace_id: UUID, document_id: UUID, batch: IndexBatch, request: Request) -> Response:
    verify_caller(request)
    if (len(batch.chunks) != len(batch.vectors) or batch.offset + len(batch.chunks) > MAX_CHUNKS
            or any(len(vector) != batch.config.dimensions or not any(vector) for vector in batch.vectors)):
        raise ApiError(422, "invalid_index_batch", "The batch does not match the index schema.")
    points = [
        {"id": str(uuid5(batch.generation, str(ordinal))), "vector": vector,
         "payload": {**chunk.model_dump(mode="json"), "workspace_id": str(workspace_id),
                     "document_id": str(document_id), "generation": str(batch.generation),
                     "ordinal": ordinal}}
        for ordinal, (chunk, vector) in enumerate(zip(batch.chunks, batch.vectors), start=batch.offset)
    ]
    headers = {"X-Request-ID": request_id(request)}
    try:
        path = await prepare(batch.config, headers)
        response = await app.state.qdrant.put(
            path + "/points", params={"wait": "true", "ordering": "strong"}, headers=headers,
            json={"points": points},
        )
        if response.status_code == 404:
            app.state.prepared.discard(PREFIX + batch.config.fingerprint)
        response.raise_for_status()
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise unavailable() from exc
    return Response(status_code=204)


@app.delete("/internal/v1/workspaces/{workspace_id}/documents/{document_id}/index", status_code=204)
@app.delete("/internal/v1/workspaces/{workspace_id}/index", status_code=204)
async def delete_index(workspace_id: UUID, request: Request, document_id: UUID | None = None) -> Response:
    verify_caller(request)
    headers = {"X-Request-ID": request_id(request)}
    filters = [{"key": "workspace_id", "match": {"value": str(workspace_id)}}]
    if document_id:
        filters.append({"key": "document_id", "match": {"value": str(document_id)}})
    try:
        response = await app.state.qdrant.get("/collections", headers=headers)
        response.raise_for_status()
        for collection in response.json()["result"]["collections"]:
            name = collection["name"]
            if not name.startswith(PREFIX):
                continue
            deleted = await app.state.qdrant.post(
                f"/collections/{name}/points/delete", params={"wait": "true", "ordering": "strong"},
                headers=headers, json={"filter": {"must": filters}},
            )
            if deleted.status_code != 404:
                deleted.raise_for_status()
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise unavailable() from exc
    return Response(status_code=204)

@app.post("/v1/workspaces/{workspace_id}/search")
async def workspace_search(workspace_id: UUID, data: SearchRequest, request: Request) -> SearchResult:
    try:
        async with asyncio.timeout(RuntimeBudgets.from_env().search):
            return await search(workspace_id, data, request, app.state.services, app.state.qdrant)
    except TimeoutError as exc:
        raise unavailable() from exc


@app.post("/internal/v1/workspaces/{workspace_id}/users/{user_id}/search", include_in_schema=False)
async def worker_search(workspace_id: UUID, user_id: UUID, data: SearchRequest, request: Request) -> SearchResult:
    require_service(request, "X-Interaction-Service-Token", os.environ["RETRIEVAL_INTERACTION_TOKEN"])
    try:
        async with asyncio.timeout(RuntimeBudgets.from_env().search):
            return await delegated_search(workspace_id, user_id, data, request, app.state.services, app.state.qdrant)
    except TimeoutError as exc:
        raise unavailable() from exc
