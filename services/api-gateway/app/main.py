import asyncio
import hashlib
import os
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from http.cookiejar import CookieJar, DefaultCookiePolicy
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from redis.exceptions import RedisError

from rag_runtime import RuntimeBudgets
from rag_telemetry import propagate_trace
from rag_http import (
    ACCESS_COOKIE, ACCESS_FORMAT, REFRESH_COOKIE, REFRESH_FORMAT,
    ApiError, health_response, install_http, request_id, unavailable,
)
from rag_limits import open_redis, require_budget

SERVICE = "api-gateway"
UUID_PATH = r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"
AUTH_PATHS = {
    "auth/register": "POST",
    "auth/login": "POST",
    "auth/logout": "POST",
    "auth/refresh": "POST",
    "auth/me": "GET",
    "auth/password-reset": "POST",
    "auth/password-reset/confirm": "POST",
    "auth/admin-access": "GET",
}
COOKIE_ROUTES = {"auth/login", "auth/logout", "auth/refresh"}
ADMIN_PATHS = (
    (re.compile(r"admin/(?:accounts|audit|jobs|models|services)"), ("GET",)),
    (re.compile(rf"admin/accounts/{UUID_PATH}"), ("PATCH",)),
    (re.compile(rf"admin/jobs/{UUID_PATH}/retry"), ("POST",)),
)
ARTIFACT_PATHS = (
    (re.compile(rf"workspaces/{UUID_PATH}/artifacts"), ("GET", "POST")),
    (re.compile(rf"workspaces/{UUID_PATH}/artifacts/{UUID_PATH}"), ("GET", "PATCH", "DELETE")),
    (re.compile(rf"workspaces/{UUID_PATH}/artifacts/{UUID_PATH}/export/(?:md|docx)"), ("GET",)),
)
WORKSPACE_PATHS = (
    (re.compile(rf"workspaces/{UUID_PATH}/references"), ("GET", "POST")),
    (re.compile(rf"workspaces/{UUID_PATH}/references/(?:discover|remove)"), ("POST",)),
    (re.compile(rf"workspaces/{UUID_PATH}/references/export"), ("GET",)),
    (re.compile(r"workspaces"), ("GET", "POST")),
    (re.compile(rf"workspaces/{UUID_PATH}"), ("GET", "PATCH", "DELETE")),
    (re.compile(rf"workspaces/{UUID_PATH}/members"), ("GET",)),
    (re.compile(rf"workspaces/{UUID_PATH}/members/{UUID_PATH}"), ("PUT", "DELETE")),
)
INTERACTION_PATHS = (
    (re.compile(rf"workspaces/{UUID_PATH}/workflow-features"), ("GET",)),
    (re.compile(rf"workspaces/{UUID_PATH}/(?:plans|runs)"), ("POST",)),
    (re.compile(rf"workspaces/{UUID_PATH}/plans/{UUID_PATH}"), ("GET", "PATCH")),
    (re.compile(rf"workspaces/{UUID_PATH}/plans/{UUID_PATH}/(?:accept|regenerate|cancel)"), ("POST",)),
    (re.compile(rf"workspaces/{UUID_PATH}/runs/{UUID_PATH}/cancel"), ("POST",)),
    (re.compile(rf"workspaces/{UUID_PATH}/runs/{UUID_PATH}(?:/events|/steps)?"), ("GET",)),
    (re.compile(rf"workspaces/{UUID_PATH}/conversations(?:/{UUID_PATH})?"), ("GET",)),
)
WORKSPACE_SEARCH = re.compile(rf"workspaces/{UUID_PATH}/search")
DOCUMENT_LIST = re.compile(rf"workspaces/{UUID_PATH}/documents")
DOCUMENT_PATHS = (
    (re.compile(rf"workspaces/{UUID_PATH}/documents/{UUID_PATH}/annotations"), ("GET", "POST")),
    (re.compile(rf"workspaces/{UUID_PATH}/documents/{UUID_PATH}/annotations/{UUID_PATH}"), ("DELETE",)),
    (DOCUMENT_LIST, ("GET", "POST")),
    (re.compile(rf"workspaces/{UUID_PATH}/documents/{UUID_PATH}"), ("GET", "PATCH", "DELETE")),
    (re.compile(rf"workspaces/{UUID_PATH}/documents/{UUID_PATH}/jobs"), ("GET",)),
    (re.compile(rf"workspaces/{UUID_PATH}/documents/{UUID_PATH}/(?:original|preview)"), ("GET", "HEAD")),
)
MAX_BODY_BYTES = 16 * 1024
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


