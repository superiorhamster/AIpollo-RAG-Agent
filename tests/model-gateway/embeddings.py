"""Exercise the embedding route against mocked upstream responses."""

import asyncio
import json
import os
import unittest
from unittest.mock import patch

import httpx

from app.main import app, load_embedding_config, valid_provider_url

GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai"
OTHER = "https://embeddings.example.test/v1"


class Embeddings(unittest.IsolatedAsyncioTestCase):
    async def embed(self, endpoint, texts, upstream, *, dimensions="3072", local_http=False):
        with patch.dict(os.environ, {
            "MODEL_PROVIDER": "openai-compatible",
            "MODEL_EMBEDDING_BASE_URL": endpoint,
            "MODEL_EMBEDDING_NAME": "test-model",
            "MODEL_EMBEDDING_API_KEY": "test-key",
            "MODEL_EMBEDDING_DIMENSIONS": dimensions,
            "MODEL_ALLOW_LOCAL_HTTP": "true" if local_http else "false",
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

    async def test_full_gemini_batch_is_bounded_and_preserves_input_order(self):
        active = 0
        peak = 0
        completed = []
        texts = [str(index) for index in range(16)]

        async def upstream(request):
            nonlocal active, peak
            index = int(json.loads(request.content)["input"][0])
            active += 1
            peak = max(peak, active)
            try:
                # Force requests to finish out of input order.
                await asyncio.sleep(0.08 if index % 4 == 0 else 0.02)
                completed.append(index)
                return httpx.Response(200, json={"data": [{"embedding": [index + 1] * 3072}]})
            finally:
                active -= 1

        with patch("app.main.GEMINI_BATCH_TIMEOUT_SECONDS", 0.8):
            response = await self.embed(GEMINI, texts, upstream)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["vectors"], [[index + 1] * 3072 for index in range(16)])
        self.assertEqual(peak, 4)
        self.assertNotEqual(completed, list(range(16)))
        self.assertEqual(active, 0)

    async def test_gemini_deadline_cancels_inflight_and_queued_requests(self):
        active = 0
        started = []
        cancelled = []

        async def upstream(request):
            nonlocal active
            text = json.loads(request.content)["input"][0]
            started.append(text)
            active += 1
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.append(text)
                raise
            finally:
                active -= 1

        with patch("app.main.GEMINI_BATCH_TIMEOUT_SECONDS", 0.05):
            response = await self.embed(GEMINI, [str(index) for index in range(16)], upstream)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "provider_unavailable")
        self.assertEqual(len(started), 4)
        self.assertCountEqual(cancelled, started)
        self.assertEqual(active, 0)

    async def test_gemini_failure_cancels_other_requests(self):
        active = 0
        started = []

        async def upstream(request):
            nonlocal active
            text = json.loads(request.content)["input"][0]
            started.append(text)
            active += 1
            try:
                if text == "0":
                    await asyncio.sleep(0.02)
                    return httpx.Response(429)
                await asyncio.Event().wait()
            finally:
                active -= 1

        async with asyncio.timeout(1):
            response = await self.embed(GEMINI, [str(index) for index in range(16)], upstream)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("vectors", response.json())
        self.assertLess(len(started), 16)
        self.assertEqual(active, 0)

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

    async def test_ollama_768_dimension_batch_preserves_input_order(self):
        def upstream(request):
            self.assertEqual(str(request.url), "http://ollama:11434/v1/embeddings")
            self.assertEqual(json.loads(request.content)["input"], ["Phòng B4-201.", "Bộ chuyển HDMI."])
            return httpx.Response(200, json={"data": [
                {"index": 1, "embedding": [2.] * 768}, {"index": 0, "embedding": [1.] * 768},
            ]})
        response = await self.embed("http://ollama:11434/v1", ["Phòng B4-201.", "Bộ chuyển HDMI."],
                                    upstream, dimensions="768", local_http=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["vectors"], [[1.] * 768, [2.] * 768])

    async def test_ollama_invalid_vectors_and_unavailable_model(self):
        for vector in ([1.] * 512, [0.] * 768):
            response = await self.embed("http://ollama:11434/v1", ["Tiếng Việt"],
                                        lambda _: httpx.Response(200, json={"data": [{"index": 0, "embedding": vector}]}),
                                        dimensions="768", local_http=True)
            self.assertEqual(response.status_code, 502)
        response = await self.embed("http://ollama:11434/v1", ["Tiếng Việt"],
                                    lambda _: httpx.Response(404), dimensions="768", local_http=True)
        self.assertEqual(response.status_code, 503)

    def test_ollama_local_http_is_opt_in_and_embedding_only(self):
        with patch.dict(os.environ, {"MODEL_ALLOW_LOCAL_HTTP": "false"}):
            self.assertFalse(valid_provider_url("http://ollama:11434/v1", embedding=True))
        with patch.dict(os.environ, {"MODEL_ALLOW_LOCAL_HTTP": "true"}):
            self.assertTrue(valid_provider_url("http://ollama:11434/v1", embedding=True))
            self.assertFalse(valid_provider_url("http://ollama:11434/v1"))
            for url in ("http://untrusted:11434/v1", "http://ollama.evil/v1", "http://user:pass@ollama/v1"):
                self.assertFalse(valid_provider_url(url, embedding=True))


if __name__ == "__main__":
    unittest.main()
