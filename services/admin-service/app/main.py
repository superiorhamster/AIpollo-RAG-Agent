"""Administrative views that preserve the underlying service ownership."""

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal
from uuid import UUID

import httpx
from fastapi import FastAPI, Request, Response
from pydantic import BaseModel

from rag_http import ACCESS_COOKIE, ACCESS_FORMAT, ApiError, health_response, install_http, request_id, unauthorized, unavailable

SERVICE = "admin-service"
AUTH = "http://auth-service:8000"
BACKENDS = ("auth-service", "workspace-service", "document-service", "ingestion-service", "retrieval-service",
            "agent-orchestrator", "artifact-service", "model-gateway")


class AccountUpdate(BaseModel):
    role: Literal["USER", "ADMIN"]
    disabled: bool


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with httpx.AsyncClient(timeout=4, trust_env=False) as client:
        app.state.client = client
        yield


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
install_http(app)


@app.get("/healthz")
async def health():
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness():
    try:
        response = await app.state.client.get(AUTH + "/readyz", timeout=2)
        ready = response.status_code == 200
    except httpx.HTTPError:
        ready = False
    return health_response(SERVICE, ready)


async def operator(request: Request) -> dict[str, str]:
    cookie = request.cookies.get(ACCESS_COOKIE)
    if not cookie or not ACCESS_FORMAT.fullmatch(cookie):
        raise unauthorized()
    headers = {"Cookie": f"{ACCESS_COOKIE}={cookie}", "X-Request-ID": request_id(request)}
    try:
        outcome = await app.state.client.get(AUTH + "/v1/auth/admin-access", headers=headers)
        if outcome.status_code == 401:
            raise unauthorized()
        if outcome.status_code == 403:
            raise ApiError(403, "forbidden", "Administrator access is required.")
        outcome.raise_for_status()
    except httpx.HTTPError as exc:
        raise unavailable() from exc
    return {**headers, "X-Admin-Service-Token": os.environ["ADMIN_DOMAIN_TOKEN"]}


async def relay(request: Request, url: str, payload: dict | None = None) -> Response:
    headers = await operator(request)
    try:
        response = await app.state.client.request(request.method, url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        raise unavailable() from exc
    out = {"Content-Type": response.headers["content-type"]} if "content-type" in response.headers else {}
    return Response(response.content, response.status_code, headers=out)


@app.get("/v1/admin/accounts")
async def accounts(request: Request):
    return await relay(request, AUTH + "/internal/v1/admin/accounts")


@app.patch("/v1/admin/accounts/{user_id}")
async def change_account(request: Request, user_id: UUID, data: AccountUpdate):
    return await relay(request, AUTH + f"/internal/v1/admin/accounts/{user_id}", data.model_dump())


@app.get("/v1/admin/audit")
async def audit(request: Request):
    return await relay(request, AUTH + "/internal/v1/admin/audit")


@app.get("/v1/admin/jobs")
async def jobs(request: Request):
    return await relay(request, "http://ingestion-service:8000/internal/v1/admin/jobs")


@app.post("/v1/admin/jobs/{job_id}/retry")
async def retry_job(request: Request, job_id: UUID):
    return await relay(request, f"http://ingestion-service:8000/internal/v1/admin/jobs/{job_id}/retry")


@app.get("/v1/admin/models")
async def models(request: Request):
    return await relay(request, "http://model-gateway:8000/internal/v1/admin/models")


@app.get("/v1/admin/services")
async def services(request: Request):
    await operator(request)

    async def probe(service: str):
        try:
            state = await app.state.client.get(f"http://{service}:8000/readyz", timeout=2)
            return {"service": service, "ready": state.status_code == 200}
        except httpx.HTTPError:
            return {"service": service, "ready": False}

    return await asyncio.gather(*(probe(service) for service in BACKENDS))
