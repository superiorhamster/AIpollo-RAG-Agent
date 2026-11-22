"""Paired-source coverage, semantic verification and durable bounded research."""
import asyncio
import json
import os
import unittest
import time
import statistics
from uuid import uuid4

import httpx
from langgraph.errors import NodeCancelledError
from sqlalchemy import text
from app.main import app, actor
from app.worker import Worker
from app.research import balanced_context
from rag_db import open_database


class ResearchTests(unittest.IsolatedAsyncioTestCase):
    measurements = []

    @classmethod
    def tearDownClass(cls):
        if cls.measurements:
            latencies = sorted(row['seconds'] for row in cls.measurements)
            print('RESEARCH_FIXTURE_METRICS ' + json.dumps({
                'runs': len(latencies), 'latency_p50_seconds': statistics.median(latencies),
                'latency_p95_seconds': latencies[min(len(latencies)-1, int(.95*len(latencies)))],
                'max_model_calls': max(row['calls'] for row in cls.measurements),
                'max_searches': max(row['searches'] for row in cls.measurements),
            }))
    async def asyncSetUp(self):
        self.env = {name: os.environ.get(name) for name in ['AGENTIC_RESEARCH_ENABLED', 'AGENTIC_WORKFLOW_ENABLED', 'RESEARCH_MAX_MODEL_CALLS']}
        os.environ.update(AGENTIC_RESEARCH_ENABLED='true', AGENTIC_WORKFLOW_ENABLED='true', RESEARCH_MAX_MODEL_CALLS='12')
        self.database = open_database()
        app.state.database = self.database
        self.workspace, self.user, self.a, self.b, self.ca, self.cb, self.cd = [uuid4() for _ in range(7)]
        app.dependency_overrides[actor] = lambda: self.user
        self.api = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://orchestrator')
        self.base = f'/v1/workspaces/{self.workspace}'
        self.objective = dict(query='Compare methods and dataset of papers A and B', capability='RESEARCH',
                              task='comparison', document_ids=[str(self.a), str(self.b)])
        self.searches = []
        self.models = []
        self.verifications = 0
        self.inject_unsupported = False
        self.crash = False
        self.no_evidence = False
        self.cross_scope = False
        self.conflicting = False

    async def asyncTearDown(self):
        async with self.database.begin() as c:
            await c.execute(text("UPDATE orchestration.runs SET status='cancelled' WHERE workspace_id=:w AND status IN ('queued','running')"), {'w': self.workspace})
        for name, value in self.env.items():
            if value is None: os.environ.pop(name, None)
            else: os.environ[name] = value
        app.dependency_overrides.clear()
        await self.api.aclose()
        await self.database.dispose()

    async def post(self, path, data):
        return await self.api.post(self.base + path, json=data, headers={'Idempotency-Key': str(uuid4())})

    def evidence(self, document, chunk, text):
        return dict(document_id=str(document), chunk_id=str(chunk), name='Paper A' if document == self.a else 'Paper B',
                    page=2 if document == self.a else 7, text=text, section='Results', region=[.1,.1,.8,.2])

    def upstream(self, request):
        if request.url.host == 'workspace-service': return httpx.Response(200)
        if request.url.path.endswith('/validate-sources'): return httpx.Response(204)
        body = json.loads(request.content)
        if request.url.path.endswith('/search'):
            if len(body['document_ids']) > 1:
                return httpx.Response(200, json={'evidence': [self.evidence(self.a,self.ca,'Method A uses a transformer.')] +
                    [self.evidence(self.a,uuid4(),'Method A uses a transformer.') for _ in range(5)]})
            self.assertEqual(len(body['document_ids']), 1)
            doc = body['document_ids'][0]
            self.searches.append(doc)
            if self.no_evidence: items = []
            elif doc == str(self.a): items = [self.evidence(self.a, self.ca, 'Method A uses a transformer. Time is 3 seconds.')]
            else:
                items = [self.evidence(self.b, self.cb, 'Method B uses recurrence. Time is 9 seconds.' if self.conflicting else 'Method B uses recurrence. Time is 2000 milliseconds.')]
                if self.searches.count(doc) > 1: items.append(self.evidence(self.b, self.cd, 'Dataset B uses Vietnamese benchmark V2.'))
            if self.cross_scope: items = [self.evidence(uuid4(), uuid4(), 'Forbidden')]
            return httpx.Response(200, json={'evidence': items})
        system = body['messages'][0]['content']
        payload = json.loads(body['messages'][1]['content'])
        self.models.append(system.split('Schema:')[0][-100:])
        if 'Compare one dimension per entry' in system:
            output = dict(claims=[dict(text='Paper A uses a transformer.', evidence=[str(self.ca)])])
        elif 'Decompose' in system:
            output = dict(criteria=[dict(name='Method',query='What method is used?'),dict(name='Dataset',query='Which dataset is used?')])
        elif 'Evaluate each paper' in system:
            if self.crash:
                self.crash = False
                raise asyncio.CancelledError()
            cells = []
            for doc in [self.a, self.b]:
                parts = [p for p in payload['passages'] if p['document_id'] == str(doc)]
                for criterion in ['Method', 'Dataset']:
                    found = next((p for p in parts if criterion in p['text']), None)
                    cells.append(dict(document_id=str(doc), criterion=criterion, status='supported' if found else 'insufficient',
                                      finding=found['text'] if found else '', evidence=[found['id']] if found else []))
            output = dict(cells=cells)
        elif 'Synthesize only' in system:
            text = 'Paper A reports 99 seconds.' if self.inject_unsupported and 'Rewrite or remove' not in system else 'Paper A uses a transformer; Paper B uses recurrence.'
            output = dict(claims=[dict(text=text, evidence=[str(self.ca),str(self.cb)])])
        else:
            self.assertIn('Verify each claim semantically', system)
            self.verifications += 1
            output = dict(claims=[dict(index=i,status='contradicted' if '99' in item['text'] else 'supported') for i,item in enumerate(payload['claims'])])
        return httpx.Response(200, json={'text': json.dumps(output)})

    async def run_research(self, mode='AGENT'):
        started_at, calls_before, searches_before = time.monotonic(), len(self.models), len(self.searches)
        body = dict(mode=mode, objective=self.objective)
        if mode == 'PLAN':
            created = (await self.post('/plans', self.objective)).json()
            self.assertEqual((await self.post('/plans/' + created['plan_id'] + '/accept', {'plan_version':1})).status_code, 200)
            body = dict(mode='PLAN',plan_id=created['plan_id'],plan_version=1)
        started = await self.post('/runs', body)
        self.assertEqual(started.status_code,202,started.text)
        run = started.json()
        async with httpx.AsyncClient(transport=httpx.MockTransport(self.upstream)) as client:
            worker = Worker(self.database, client)
            claimed = await worker.claim()
            self.assertEqual(str(claimed['run_id']),run['run_id'])
            await worker.execute(claimed)
        result = (await self.api.get(self.base + '/runs/' + run['run_id'])).json()
        self.measurements.append(dict(seconds=time.monotonic()-started_at, calls=len(self.models)-calls_before,
                                      searches=len(self.searches)-searches_before))
        return result

    async def test_per_paper_coverage_gap_budget_and_acceptance(self):
        result = await self.run_research('PLAN')
        self.assertEqual(result['status'],'succeeded',result)
        matrix = {(cell['document_id'],cell['criterion']):cell for cell in result['result']['evidence_matrix']}
        self.assertEqual(matrix[(str(self.b),'Dataset')]['status'],'supported')
        self.assertEqual(matrix[(str(self.b),'Dataset')]['citations'][0]['page'],7)
        self.assertEqual(matrix[(str(self.a),'Dataset')]['status'],'insufficient')
        self.assertEqual(self.searches[:2],[str(self.a),str(self.b)])
        self.assertLessEqual(len(self.searches),4)
        self.assertTrue(result['result']['claims'])
        self.assertGreaterEqual(self.verifications,1)
        # Run the preserved single-query/six-chunk Ask path on the same scoped synthetic corpus.
        baseline = (await self.post('/runs', dict(mode='ASK', objective=self.objective))).json()
        async with httpx.AsyncClient(transport=httpx.MockTransport(self.upstream)) as client:
            worker = Worker(self.database, client)
            await worker.execute(await worker.claim())
        baseline = (await self.api.get(self.base + '/runs/' + baseline['run_id'])).json()
        self.assertEqual(baseline['status'], 'succeeded', baseline)
        self.assertEqual({c['document_id'] for claim in baseline['result']['claims'] for c in claim['citations']}, {str(self.a)})
        self.assertEqual(sum(cell['status'] == 'supported' for cell in matrix.values()), 3)
        baseline_coverage = sum('transformer' in claim['text'] for claim in baseline['result']['claims']) / len(matrix)
        print('RESEARCH_FIXTURE_COVERAGE ' + json.dumps({'baseline_top6': baseline_coverage,
              'per_paper_with_gaps': sum(cell['status'] == 'supported' for cell in matrix.values()) / len(matrix),
              'citation_scope_valid': True, 'supported_claims_after_verification': 1}))
        self.assertTrue(all(c['document_id']==cell['document_id'] for cell in matrix.values() for c in cell['citations']))

    async def test_semantic_verifier_repairs_valid_uuid_with_false_number(self):
        self.inject_unsupported = True
        result = await self.run_research()
        self.assertEqual(result['status'],'succeeded',result)
        self.assertNotIn('99',' '.join(claim['text'] for claim in result['result']['claims']))
        self.assertEqual(self.verifications,2)

    async def test_reported_units_and_conflicting_results_are_preserved(self):
        for conflicting in [False, True]:
            self.conflicting = conflicting
            self.searches = []
            result = await self.run_research()
            self.assertEqual(result['status'], 'succeeded', result)
            matrix = result['result']['evidence_matrix']
            a = next(cell for cell in matrix if cell['document_id'] == str(self.a) and cell['criterion'] == 'Method')
            b = next(cell for cell in matrix if cell['document_id'] == str(self.b) and cell['criterion'] == 'Method')
            self.assertIn('3 seconds', a['finding'])
            self.assertIn('9 seconds' if conflicting else '2000 milliseconds', b['finding'])
            self.assertNotEqual(a['citations'][0]['document_id'], b['citations'][0]['document_id'])

    async def test_context_reserves_each_paper_under_competition(self):
        dense = [self.evidence(self.a,uuid4(),'A'*6000) for _ in range(6)]
        sparse = [self.evidence(self.b,self.cb,'Only B reports Vietnamese dataset V2.')]
        packed, ids = balanced_context({str(self.a):dense,str(self.b):sparse},8000)
        self.assertEqual({part['document_id'] for part in packed},{str(self.a),str(self.b)})
        self.assertIn(str(self.cb),ids)
        self.assertLessEqual(len(json.dumps(packed).encode()),8000)
        self.assertEqual(len(dense[0]['text']),6000)

    async def test_missing_answers_and_scope_failure(self):
        self.no_evidence = True
        result = await self.run_research()
        self.assertEqual(result['status'],'succeeded',result)
        self.assertTrue(result['result']['insufficient_evidence'])
        self.assertTrue(all(cell['status']=='insufficient' for cell in result['result']['evidence_matrix']))
        self.assertLessEqual(len(self.searches),4)
        self.cross_scope,self.no_evidence = True,False
        result = await self.run_research()
        self.assertEqual((result['status'],result['error_code']),('failed','invalid_evidence_scope'))

    async def test_budget_retains_matrix_and_ask_path_is_not_pinned(self):
        os.environ['RESEARCH_MAX_MODEL_CALLS']='1'
        result = await self.run_research()
        self.assertEqual(result['status'],'succeeded',result)
        self.assertEqual(result['result']['budget_exhausted'],'generation_budget')
        self.assertTrue(result['result']['insufficient_evidence'])
        self.assertTrue(all(cell['status']=='insufficient' for cell in result['result']['evidence_matrix']))
        ask = (await self.post('/runs',dict(mode='ASK',objective=self.objective))).json()
        async with self.database.connect() as c:
            data = await c.scalar(text('SELECT input FROM orchestration.runs WHERE run_id=:id'),{'id':ask['run_id']})
        self.assertNotIn('research_workflow',data)
        many = {**self.objective,'document_ids':[str(uuid4()) for _ in range(6)]}
        self.assertEqual((await self.post('/runs',dict(mode='AGENT',objective=many))).status_code,422)

    async def test_restart_keeps_completed_searches_and_owner_scope(self):
        run = (await self.post('/runs',dict(mode='AGENT',objective=self.objective))).json()
        self.crash = True
        async with httpx.AsyncClient(transport=httpx.MockTransport(self.upstream)) as client:
            worker = Worker(self.database,client)
            claimed = await worker.claim()
            with self.assertRaises((asyncio.CancelledError, NodeCancelledError)): await worker.execute(claimed)
            initial_searches = list(self.searches)
            self.assertEqual(initial_searches,[str(self.a),str(self.b)])
            async with self.database.begin() as c:
                await c.execute(text("UPDATE orchestration.runs SET lease_until=now()-interval '1 second' WHERE run_id=:id"),{'id':run['run_id']})
            recovered = await worker.claim()
            self.assertEqual(claimed['execution_started_at'],recovered['execution_started_at'])
            await worker.execute(recovered)
        final = (await self.api.get(self.base + '/runs/' + run['run_id'])).json()
        self.assertEqual(final['status'],'succeeded',final)
        self.assertLessEqual(len(self.searches),4)
        app.dependency_overrides[actor] = lambda:uuid4()
        self.assertEqual((await self.api.get(self.base + '/runs/' + run['run_id'])).status_code,404)


if __name__=='__main__':unittest.main()
