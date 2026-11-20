"""Exercise the embedding route against mocked upstream responses."""

import json
import os
import unittest
from unittest.mock import patch

import httpx

from app.main import app, load_embedding_config

GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai"
OTHER = "https://embeddings.example.test/v1"


class Embeddings(unittest.IsolatedAsyncioTestCase):
    async def embed(self, endpoint, texts, upstream):
        with patch.dict(os.environ, {
            "MODEL_PROVIDER": "openai-compatible",
            "MODEL_EMBEDDING_BASE_URL": endpoint,
            "MODEL_EMBEDDING_NAME": "test-model",
            "MODEL_EMBEDDING_API_KEY": "test-key",
            "MODEL_EMBEDDING_DIMENSIONS": "3072",
        }):
            config = load_embedding_config()
            async with (
                httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as provider,
                httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
            ):
                app.state.embedding_config = config
                app.state.token = b"test-token"
                app.state.client = provider
                return await client.post(
                    "/internal/v1/embeddings",
                    headers={"X-Embedding-Service-Token": "test-token"},
                    json={"texts": texts, "fingerprint": config.fingerprint},
                )

    async def test_gemini_unindexed_singletons_preserve_input_order(self):
        values = {"first": 2, "second": 1, "third": 3}
        requests = []

        def upstream(request):
            self.assertEqual(str(request.url), GEMINI + "/embeddings")
            inputs = json.loads(request.content)["input"]
            self.assertEqual(len(inputs), 1)
            text = inputs[0]
            requests.append(text)
            row = {"embedding": [values[text]] * 3072}
            if text == "second":
                row["index"] = 0
            return httpx.Response(200, json={"data": [row]})

        response = await self.embed(GEMINI + "/", ["first", "second", "third"], upstream)
        self.assertEqual(response.status_code, 200)
        self.assertCountEqual(requests, values.keys())
        self.assertEqual(response.json()["vectors"], [[2] * 3072, [1] * 3072, [3] * 3072])

    async def test_gemini_rejects_invalid_singletons(self):
        valid = {"embedding": [1] * 3072}
        for rows in ([], [valid, valid], [dict(valid, index=1)], [dict(valid, index=False)],
                     [dict(valid, index=None)], [{"embedding": [1]}], [{"embedding": [0] * 3072}]):
            with self.subTest(row_count=len(rows), index=rows[0].get("index") if rows else None):
                response = await self.embed(GEMINI, ["text"], lambda _: httpx.Response(200, json={"data": rows}))
                self.assertEqual(response.status_code, 502)

    async def test_other_providers_still_require_indexed_batches(self):
        def upstream(request):
            self.assertEqual(json.loads(request.content)["input"], ["first", "second"])
            return httpx.Response(200, json={"data": [
                {"index": 1, "embedding": [2] * 3072},
                {"index": 0, "embedding": [1] * 3072},
            ]})

        response = await self.embed(OTHER, ["first", "second"], upstream)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["vectors"], [[1] * 3072, [2] * 3072])
        for rows in ([{"embedding": [1] * 3072}], [{"index": 0, "embedding": [1] * 3072}]):
            response = await self.embed(OTHER, ["first", "second"], lambda _: httpx.Response(200, json={"data": rows}))
            self.assertEqual(response.status_code, 502)


if __name__ == "__main__":
    unittest.main()
