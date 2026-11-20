"""Exercise Ask's worker and HTTP payloads without provider traffic."""

import json
import os
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx

from app.ask_prompts import ANSWER_SYSTEM, REWRITE_SYSTEM
from app.types import Answer, GeneratedAnswer, GeneratedAskAnswer
from app.worker import ASK_COMPLETION_UNAVAILABLE, StopRun, Worker


def passage(name, text):
    return dict(name=name, text=text, document_id=str(uuid4()), chunk_id=str(uuid4()),
                section="", page=1, region=None)


SCHEDULE = passage("Schedule", "Internal demo Friday at 09:30 in B2-302. Instructor demo Friday at 14:00 in B4-201.")
CHECKLIST = passage("Checklist", "B2-302 uses direct HDMI. B4-201 requires an HDMI-to-VGA adapter.")
GUIDE = passage("Borrowing guide", "The adapter is available at B4-105. Register at least 30 minutes before the demo.")
SOURCES = [part["document_id"] for part in (SCHEDULE, CHECKLIST, GUIDE)]
Q1 = "Buổi demo với giảng viên diễn ra lúc mấy giờ và ở phòng nào?"
Q2 = "Vậy vào phòng đó thì laptop nhóm tôi cần mang thêm gì để chiếu?"
Q3 = "Cái đó mượn ở đâu, và chậm nhất mấy giờ phải đăng ký?"


def claim(text, *sources):
    return dict(text=text, source="document" if sources else "conversation",
                evidence=[part["chunk_id"] for part in sources])


class InMemoryRuns:
    rowcount = 1

    def __init__(self):
        self.rows = []

    @asynccontextmanager
    async def connect(self):
        yield self

    begin = connect

    async def scalar(self, *_):
        return True

    async def execute(self, statement, params):
        sql = str(statement)
        if "jsonb_path_query_array" in sql:
            for fragment in ("workspace_id=:workspace", "user_id=:user", "conversation_id=:conversation",
                             "status='succeeded'", "run_id <> :run", "created_at < :created", "LIMIT 6"):
                assert fragment in sql
            matching = [row for row in reversed(self.rows)
                        if row["workspace_id"] == params["workspace"] and row["user_id"] == params["user"]
                        and row["conversation_id"] == params["conversation"] and row["status"] == "succeeded"
                        and row["created_at"] < params["created"]]
            return [(row["input"]["query"], [item["text"] for item in row["result"]["claims"]])
                    for row in matching[:6]]
        if "SET status=:status" in sql:
            row = next(row for row in self.rows if row["run_id"] == params["run"])
            row.update(status=params["status"], error=params["error"], result=json.loads(params["result"] or "null"))
        return self


