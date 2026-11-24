"""Check the final Ask retry against mocked upstream responses."""

import json
import os
import unittest
from unittest.mock import patch

import httpx

from app.main import app


class CompletionRetry(unittest.IsolatedAsyncioTestCase):
    async def request(self, statuses, *, retry, effort="", response_format="", content="answer", error=None):
        calls = []

        def upstream(request):
            calls.append(json.loads(request.content))
            self.assertIs(calls[-1]['stream'], False)
            status = statuses[len(calls) - 1]
            if status is None:
                raise httpx.ReadTimeout("fixture timeout", request=request)
            if error is not None:
                return httpx.Response(status,json={"error":error})
            return httpx.Response(status, json={"choices": [{"finish_reason": "length" if content is None else "stop",
                "message": {"content": content, "reasoning_content": "private-fixture-reasoning"}}],
                "usage": {"completion_tokens": 2048, "completion_tokens_details": {"reasoning_tokens": 2048}}})

        with patch.dict(os.environ, {
            "MODEL_PROVIDER": "openai-compatible", "MODEL_CHAT_BASE_URL": "https://example.test/v1",
            "MODEL_CHAT_NAME": "fixture", "MODEL_CHAT_API_KEY": "provider-fixture",
            "MODEL_CHAT_TOKEN": "service-fixture", "MODEL_CHAT_REASONING_EFFORT": effort,
            "MODEL_CHAT_RESPONSE_FORMAT": response_format,
        }):
            async with (
                httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as provider,
                httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://gateway") as client,
            ):
                app.state.client = provider
                body = {"messages": [{"role": "user", "content": "question"}]}
                if retry:
                    body["retry_on_unavailable"] = True
                response = await client.post("/internal/v1/completions", json=body,
                                             headers={"X-Model-Service-Token": "service-fixture"})
        return response, calls

    async def test_retries_503_once_with_same_payload(self):
        response, calls = await self.request([503, 200], retry=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "answer")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], calls[1])
        self.assertNotIn("retry_on_unavailable", calls[0])

    async def test_reasoning_effort_is_opt_in_and_validated(self):
        response, calls = await self.request([200], retry=False)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('reasoning_effort', calls[0])
        response, calls = await self.request([503, 200], retry=True, effort='low')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0]['reasoning_effort'], 'low')
        self.assertEqual(calls[0], calls[1])
        response, calls = await self.request([], retry=False, effort='invalid')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(calls, [])

    async def test_json_object_mode_is_opt_in_and_preserved_on_retry(self):
        response, calls = await self.request([200], retry=False)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('response_format', calls[0])
        response, calls = await self.request([503, 200], retry=True, response_format='json_object')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0]['response_format'], {'type': 'json_object'})
        self.assertEqual(calls[0], calls[1])
        response, calls = await self.request([], retry=False, response_format='invalid')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(calls, [])

    async def test_missing_content_reports_only_safe_shape_metadata(self):
        with self.assertLogs('uvicorn.error', level='WARNING') as logs:
            response, calls = await self.request([200], retry=False, content=None)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(len(calls), 1)
        self.assertTrue(any('finish_reason=length' in line and 'reasoning_tokens=2048' in line for line in logs.output))
        self.assertFalse(any('private-fixture-reasoning' in line for line in logs.output))

    async def test_rejection_logs_only_allowlisted_codes_and_parameters(self):
        for error, code, param in [
            ({'code':'context_length_exceeded','param':'messages','message':'private-provider-fixture'}, 'context_length_exceeded', 'messages'),
            ({'code':['private-provider-fixture'],'param':'private-provider-fixture','message':'private-provider-fixture'}, 'other', 'None'),
        ]:
            with self.assertLogs('uvicorn.error',level='WARNING') as logs:
                response, calls = await self.request([400],retry=False,error=error)
            self.assertEqual(response.status_code,503)
            self.assertEqual(len(calls),1)
            self.assertTrue(any('code='+code in line and 'param='+param in line for line in logs.output))
            self.assertFalse(any('private-provider-fixture' in line for line in logs.output))

    async def test_repeated_503_stops_after_retry(self):
        with self.assertLogs("uvicorn.error", level="WARNING") as logs:
            response, calls = await self.request([503, 503], retry=True)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(len(calls), 2)
        self.assertIn("error=HTTPStatusError", logs.output[-1])
        self.assertIn("upstream_status=503", logs.output[-1])

    async def test_no_retry_for_other_errors_or_unflagged_call(self):
        for status, retry in ((503, False), (429, True), (None, True)):
            with self.subTest(status=status, retry=retry):
                response, calls = await self.request([status], retry=retry)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
