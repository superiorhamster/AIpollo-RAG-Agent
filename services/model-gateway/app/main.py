"""Provider-facing embedding API. Domain services receive validated vectors only."""

import asyncio
import hashlib
import json
import hmac
import logging
import math
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import perf_counter
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from pydantic import BaseModel, Field, ValidationError

from rag_http import ApiError, health_response, install_http, request_id, require_service, unauthorized
from rag_runtime import RuntimeBudgets
from rag_index import EmbeddingBatch, EmbeddingConfig, EmbeddingResult

SERVICE = "model-gateway"
LOG = logging.getLogger("uvicorn.error")

GEMINI_CONCURRENCY = 4
# Compatibility name retained for adapter tests; applies to every provider.
GEMINI_BATCH_TIMEOUT_SECONDS = RuntimeBudgets.from_env().embedding
CHAT_COMPLETION_TIMEOUT_SECONDS = 55
OPTIONAL_CHAT_PARAMS = ("reasoning_effort", "response_format")
GEMINI_EMBEDDING_2_MODELS = {"gemini-embedding-2", "gemini-embedding-2-preview"}
GEMINI_RETRIEVAL_FORMAT = "gemini-embedding-2:retrieval-v1"


def uses_gemini_retrieval_format() -> bool:
    return (
        os.environ.get("MODEL_EMBEDDING_PROTOCOL", "openai") == "openai"
        and os.environ.get("MODEL_EMBEDDING_NAME") in GEMINI_EMBEDDING_2_MODELS
    )


def model_unavailable() -> ApiError:
    return ApiError(503, "model_unavailable", "The embedding model is not configured or available.")


def valid_provider_url(url: str, *, embedding: bool = False) -> bool:
    parsed = urlsplit(url)
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return False
    if parsed.scheme == "https":
        return True
    return (
        parsed.scheme == "http"
        and parsed.hostname in {"host.docker.internal", "localhost", "127.0.0.1", "::1"}
        and os.environ.get("MODEL_ALLOW_LOCAL_HTTP") == "true"
    )


def load_embedding_config() -> EmbeddingConfig | None:
    if os.environ.get("MODEL_PROVIDER") == "fixture":
        return EmbeddingConfig(fingerprint=hashlib.sha256(b"rag-test-embedding-v1").hexdigest(), dimensions=64)
    endpoint = os.environ.get("MODEL_EMBEDDING_BASE_URL", "").rstrip("/")
    model = os.environ.get("MODEL_EMBEDDING_NAME")
    key = os.environ.get("MODEL_EMBEDDING_API_KEY")
    dimensions = os.environ.get("MODEL_EMBEDDING_DIMENSIONS")
    if os.environ.get("MODEL_PROVIDER") != "openai-compatible" or not all((endpoint, model, key, dimensions)):
        return None
    if not valid_provider_url(endpoint, embedding=True):
        raise ValueError("Set a valid embedding provider URL using HTTPS or explicitly enabled local HTTP.")
    revision = os.environ.get("MODEL_EMBEDDING_REVISION", "1")
    protocol = os.environ.get("MODEL_EMBEDDING_PROTOCOL", "openai")
    if protocol != "openai":
        raise ValueError("Choose openai as the embedding protocol.")
    identity = f"{endpoint}\n{model}\n{dimensions}\n{revision}"
    if uses_gemini_retrieval_format():
        if not 128 <= int(dimensions) <= 3072:
            raise ValueError("Gemini Embedding 2 requires 128 to 3072 output dimensions.")
        identity += "\n" + GEMINI_RETRIEVAL_FORMAT
    version = hashlib.sha256(identity.encode()).hexdigest()
    return EmbeddingConfig(fingerprint=version, dimensions=int(dimensions))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.embedding_config = load_embedding_config()
    app.state.token = os.environ["MODEL_EMBEDDING_TOKEN"].encode()
    async with httpx.AsyncClient(timeout=httpx.Timeout(CHAT_COMPLETION_TIMEOUT_SECONDS, connect=5), trust_env=False) as client:
        app.state.client = client
        yield


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
install_http(app)


def verify_caller(request: Request) -> None:
    if not hmac.compare_digest(request.headers.get("X-Embedding-Service-Token", "").encode(), app.state.token):
        raise unauthorized()


