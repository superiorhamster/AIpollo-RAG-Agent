"""Exercise the configured provider using synthetic evidence only."""

import json
import os
from uuid import uuid4

import httpx

from rag_runtime import RuntimeBudgets
from rag_index import EmbeddingConfig, EmbeddingResult

if os.environ.get("MODEL_PROVIDER") != "openai-compatible":
    raise SystemExit("Configure embedding and chat providers before running the provider smoke test.")

identifier = str(uuid4())
source = "Synthetic smoke test. A controlled sample contains exactly seven observations."
headers = {"X-Request-ID": str(uuid4())}
embed_headers = {**headers, "X-Embedding-Service-Token": os.environ["MODEL_EMBEDDING_TOKEN"]}
chat_headers = {**headers, "X-Model-Service-Token": os.environ["MODEL_CHAT_TOKEN"]}

with httpx.Client(base_url="http://127.0.0.1:8000/internal/v1", timeout=35, trust_env=False) as client:
    response = client.get("/embedding-config", headers=embed_headers)
    config = EmbeddingConfig.model_validate_json(response.raise_for_status().content)
    response = client.post("/embeddings", headers=embed_headers, json={
        "texts": [source], "fingerprint": config.fingerprint,
    }, timeout=RuntimeBudgets.from_env().embedding_caller)
    vectors = EmbeddingResult.model_validate_json(response.raise_for_status().content).vectors
    if len(vectors) != 1 or len(vectors[0]) != config.dimensions:
        raise SystemExit("The provider returned an unexpected embedding shape.")
    response = client.post("/completions", headers=chat_headers, json={
        "messages": [
            {"role": "system", "content": "Return the number of observations and the exact source ID. Return JSON "
                                          "with keys observations (number) and source_id (string)."},
            {"role": "user", "content": json.dumps({"source_id": identifier, "text": source})},
        ],
        "max_tokens": 2048,
    })
    if response.status_code != 200:
        raise SystemExit(f"Chat provider smoke failed (HTTP {response.status_code}). "
                         "Check provider availability, account quota and the configured chat model; "
                         "service readiness alone does not verify live generation.")
    answer = response.json()["text"].strip()
    fence = chr(96) * 3
    if answer.startswith(fence + "json") and answer.endswith(fence):
        answer = answer[7:-3].strip()
    data = json.loads(answer)
    if data.get("observations") != 7 or data.get("source_id") != identifier:
        raise SystemExit("The chat provider did not preserve the synthetic evidence.")
print("Configured embedding dimensions and citation-bearing chat response verified with synthetic data.")
