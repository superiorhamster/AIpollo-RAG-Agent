"""Measure configured real embeddings on the versioned synthetic bilingual corpus.

Uses Model Gateway and local cosine ranking. This does not replace the live Qdrant
hybrid/tenant evaluation in retrieval.py or the full upload/citation checks.
"""

import argparse
import json
import math
import os
import statistics
import time
from pathlib import Path

import httpx
from rag_runtime import RuntimeBudgets

from app.main import fixture_vector


def cosine(left, right):
    return sum(a * b for a, b in zip(left, right, strict=True)) / (math.hypot(*left) * math.hypot(*right))


def metrics(documents, queries, doc_vectors, query_vectors):
    recalls, reciprocal, top1 = [], [], []
    for case, vector in zip(queries, query_vectors, strict=True):
        ranked = sorted(zip(documents, doc_vectors, strict=True), key=lambda pair: -cosine(vector, pair[1]))
        relevant = set(case["relevant"])
        positions = [i + 1 for i, (doc, _) in enumerate(ranked) if doc["id"] in relevant]
        recalls.append(sum(rank <= 3 for rank in positions) / len(relevant))
        reciprocal.append(1 / positions[0] if positions else 0)
        top1.append(bool(positions and positions[0] == 1))
    return {"recall_at_3": round(statistics.mean(recalls), 4),
            "mrr": round(statistics.mean(reciprocal), 4), "top1": round(statistics.mean(top1), 4)}


def evaluate(base_url):
    corpus = json.loads(Path(__file__).with_name("corpus-v1.json").read_text())
    docs, queries = corpus["documents"], corpus["queries"]
    headers = {"X-Embedding-Service-Token": os.environ["MODEL_EMBEDDING_TOKEN"]}
    with httpx.Client(base_url=base_url, headers=headers, timeout=RuntimeBudgets.from_env().embedding_caller, trust_env=False) as client:
        config = client.get("/embedding-config").raise_for_status().json()
        started = time.perf_counter()

        def embed(texts):
            vectors = []
            size = 1 if os.environ.get("MODEL_EMBEDDING_PROTOCOL") == "ollama" else 16
            for offset in range(0, len(texts), size):
                batch = texts[offset:offset + size]
                response = client.post("/embeddings", json={"texts": batch, "fingerprint": config["fingerprint"]})
                result = response.raise_for_status().json()["vectors"]
                if (len(result) != len(batch) or any(len(v) != config["dimensions"] for v in result)
                        or any(not any(v) or not all(math.isfinite(x) for x in v) for v in result)):
                    raise ValueError("Invalid embedding batch")
                vectors.extend(result)
            return vectors

        doc_vectors = embed([d["text"] for d in docs])
        query_vectors = embed([q["query"] for q in queries])
        elapsed = round((time.perf_counter() - started) * 1000, 1)
    baseline = metrics(docs, queries, [fixture_vector(d["text"], 64) for d in docs],
                       [fixture_vector(q["query"], 64) for q in queries])
    actual = metrics(docs, queries, doc_vectors, query_vectors)
    print(json.dumps({"corpus": corpus["version"], "queries": len(queries), "dimensions": config["dimensions"],
                      "fixture_baseline": baseline, "configured_model": actual, "embedding_elapsed_ms": elapsed,
                      "regressed_metrics": [key for key in actual if actual[key] < baseline[key]]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://model-gateway:8000/internal/v1/")
    evaluate(parser.parse_args().base_url)
