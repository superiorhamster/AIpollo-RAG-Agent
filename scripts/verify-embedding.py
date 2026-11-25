"""Exercise the configured embedding provider from inside Model Gateway."""

import math
import os

import httpx
from rag_runtime import RuntimeBudgets

texts = ["Buổi demo diễn ra ở phòng B4-201.", "Nhóm cần mang bộ chuyển HDMI sang VGA."]
headers = {"X-Embedding-Service-Token": os.environ["MODEL_EMBEDDING_TOKEN"]}
with httpx.Client(base_url="http://127.0.0.1:8000/internal/v1", timeout=RuntimeBudgets.from_env().embedding_caller, trust_env=False) as client:
    response = client.get("/embedding-config", headers=headers)
    response.raise_for_status()
    config = response.json()
    vectors = []
    size = len(texts)
    for offset in range(0, len(texts), size):
        response = client.post("/embeddings", headers=headers,
                               json={"texts": texts[offset:offset + size], "fingerprint": config["fingerprint"]})
        response.raise_for_status()
        vectors.extend(response.json()["vectors"])
    if (len(vectors) != len(texts) or any(len(v) != config["dimensions"] for v in vectors)
            or any(not any(v) or not all(math.isfinite(x) for x in v) for v in vectors)):
        raise SystemExit("Embedding batch shape or values are invalid.")
    response = client.post("/embeddings", headers=headers, json={
        "texts": ["Buổi demo diễn ra ở đâu?"], "fingerprint": config["fingerprint"], "input_type": "query",
    })
    response.raise_for_status()
    queries = response.json()["vectors"]
    if (len(queries) != 1 or len(queries[0]) != config["dimensions"] or not any(queries[0])
            or not all(math.isfinite(x) for x in queries[0])):
        raise SystemExit("Query embedding shape or values are invalid.")
    print(f"Verified two Vietnamese documents and one query, dimensions={config['dimensions']}, "
          f"fingerprint={config['fingerprint']}.")