def fixture_vector(text: str, dimensions: int) -> list[float]:
    vector = [0.0] * dimensions
    for word in text.casefold().split():
        digest = hashlib.sha256(word.encode()).digest()
        vector[digest[0] % dimensions] += 1.0 if digest[1] % 2 else -1.0
    scale = math.hypot(*vector)
    return [value / scale for value in vector] if scale else [1.0] + [0.0] * (dimensions - 1)


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness():
    return health_response(SERVICE, True)


@app.get("/internal/v1/embedding-config")
async def embedding_config(request: Request) -> EmbeddingConfig:
    verify_caller(request)
    config = app.state.embedding_config
    if config is None:
        raise model_unavailable()
    return config


@app.post("/internal/v1/embeddings")
async def embed(data: EmbeddingBatch, request: Request) -> EmbeddingResult:
    try:
        async with asyncio.timeout(GEMINI_BATCH_TIMEOUT_SECONDS):
            return await embed_batch(data, request)
    except TimeoutError as exc:
        raise ApiError(503, "provider_unavailable", "The embedding provider exceeded the batch deadline.") from exc


async def embed_batch(data: EmbeddingBatch, request: Request) -> EmbeddingResult:
    config = await embedding_config(request)
    if config.fingerprint != data.fingerprint:
        raise ApiError(409, "model_changed", "The embedding model configuration changed.")
    if os.environ.get("MODEL_PROVIDER") == "fixture":
        return EmbeddingResult(vectors=[fixture_vector(item, config.dimensions) for item in data.texts])

    base_url = os.environ["MODEL_EMBEDDING_BASE_URL"].rstrip("/")
    texts = data.texts
    if uses_gemini_retrieval_format():
        prefix = "task: search result | query: " if data.input_type == "query" else "title: none | text: "
        texts = [prefix + text for text in texts]
    gemini = urlsplit(base_url).hostname == "generativelanguage.googleapis.com"
    if not gemini:
        vectors = await fetch_embeddings(request, base_url, texts, config.dimensions, False)
        return EmbeddingResult(vectors=vectors)

    semaphore = asyncio.Semaphore(GEMINI_CONCURRENCY)

    async def singleton(text: str) -> list[list[float]]:
        async with semaphore:
            return await fetch_embeddings(request, base_url, [text], config.dimensions, True)

    tasks = [asyncio.create_task(singleton(text)) for text in texts]
    try:
        async with asyncio.timeout(GEMINI_BATCH_TIMEOUT_SECONDS):
            batches = await asyncio.gather(*tasks)
        return EmbeddingResult(vectors=[vector for batch in batches for vector in batch])
    except TimeoutError as exc:
        raise ApiError(503, "provider_unavailable", "The embedding provider exceeded the batch deadline.") from exc
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def fetch_embeddings(
    request: Request, base_url: str, texts: list[str], dimensions: int, gemini: bool,
) -> list[list[float]]:
    payload: dict[str, object] = {"model": os.environ["MODEL_EMBEDDING_NAME"], "input": texts}
    if uses_gemini_retrieval_format():
        payload["dimensions"] = dimensions
    try:
        response = await app.state.client.post(
            base_url + "/embeddings",
            headers={"Authorization": "Bearer " + os.environ["MODEL_EMBEDDING_API_KEY"],
                     "X-Request-ID": request_id(request)},
            json=payload, timeout=httpx.Timeout(GEMINI_BATCH_TIMEOUT_SECONDS, connect=5),
        )
    except httpx.HTTPError as exc:
        raise ApiError(503, "provider_unavailable", "The embedding provider could not be reached.") from exc
    if response.status_code in (401, 403):
        raise model_unavailable()
    if response.status_code != 200:
        raise ApiError(503, "provider_unavailable", "The embedding provider rejected the request.")
    try:
        if gemini:
            rows = response.json()["data"]
            # Each request has one input, so an omitted index is unambiguous.
            if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
                raise ValueError("Expected one Gemini embedding row")
            index = rows[0].get("index", 0)
            if type(index) is not int or index != 0:
                raise ValueError("Invalid Gemini embedding index")
        else:
            rows = response.json()["data"]
            rows = sorted(rows, key=lambda item: item["index"])
            if [row["index"] for row in rows] != list(range(len(texts))):
                raise ValueError("Invalid embedding batch order")
        result = EmbeddingResult(vectors=[row["embedding"] for row in rows])
        if any(len(vector) != dimensions or not any(vector) for vector in result.vectors):
            raise ValueError("Invalid embedding dimensions or zero vector")
    except (ValueError, KeyError, TypeError, ValidationError) as exc:
        raise ApiError(502, "invalid_embedding", "The provider returned invalid embeddings.") from exc
    return result.vectors


