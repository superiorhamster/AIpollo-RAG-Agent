"""Phase 02 HTTP, broker, and database integration checks."""

import io
import json
import os
import sys
import tarfile
import time
import unittest
import os
import zipfile
from uuid import UUID, uuid4

import httpx
import psycopg

API = "http://api-gateway:8000"
ORIGIN = os.environ.get("WEB_ORIGIN", "http://127.0.0.1:3000")
PASSWORD = "Phase2!a"
PDF = "application/pdf"


def pdf() -> bytes:
    contents = (
        b"BT\n/F1 14 Tf\n72 700 Td\n(Academic source reference and study notes.) Tj\n"
        b"0 -20 Td\n(This source provides evidence for citation analysis across research papers.) Tj\nET"
    )
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>",
        f"<< /Length {len(contents)} >>\nstream\n".encode() + contents + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, body in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{index} 0 obj\n".encode() + body + b"\nendobj\n")
    start = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010} 00000 n \n".encode())
    data.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())
    return bytes(data)


def docx() -> bytes:
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", """
          <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
            <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
            <Default Extension="xml" ContentType="application/xml"/>
            <Override PartName="/word/document.xml"
              ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
          </Types>
        """)
        archive.writestr("_rels/.rels", """
          <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Target="word/document.xml"
              Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>
          </Relationships>
        """)
        archive.writestr("word/document.xml", """
          <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:body><w:p><w:r><w:t>Research preview fixture</w:t></w:r></w:p></w:body>
          </w:document>
        """)
    return data.getvalue()


def fixtures() -> None:
    with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
        for name, data in [("study.pdf", pdf()), ("paper.docx", docx())]:
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            entry.mode = 0o644
            archive.addfile(entry, io.BytesIO(data))


def client() -> httpx.Client:
    return httpx.Client(base_url=API, headers={"Origin": ORIGIN}, timeout=25, trust_env=False)


def status(response: httpx.Response, code: int) -> httpx.Response:
    if response.status_code != code:
        raise AssertionError(f"{response.request.method} {response.request.url.path} returned "
                             f"{response.status_code}, expected {code}: {response.text[:300]}")
    return response


def login(http: httpx.Client, label: str) -> str:
    body = {"email": f"{label}-{uuid4().hex}@example.com", "password": PASSWORD}
    status(http.post("/v1/auth/register", json=body), 204)
    return status(http.post("/v1/auth/login", json=body), 200).json()["user_id"]


def workspace(http: httpx.Client) -> str:
    return status(http.post("/v1/workspaces", json={"name": "Document tests"},
                            headers={"Idempotency-Key": str(uuid4())}), 201).json()["workspace_id"]


def upload(http: httpx.Client, path: str, name: str, data: bytes, key: str | None = None) -> httpx.Response:
    return http.post(path, content=data, headers={"Content-Type": "application/octet-stream",
        "X-Filename": name, "Idempotency-Key": key or str(uuid4())})


def eventually(callback, seconds: int = 35):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = callback()
        if result:
            return result
        time.sleep(0.3)
    raise AssertionError("Timed out waiting for the durable state transition")


def database() -> psycopg.Connection:
    return psycopg.connect(host=os.environ["DB_HOST"], dbname=os.environ["DB_NAME"],
                           user=os.environ["PHASE02_POSTGRES_USER"], password=os.environ["PHASE02_POSTGRES_PASSWORD"])


class DocumentLifecycle(unittest.TestCase):
    def test_upload_preview_access_retry_and_replayed_message(self):
        with client() as owner, client() as editor, client() as viewer, client() as outsider, client() as anonymous:
            owner_id = login(owner, "documents-owner")
            editor_id = login(editor, "documents-editor")
            viewer_id = login(viewer, "documents-viewer")
            login(outsider, "documents-outsider")
            workspace_id = workspace(owner)
            scope = f"/v1/workspaces/{workspace_id}"
            path = scope + "/documents"
            for user_id, role in ((editor_id, "EDITOR"), (viewer_id, "VIEWER")):
                status(owner.put(f"{scope}/members/{user_id}", json={"role": role}), 200)

            status(anonymous.get(path), 401)
            status(outsider.get(path), 404)
            status(upload(viewer, path, "study.pdf", pdf()), 403)
            status(upload(editor, path, "fake.pdf", b"bad"), 415)
            status(upload(editor, path, "too-large.pdf", b"x" * (25 * 1024 * 1024 + 1)), 413)

            key = str(uuid4())
            entry = status(upload(editor, path, "study.pdf", pdf(), key), 201).json()
            self.assertEqual(status(upload(editor, path, "study.pdf", pdf(), key), 201).json()["document_id"],
                             entry["document_id"])
            status(upload(editor, path, "changed.pdf", pdf(), key), 409)
            item = path + "/" + entry["document_id"]
            status(outsider.get(item + "/original"), 404)
            status(viewer.patch(item, json={"name": "Forbidden"}), 403)
            status(viewer.delete(item), 403)
            status(editor.patch(item, json={"name": "Renamed source"}), 200)
            response = status(viewer.get(item + "/preview", headers={"Range": "bytes=0-4"}), 206)
            self.assertEqual(response.content, b"%PDF-")
            self.assertEqual(response.headers["Content-Range"], f"bytes 0-4/{len(pdf())}")
            self.assertIn("no-store", response.headers["Cache-Control"])
            status(viewer.head(item + "/original"), 200)
            status(viewer.get(item + "/preview", headers={"Range": "bytes=999999-"}), 416)
            initial_jobs = eventually(lambda: status(viewer.get(item + "/jobs"), 200).json())
            self.assertEqual([(job["kind"], job["status"]) for job in initial_jobs], [("index", "queued")])

            with httpx.Client(base_url="http://rabbitmq:15672/api/", timeout=8, trust_env=False,
                              auth=(os.environ["PHASE02_RABBIT_USER"], os.environ["PHASE02_RABBIT_PASS"])) as broker:
                event = {"event_id": str(uuid4()), "schema_version": 1, "event_type": "document.uploaded.v1",
                         "occurred_at": "2026-11-16T00:00:00Z", "workspace_id": workspace_id,
                         "document_id": entry["document_id"], "actor_id": owner_id,
                         "request_id": str(uuid4()), "media_type": PDF}
                message = {"properties": {"delivery_mode": 2}, "routing_key": event["event_type"],
                           "payload": json.dumps(event), "payload_encoding": "string"}
                for _ in range(2):
                    receipt = status(broker.post("exchanges/rag-documents/rag.documents/publish", json=message), 200)
                    self.assertTrue(receipt.json()["routed"])
            time.sleep(1)
            self.assertEqual(status(viewer.get(item + "/jobs"), 200).json(), initial_jobs)
            status(editor.delete(item), 202)
            status(viewer.get(item), 404)

            original_docx = docx()
            draft = status(upload(editor, path, "paper.docx", original_docx), 201).json()
            draft_path = path + "/" + draft["document_id"]
            self.assertEqual(status(viewer.get(draft_path + "/original"), 200).content, original_docx)
            eventually(lambda: status(viewer.get(draft_path), 200).json()["preview_ready"], 60)
            self.assertTrue(status(viewer.get(draft_path + "/preview"), 200).content.startswith(b"%PDF-"))
            eventually(lambda: any(job["kind"] == "preview" and job["status"] == "succeeded"
                                  for job in status(viewer.get(draft_path + "/jobs"), 200).json()))


def outage_fixture(mode: str) -> None:
    with client() as http:
        if mode == "--prepare":
            credentials = {"email": "phase02-outage@example.com", "password": PASSWORD}
            status(http.post("/v1/auth/register", json=credentials), 204)
            status(http.post("/v1/auth/login", json=credentials), 200)
            print(workspace(http))
        else:
            if mode == "--cascade":
                login(http, "document-cascade")
                workspace_id = workspace(http)
                scope = f"/v1/workspaces/{workspace_id}"
                item = status(upload(http, scope + "/documents", "pending.docx", docx()), 201).json()
                path = f"{scope}/documents/{item['document_id']}"
                eventually(lambda: any(job["kind"] == "preview" and job["status"] == "running"
                                       for job in status(http.get(path + "/jobs"), 200).json()))
                status(http.delete(scope), 202)
                status(http.get(path + "/original"), 404)

                def completed():
                    with database() as db:
                        return db.execute("""
                            SELECT NOT EXISTS(SELECT 1 FROM workspace.workspaces WHERE workspace_id = %s)
                                AND EXISTS(SELECT 1 FROM documents.items WHERE document_id = %s AND state = 'deleted')
                                AND EXISTS(SELECT 1 FROM ingestion.jobs
                                           WHERE document_id = %s AND kind = 'preview' AND status = 'cancelled')
                        """, (workspace_id, item["document_id"], item["document_id"])).fetchone()[0]

                eventually(completed)
                print(workspace_id)
                return
            workspace_id = str(UUID(sys.argv[2]))
            status(http.post("/v1/auth/login", json={"email": "phase02-outage@example.com", "password": PASSWORD}), 200)
            path = f"/v1/workspaces/{workspace_id}/documents"
            result = upload(http, path, "retry.pdf", pdf(), "470c887f-f08e-4093-bd9f-e70ec451d8fb")
            status(result, 503 if mode == "--offline" else 201)
            contents = status(http.get(path), 200).json()
            assert len(contents) == (0 if mode == "--offline" else 1)


if __name__ == "__main__":
    if sys.argv[1:] == ["--fixtures"]:
        fixtures()
    elif len(sys.argv) > 1:
        outage_fixture(sys.argv[1])
    else:
        unittest.main(verbosity=2)
