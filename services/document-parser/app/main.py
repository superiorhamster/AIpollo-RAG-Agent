"""Bounded, single-slot structured PDF parsing on an isolated network."""

import asyncio
import json
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, Request
from pydantic import TypeAdapter

from rag_http import ApiError, health_response, install_http
from rag_index import MAX_PDF_BYTES, Chunk
from rag_runtime import RuntimeBudgets

SERVICE = "document-parser"
ARTIFACTS = Path(os.environ.get("DOCLING_ARTIFACTS_PATH", "/opt/docling"))
budgets = RuntimeBudgets.from_env()
slot = asyncio.Lock()
children: set[asyncio.subprocess.Process] = set()
chunk_list = TypeAdapter(list[Chunk])


async def stop(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        try:
            process.terminate()
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(process.wait(), 3)
        except TimeoutError:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    try:
        yield
    finally:
        await asyncio.gather(*(stop(child) for child in list(children)))


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
install_http(app)


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness():
    return health_response(SERVICE, all((ARTIFACTS / name).is_dir() for name in (
        "docling-project--docling-layout-heron", "docling-project--docling-models",
    )))


async def converted(request: Request, source: Path, result: Path) -> list[Chunk]:
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "app.conversion", str(source), str(result),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    children.add(process)
    waiter = asyncio.create_task(process.wait())
    try:
        async with asyncio.timeout(budgets.parse_wall):
            while not waiter.done():
                if await request.is_disconnected():
                    raise ApiError(499, "cancelled", "Document processing was cancelled.")
                await asyncio.wait({waiter}, timeout=.25)
        if process.returncode != 0 or not result.is_file():
            raise ApiError(422, "parse_failed", "The document could not be parsed.")
        payload = json.loads(result.read_text())
        if "error" in payload:
            code = payload["error"]
            if code not in {"parse_failed", "parse_timeout", "no_text", "too_many_chunks", "file_too_large"}:
                code = "parse_failed"
            message = ("Scanned PDFs require OCR, which is not enabled." if code == "no_text"
                       else "Document processing did not complete within the supported limits.")
            raise ApiError(422, code, message)
        return chunk_list.validate_python(payload["chunks"])
    except TimeoutError as exc:
        raise ApiError(422, "parse_timeout", "Document processing exceeded its time limit.") from exc
    finally:
        await stop(process)
        await waiter
        children.discard(process)


@app.post("/internal/v1/parse")
async def parse(request: Request) -> list[Chunk]:
    if request.headers.get("content-type") != "application/pdf":
        raise ApiError(415, "unsupported_media_type", "Send a PDF.")
    if slot.locked():
        raise ApiError(503, "parser_busy", "The parser is processing another document.",
                       headers={"Retry-After": str(budgets.parse_wall)})
    async with slot:
        with TemporaryDirectory(prefix="rag-parse-") as directory:
            source, result = Path(directory) / "source.pdf", Path(directory) / "result.json"
            size = 0
            with source.open("wb") as output:
                async for piece in request.stream():
                    size += len(piece)
                    if size > MAX_PDF_BYTES:
                        raise ApiError(413, "file_too_large", "The source exceeds 25 MiB.")
                    output.write(piece)
            with source.open("rb") as uploaded:
                if uploaded.read(5) != b"%PDF-":
                    raise ApiError(422, "parse_failed", "The source is not a PDF.")
            return await converted(request, source, result)
