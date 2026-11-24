"""Durable curriculum drafts, exact approval and bounded read-only planning."""
import asyncio
import json
import os
import unittest
from uuid import uuid4

import httpx
from sqlalchemy import text
from app.main import app, actor, digest
from app.curriculum import CurriculumWorker, validated_schedule
from app.types import Objective, PlanDefinition
from app.worker import StopRun
from rag_db import open_database


class CurriculumTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = {name: os.environ.get(name) for name in ['AGENTIC_CURRICULUM_ENABLED', 'AGENTIC_WORKFLOW_ENABLED']}
        os.environ.update(AGENTIC_CURRICULUM_ENABLED='true', AGENTIC_WORKFLOW_ENABLED='true')
        self.database = open_database()
        app.state.database = self.database
        self.workspace, self.user, self.document, self.chunk = [uuid4() for _ in range(4)]
        app.dependency_overrides[actor] = lambda: self.user
        self.api = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://orchestrator')
        self.base = f'/v1/workspaces/{self.workspace}'
        self.objective = dict(query='Ôn Attention chương 4 trong 3 ngày', capability='LEARN',
                              task='study_guide', document_ids=[str(self.document)])
        self.evidence = dict(document_id=str(self.document), chunk_id=str(self.chunk), name='Attention textbook',
                             page=24, text='Chapter 4: Attention uses Q, K, V and weighted values.', section='Chapter 4', region=None)
        self.output = dict(available=True, activities=[dict(day=i, action=f'Ngày {i}: Attention', query='Explain Q K V',
                            task='explanation' if i < 3 else 'quiz', expected_output='Giải thích và bài tập có nguồn',
                            evidence=[str(self.chunk)]) for i in range(1, 4)])
        self.calls = 0

    async def asyncTearDown(self):
        # Keep other tests' jobs untouched, but leave no pending jobs owned by this fixture.
        async with self.database.begin() as c:
            await c.execute(text("UPDATE orchestration.plans SET cancelled=true WHERE workspace_id=:w"), {'w': self.workspace})
            await c.execute(text("UPDATE orchestration.runs SET status='cancelled' WHERE workspace_id=:w AND status IN ('queued','running')"), {'w': self.workspace})
        for name, value in self.env.items():
            if value is None: os.environ.pop(name, None)
            else: os.environ[name] = value
        app.dependency_overrides.clear()
        await self.api.aclose()
        await self.database.dispose()

    async def post(self, path, data, key=None):
        return await self.api.post(self.base + path, json=data, headers={'Idempotency-Key': str(key or uuid4())})

    async def create(self):
        response = await self.post('/plans', {**self.objective, 'curriculum_days': 3})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def upstream(self, request):
        if request.url.host == 'workspace-service': return httpx.Response(200)
        if request.url.path.endswith('/validate-sources'): return httpx.Response(204)
        if request.url.path.endswith('/search'): return httpx.Response(200, json={'evidence': [self.evidence]})
        self.assertEqual(request.url.host, 'model-gateway')
        self.calls += 1
        self.assertIn('untrusted', json.loads(request.content)['messages'][0]['content'])
        return httpx.Response(200, json={'text': json.dumps(self.output)})

    async def test_legacy_hash_validation_and_flag(self):
        self.assertEqual(digest(Objective(**self.objective)), digest(PlanDefinition(**self.objective)))
        for invalid in [dict(curriculum_days=7), dict(curriculum_days=3, task='quiz'),
                        dict(curriculum_days=3, capability='WRITE', task='draft')]:
            self.assertEqual((await self.post('/plans', {**self.objective, **invalid})).status_code, 422)
        os.environ['AGENTIC_CURRICULUM_ENABLED'] = 'false'
        self.assertEqual((await self.post('/plans', {**self.objective, 'curriculum_days': 3})).status_code, 409)
        self.assertIsNone(await CurriculumWorker(self.database, None).claim())

    async def test_ready_exact_version_acceptance_and_scope(self):
        key = uuid4()
        first = await self.post('/plans', {**self.objective, 'curriculum_days': 3}, key)
        repeated = await self.post('/plans', {**self.objective, 'curriculum_days': 3}, key)
        plan = first.json()
        self.assertEqual(plan, repeated.json())
        path = '/plans/' + plan['plan_id']
        self.assertEqual((plan['state'], plan['steps']), ('GENERATING', []))
        self.assertEqual((await self.post(path + '/accept', {'plan_version': 1})).json()['code'], 'plan_not_ready')
        self.assertEqual((await self.post('/runs', dict(mode='PLAN', plan_id=plan['plan_id'], plan_version=1))).status_code, 409)
        async with httpx.AsyncClient(transport=httpx.MockTransport(self.upstream)) as client:
            worker = CurriculumWorker(self.database, client)
            job = await worker.claim()
            await worker.execute(job)
        fresh = (await self.api.get(self.base + path)).json()
        self.assertEqual(fresh['state'], 'REVIEW', fresh)
        self.assertEqual([step['day'] for step in fresh['steps']], [1, 2, 3])
        self.assertEqual(fresh['steps'][0]['citations'][0]['page'], 24)
        self.assertEqual(self.calls, 1)
        accept_key = uuid4()
        accepted = await self.post(path + '/accept', {'plan_version': 1}, accept_key)
        self.assertEqual(accepted.json(), (await self.post(path + '/accept', {'plan_version': 1}, accept_key)).json())
        self.assertEqual((await self.post('/runs', dict(mode='PLAN', plan_id=plan['plan_id'], plan_version=1))).status_code, 202)
        revised = await self.post(path + '/regenerate', {'plan_version': 1})
        self.assertEqual((revised.json()['plan_version'], revised.json()['generation_status']), (2, 'queued'))
        self.assertEqual((await self.post(path + '/accept', {'plan_version': 1})).status_code, 409)
        app.dependency_overrides[actor] = lambda: uuid4()
        self.assertEqual((await self.api.get(self.base + path)).status_code, 404)
        self.assertEqual((await self.post(path + '/accept', {'plan_version': 2})).status_code, 404)

    async def test_cancel_and_revision_fence_late_publication(self):
        for action in ['cancel', 'regenerate']:
            plan = await self.create()
            async with httpx.AsyncClient(transport=httpx.MockTransport(self.upstream)) as client:
                worker = CurriculumWorker(self.database, client)
                job = await worker.claim()
                workflow = validated_schedule(json.dumps(self.output), job, [self.evidence])
                self.assertEqual((await self.post('/plans/' + plan['plan_id'] + '/' + action, {'plan_version': 1})).status_code, 200)
                await worker.finish(job, workflow=workflow)
            async with self.database.connect() as c:
                self.assertIsNone(await c.scalar(text('SELECT workflow FROM orchestration.plan_versions WHERE plan_id=:id AND version=1'), {'id': plan['plan_id']}))
            # Cancel the new queued revision so the next case claims its own job.
            await self.post('/plans/' + plan['plan_id'] + '/cancel', {})

    async def test_interrupted_lease_resumes_and_old_worker_cannot_publish(self):
        plan = await self.create()
        async with httpx.AsyncClient(transport=httpx.MockTransport(self.upstream)) as client:
            worker = CurriculumWorker(self.database, client)
            first = await worker.claim()
            async with self.database.begin() as c:
                await c.execute(text("UPDATE orchestration.plan_drafts SET lease_until=now()-interval '1 second' WHERE plan_id=:id"), {'id': plan['plan_id']})
            second = await worker.claim()
            self.assertEqual(second['started_at'], first['started_at'])
            self.assertNotEqual(second['lease_id'], first['lease_id'])
            await worker.finish(first, workflow=validated_schedule(json.dumps(self.output), first, [self.evidence]))
            self.assertEqual((await self.api.get(self.base + '/plans/' + plan['plan_id'])).json()['state'], 'GENERATING')
            await worker.execute(second)
        self.assertEqual((await self.api.get(self.base + '/plans/' + plan['plan_id'])).json()['state'], 'REVIEW')

    async def test_missing_scope_invalid_ids_and_days_are_explicit(self):
        for change, expected in [({'available': False, 'activities': []}, 'curriculum_scope_not_found'),
                                 ({'activities': [{**self.output['activities'][0], 'evidence': [str(uuid4())]}]}, 'invalid_model_output'),
                                 ({'activities': self.output['activities'][:1]}, 'invalid_model_output')]:
            original = self.output
            self.output = {**original, **change}
            plan = await self.create()
            async with httpx.AsyncClient(transport=httpx.MockTransport(self.upstream)) as client:
                worker = CurriculumWorker(self.database, client)
                await worker.execute(await worker.claim())
            result = (await self.api.get(self.base + '/plans/' + plan['plan_id'])).json()
            self.assertEqual((result['state'], result['generation_error']), ('FAILED', expected), result)
            self.assertEqual((await self.post('/plans/' + plan['plan_id'] + '/accept', {'plan_version': 1})).status_code, 409)
            self.output = original

    async def test_transient_retry_and_fixed_deadline(self):
        plan = await self.create()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503))) as client:
            worker = CurriculumWorker(self.database, client)
            job = await worker.claim()
            await worker.execute(job)
        result = (await self.api.get(self.base + '/plans/' + plan['plan_id'])).json()
        self.assertEqual(result['generation_status'], 'queued')
        async with self.database.begin() as c:
            await c.execute(text("UPDATE orchestration.plan_drafts SET started_at=now()-interval '1 hour', next_attempt_at=now() WHERE plan_id=:id"), {'id': plan['plan_id']})
        self.assertIsNone(await worker.claim())
        result = (await self.api.get(self.base + '/plans/' + plan['plan_id'])).json()
        self.assertEqual(result['generation_error'], 'time_limit')

    async def test_revoked_access_and_cost_budget_stop_before_generation(self):
        for denied in ['workspace', 'sources', 'cost']:
            plan = await self.create()
            def provider(request):
                if request.url.host == 'workspace-service' and denied == 'workspace': return httpx.Response(404)
                if request.url.path.endswith('/validate-sources') and denied == 'sources': return httpx.Response(404)
                return self.upstream(request)
            async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
                worker = CurriculumWorker(self.database, client)
                if denied == 'cost': worker.limits.budget = 1
                await worker.execute(await worker.claim())
            result = (await self.api.get(self.base + '/plans/' + plan['plan_id'])).json()
            self.assertEqual(result['generation_error'], {'workspace':'workspace_access_revoked', 'sources':'source_unavailable', 'cost':'cost_limit'}[denied])
            self.assertEqual(self.calls, 0)


if __name__ == '__main__':
    unittest.main()
