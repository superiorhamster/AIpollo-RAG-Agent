"""Authorize source scope and rank grounded evidence."""

import os
import re
import unicodedata
from typing import Any
from uuid import UUID

import httpx
from fastapi import Request
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from rag_telemetry import propagate_trace
from rag_http import ACCESS_COOKIE, ACCESS_FORMAT, ApiError, request_id, unauthorized, unavailable
from rag_index import ActiveIndex, Chunk, EmbeddingConfig, EmbeddingResult, SourceSelection

document_list = TypeAdapter(list[ActiveIndex])
WORD = re.compile(r"[^\W_]+", re.UNICODE)


class SearchRequest(SourceSelection):
    query: str = Field(min_length=2, max_length=1800, pattern=r"\S")
    limit: int = Field(default=5, ge=1, le=10)


class Evidence(Chunk):
    document_id: UUID
    chunk_id: UUID
    name: str
    score: float


class SearchResult(BaseModel):
    evidence: list[Evidence]
    indexed_documents: list[UUID]


def words(value: str) -> set[str]:
    return set(WORD.findall(unicodedata.normalize("NFC", value.casefold())))


def rank(query: str, evidence: list[Evidence], limit: int) -> list[Evidence]:
    query_words = words(query)
    ordered = sorted(evidence, key=lambda item: (
        -(item.score + 0.08 * len(query_words & words(item.section + " " + item.text)) / max(1, len(query_words))),
        str(item.chunk_id),
    ))
    selected = []
    seen = set()
    for item in ordered:
        key = (item.document_id, " ".join(item.text.casefold().split()))
        if key in seen:
            continue
        selected.append(item)
        seen.add(key)
        if len(selected) == limit:
            break
    return selected


def match(field: str, values: list[str]) -> dict:
    return {"key": field, "match": {"any": values}}


async def visible_documents(client: httpx.AsyncClient, workspace_id: UUID, headers: dict[str, str]) -> dict[UUID, str]:
    response = await client.get(f"http://document-service:8000/v1/workspaces/{workspace_id}/documents",
                                headers=headers)
    if response.status_code == 401:
        raise unauthorized()
    if response.status_code == 404:
        raise ApiError(404, "not_found", "The workspace or one of its sources could not be found.")
    response.raise_for_status()
    return {UUID(item["document_id"]): item["name"] for item in response.json()}


async def candidates(
    client: httpx.AsyncClient,
    qdrant: httpx.AsyncClient,
    workspace_id: UUID,
    data: SearchRequest,
    names: dict[UUID, str],
    headers: dict[str, str],
) -> SearchResult:
    model_path = "http://model-gateway:8000/internal/v1"
    model_headers = {**headers, "X-Embedding-Service-Token": os.environ["MODEL_EMBEDDING_TOKEN"]}
    selected = [str(document_id) for document_id in dict.fromkeys(data.document_ids)]
    response = await client.get(model_path + "/embedding-config", headers=model_headers)
    if response.status_code == 503:
        raise ApiError(503, "model_unavailable", "The embedding model has not been configured.")
    response.raise_for_status()
    config = EmbeddingConfig.model_validate_json(response.content)
    response = await client.post(
        f"http://ingestion-service:8000/internal/v1/workspaces/{workspace_id}/active-indexes",
        headers={**headers, "X-Index-Service-Token": os.environ["INGESTION_RETRIEVAL_TOKEN"]},
        json={"document_ids": selected, "fingerprint": config.fingerprint},
    )
    response.raise_for_status()
    scope = {item.document_id: str(item.index_generation) for item in document_list.validate_json(response.content)
             if item.document_id in data.document_ids}
    if not scope:
        return SearchResult(evidence=[], indexed_documents=[])
    response = await client.post(
        model_path + "/embeddings", headers=model_headers, timeout=30,
        json={"texts": [data.query.strip()], "fingerprint": config.fingerprint},
    )
    response.raise_for_status()
    result = EmbeddingResult.model_validate_json(response.content)
    if len(result.vectors) != 1 or len(result.vectors[0]) != config.dimensions:
        raise ValueError("Unexpected search embedding dimensions")

    scope_filter = {"must": [
        {"key": "workspace_id", "match": {"value": str(workspace_id)}},
        match("document_id", [str(document_id) for document_id in scope]),
        match("generation", list(scope.values())),
    ]}
    prefetch_limit = max(25, data.limit * 4)
    response = await qdrant.post(f"/collections/rag_chunks_{config.fingerprint}/points/query", headers=headers, json={
        "prefetch": [
            {"query": result.vectors[0], "filter": scope_filter, "limit": prefetch_limit},
            {"query": {"text": data.query.strip()}, "using": "text", "filter": scope_filter, "limit": prefetch_limit},
        ],
        "query": {"fusion": "rrf"},
        "filter": scope_filter,
        "limit": prefetch_limit,
        "with_payload": True,
    })
    response.raise_for_status()
    evidence: list[Evidence] = []
    for point in response.json()["result"]["points"]:
        payload: dict[str, Any] = point["payload"]
        document_id = UUID(payload["document_id"])
        if (payload.get("workspace_id") != str(workspace_id) or document_id not in scope
                or payload.get("generation") != scope[document_id]):
            continue
        chunk = Chunk.model_validate(payload)
        evidence.append(Evidence(
            **chunk.model_dump(), document_id=document_id, chunk_id=point["id"],
            score=point["score"], name=names[document_id],
        ))
    return SearchResult(evidence=rank(data.query, evidence, data.limit), indexed_documents=list(scope))


