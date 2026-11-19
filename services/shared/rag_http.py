"""Common HTTP conventions for the Phase 01 services."""

import hmac
import json
import logging
import time
import re
from collections.abc import Awaitable, Callable
from uuid import UUID, uuid4

from rag_telemetry import configure, server_span

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException

ACCESS_COOKIE = "rag_access"
REFRESH_COOKIE = "rag_refresh"
REFRESH_PATH = "/v1/auth"
ACCESS_FORMAT = re.compile(r"[A-Za-z0-9_-]{1,256}\.[A-Za-z0-9_-]{1,1024}\.[A-Za-z0-9_-]{43}")
REFRESH_FORMAT = re.compile(r"[A-Za-z0-9_-]{43}")


class ApiError(HTTPException):
    def __init__(self, status: int, code: str, message: str, headers: dict[str, str] | None = None):
        super().__init__(status, {"code": code, "message": message}, headers=headers)


def request_id(request: Request) -> str:
    return request.state.request_id


def unavailable() -> ApiError:
    return ApiError(503, "unavailable", "The service is temporarily unavailable.")


def unauthorized() -> ApiError:
    return ApiError(401, "unauthenticated", "Sign in to continue.")


def install_http(app: FastAPI) -> None:
    configure(app.title)
    @app.middleware("http")
    async def correlate(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        try:
            identifier = UUID(request.headers.get("X-Request-ID", ""))
        except ValueError:
            identifier = uuid4()
        request.state.request_id = str(identifier)
        started = time.perf_counter()
        with server_span(request.headers, request.method, app.title != "api-gateway") as span:
            response = await call_next(request)
            route = getattr(request.scope.get("route"), "path", "unmatched")
            span.update_name(request.method + " " + route)
            span.set_attribute("http.route", route)
            span.set_attribute("http.response.status_code", response.status_code)
            span.set_attribute("rag.request_id", request_id(request))
            if route not in ("/healthz", "/readyz"):
                logging.getLogger("uvicorn.error").info(json.dumps({
                    "event": "http.request", "service": app.title, "route": route, "method": request.method,
                    "request_id": request_id(request), "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                }))
        response.headers["X-Request-ID"] = request_id(request)
        if request.url.path.startswith(("/v1/", "/internal/")):
            response.headers.setdefault("Cache-Control", "no-store")
            response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc, ApiError) else {
            "code": "http_error", "message": str(exc.detail),
        }
        return JSONResponse({**detail, "request_id": request_id(request)}, exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, _: RequestValidationError) -> JSONResponse:
        return JSONResponse({
            "code": "invalid_request",
            "message": "Check the submitted fields and try again.",
            "request_id": request_id(request),
        }, 422)


def health_response(service: str, ready: bool) -> JSONResponse:
    return JSONResponse({"service": service, "status": "ready" if ready else "unavailable"}, 200 if ready else 503)


def require_service(request: Request, name: str, token: str) -> None:
    if not hmac.compare_digest(request.headers.get(name, "").encode(), token.encode()):
        raise unauthorized()
