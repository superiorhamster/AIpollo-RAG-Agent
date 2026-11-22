"""Exercise queued indexing, stored provenance, search authorization, and cleanup."""

import hashlib
import sys
import time
from rag_runtime import RuntimeBudgets
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from phase02.api import client, docx, login, pdf, status, upload, workspace

ACCOUNT = {"email": "phase03@example.com", "password": "Phase3!a"}
COLLECTION = "rag_chunks_" + hashlib.sha256(b"rag-test-embedding-v1").hexdigest()


def wait_for(check, accepts, timeout=None):
    if timeout is None:
        budgets = RuntimeBudgets.from_env()
        timeout = budgets.parse_caller + 2 * budgets.embedding_caller
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        value = check()
        if accepts(value):
            return value
        time.sleep(1)
    raise AssertionError(f"Timed out waiting for state: {value}")


def job(http, base, document):
    response = http.get(f"{base}/{document}/jobs")
    if response.status_code == 503:
        return "queued"
    rows = status(response, 200).json()
    return next((item["status"] for item in rows if item["kind"] == "index"), "missing")


def total(http, workspace_id, document):
    response = http.post(
        f"http://qdrant:6333/collections/{COLLECTION}/points/count", json={
            "exact": True,
            "filter": {"must": [
                {"key": "workspace_id", "match": {"value": workspace_id}},
                {"key": "document_id", "match": {"value": document}},
            ]},
        },
    )
    return status(response, 200).json()["result"]["count"]


def seed():
    with client() as owner:
        status(owner.post("/v1/auth/register", json=ACCOUNT), 204)
        status(owner.post("/v1/auth/login", json=ACCOUNT), 200)
        workspace_id = workspace(owner)
        base = f"/v1/workspaces/{workspace_id}/documents"
        pdf_id = status(upload(owner, base, "study.pdf", pdf()), 201).json()["document_id"]
        docx_id = status(upload(owner, base, "paper.docx", docx()), 201).json()["document_id"]
        for document in (pdf_id, docx_id):
            wait_for(lambda: job(owner, base, document), lambda value: value in ("queued", "running", "succeeded"))
        print(workspace_id, pdf_id, docx_id)


def verify(workspace_id, pdf_id, docx_id):
    path = f"/v1/workspaces/{workspace_id}"
    base = path + "/documents"
    with client() as owner, client() as outsider:
        status(owner.post("/v1/auth/login", json=ACCOUNT), 200)
        login(outsider, "phase03-outsider")
        foreign_id = workspace(outsider)
        foreign_doc = status(upload(outsider, f"/v1/workspaces/{foreign_id}/documents", "foreign.pdf", pdf()), 201).json()
        for document in (pdf_id, docx_id):
            assert wait_for(lambda: job(owner, base, document), lambda value: value in ("succeeded", "failed")) == "succeeded"
        assert total(owner, workspace_id, pdf_id) == 2
        assert total(owner, workspace_id, docx_id) == 1
        search = lambda http, ids: http.post(path + "/search", json={
            "query": "Academic source", "document_ids": ids,
        })
        result = status(search(owner, [pdf_id]), 200).json()
        assert result["indexed_documents"] == [pdf_id]
        assert result["evidence"] and all(row["document_id"] == pdf_id for row in result["evidence"]), result
        assert all(row["page"] >= 1 and row["region"] for row in result["evidence"]), result
        status(search(owner, [pdf_id, foreign_doc["document_id"]]), 404)
        status(search(outsider, [pdf_id]), 404)
        status(owner.delete(f"{base}/{pdf_id}"), 202)
        status(search(owner, [pdf_id]), 404)
        wait_for(lambda: total(owner, workspace_id, pdf_id), lambda value: value == 0)
        status(owner.delete(path), 202)
        wait_for(lambda: total(owner, workspace_id, docx_id), lambda value: value == 0)
    print("Queued indexing, PDF/DOCX provenance, scoped search, and vector cleanup passed.")


if __name__ == "__main__":
    if sys.argv[1:] == ["seed"]:
        seed()
    else:
        verify(*sys.argv[1:])
