"""Docling conversion worker; all ML imports stay outside the HTTP process."""
import os
import sys
import json
from collections.abc import Iterator
from io import BytesIO
from pathlib import Path
from docling.datamodel.base_models import ConversionStatus, DocumentStream, InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.exceptions import ConversionError
from docling_core.types.doc import DocItemLabel, DoclingDocument, TableItem, TextItem
from rag_http import ApiError
from rag_index import MAX_CHUNKS, MAX_PDF_BYTES, Chunk
from rag_runtime import RuntimeBudgets
from .chunking import group_blocks, heading, passages, regions_union
ARTIFACTS = Path(os.environ.get("DOCLING_ARTIFACTS_PATH", "/opt/docling"))
converter = DocumentConverter(allowed_formats=[InputFormat.PDF], format_options={
    InputFormat.PDF: PdfFormatOption(pipeline_options=PdfPipelineOptions(
        artifacts_path=ARTIFACTS, document_timeout=RuntimeBudgets.from_env().parse,
        do_ocr=False, enable_remote_services=False,
    ))})

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
    if result.has_timeout_errors():
        raise ApiError(422, "parse_timeout", "Document processing exceeded its time limit.")
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


def main() -> None:
    try:
        with open(sys.argv[1], "rb") as source:
            chunks = parse_pdf(BytesIO(source.read(MAX_PDF_BYTES + 1)))
        payload = {"chunks": [chunk.model_dump(mode="json") for chunk in chunks]}
    except ApiError as exc:
        payload = {"error": exc.detail["code"]}
    except Exception:
        payload = {"error": "parse_failed"}
    # Only the parent reads this private file; document text never goes to logs.
    Path(sys.argv[2]).write_text(json.dumps(payload, ensure_ascii=False))

if __name__ == "__main__":
    main()
