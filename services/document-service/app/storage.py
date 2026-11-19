"""Validated uploads and private MinIO streaming."""

import hashlib
import re
from pathlib import PurePosixPath
from typing import BinaryIO
from urllib.parse import quote, unquote
from zipfile import BadZipFile, ZipFile

from fastapi import Request
from fastapi.responses import Response, StreamingResponse
from minio import Minio
from minio.error import S3Error
from starlette.concurrency import run_in_threadpool
from urllib3.exceptions import HTTPError

from rag_http import ApiError, unavailable

MAX_FILE = 25 * 1024 * 1024
PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def filename_from(header: str) -> str:
    try:
        filename = unquote(header, errors="strict").strip()
    except UnicodeError as exc:
        raise ApiError(422, "invalid_filename", "Provide a valid file name.") from exc
    if not 1 <= len(filename) <= 200 or any(ord(c) < 32 or c in "/\\" for c in filename):
        raise ApiError(422, "invalid_filename", "Provide a valid file name.")
    return filename


async def spool(request: Request, file: BinaryIO) -> tuple[int, str]:
    size = 0
    digest = hashlib.sha256()
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_FILE:
            raise ApiError(413, "file_too_large", "Files may be up to 25 MiB.")
        file.write(chunk)
        digest.update(chunk)
    file.seek(0)
    return size, digest.hexdigest()


def inspect_file(file: BinaryIO, filename: str) -> str:
    suffix = PurePosixPath(filename).suffix.lower()
    if suffix == ".pdf" and file.read(5) == b"%PDF-":
        file.seek(0)
        return PDF
    if suffix == ".docx":
        try:
            with ZipFile(file) as archive:
                items = archive.infolist()
                if len(items) > 2000 or sum(item.file_size for item in items) > 128 * 1024 * 1024:
                    raise BadZipFile("DOCX expansion limit")
                names = {item.filename for item in items}
                if len(names) != len(items) or any(
                    item.flag_bits & 1 or item.filename.startswith(("/", "\\")) or "\\" in item.filename
                    or ".." in PurePosixPath(item.filename).parts
                    or item.filename.lower().endswith("/vbaproject.bin")
                    for item in items
                ):
                    raise BadZipFile("Unsafe DOCX archive")
                if "word/document.xml" in names and archive.getinfo("[Content_Types].xml").file_size <= 256 * 1024:
                    types = archive.read("[Content_Types].xml").lower()
                    if b"wordprocessingml.document.main+xml" in types and b"macroenabled" not in types:
                        file.seek(0)
                        return DOCX
        except (BadZipFile, KeyError, RuntimeError, NotImplementedError):
            pass
    raise ApiError(415, "unsupported_document", "Upload a PDF or a valid DOCX file.")


def select_range(header: str, size: int) -> tuple[int, int]:
    match = re.fullmatch(r"bytes=([0-9]{0,15})-([0-9]{0,15})", header)

    def unsatisfied() -> ApiError:
        return ApiError(416, "range_not_satisfiable", "The requested byte range is unavailable.",
                        {"Content-Range": f"bytes */{size}"})

    if match is None or not any(match.groups()) or not size:
        raise unsatisfied()
    start_arg, end_arg = match.groups()
    if not start_arg:
        suffix = int(end_arg)
        if not suffix:
            raise unsatisfied()
        return max(0, size - suffix), size - 1
    start = int(start_arg)
    end = min(size - 1, int(end_arg)) if end_arg else size - 1
    if start > end:
        raise unsatisfied()
    return start, end


async def stream_object(storage: Minio, bucket: str, key: str, media_type: str,
                        filename: str, request: Request, attachment: bool) -> Response:
    try:
        stat = await run_in_threadpool(storage.stat_object, bucket, key)
    except (S3Error, OSError, HTTPError) as exc:
        raise unavailable() from exc

    start, end = 0, stat.size - 1
    range_header = request.headers.get("Range")
    if range_header:
        start, end = select_range(range_header, stat.size)
    length = end - start + 1
    disposition = "attachment" if attachment else "inline"
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(filename, safe='')}",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    }
    if range_header:
        headers["Content-Range"] = f"bytes {start}-{end}/{stat.size}"
    status = 206 if range_header else 200
    if request.method == "HEAD" or not length:
        return Response(status_code=status, media_type=media_type, headers=headers)
    try:
        source = await run_in_threadpool(storage.get_object, bucket, key, offset=start, length=length)
    except (S3Error, OSError, HTTPError) as exc:
        raise unavailable() from exc

    def chunks():
        try:
            yield from source.stream(64 * 1024)
        finally:
            source.close()
            source.release_conn()

    return StreamingResponse(chunks(), status_code=status, media_type=media_type, headers=headers)
