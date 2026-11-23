"""Exercise Ask's worker and HTTP payloads without provider traffic."""

import json
import os
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx

from app.generation import REPAIR
from app.ask_prompts import ANSWER_SYSTEM, ATTRIBUTION_SYSTEM, PRIMARY_SEGMENT_SYSTEM, REWRITE_SYSTEM
from app.types import Answer, GeneratedAnswer, GeneratedAskAnswer
from app.worker import ASK_COMPLETION_UNAVAILABLE, StopRun, Worker


def passage(name, text):
    return dict(name=name, text=text, document_id=str(uuid4()), chunk_id=str(uuid4()),
                section="", page=1, region=None, segment_ids=None)


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
        self.selected = None

    def mappings(self):
        return self

    def one_or_none(self):
        return self.selected

    @asynccontextmanager
    async def connect(self):
        yield self

    begin = connect

    async def scalar(self, *_):
        return True

    async def execute(self, statement, params):
        sql = str(statement)
        if "SELECT history_snapshot" in sql:
            self.selected = next((row for row in self.rows if row["run_id"] == params["run"]
                                  and row["lease_id"] == params["lease"] and row["status"] == "running"), None)
            if self.selected is not None:
                self.selected.setdefault("history_snapshot", None)
        if "SET history_snapshot" in sql:
            row = next(row for row in self.rows if row["run_id"] == params["run"])
            row["history_snapshot"] = json.loads(params["history"])
        if "jsonb_path_query_array" in sql:
            for fragment in ("workspace_id=:workspace", "user_id=:user", "conversation_id=:conversation",
                             "status='succeeded'", "run_id <> :run", "created_at < :created", "LIMIT 6"):
                assert fragment in sql
            matching = [row for row in reversed(self.rows)
                        if row["workspace_id"] == params["workspace"] and row["user_id"] == params["user"]
                        and row["conversation_id"] == params["conversation"] and row["status"] == "succeeded"
                        and row["created_at"] < params["created"]]
            return [(row["input"]["query"], [item["text"] for item in row["result"]["claims"]], row["result"].get("tutor_question"))
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
                                      "RUN_MAX_INPUT_BYTES": "14000", "RUN_MAX_STEPS": "2",
                                      "ASK_SENTENCE_CITATIONS": "legacy"})
        env.start()
        self.addCleanup(env.stop)

    def new_run(self, question, new_thread=False):
        run = dict(run_id=uuid4(), lease_id=uuid4(), request_id=uuid4(), workspace_id=self.workspace,
                   user_id=self.user, conversation_id=uuid4() if new_thread else self.thread,
                   interaction="ASK", created_at=len(self.database.rows), status="running",
                   input=dict(query=question, document_ids=SOURCES, capability="LEARN", task="answer"))
        self.database.rows.append(run)
        return run

    async def turn(self, question, passages, claims, history=(), *, standalone=None, fallback=None, new_thread=False, repaired=None):
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
                self.assertIn(system["content"], (ANSWER_SYSTEM, ANSWER_SYSTEM + REPAIR))
                self.assertEqual(inputs, {
                    "task": "answer", "fields": [], "objective": question, "capability": "LEARN",
                    "history": list(history), "evidence": [
                        {"id": p["chunk_id"], "text": p["text"], "section": p["section"]} for p in passages
                    ],
                })
                output = json.dumps({"claims": repaired if system["content"].endswith(REPAIR) and repaired is not None else claims})
            return httpx.Response(200, json={"text": output})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            await Worker(self.database, client).execute(run)
        self.assertEqual(run["status"], "succeeded", run.get("error"))
        self.assertEqual(stages, (["rewrite"] if history else []) + ["retrieve"] +
                         (["compose"] * (2 if repaired is not None else 1) if passages or history else []))
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
                               [{"question": seed, "answer": ""}], repaired=[claim("14:00 thứ Sáu.", SCHEDULE), claim("Bạn gọi nó là Mây Tím.")])
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
                                     (200, "invalid_model_output")):
                run = self.new_run(Q1, new_thread=True)
                await worker.execute(run)
                self.assertEqual((run["status"], run["error"]), ("failed", expected))

    async def test_snapshot_survives_later_turns_and_worker_reexecution(self):
        await self.turn(Q1, [SCHEDULE], [claim("Phòng B4-201.", SCHEDULE)])
        original = self.new_run(Q2)
        worker = Worker(self.database, None)
        saved = await worker.load_history(original)
        self.assertEqual(saved, [{"question": Q1, "answer": "Phòng B4-201."}])
        await self.turn("Hãy nói về phòng B2-302.", [], [], saved)
        self.assertEqual(await worker.load_history(original), saved)
        retried = self.new_run(Q2)
        retried["history_snapshot"] = saved
        self.assertEqual(await worker.load_history(retried), saved)

    async def test_empty_snapshot_is_not_rebuilt(self):
        first = self.new_run(Q1)
        worker = Worker(self.database, None)
        self.assertEqual(await worker.load_history(first), [])
        await self.turn("Một câu hỏi về phòng khác.", [], [])
        first["created_at"] = 100
        self.assertEqual(await worker.load_history(first), [])

    async def test_evidence_precedes_history_at_small_input_limit(self):
        with patch.dict(os.environ, {"RUN_MAX_INPUT_BYTES": "4096"}):
            worker = Worker(self.database, None)
        run = self.new_run(Q1)
        source = passage("Schedule", "Buổi demo ở phòng B4-201. " + "x" * 1450)
        history = [{"question": "Câu hỏi cũ " + "x" * 100, "answer": "x" * 880}]
        worker.current = AsyncMock()
        worker.complete = AsyncMock(return_value=json.dumps({"claims": [claim("B4-201.", source)]}))
        result = await worker.compose(run, [source], history, 0)
        packed = json.loads(worker.complete.call_args.args[2])
        self.assertEqual(packed["evidence"][0]["id"], source["chunk_id"])
        self.assertEqual(packed["history"], [])
        self.assertLessEqual(len((ANSWER_SYSTEM + worker.complete.call_args.args[2]).encode()), 4096)
        self.assertEqual(result["claims"][0]["citations"], [source])

    async def test_newest_history_is_retained_in_remaining_space(self):
        worker = Worker(self.database, None)
        run = self.new_run(Q1)
        worker.current = AsyncMock()
        worker.complete = AsyncMock(return_value='{"claims":[]}')
        history = [{"question": "old", "answer": "x" * 13000}, {"question": "new", "answer": "new answer"}]
        await worker.compose(run, [SCHEDULE], history, 0)
        packed = json.loads(worker.complete.call_args.args[2])
        self.assertEqual(packed["history"], history[1:])

    async def test_final_prompt_and_rewrite_share_the_cost_budget(self):
        worker = Worker(self.database, None)
        worker.current = AsyncMock()
        worker.complete = AsyncMock()
        worker.budget, worker.input_cost, worker.output_cost = 1, 1, 1
        with self.assertRaises(StopRun) as caught:
            await worker.compose(self.new_run(Q1), [SCHEDULE], [], 1)
        self.assertEqual(caught.exception.code, "cost_limit")
        worker.complete.assert_not_called()
    async def test_socratic_three_turns_keep_questions_and_current_citations(self):
        questions = ["Em tính hạn đăng ký như thế nào?", "Nếu phải sớm 30 phút thì em trừ hay cộng?", None]
        packed_history = []
        def upstream(request):
            if request.url.host == 'workspace-service':
                return httpx.Response(200)
            payload = json.loads(request.content)
            if request.url.host == 'retrieval-service':
                return httpx.Response(200, json={'evidence': [SCHEDULE]})
            content = json.loads(payload['messages'][1]['content'])
            if 'question' in content:
                return httpx.Response(200, json={'text': json.dumps({'query': content['question']})})
            packed_history.append(content['history'])
            question = questions[len(packed_history)-1]
            return httpx.Response(200, json={'text': json.dumps({'question': question, 'claims': [claim('Buổi demo lúc 14:00.', SCHEDULE)]})})
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            worker = Worker(self.database, client)
            for action, query in [('guide', 'Tôi nên đăng ký lúc nào?'), ('hint', 'Tôi nghĩ cộng thêm 30 phút.'), ('solution', 'Cho tôi xem lời giải.')]:
                run = self.new_run(query)
                run['input'].update(task='socratic_tutor', tutor_action=action, citation_mode='segment')
                await worker.execute(run)
                self.assertEqual(run['status'], 'succeeded', run.get('error'))
                self.assertEqual(run['result']['claims'][0]['citations'], [SCHEDULE])
        self.assertEqual(packed_history[0], [])
        self.assertIn(questions[0], packed_history[1][0]['answer'])
        self.assertIn('cộng thêm', packed_history[2][-1]['question'])
        self.assertIsNone(run['result']['tutor_question'])

    async def test_structured_candidates_preserve_cited_siblings_and_abstain_without_evidence(self):
        def upstream(request):
            if request.url.host == 'retrieval-service':
                return httpx.Response(200, json={'evidence': [SCHEDULE]})
            return httpx.Response(200)
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            for valid in (True, False):
                run = self.new_run('Compare the reported schedule and dataset', new_thread=True)
                run['input'].update(task='comparison', capability='RESEARCH')
                candidate = {'text': 'Dataset not provided.', 'evidence': []}
                with self.assertRaises(ValueError):
                    GeneratedAnswer.model_validate({'claims': [candidate]})
                worker = Worker(self.database, client)
                claims = [claim('The demo begins at 14:00.', SCHEDULE)] if valid else []
                worker.complete = AsyncMock(return_value=json.dumps({'claims': [*claims, candidate]}))
                await worker.execute(run)
                self.assertEqual(run['status'], 'succeeded', run.get('error'))
                self.assertEqual(worker.complete.await_count, 1)
                self.assertEqual(run['result']['insufficient_evidence'], not valid)
                self.assertEqual(len(run['result']['claims']), int(valid))
                if valid:
                    self.assertEqual(run['result']['claims'][0]['citations'], [SCHEDULE])

    async def test_structured_candidates_reject_unknown_source_ids(self):
        def upstream(request):
            if request.url.host == 'retrieval-service':
                return httpx.Response(200, json={'evidence': [SCHEDULE]})
            return httpx.Response(200)
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            run = self.new_run(Q1, new_thread=True)
            run['input'].update(task='comparison', capability='RESEARCH')
            worker = Worker(self.database, client)
            worker.complete = AsyncMock(return_value=json.dumps({'claims': [claim('Wrong source', CHECKLIST)]}))
            with self.assertLogs('app.worker', level='WARNING'):
                await worker.execute(run)
            self.assertEqual(worker.complete.await_count, 2)
            self.assertEqual((run['status'], run['error']), ('failed', 'invalid_model_output'))

    async def test_invalid_tutor_question_receives_one_specific_repair(self):
        def upstream(request):
            if request.url.host == 'retrieval-service':
                return httpx.Response(200, json={'evidence': [SCHEDULE]})
            return httpx.Response(200)
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            run = self.new_run(Q1, new_thread=True)
            run['input'].update(task='socratic_tutor', tutor_action='guide')
            worker = Worker(self.database, client)
            worker.complete = AsyncMock(return_value=json.dumps({'claims': [], 'question': None}))
            with self.assertLogs('app.worker', level='WARNING') as logs:
                await worker.execute(run)
            self.assertEqual(worker.complete.await_count, 2)
            self.assertIn('Return one nonempty guiding question', worker.complete.await_args_list[1].args[1])
            self.assertIn('rule=question', ' '.join(logs.output))
            self.assertEqual((run['status'], run['error']), ('failed', 'invalid_model_output'))

    async def test_generation_repair_validates_envelope_uuid_and_provenance(self):
        good = json.dumps({"claims": [claim("14:00 thứ Sáu.", SCHEDULE)]})
        invalid = [
            'Here is the answer: ' + good,
            json.dumps({"claims": [{"text": "private-output-sentinel", "evidence": ["EX_SCHEDULE"]}]}),
            json.dumps({"claims": [claim("Wrong source", CHECKLIST)]}),
            json.dumps({"claims": [{"text": "Unsupported", "source": "document", "evidence": []}]}),
        ]
        def upstream(request):
            if request.url.host == 'retrieval-service':
                return httpx.Response(200, json={'evidence': [SCHEDULE]})
            return httpx.Response(200)
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            for broken in invalid:
                run = self.new_run(Q1, new_thread=True)
                worker = Worker(self.database, client)
                worker.complete = AsyncMock(side_effect=[broken, '```json\n' + good + '\n```'])
                with self.assertLogs('app.worker', level='WARNING') as captured:
                    await worker.execute(run)
                self.assertNotIn('private-output-sentinel', '\n'.join(captured.output))
                self.assertEqual(worker.complete.await_count, 2)
                self.assertEqual(run['status'], 'succeeded', run.get('error'))
                self.assertEqual(run['result']['claims'][0]['citations'], [SCHEDULE])

    async def test_schema_repair_includes_safe_error_paths_without_relaxing_validation(self):
        def upstream(request):
            if request.url.host == 'retrieval-service':return httpx.Response(200,json={'evidence':[SCHEDULE]})
            return httpx.Response(200)
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            worker=Worker(self.database,client)
            run=self.new_run(Q1,new_thread=True)
            broken=json.dumps({'claims':[{'text':'private-output-sentinel','source':'document','evidence':SCHEDULE['chunk_id']}]})
            good=json.dumps({'claims':[claim('14:00.',SCHEDULE)]})
            worker.complete=AsyncMock(side_effect=[broken,good])
            with self.assertLogs('app.worker',level='WARNING') as captured:await worker.execute(run)
            self.assertEqual(run['status'],'succeeded',run.get('error'))
            repair=worker.complete.await_args_list[1].args[1]
            self.assertIn('list_type',repair)
            self.assertIn('evidence',repair)
            self.assertNotIn('private-output-sentinel',repair)
            self.assertNotIn('private-output-sentinel',' '.join(captured.output))
            self.assertEqual(worker.complete.await_count,2)
            self.assertEqual(run['result']['claims'][0]['citations'],[SCHEDULE])

    async def test_request_citation_mode_controls_prompt_and_retrieval_opt_in(self):
        identifier = str(uuid4())
        parent = SCHEDULE | {"citation_segments_v1": [
            dict(id=identifier, ordinal=0, start=0, end=len(SCHEDULE["text"]),
                 page=1, precision="line", rects=[(.1, .1, .7, .2)]),
        ]}
        for mode in ("segment", "chunk", None):
            with self.subTest(mode=mode):
                run = self.new_run(Q1, new_thread=True)
                if mode is not None:
                    run["input"]["citation_mode"] = mode
                systems = []

                def handle(request):
                    if request.url.host == "workspace-service":
                        return httpx.Response(200)
                    payload = json.loads(request.content)
                    if request.url.host == "retrieval-service":
                        self.assertEqual(payload.get("include_segments"), True if mode == "segment" else None)
                        return httpx.Response(200, json={"evidence": [parent]})
                    system, user = payload["messages"]
                    systems.append(system["content"])
                    part = json.loads(user["content"])["evidence"][0]
                    if mode == "segment":
                        self.assertEqual(part["segments"][0]["id"], identifier)
                        evidence_id = identifier
                    else:
                        self.assertEqual(part, {"id": SCHEDULE["chunk_id"], "text": SCHEDULE["text"], "section": ""})
                        self.assertNotIn(identifier, user["content"])
                        evidence_id = SCHEDULE["chunk_id"]
                    return httpx.Response(200, json={"text": json.dumps({"claims": [
                        {"text": "Answer.", "source": "document", "evidence": [evidence_id]},
                    ]})})

                async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
                    worker = Worker(self.database, client)
                    # Explicit Chunk must suppress even a configured two-pass pipeline.
                    worker.citation_mode = "two" if mode == "chunk" else "legacy"
                    await worker.execute(run)
                self.assertEqual(run["status"], "succeeded", run.get("error"))
                self.assertEqual(systems, [PRIMARY_SEGMENT_SYSTEM if mode == "segment" else ANSWER_SYSTEM])
                citation = run["result"]["claims"][0]["citations"][0]
                self.assertEqual(citation["segment_ids"], [identifier] if mode == "segment" else None)

    async def test_adaptive_citations_and_per_target_fallback(self):
        from asyncio import get_running_loop

        parents = [SCHEDULE | {}, CHECKLIST | {}]
        for parent in parents:
            parent["citation_segments_v1"] = [
                dict(id=str(uuid4()), ordinal=0, start=0, end=len(parent["text"]),
                     page=1, precision="line", rects=[(.1, .1, .7, .2), (.1, .25, .4, .3)]),
            ]
        first_id, second_id = [p["citation_segments_v1"][0]["id"] for p in parents]
        for mode in ("single", "two", "auto"):
            with self.subTest(mode=mode):
                worker = Worker(self.database, None)
                worker.citation_mode = mode
                worker.current = AsyncMock()
                phase = []

                async def complete(_run, system, body, _tokens, **_kwargs):
                    payload = json.loads(body)
                    phase.append(system)
                    if system == ATTRIBUTION_SYSTEM:
                        self.assertEqual({t["claim"] for t in payload["targets"]}, {"Answer verbatim."})
                        self.assertEqual(set(payload["parents"]), {p["chunk_id"] for p in parents})
                        return json.dumps({"attributions": [
                            {"target": "c0:p0", "segment_ids": [first_id]},
                            {"target": "c0:p1", "segment_ids": [first_id]},
                        ]})
                    if system == PRIMARY_SEGMENT_SYSTEM:
                        self.assertEqual(payload["evidence"][0]["segments"][0]["id"], first_id)
                        ids = [first_id, second_id]
                    else:
                        ids = [p["chunk_id"] for p in parents]
                    return json.dumps({"claims": [
                        {"text": "Answer verbatim.", "source": "document", "evidence": ids},
                    ]})

                worker.complete = complete
                answer = await worker.compose(self.new_run(Q1), parents, [], 0,
                                              deadline=get_running_loop().time() + 100)
                decoded = Answer.model_validate(answer).model_dump(mode="json")
                claim = decoded["claims"][0]
                self.assertEqual(claim["text"], "Answer verbatim.")
                self.assertEqual(claim["citations"][0]["segment_ids"], [first_id])
                self.assertEqual(len(claim["citations"][0]["regions"]), 2)
                self.assertEqual(claim["citations"][1]["chunk_id"], parents[1]["chunk_id"])
                if mode == "two":
                    self.assertEqual(phase, [ANSWER_SYSTEM, ATTRIBUTION_SYSTEM])
                    self.assertIsNone(claim["citations"][1]["segment_ids"])
                else:
                    self.assertEqual(phase, [PRIMARY_SEGMENT_SYSTEM])
                    self.assertEqual(claim["citations"][1]["segment_ids"], [second_id])

    async def test_auto_chooses_legacy_answer_for_many_segments(self):
        from asyncio import get_running_loop

        parents = []
        for _ in range(2):
            parent = passage("Long source", "A." * 17)
            parent["citation_segments_v1"] = [
                dict(id=str(uuid4()), ordinal=n, start=n * 2, end=n * 2 + 2,
                     page=1, precision="page", rects=[])
                for n in range(17)
            ]
            parents.append(parent)
        worker = Worker(self.database, None)
        worker.citation_mode = "auto"
        worker.current = AsyncMock()
        worker.complete = AsyncMock(side_effect=[
            json.dumps({"claims": [claim("A.", parents[0])]}),
            "not JSON",
        ])
        result = await worker.compose(self.new_run(Q1), parents, [], 0,
                                      deadline=get_running_loop().time() + 100)
        self.assertEqual([call.args[1] for call in worker.complete.await_args_list],
                         [ANSWER_SYSTEM, ATTRIBUTION_SYSTEM])
        self.assertIsNone(result["claims"][0]["citations"][0]["segment_ids"])

    async def test_merge_preserves_uncited_gaps_and_precision(self):
        from app.citations import anchors

        text = "A. B. C. D. E."
        segments = [dict(id=str(uuid4()), ordinal=n, start=n * 3, end=n * 3 + 2,
                         page=1, precision="page" if n == 4 else "line",
                         rects=[] if n == 4 else [(n / 10, .1, n / 10 + .09, .15)])
                    for n in range(5)]
        parent = SCHEDULE | {"text": text, "citation_segments_v1": segments}
        result = anchors(parent, {segments[n]["id"] for n in (0, 1, 3, 4)})
        self.assertEqual([citation["text"] for citation in result], ["A. B.", "D.", "E."])
        self.assertEqual(len(result[0]["regions"]), 1)
        self.assertEqual(result[2]["regions"], [])
        self.assertEqual(result[2]["segment_ids"], [segments[4]["id"]])

    async def test_optional_attribution_respects_deadline_and_cancellation(self):
        from asyncio import get_running_loop

        parent = SCHEDULE | {"citation_segments_v1": [
            dict(id=str(uuid4()), ordinal=0, start=0, end=len(SCHEDULE["text"]),
                 page=1, precision="page", rects=[]),
        ]}
        baseline = [{"text": "Answer.", "citations": [SCHEDULE]}]
        worker = Worker(self.database, None)
        worker.current = AsyncMock()
        worker.complete = AsyncMock()
        run = self.new_run(Q1)
        parents = {parent["chunk_id"]: parent}
        actual = await worker.attribute(run, baseline, parents, 0, get_running_loop().time() + 1)
        self.assertEqual(actual, baseline)
        worker.complete.assert_not_awaited()

        worker.current.side_effect = StopRun("cancelled")
        with self.assertRaises(StopRun) as refusal:
            await worker.attribute(run, baseline, parents, 0, get_running_loop().time() + 40)
        self.assertEqual(refusal.exception.code, "cancelled")
        worker.complete.assert_not_awaited()

    async def test_repair_does_not_exceed_the_cost_budget(self):
        def upstream(request):
            if request.url.host == 'retrieval-service':
                return httpx.Response(200, json={'evidence': [SCHEDULE]})
            return httpx.Response(200)
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            run = self.new_run(Q1, new_thread=True)
            worker = Worker(self.database, client)
            worker.budget = 1
            worker.input_cost = worker.output_cost = 1
            worker.estimate_cost = lambda *_args: 1
            worker.complete = AsyncMock(return_value='invalid')
            await worker.execute(run)
            self.assertEqual(worker.complete.await_count, 1)
            self.assertEqual(run['error'], 'cost_limit')


if __name__ == "__main__":
    unittest.main()
