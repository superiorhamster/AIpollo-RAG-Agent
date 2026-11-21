"""Exercise real subprocess cleanup without loading ML models or Docker."""

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app import main
from rag_http import ApiError
from rag_runtime import RuntimeBudgets


class ParserLifecycle(unittest.IsolatedAsyncioTestCase):
    async def test_real_child_is_stopped_on_timeout_and_disconnect(self):
        create = asyncio.create_subprocess_exec
        for disconnected in (False, True):
            processes = []

            async def launch(*_args, **kwargs):
                process = await create(sys.executable, '-c', 'import time; time.sleep(60)', **kwargs)
                processes.append(process)
                return process

            async def is_disconnected():
                return disconnected

            with tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / 'source.pdf'
                source.write_bytes(b'%PDF-synthetic')
                with patch.object(main.asyncio, 'create_subprocess_exec', launch), patch.object(main, 'budgets', SimpleNamespace(parse_wall=.05)):
                    with self.assertRaises(ApiError) as caught:
                        await main.converted(SimpleNamespace(is_disconnected=is_disconnected), source, Path(directory) / 'output')
                self.assertEqual(caught.exception.detail['code'], 'cancelled' if disconnected else 'parse_timeout')
                self.assertIsNotNone(processes[0].returncode)
                self.assertFalse(main.children)

    async def test_success_preserves_page_and_region(self):
        create = asyncio.create_subprocess_exec
        chunk = {'text': 'Phòng B4-201.', 'page': 2, 'region': [0.1, 0.2, 0.8, 0.4]}
        async def launch(*args, **kwargs):
            script = 'from pathlib import Path; Path(' + repr(args[-1]) + ').write_text(' + repr(json.dumps({'chunks': [chunk]})) + ')'
            return await create(sys.executable, '-c', script, **kwargs)
        async def is_disconnected():
            return False
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(main.asyncio, 'create_subprocess_exec', launch):
                result = await main.converted(SimpleNamespace(is_disconnected=is_disconnected), Path(directory)/'input', Path(directory)/'output')
        self.assertEqual(result[0].page, 2)
        self.assertEqual(result[0].region, tuple(chunk['region']))

    async def test_busy_does_not_consume_a_second_request(self):
        async with main.slot:
            with self.assertRaises(ApiError) as caught:
                await main.parse(SimpleNamespace(headers={'content-type': 'application/pdf'}))
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail['code'], 'parser_busy')
        self.assertGreater(int(caught.exception.headers['Retry-After']), 0)

    def test_deadlines_are_nested_and_invalid_configuration_is_rejected(self):
        budgets = RuntimeBudgets.from_env()
        self.assertLess(budgets.parse, budgets.parse_wall)
        self.assertLess(budgets.parse_wall, budgets.parse_caller)
        self.assertLess(budgets.embedding, budgets.embedding_caller)
        self.assertLess(budgets.search, budgets.search_caller)
        with patch.dict('os.environ', {'DOCUMENT_PARSE_TIMEOUT_SECONDS': '600'}):
            heavy = RuntimeBudgets.from_env()
            self.assertEqual((heavy.parse_wall, heavy.parse_caller), (630, 645))
        with patch.dict('os.environ', {'INDEX_JOB_TIMEOUT_SECONDS': '100'}):
            with self.assertRaises(ValueError):
                RuntimeBudgets.from_env()


if __name__ == '__main__':
    unittest.main()
