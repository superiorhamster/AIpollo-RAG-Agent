"""Evaluate dense and hybrid ranking with fixture embeddings and a live Qdrant."""

import asyncio
import json
import os
import statistics
import time
import sys
from pathlib import Path
from uuid import NAMESPACE_DNS, uuid4, uuid5

import httpx

sys.path.insert(0, "/app")
from app.main import fixture_vector

DATA = json.loads(Path(__file__).with_name("corpus-v1.json").read_text())
DIMENSIONS = 64


async def evaluate() -> dict:
    collection = "/collections/rag_eval_" + uuid4().hex
    limits = asyncio.Semaphore(10)
    async with httpx.AsyncClient(base_url=os.environ.get("QDRANT_URL", "http://qdrant:6333"),
                                 timeout=15, trust_env=False) as client:
        (await client.put(collection, json={"vectors": {"size": DIMENSIONS, "distance": "Cosine"}})).raise_for_status()
        try:
            (await client.put(collection + "/index", params={"wait": "true"}, json={
                "field_name": "text",
                "field_schema": {"type": "text", "tokenizer": "word", "scoring": True},
            })).raise_for_status()
            points = []
            for document in DATA["documents"]:
                for workspace in ("test-tenant", "excluded-tenant"):
                    label = document["id"]
                    points.append({
                        "id": str(uuid5(NAMESPACE_DNS, workspace + ":" + label)),
                        "vector": fixture_vector(document["text"], DIMENSIONS),
                        "payload": {"label": label, "workspace": workspace, "text": document["text"]},
                    })
            (await client.put(collection + "/points", params={"wait": "true"}, json={"points": points})).raise_for_status()
            scope = {"must": [{"key": "workspace", "match": {"value": "test-tenant"}}]}

            async def sample(case, hybrid):
                query = case["query"]
                dense = fixture_vector(query, DIMENSIONS)
                params = {"filter": scope, "limit": 10, "with_payload": True, "query": dense}
                if hybrid:
                    params["query"] = {"fusion": "rrf"}
                    params["prefetch"] = [
                        {"query": dense, "filter": scope, "limit": 25},
                        {"query": {"text": query}, "using": "text", "filter": scope, "limit": 25},
                    ]
                async with limits:
                    started = time.perf_counter()
                    response = await client.post(collection + "/points/query", json=params)
                    duration = (time.perf_counter() - started) * 1000
                rows = response.raise_for_status().json()["result"]["points"]
                assert all(point["payload"]["workspace"] == "test-tenant" for point in rows)
                relevant = set(case["relevant"])
                found = [i + 1 for i, item in enumerate(rows) if item["payload"]["label"] in relevant]
                return len(found) / len(relevant), (1 / found[0] if found else 0), duration

            report = {}
            for hybrid in (False, True):
                rows = await asyncio.gather(*(sample(case, hybrid) for case in DATA["queries"]))
                recalls, reciprocal, times = zip(*rows)
                report["hybrid" if hybrid else "dense"] = {
                    "recall_at_10": round(statistics.mean(recalls), 4),
                    "mrr": round(statistics.mean(reciprocal), 4),
                    "p95_ms": round(sorted(times)[int(len(times) * .95)], 1),
                }
            assert report["hybrid"]["recall_at_10"] >= report["dense"]["recall_at_10"], report
            assert report["hybrid"]["mrr"] >= report["dense"]["mrr"], report
            return report
        finally:
            (await client.delete(collection)).raise_for_status()


if __name__ == "__main__":
    print(json.dumps(asyncio.run(evaluate()), indent=2))
