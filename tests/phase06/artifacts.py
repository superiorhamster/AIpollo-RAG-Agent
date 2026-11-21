"""Check artifact sharing and export using an isolated PostgreSQL database."""

import asyncio
import os
from io import BytesIO
from uuid import uuid4

import httpx
from docx import Document

from app.main import app
from rag_db import open_database

OWNERSHIP = {char: uuid4() for char in ["o", "e", "v", "x"]}
WORKSPACE, RUN, DOC, CHUNK = [uuid4() for _ in range(4)]
BASE = f"/v1/workspaces/{WORKSPACE}/artifacts"
BODY = {"claims": [{"text": "The fixture obtained four results.", "citations": [
    {"document_id": str(DOC), "chunk_id": str(CHUNK), "name": "Study", "page": 3,
     "segment_ids": [str(uuid4())], "citation_id": str(uuid4()), "precision": "line",
     "regions": [[0.1, 0.1, 0.7, 0.2], [0.1, 0.3, 0.4, 0.4]]}
]}], "insufficient_evidence": False}


async def test():
    database = open_database()
    app.state.database = database
    source_available = True

    async def services(request):
        if request.url.host == "workspace-service":
            assert request.headers["X-Interaction-Service-Token"] == os.environ["WORKSPACE_INTERACTION_TOKEN"]
            role = request.headers.get("Cookie", "")[-1]
            if role == "x":
                return httpx.Response(404)
            name = {"o": "OWNER", "e": "EDITOR", "v": "VIEWER"}[role]
            return httpx.Response(200, json={"role": name, "user_id": str(OWNERSHIP[role])})
        if request.url.host == "agent-orchestrator":
            assert str(RUN) in request.url.path and str(OWNERSHIP["e"]) in request.url.path
            return httpx.Response(200, json={"input": {"task": "study_guide"}, "result": BODY})
        assert request.url.host == "document-service"
        return httpx.Response(200, json=[{"document_id": str(DOC)}] if source_available else [])

    async with httpx.AsyncClient(transport=httpx.MockTransport(services)) as dependencies, httpx.AsyncClient(
        base_url="http://artifacts", transport=httpx.ASGITransport(app=app),
    ) as http:
        app.state.client = dependencies

        async def call(method, path, role, expected, **kwargs):
            response = await http.request(method, path, headers={"Cookie": "rag_access=a.b." + role * 43}, **kwargs)
            assert response.status_code == expected, response.text[:600]
            return response

        data = {"name": "Shared study guide", "run_id": str(RUN)}
        await call("POST", BASE, "v", 403, json=data)
        published = (await call("POST", BASE, "e", 201, json=data)).json()
        assert (await call("POST", BASE, "e", 201, json=data)).json()["artifact_id"] == published["artifact_id"]
        path = BASE + "/" + published["artifact_id"]
        assert (await call("GET", path, "v", 200)).json()["body"] == BODY
        await call("GET", path, "x", 404)
        await call("DELETE", path, "v", 403)
        await call("PATCH", path, "o", 200, json={"name": "Study guide"})
        markdown = await call("GET", path + "/export/md", "v", 200)
        assert "Study, page 3" in markdown.text
        exported = await call("GET", path + "/export/docx", "v", 200)
        docx = Document(BytesIO(exported.content))
        assert any("page 3" in paragraph.text for paragraph in docx.paragraphs)
        source_available = False
        await call("GET", path, "v", 409)
        await call("GET", path + "/export/docx", "v", 409)
        await call("DELETE", path, "o", 204)
    await database.dispose()
    print("Artifact replay, member read, Viewer rejection, Owner management, DOCX/Markdown and removed-source redaction passed.")


if __name__ == "__main__":
    asyncio.run(test())