async def search(
    workspace_id: UUID, data: SearchRequest, request: Request,
    client: httpx.AsyncClient, qdrant: httpx.AsyncClient,
) -> SearchResult:
    access = request.cookies.get(ACCESS_COOKIE)
    if not access or not ACCESS_FORMAT.fullmatch(access):
        raise unauthorized()
    headers = {"X-Request-ID": request_id(request)}
    propagate_trace(headers)
    document_headers = {**headers, "Cookie": f"{ACCESS_COOKIE}={access}"}
    try:
        names = await visible_documents(client, workspace_id, document_headers)
        if set(data.document_ids) - names.keys():
            raise ApiError(404, "not_found", "The workspace or one of its sources could not be found.")
        result = await candidates(client, qdrant, workspace_id, data, names, headers)
        current = await visible_documents(client, workspace_id, document_headers)
        result.evidence = [item for item in result.evidence if item.document_id in current]
        result.indexed_documents = [item for item in result.indexed_documents if item in current]
        return result
    except (ValueError, KeyError, TypeError, ValidationError, httpx.HTTPError) as exc:
        raise unavailable() from exc


async def delegated_search(
    workspace_id: UUID, user_id: UUID, data: SearchRequest, request: Request,
    client: httpx.AsyncClient, qdrant: httpx.AsyncClient,
) -> SearchResult:
    headers = {"X-Request-ID": request_id(request)}
    base = f"http://workspace-service:8000/internal/v1/workspaces/{workspace_id}/interaction-access"
    auth_headers = {**headers, "X-Interaction-Service-Token": os.environ["WORKSPACE_INTERACTION_TOKEN"]}
    document_headers = {**headers, "X-Retrieval-Service-Token": os.environ["DOCUMENT_RETRIEVAL_TOKEN"]}
    sources = f"http://document-service:8000/internal/v1/workspaces/{workspace_id}/retrieval-sources"

    async def scope() -> dict[UUID, str]:
        access = await client.get(base, params={"user_id": str(user_id)}, headers=auth_headers)
        if access.status_code in (401, 404):
            raise ApiError(404, "not_found", "The workspace or one of its sources could not be found.")
        access.raise_for_status()
        response = await client.get(sources, headers=document_headers)
        response.raise_for_status()
        return {UUID(item["document_id"]): item["name"] for item in response.json()}

    try:
        names = await scope()
        if set(data.document_ids) - names.keys():
            raise ApiError(404, "not_found", "The workspace or one of its sources could not be found.")
        result = await candidates(client, qdrant, workspace_id, data, names, headers)
        current = await scope()
        result.evidence = [item for item in result.evidence if item.document_id in current]
        result.indexed_documents = [item for item in result.indexed_documents if item in current]
        return result
    except (ValueError, KeyError, TypeError, ValidationError, httpx.HTTPError) as exc:
        raise unavailable() from exc
