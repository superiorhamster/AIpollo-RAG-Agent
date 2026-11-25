"""Exercise the embedding route against mocked upstream responses."""

import asyncio
import hashlib
import json
import os
import unittest
from unittest.mock import patch

import httpx

from app.main import app, load_embedding_config, valid_provider_url

GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai"
OTHER = "https://embeddings.example.test/v1"


class Embeddings(unittest.IsolatedAsyncioTestCase):
    async def embed(self, endpoint, texts, upstream, *, dimensions="3072", local_http=False, protocol="openai",
                    model="test-model", input_type=None, fingerprint=None):
        with patch.dict(os.environ, {
            "MODEL_PROVIDER": "openai-compatible",
            "MODEL_EMBEDDING_BASE_URL": endpoint,
            "MODEL_EMBEDDING_NAME": model,
            "MODEL_EMBEDDING_API_KEY": "test-key",
            "MODEL_EMBEDDING_DIMENSIONS": dimensions,
            "MODEL_ALLOW_LOCAL_HTTP": "true" if local_http else "false",
            "MODEL_EMBEDDING_PROTOCOL": protocol,
        }):
            config = load_embedding_config()
            async with (
                httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as provider,
                httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
            ):
                app.state.embedding_config = config
                app.state.token = b"test-token"
                app.state.client = provider
                payload = {"texts": texts, "fingerprint": fingerprint or config.fingerprint}
                if input_type is not None:
                    payload["input_type"] = input_type
                return await client.post(
                    "/internal/v1/embeddings",
                    headers={"X-Embedding-Service-Token": "test-token"},
                    json=payload,
                )

    async def test_gemini_2_retrieval_roles_and_dimensions(self):
        texts = ["Phòng B4-201.", "Bộ chuyển HDMI."]
        for model in ("gemini-embedding-2", "gemini-embedding-2-preview"):
            for dimensions in (768, 1536, 3072):
                for role in (None, "document", "query"):
                    with self.subTest(model=model, dimensions=dimensions, role=role):
                        seen = []

                        def upstream(request):
                            self.assertEqual(str(request.url), GEMINI + "/embeddings")
                            body = json.loads(request.content)
                            self.assertEqual(body["model"], model)
                            self.assertEqual(body["dimensions"], dimensions)
                            self.assertNotIn("task_type", body)
                            self.assertEqual(len(body["input"]), 1)
                            seen.extend(body["input"])
                            return httpx.Response(200, json={"data": [{"embedding": [1.] * dimensions}]})

                        response = await self.embed(GEMINI, texts, upstream, model=model,
                                                    dimensions=str(dimensions), input_type=role)
                        self.assertEqual(response.status_code, 200)
                        prefix = "task: search result | query: " if role == "query" else "title: none | text: "
                        self.assertCountEqual(seen, [prefix + text for text in texts])
                        self.assertEqual(len(response.json()["vectors"]), len(texts))
                        self.assertEqual(texts, ["Phòng B4-201.", "Bộ chuyển HDMI."])

    async def test_legacy_model_query_request_is_unchanged(self):
        for endpoint, model in ((GEMINI, "gemini-embedding-001"), (OTHER, "another-model")):
            def upstream(request):
                self.assertEqual(json.loads(request.content), {"model": model, "input": ["Evidence"]})
                return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.] * 3072}]})

            response = await self.embed(endpoint, ["Evidence"], upstream, model=model, input_type="query")
            self.assertEqual(response.status_code, 200)

    async def test_gemini_2_proxy_uses_same_retrieval_format(self):
        def upstream(request):
            self.assertEqual(json.loads(request.content), {
                "model": "gemini-embedding-2", "input": ["task: search result | query: Evidence"],
                "dimensions": 768,
            })
            return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.] * 768}]})

        response = await self.embed(OTHER, ["Evidence"], upstream, model="gemini-embedding-2",
                                    input_type="query", dimensions="768")
        self.assertEqual(response.status_code, 200)

    async def test_gemini_2_rejects_mismatched_or_zero_vectors(self):
        for vector in ([1.] * 3072, [0.] * 768):
            response = await self.embed(GEMINI, ["Evidence"],
                                        lambda _: httpx.Response(200, json={"data": [{"embedding": vector}]}),
                                        model="gemini-embedding-2", dimensions="768")
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.json()["code"], "invalid_embedding")

    async def test_invalid_embedding_role_never_calls_provider(self):
        def upstream(_):
            self.fail("Invalid role must not reach the provider")

        response = await self.embed(GEMINI, ["Evidence"], upstream, model="gemini-embedding-2",
                                    input_type="invalid")
        self.assertEqual(response.status_code, 422)

    async def test_gemini_2_old_fingerprint_never_calls_provider(self):
        def upstream(_):
            self.fail("An outdated embedding configuration must not reach the provider")

        previous = hashlib.sha256(f"{GEMINI}\ngemini-embedding-2\n3072\n1".encode()).hexdigest()
        response = await self.embed(GEMINI, ["Evidence"], upstream, model="gemini-embedding-2",
                                    fingerprint=previous)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "model_changed")

    def test_gemini_2_fingerprint_versions_format_and_dimensions(self):
        with patch.dict(os.environ, {
            "MODEL_PROVIDER": "openai-compatible", "MODEL_EMBEDDING_BASE_URL": GEMINI,
            "MODEL_EMBEDDING_NAME": "gemini-embedding-2", "MODEL_EMBEDDING_API_KEY": "test-key",
            "MODEL_EMBEDDING_DIMENSIONS": "3072", "MODEL_EMBEDDING_REVISION": "1",
            "MODEL_EMBEDDING_PROTOCOL": "openai",
        }):
            original = load_embedding_config().fingerprint
            previous = hashlib.sha256(f"{GEMINI}\ngemini-embedding-2\n3072\n1".encode()).hexdigest()
            self.assertNotEqual(original, previous)
            with patch("app.main.GEMINI_RETRIEVAL_FORMAT", "test-next-format"):
                self.assertNotEqual(load_embedding_config().fingerprint, original)
            with patch.dict(os.environ, {"MODEL_EMBEDDING_DIMENSIONS": "768"}):
                self.assertNotEqual(load_embedding_config().fingerprint, original)
            with patch.dict(os.environ, {"MODEL_EMBEDDING_API_KEY": "rotated-test-key"}):
                self.assertEqual(load_embedding_config().fingerprint, original)
            for dimensions in ("127", "3073"):
                with patch.dict(os.environ, {"MODEL_EMBEDDING_DIMENSIONS": dimensions}):
                    with self.assertRaises(ValueError):
                        load_embedding_config()
            with patch.dict(os.environ, {"MODEL_EMBEDDING_NAME": "gemini-embedding-001"}):
                legacy = hashlib.sha256(f"{GEMINI}\ngemini-embedding-001\n3072\n1".encode()).hexdigest()
                self.assertEqual(load_embedding_config().fingerprint, legacy)

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

    def test_local_http_is_opt_in_and_rejects_untrusted_hosts(self):
        with patch.dict(os.environ, {"MODEL_ALLOW_LOCAL_HTTP": "false"}):
            self.assertFalse(valid_provider_url("http://host.docker.internal:11434/v1", embedding=True))
        with patch.dict(os.environ, {"MODEL_ALLOW_LOCAL_HTTP": "true"}):
            self.assertTrue(valid_provider_url("http://host.docker.internal:11434/v1", embedding=True))
            self.assertTrue(valid_provider_url("http://host.docker.internal:11434/v1"))
            for url in ("http://ollama:11434/v1", "http://untrusted:11434/v1", "http://user:pass@localhost/v1"):
                self.assertFalse(valid_provider_url(url, embedding=True))

    def test_unsupported_embedding_protocol_is_rejected(self):
        for protocol in ("ollama", "unknown"):
            with patch.dict(os.environ, {
                "MODEL_PROVIDER": "openai-compatible", "MODEL_EMBEDDING_BASE_URL": OTHER,
                "MODEL_EMBEDDING_NAME": "fixture", "MODEL_EMBEDDING_API_KEY": "fixture",
                "MODEL_EMBEDDING_DIMENSIONS": "768", "MODEL_EMBEDDING_PROTOCOL": protocol,
            }):
                with self.assertRaises(ValueError):
                    load_embedding_config()


if __name__ == "__main__":
    unittest.main()