class Message(BaseModel):
    role: Literal["system", "user"]
    content: str = Field(min_length=1, max_length=36_000)


class CompletionInput(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=8)
    max_tokens: int = Field(default=800, ge=32, le=4096)
    retry_on_unavailable: bool = False


class CompletionOutput(BaseModel):
    text: str = Field(min_length=1, max_length=32_000)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)


def _unsupported_optional_param(response: httpx.Response, body: dict[str, object]) -> str | None:
    """Return an optional chat parameter name if the upstream 400/422 specifically rejected it."""
    if response.status_code not in (400, 422):
        return None
    try:
        error = response.json().get("error", {})
        if not isinstance(error, dict):
            return None
    except (ValueError, AttributeError):
        return None
    param = error.get("param")
    if isinstance(param, str) and param in OPTIONAL_CHAT_PARAMS and param in body:
        return param
    code = error.get("code") or error.get("type")
    if param is None and code in {"unsupported_parameter", "invalid_request_error", "invalid_value"}:
        message = str(error.get("message") or "").casefold()
        for candidate in OPTIONAL_CHAT_PARAMS:
            if candidate in body and candidate in message:
                return candidate
        if "response_format" in body and "json_object" in message:
            return "response_format"
    return None


@app.post("/internal/v1/completions")
async def completion(data: CompletionInput, request: Request) -> CompletionOutput:
    require_service(request, "X-Model-Service-Token", os.environ["MODEL_CHAT_TOKEN"])
    if os.environ.get("MODEL_PROVIDER") == "fixture":
        payload = json.loads(data.messages[-1].content)
        if "question" in payload and "history" in payload and "evidence" not in payload:
            return CompletionOutput(text=json.dumps({"query": payload["question"]}))
        if "targets" in payload and "parents" in payload:
            return CompletionOutput(text=json.dumps({"attributions": [
                {"target": row["target"], "segment_ids": [payload["parents"][row["parent"]][0]["id"]]}
                for row in payload["targets"]
            ]}))
        sources = payload["evidence"]
        if not sources:
            return CompletionOutput(text=json.dumps({"claims": []}))
        first = sources[0]
        if "segments" in first:
            first = first["segments"][0]
        fields = {name: first["text"][:600] for name in payload.get("fields", [])}
        return CompletionOutput(text=json.dumps({"claims": [{
            "text": first["text"], "evidence": [first["id"]], "fields": fields,
        }]}))
    base = os.environ.get("MODEL_CHAT_BASE_URL", "").rstrip("/")
    model = os.environ.get("MODEL_CHAT_NAME", "")
    key = os.environ.get("MODEL_CHAT_API_KEY", "")
    if (os.environ.get("MODEL_PROVIDER") != "openai-compatible" or not model or not key
            or not valid_provider_url(base)):
        raise ApiError(503, "chat_model_unavailable", "The chat model is not configured.")
    started = perf_counter()
    response = None
    headers = {"Authorization": "Bearer " + key, "X-Request-ID": request_id(request)}
    body: dict[str, object] = {"model": model, "max_tokens": data.max_tokens, "stream": False,
                               "messages": [item.model_dump() for item in data.messages]}
    response_format = os.environ.get("MODEL_CHAT_RESPONSE_FORMAT", "")
    if response_format:
        if response_format != "json_object":
            raise ApiError(503, "chat_model_unavailable", "The configured response format is invalid.")
        body["response_format"] = {"type": response_format}
    effort = os.environ.get("MODEL_CHAT_REASONING_EFFORT", "")
    if effort:
        if effort not in {"none", "minimal", "low", "medium", "high", "xhigh", "max"}:
            raise ApiError(503, "chat_model_unavailable", "The configured reasoning effort is invalid.")
        body["reasoning_effort"] = effort
    try:
        retried_503 = False
        stripped: set[str] = set()
        async with asyncio.timeout(CHAT_COMPLETION_TIMEOUT_SECONDS):
            while True:
                response = await app.state.client.post(base + "/chat/completions", headers=headers, json=body)
                if data.retry_on_unavailable and response.status_code == 503 and not retried_503:
                    retried_503 = True
                    LOG.info("Chat completion retry request_id=%s upstream_status=503", request_id(request))
                    await asyncio.sleep(0.25)
                    response = None
                    continue
                bad_param = _unsupported_optional_param(response, body)
                if bad_param and bad_param not in stripped:
                    stripped.add(bad_param)
                    body.pop(bad_param, None)
                    LOG.info("Chat completion stripped unsupported param=%s request_id=%s", bad_param, request_id(request))
                    response = None
                    continue
                break
        response.raise_for_status()
        result = response.json()
        usage = result.get("usage") or {}
        choice = result["choices"][0]
        content = choice["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            finish = choice.get("finish_reason")
            finish = finish if isinstance(finish, str) and finish in {"stop", "length", "tool_calls", "content_filter", "function_call"} else "unknown"
            output_tokens = usage.get("completion_tokens")
            details = usage.get("completion_tokens_details")
            reasoning_tokens = details.get("reasoning_tokens") if isinstance(details, dict) else None
            LOG.warning("Chat completion missing text request_id=%s finish_reason=%s output_tokens=%s reasoning_tokens=%s",
                        request_id(request), finish, output_tokens if isinstance(output_tokens, int) else None,
                        reasoning_tokens if isinstance(reasoning_tokens, int) else None)
            raise ValueError("Provider returned no text")
        return CompletionOutput(text=content,
                                input_tokens=usage.get("prompt_tokens"),
                                output_tokens=usage.get("completion_tokens"))
    except (httpx.HTTPError, TimeoutError, ValueError, KeyError, IndexError, ValidationError) as exc:
        if response is not None and response.is_error:
            # Error messages can echo prompts. Log only allowlisted machine-readable fields.
            try:
                error = response.json().get("error", {})
                error = error if isinstance(error, dict) else {}
            except (ValueError, AttributeError):
                error = {}
            code = error.get("code") or error.get("type")
            code = code if isinstance(code, str) and code in {"context_length_exceeded", "invalid_request_error", "unsupported_parameter",
                "invalid_value", "model_not_found", "invalid_api_key", "rate_limit_exceeded", "insufficient_quota"} else "other"
            param = error.get("param")
            param = param if isinstance(param, str) and param in {"messages", "max_tokens", "max_completion_tokens",
                "response_format", "reasoning_effort", "model"} else None
            LOG.warning("Chat rejection request_id=%s code=%s param=%s input_bytes=%s max_tokens=%s",
                        request_id(request), code, param, sum(len(item.content.encode()) for item in data.messages), data.max_tokens)
        LOG.warning("Chat completion failure request_id=%s error=%s elapsed_ms=%.2f upstream_status=%s",
                    request_id(request), type(exc).__name__, (perf_counter() - started) * 1000,
                    response.status_code if response is not None else None)
        raise ApiError(503, "chat_provider_unavailable", "The chat provider could not complete the request.") from exc


@app.get("/internal/v1/admin/models", include_in_schema=False)
async def admin_models(request: Request):
    require_service(request, "X-Admin-Service-Token", os.environ["ADMIN_DOMAIN_TOKEN"])
    config = app.state.embedding_config
    return {
        "provider": os.environ.get("MODEL_PROVIDER", "disabled"),
        "embedding_model": os.environ.get("MODEL_EMBEDDING_NAME") or None,
        "embedding_ready": config is not None,
        "dimensions": config.dimensions if config else None,
        "chat_model": os.environ.get("MODEL_CHAT_NAME") or None,
        "chat_ready": bool(os.environ.get("MODEL_CHAT_NAME") and os.environ.get("MODEL_CHAT_API_KEY")),
    }