class RejectUpstreamCookies(DefaultCookiePolicy):
    def set_ok(self, cookie, request) -> bool:
        return False


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    RuntimeBudgets.from_env()  # Reject invalid deadline combinations before serving traffic.
    origin = os.environ["WEB_ORIGIN"]
    parsed = urlsplit(origin)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or origin != f"{parsed.scheme}://{parsed.netloc}":
        raise ValueError("WEB_ORIGIN must contain only the browser scheme, hostname, and optional port.")
    app.state.web_origin = origin
    app.state.auth_url = os.environ["AUTH_URL"].rstrip("/")
    app.state.workspace_url = os.environ["WORKSPACE_URL"].rstrip("/")
    app.state.document_url = os.environ["DOCUMENT_URL"].rstrip("/")
    app.state.admin_url = os.environ["ADMIN_URL"].rstrip("/")
    app.state.artifact_url = os.environ["ARTIFACT_URL"].rstrip("/")
    app.state.orchestrator_url = os.environ["ORCHESTRATOR_URL"].rstrip("/")
    app.state.retrieval_url = os.environ["RETRIEVAL_URL"].rstrip("/")
    app.state.ingestion_url = os.environ["INGESTION_URL"].rstrip("/")
    app.state.peer_limit = int(os.environ.get("AUTH_PEER_LIMIT", "100"))
    app.state.rate_window = int(os.environ.get("AUTH_RATE_WINDOW_SECONDS", "900"))
    if min(app.state.peer_limit, app.state.rate_window) < 1:
        raise ValueError("Gateway rate limits must be positive.")
    app.state.redis = open_redis(os.environ["REDIS_URL"])
    try:
        async with httpx.AsyncClient(
            timeout=4, trust_env=False, cookies=CookieJar(policy=RejectUpstreamCookies()),
        ) as client:
            app.state.client = client
            yield
    finally:
        await app.state.redis.aclose()


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
install_http(app)


@app.get("/openapi.json", include_in_schema=False)
async def public_contract() -> FileResponse:
    return FileResponse(Path(__file__).with_name("openapi-v1.json"), media_type="application/json")


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness() -> Response:
    try:
        urls = (
            app.state.auth_url, app.state.workspace_url, app.state.document_url, app.state.ingestion_url,
            app.state.retrieval_url, app.state.orchestrator_url, app.state.artifact_url, app.state.admin_url,
        )
        redis_ready, *responses = await asyncio.gather(
            app.state.redis.ping(),
            *(app.state.client.get(f"{url}/readyz") for url in urls),
        )
        ready = redis_ready and all(response.status_code == 200 for response in responses)
    except (httpx.HTTPError, RedisError):
        ready = False
    return health_response(SERVICE, ready)


def upstream_for(path: str, method: str) -> str:
    if path in AUTH_PATHS:
        upstream, allowed = app.state.auth_url, (AUTH_PATHS[path],)
    elif operation := next((methods for pattern, methods in ADMIN_PATHS if pattern.fullmatch(path)), None):
        upstream, allowed = app.state.admin_url, operation
    elif artifact := next((methods for pattern, methods in ARTIFACT_PATHS if pattern.fullmatch(path)), None):
        upstream, allowed = app.state.artifact_url, artifact
    elif interaction := next((methods for pattern, methods in INTERACTION_PATHS if pattern.fullmatch(path)), None):
        upstream, allowed = app.state.orchestrator_url, interaction
    elif WORKSPACE_SEARCH.fullmatch(path):
        upstream, allowed = app.state.retrieval_url, ("POST",)
    else:
        matched = next((methods for pattern, methods in DOCUMENT_PATHS if pattern.fullmatch(path)), None)
        if matched:
            upstream, allowed = app.state.document_url, matched
        else:
            for pattern, methods in WORKSPACE_PATHS:
                if pattern.fullmatch(path):
                    upstream, allowed = app.state.workspace_url, methods
                    break
            else:
                raise ApiError(404, "not_found", "Route could not be found.")
    if method not in allowed:
        raise ApiError(405, "method_not_allowed", "This method is unavailable for the route.",
                       {"Allow": ", ".join(allowed)})
    return upstream


