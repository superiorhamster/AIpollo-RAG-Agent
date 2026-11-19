"""Isolated, bounded LibreOffice process for original DOCX previews."""

import asyncio
import os
import signal
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from rag_http import ApiError, health_response, install_http

SERVICE = "document-converter"
LIMIT = 25 * 1024 * 1024
app = FastAPI(title=SERVICE, docs_url=None, redoc_url=None, openapi_url=None)
install_http(app)
conversion = asyncio.Semaphore(1)


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness() -> Response:
    return health_response(SERVICE, os.access("/usr/bin/soffice", os.X_OK))


@app.post("/convert")
async def convert(request: Request) -> Response:
    async with conversion:
        scratch = TemporaryDirectory()
        root = Path(scratch.name)
        try:
            source = root / "upload.docx"
            size = 0
            with source.open("wb") as file:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > LIMIT:
                        raise ApiError(413, "file_too_large", "Preview input is too large.")
                    file.write(chunk)

            profile = root / "profile"
            (profile / "user").mkdir(parents=True)
            (profile / "user" / "registrymodifications.xcu").write_text(
                '<oor:items xmlns:oor="http://openoffice.org/2001/registry">'
                '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
                '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>'
                '</item></oor:items>'
            )
            process = await asyncio.create_subprocess_exec(
                "/usr/bin/soffice", f"-env:UserInstallation={profile.as_uri()}",
                "--headless", "--nologo", "--norestore", "--convert-to", "pdf:writer_pdf_Export",
                "--outdir", str(root), str(source),
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL, start_new_session=True,
            )
            try:
                await asyncio.wait_for(process.wait(), 45)
            finally:
                if process.returncode is None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    await process.wait()
            output = root / "upload.pdf"
            if process.returncode or not output.is_file() or not 0 < output.stat().st_size <= LIMIT:
                raise ApiError(422, "conversion_failed", "The DOCX preview could not be generated.")
            return FileResponse(output, media_type="application/pdf", background=BackgroundTask(scratch.cleanup))
        except BaseException:
            scratch.cleanup()
            raise