class HistoryAsk(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.database = InMemoryRuns()
        self.thread, self.workspace, self.user = uuid4(), uuid4(), uuid4()
        env = patch.dict(os.environ, {"MODEL_CHAT_TOKEN": "fixture", "RETRIEVAL_INTERACTION_TOKEN": "fixture",
                                      "WORKSPACE_INTERACTION_TOKEN": "fixture", "RUN_MAX_COST_MICRO_USD": "0",
                                      "RUN_MAX_INPUT_BYTES": "14000", "RUN_MAX_STEPS": "2"})
        env.start()
        self.addCleanup(env.stop)

    def new_run(self, question, new_thread=False):
        run = dict(run_id=uuid4(), lease_id=uuid4(), request_id=uuid4(), workspace_id=self.workspace,
                   user_id=self.user, conversation_id=uuid4() if new_thread else self.thread,
                   interaction="ASK", created_at=len(self.database.rows), status="running",
                   input=dict(query=question, document_ids=SOURCES, capability="LEARN", task="answer"))
        self.database.rows.append(run)
        return run

    async def turn(self, question, passages, claims, history=(), *, standalone=None, fallback=None, new_thread=False):
        run = self.new_run(question, new_thread)
        stages = []

        def handle(request):
            if request.url.host == "workspace-service":
                return httpx.Response(200)
            payload = json.loads(request.content)
            if request.url.host == "retrieval-service":
                stages.append("retrieve")
                self.assertEqual(payload, dict(query=standalone or question, document_ids=SOURCES, limit=6))
                return httpx.Response(200, json={"evidence": passages})
            self.assertEqual(request.url.host, "model-gateway")
            system, user = payload["messages"]
            inputs = json.loads(user["content"])
            if system["content"] == REWRITE_SYSTEM:
                stages.append("rewrite")
                self.assertNotIn("retry_on_unavailable", payload)
                self.assertEqual(inputs, {"question": question, "history": list(history)})
                if isinstance(fallback, int):
                    return httpx.Response(fallback)
                output = fallback or json.dumps({"query": standalone or question})
            else:
                stages.append("compose")
                self.assertTrue(payload["retry_on_unavailable"])
                self.assertEqual(system["content"], ANSWER_SYSTEM)
                self.assertEqual(inputs, {
                    "task": "answer", "fields": [], "objective": question, "capability": "LEARN",
                    "history": list(history), "evidence": [
                        {"id": p["chunk_id"], "text": p["text"], "section": p["section"]} for p in passages
                    ],
                })
                output = json.dumps({"claims": claims})
            return httpx.Response(200, json={"text": output})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            await Worker(self.database, client).execute(run)
        self.assertEqual(run["status"], "succeeded", run.get("error"))
        self.assertEqual(stages, (["rewrite"] if history else []) + ["retrieve"] +
                         (["compose"] if passages or history else []))
        self.assertEqual(run["input"]["query"], question)
        return run["result"]

    async def test_first_ask_and_three_turn_demo(self):
        time, room, adapter = "14:00 thứ Sáu.", "Phòng B4-201.", "Cần bộ chuyển HDMI sang VGA."
        first = await self.turn(Q1, [SCHEDULE], [claim(time, SCHEDULE), claim(room, SCHEDULE)])
        self.assertEqual([c["citations"] for c in first["claims"]], [[SCHEDULE], [SCHEDULE]])
        history = [{"question": Q1, "answer": f"{time} {room}"}]
        second = await self.turn(Q2, [CHECKLIST], [claim(adapter, CHECKLIST)], history,
                                 standalone="Laptop cần mang gì để chiếu tại phòng B4-201?")
        self.assertEqual(second["claims"][0]["citations"], [CHECKLIST])
        history.append({"question": Q2, "answer": adapter})
        third = await self.turn(Q3, [GUIDE, SCHEDULE], [
            claim("Mượn tại B4-105.", GUIDE), claim("Đăng ký chậm nhất 13:30.", SCHEDULE, GUIDE),
        ], history, standalone="Mượn bộ chuyển HDMI sang VGA ở đâu, và khi nào phải đăng ký cho demo giảng viên?")
        self.assertEqual([c["citations"] for c in third["claims"]], [[GUIDE], [SCHEDULE, GUIDE]])
        fresh = await self.turn(Q1, [SCHEDULE], [claim(time, SCHEDULE)], new_thread=True)
        self.assertEqual(fresh["claims"][0]["citations"], [SCHEDULE])

    async def test_fallback_recall_and_unsupported_question(self):
        seed = "Tôi gọi buổi demo là Mây Tím."
        await self.turn(seed, [], [])
        history = [{"question": seed, "answer": ""}]
        for unusable in (503, '{"query":""}', '{"query":"??"}', '{"query":"line\\nbreak"}'):
            question, answer = "Tôi đã đặt tên gì?", "Bạn gọi nó là Mây Tím."
            result = await self.turn(question, [], [claim(answer)], history, fallback=unusable)
            parsed = Answer.model_validate(result)
            self.assertEqual(parsed.claims[0].source, "conversation")
            self.assertEqual(parsed.claims[0].citations, [])
            history.append({"question": question, "answer": answer})
        result = await self.turn("Tài liệu có nói về bảo hành không?", [], [], history)
        self.assertTrue(result["insufficient_evidence"])

    async def test_mixed_citations_and_history_scope(self):
        seed = "Tôi gọi buổi demo là Mây Tím."
        await self.turn(seed, [], [])
        for overrides in ({"status": "failed"}, {"status": "cancelled"}, {"user_id": uuid4()},
                          {"workspace_id": uuid4()}, {"conversation_id": uuid4()}):
            self.database.rows.append({**self.database.rows[0], **overrides,
                                       "input": {"query": "Do not load"}, "created_at": len(self.database.rows)})
        mixed = await self.turn("Demo lúc nào và tôi gọi là gì?", [SCHEDULE],
                               [claim("14:00 thứ Sáu.", SCHEDULE), claim("Bạn gọi nó là Mây Tím."),
                                claim("Không có căn cứ.", CHECKLIST)],
                               [{"question": seed, "answer": ""}])
        self.assertEqual([c["citations"] for c in mixed["claims"]], [[SCHEDULE], []])
        for schema in (GeneratedAnswer, GeneratedAskAnswer):
            with self.assertRaises(ValueError):
                schema.model_validate({"claims": [{"text": "No support", "evidence": []}]})
        legacy = Answer.model_validate({"claims": [{"text": "Old", "citations": [SCHEDULE]}],
                                        "insufficient_evidence": False})
        self.assertEqual(legacy.claims[0].source, "document")

    async def test_rewrite_does_not_bypass_cancellation(self):
        await self.turn(Q1, [SCHEDULE], [claim("14:00", SCHEDULE)])
        run = self.new_run(Q2)
        client = AsyncMock()
        worker = Worker(self.database, client)
        with (patch.object(worker, "current", side_effect=[None, StopRun("cancelled")]),
              patch.object(worker, "complete", return_value='{"query":"B4-201"}')):
            await worker.execute(run)
        client.post.assert_not_called()
        self.assertEqual(run["status"], "cancelled")

    async def test_only_final_ask_gateway_503_gets_retry_marker(self):
        async def handle(request):
            if request.url.host == "workspace-service":
                return httpx.Response(200)
            if request.url.host == "retrieval-service":
                return httpx.Response(200, json={"evidence": [SCHEDULE]})
            return httpx.Response(status, json={"text": "invalid model output"})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            worker = Worker(self.database, client)
            for status, expected in ((503, ASK_COMPLETION_UNAVAILABLE), (502, "interaction_unavailable"),
                                     (200, "interaction_unavailable")):
                run = self.new_run(Q1, new_thread=True)
                await worker.execute(run)
                self.assertEqual((run["status"], run["error"]), ("failed", expected))

if __name__ == "__main__":
    unittest.main()