async def read_body(request: Request) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            raise ApiError(413, "body_too_large", "The request body is too large.")
        body.extend(chunk)
    if body and request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise ApiError(415, "unsupported_media_type", "Use an application/json request body.")
    return bytes(body)


@app.api_route("/v1/{path:path}", methods=["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"], include_in_schema=False)
async def proxy(request: Request, path: str) -> Response:
    method = request.method
    upstream = upstream_for(path, method)
    if method not in ("GET", "HEAD") and request.headers.getlist("origin") != [app.state.web_origin]:
        raise ApiError(403, "invalid_origin", "This request must come from the configured web origin.")
    if path in ("auth/register", "auth/login", "auth/password-reset", "auth/password-reset/confirm"):
        peer = request.client.host if request.client else "unknown"
        key = hashlib.sha256(peer.encode()).hexdigest()
        await require_budget(app.state.redis, f"gateway:{path}:{key}", app.state.peer_limit, app.state.rate_window)

    upload = method == "POST" and DOCUMENT_LIST.fullmatch(path) is not None
    search = WORKSPACE_SEARCH.fullmatch(path) is not None
    stream = (
        (upstream == app.state.document_url and path.endswith(("/preview", "/original")))
        or (upstream == app.state.orchestrator_url and path.endswith("/events"))
    )
    if upload:
        if request.headers.get("content-type", "").split(";", 1)[0] != "application/octet-stream":
            raise ApiError(415, "unsupported_media_type", "Send the file as application/octet-stream.")
        length = request.headers.get("content-length", "")
        if length.isdecimal() and int(length) > MAX_UPLOAD_BYTES:
            raise ApiError(413, "file_too_large", "Files may be up to 25 MiB.")
    body = request.stream() if upload else await read_body(request)
    headers = {"X-Request-ID": request_id(request)}
    cookies = []
    access = request.cookies.get(ACCESS_COOKIE)
    if access and ACCESS_FORMAT.fullmatch(access):
        cookies.append(f"{ACCESS_COOKIE}={access}")
    refresh = request.cookies.get(REFRESH_COOKIE)
    if path in COOKIE_ROUTES and refresh and REFRESH_FORMAT.fullmatch(refresh):
        cookies.append(f"{REFRESH_COOKIE}={refresh}")
    if cookies:
        headers["Cookie"] = "; ".join(cookies)
    for name in ("content-type", "idempotency-key", "x-filename", "range"):
        if name in request.headers:
            headers[name] = request.headers[name]
    propagate_trace(headers)
    try:
        timeout = app.state.client.timeout
        if upload:
            timeout = httpx.Timeout(120, connect=5)
        elif path.startswith("auth/password-reset") or path.startswith("admin/") or path.endswith("/references/discover"):
            timeout = httpx.Timeout(14, connect=5)
        elif path.endswith("/jobs"):
            timeout = httpx.Timeout(15, connect=5)
        elif search or stream:
            timeout = httpx.Timeout(RuntimeBudgets.from_env().search_caller if search else 15, connect=5)
        outbound = app.state.client.build_request(
            method, f"{upstream}/v1/{path}", headers=headers, content=body,
            timeout=timeout,
        )
        upstream_response = await app.state.client.send(outbound, stream=stream)
    except httpx.HTTPError as exc:
        raise unavailable() from exc

    result_headers = {name: upstream_response.headers[name] for name in (
        "content-type", "retry-after", "allow", "cache-control", "content-length",
        "content-range", "accept-ranges", "content-disposition", "x-accel-buffering",
    ) if name in upstream_response.headers and (stream or name != "content-length")}
    if stream:
        if method == "HEAD":
            await upstream_response.aclose()
            return Response(status_code=upstream_response.status_code, headers=result_headers)

        async def response_chunks():
            try:
                async for chunk in upstream_response.aiter_raw():
                    yield chunk
            finally:
                await upstream_response.aclose()

        return StreamingResponse(response_chunks(), status_code=upstream_response.status_code, headers=result_headers)
    response = Response(upstream_response.content, upstream_response.status_code, headers=result_headers)
    if path in COOKIE_ROUTES:
        for cookie in upstream_response.headers.get_list("set-cookie"):
            response.headers.append("Set-Cookie", cookie)
    return response
