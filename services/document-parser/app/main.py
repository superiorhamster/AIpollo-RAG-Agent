"""CPU-only structured PDF extraction on an isolated Compose network."""

import asyncio
import os
from collections.abc import Iterator
from io import BytesIO
from pathlib import Path

from docling.datamodel.base_models import ConversionStatus, DocumentStream, InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.exceptions import ConversionError
from docling_core.types.doc import DocItemLabel, DoclingDocument, TableItem, TextItem
from fastapi import FastAPI, Request
from starlette.concurrency import run_in_threadpool

from rag_http import ApiError, health_response, install_http
from rag_index import MAX_CHUNKS, MAX_PDF_BYTES, Chunk

from .chunking import group_blocks, heading, passages, regions_union

SERVICE = "document-parser"
ARTIFACTS = Path(os.environ.get("DOCLING_ARTIFACTS_PATH", "/opt/docling"))
converter = DocumentConverter(
    allowed_formats=[InputFormat.PDF],
    format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=PdfPipelineOptions(
        artifacts_path=ARTIFACTS, document_timeout=110, do_ocr=False, enable_remote_services=False,
    ))},
)
app = FastAPI(title=SERVICE, docs_url=None, redoc_url=None, openapi_url=None)
install_http(app)
slot = asyncio.Lock()


def blocks(document: DoclingDocument) -> Iterator[Chunk]:
    section = ""
    for item, _ in document.iterate_items():
        if not isinstance(item, (TextItem, TableItem)) or not item.prov:
            continue
        if item.label in (DocItemLabel.PAGE_HEADER, DocItemLabel.PAGE_FOOTER):
            continue
        if isinstance(item, TableItem):
            content = item.export_to_markdown(doc=document)
        else:
            content = item.text
            if item.label in (DocItemLabel.TITLE, DocItemLabel.SECTION_HEADER):
                section = heading(content)
        page = item.prov[0].page_no
        size = document.pages[page].size
        region = None
        if size.width > 0 and size.height > 0:
            boxes = [
                entry.bbox.to_top_left_origin(size.height)
                for entry in item.prov if entry.page_no == page
            ]
            region = regions_union(
                tuple(max(0.0, min(1.0, value / extent))
                      for value, extent in zip((box.l, box.t, box.r, box.b), (size.width, size.height) * 2))
                for box in boxes
            )
        for passage in passages(content):
            yield Chunk(page=page, section=section, text=passage, region=region)


def parse_pdf(data: BytesIO) -> list[Chunk]:
    try:
        result = converter.convert(
            DocumentStream(name="source.pdf", stream=data), max_num_pages=300,
            max_file_size=MAX_PDF_BYTES,
        )
    except ConversionError as exc:
        raise ApiError(422, "parse_failed", "The document could not be parsed.") from exc
    if result.status != ConversionStatus.SUCCESS:
        raise ApiError(422, "parse_failed", "The document could not be parsed completely.")
    chunks = []
    for chunk in group_blocks(blocks(result.document)):
        if len(chunks) >= MAX_CHUNKS:
            raise ApiError(422, "too_many_chunks", "The document has too many passages to index.")
        chunks.append(chunk)
    if not chunks:
        raise ApiError(422, "no_text", "The parser did not find text to index.")
    return chunks


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness():
    return health_response(SERVICE, all(
        (ARTIFACTS / name).is_dir()
        for name in ("docling-project--docling-layout-heron", "docling-project--docling-models")
    ))


@app.post("/internal/v1/parse")
async def parse(request: Request) -> list[Chunk]:
    if request.headers.get("content-type") != "application/pdf":
        raise ApiError(415, "unsupported_media_type", "Send a PDF.")
    async with slot:
        with BytesIO() as data:
            async for piece in request.stream():
                if data.tell() + len(piece) > MAX_PDF_BYTES:
                    raise ApiError(413, "file_too_large", "The source exceeds 25 MiB.")
                data.write(piece)
            data.seek(0)
            if data.read(5) != b"%PDF-":
                raise ApiError(422, "parse_failed", "The source is not a PDF.")
            data.seek(0)
            return await run_in_threadpool(parse_pdf, data)
