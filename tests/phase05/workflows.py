"""Approved workflow snapshots and crash recovery against isolated PostgreSQL."""
import asyncio
import json
import os
import unittest
from uuid import uuid4

import httpx
from sqlalchemy import text
from app.main import app, actor
from app.types import PlanDefinition
from app.worker import Worker
from rag_db import open_database


class WorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.previous_flag = os.environ.get('AGENTIC_WORKFLOW_ENABLED')
        os.environ['AGENTIC_WORKFLOW_ENABLED'] = 'true'
        self.database = open_database()
        app.state.database = self.database
        self.workspace, self.user, self.document, self.chunk = [uuid4() for _ in range(4)]
        app.dependency_overrides[actor] = lambda: self.user
        self.api = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://orchestrator')
        self.base = f'/v1/workspaces/{self.workspace}'
        self.objective = dict(query='Explain the attention mechanism', capability='LEARN',
                              task='explanation', document_ids=[str(self.document)])
        self.steps = [dict(step_id=str(uuid4()), tool=tool, action=f'{tool} activity {i}',
                           objective=self.objective, expected_output='Cited explanation')
                      for i, tool in enumerate(['retrieve', 'compose', 'retrieve', 'compose'])]

    async def asyncTearDown(self):
        if self.previous_flag is None:
            os.environ.pop('AGENTIC_WORKFLOW_ENABLED', None)
        else:
            os.environ['AGENTIC_WORKFLOW_ENABLED'] = self.previous_flag
        app.dependency_overrides.clear()
        await self.api.aclose()
        await self.database.dispose()

    async def post(self, path, body, key=None):
        return await self.api.post(self.base + path, json=body, headers={'Idempotency-Key': str(key or uuid4())})

    async def test_validation_requires_source_capability_and_order(self):
        valid = {**self.objective, 'steps': self.steps}
        PlanDefinition.model_validate(valid)
        for steps in ([self.steps[0]], self.steps * 2,
                      [{**self.steps[0], 'objective': {**self.objective, 'document_ids': [str(uuid4())]}}, self.steps[1]],
                      [{**self.steps[0], 'tool': 'shell'}, self.steps[1]]):
            with self.assertRaises(ValueError):
                PlanDefinition.model_validate({**self.objective, 'steps': steps})

    async def test_cancel_between_steps_prevents_model_calls(self):
        plan = (await self.post('/plans', {**self.objective, 'steps': self.steps[:2]})).json()
        await self.post('/plans/' + plan['plan_id'] + '/accept', {'plan_version': 1})
        started = (await self.post('/runs', dict(mode='PLAN', plan_id=plan['plan_id'], plan_version=1))).json()
        lease = uuid4()
        async with self.database.begin() as connection:
            row = await connection.execute(text("""
                UPDATE orchestration.runs SET status='running', lease_id=:lease, lease_until=now()+interval '1 hour'
                WHERE run_id=:run RETURNING *
            """), {'lease': lease, 'run': started['run_id']})
            run = dict(row.mappings().one())
        run['workflow'] = self.steps[:2]
        def upstream(request):
            if request.url.host == 'workspace-service':
                return httpx.Response(200)
            if request.url.path.endswith('/validate-sources'):
                return httpx.Response(204)
            if request.url.host == 'model-gateway':
                self.fail('A cancelled plan must not call the model')
            return httpx.Response(200, json={'evidence': []})
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            worker = Worker(self.database, client)
            save = worker.save_step
            async def save_and_cancel(*args, **kwargs):
                await save(*args, **kwargs)
                if args[3] == 'succeeded':
                    cancelled = await self.post('/runs/' + str(run['run_id']) + '/cancel', {})
                    self.assertEqual(cancelled.status_code, 200)
            worker.save_step = save_and_cancel
            await worker.execute(run)
        outcome = (await self.api.get(self.base + '/runs/' + str(run['run_id']))).json()
        self.assertEqual(outcome['status'], 'cancelled')

    async def test_restart_does_not_reset_the_workflow_deadline(self):
        plan = (await self.post('/plans', {**self.objective, 'steps': self.steps[:2]})).json()
        await self.post('/plans/' + plan['plan_id'] + '/accept', {'plan_version': 1})
        started = (await self.post('/runs', dict(mode='PLAN', plan_id=plan['plan_id'], plan_version=1))).json()
        async with self.database.begin() as connection:
            rows = await connection.execute(text("""
                UPDATE orchestration.runs SET status='running', lease_id=:lease,
                    execution_started_at=now()-interval '1 hour', lease_until=now()+interval '1 hour'
                WHERE run_id=:run RETURNING *
            """), {'lease': uuid4(), 'run': started['run_id']})
            run = dict(rows.mappings().one())
        run['workflow'] = self.steps[:2]
        def unexpected(request):
            self.fail('An expired workflow must not call providers or tools')
        async with httpx.AsyncClient(transport=httpx.MockTransport(unexpected)) as client:
            await Worker(self.database, client).execute(run)
        result = (await self.api.get(self.base + '/runs/' + str(run['run_id']))).json()
        self.assertEqual((result['status'], result['error_code']), ('failed', 'time_limit'))

    async def test_feature_flag_and_step_scope_are_rejected_at_api(self):
        os.environ['AGENTIC_WORKFLOW_ENABLED'] = 'false'
        response = await self.post('/plans', {**self.objective, 'steps': self.steps})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'feature_disabled')
        os.environ['AGENTIC_WORKFLOW_ENABLED'] = 'true'
        invalid = [{**self.steps[0], 'objective': {**self.objective, 'document_ids': [str(uuid4())]}}, self.steps[1]]
        self.assertEqual((await self.post('/plans', {**self.objective, 'steps': invalid})).status_code, 422)

    async def test_accepted_snapshot_recovers_without_repeating_completed_steps(self):
        created = await self.post('/plans', {**self.objective, 'steps': self.steps})
        self.assertEqual(created.status_code, 201, created.text)
        plan = created.json()
        self.assertEqual(plan['steps'], self.steps)
        plan_path = '/plans/' + plan['plan_id']
        start = dict(mode='PLAN', plan_id=plan['plan_id'], plan_version=1)
        self.assertEqual((await self.post('/runs', start)).status_code, 409)
        acceptance_key = uuid4()
        first_accept = await self.post(plan_path + '/accept', {'plan_version': 1}, acceptance_key)
        accepted = await self.post(plan_path + '/accept', {'plan_version': 1}, acceptance_key)
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(first_accept.json()['accepted_at'], accepted.json()['accepted_at'])
        started = await self.post('/runs', start)
        self.assertEqual(started.status_code, 202, started.text)
        run_id = started.json()['run_id']
        revised = await self.api.patch(self.base + plan_path, json={**self.objective, 'steps': self.steps[:2], 'expected_version': 1})
        self.assertEqual(revised.status_code, 200, revised.text)
        self.assertEqual((await self.post('/runs', start)).status_code, 409)
        self.assertEqual((await self.post('/runs', {**start, 'plan_version': 2})).status_code, 409)
        owner = self.user
        app.dependency_overrides[actor] = lambda: uuid4()
        self.assertEqual((await self.api.get(self.base + f'/runs/{run_id}/steps')).status_code, 404)
        self.assertEqual((await self.post(plan_path + '/accept', {'plan_version': 2})).status_code, 404)
        app.dependency_overrides[actor] = lambda: owner
        retrievals, completions = 0, 0
        crashed = False

        async def upstream(request):
            nonlocal retrievals, completions, crashed
            if request.url.host == 'workspace-service':
                return httpx.Response(200, json={'user_id': str(self.user), 'role': 'OWNER'})
            if request.url.path.endswith('/validate-sources'):
                return httpx.Response(204)
            if request.url.host == 'retrieval-service':
                retrievals += 1
                if retrievals == 2 and not crashed:
                    crashed = True
                    raise asyncio.CancelledError()
                return httpx.Response(200, json={'evidence': [dict(document_id=str(self.document), chunk_id=str(self.chunk),
                    page=2, name='Synthetic paper', section='Attention', text='Attention combines weighted values.', region=None)]})
            completions += 1
            return httpx.Response(200, json={'text': json.dumps({'claims': [dict(text='Weighted values.', evidence=[str(self.chunk)])]})})

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            worker = Worker(self.database, client)
            claimed = await worker.claim()
            self.assertEqual(str(claimed['run_id']), run_id)
            with self.assertRaises(asyncio.CancelledError):
                await worker.execute(claimed)
            progress = (await self.api.get(self.base + f'/runs/{run_id}/steps')).json()
            self.assertEqual([p['status'] for p in progress], ['succeeded', 'succeeded', 'running'])
            async with self.database.begin() as c:
                await c.execute(text("UPDATE orchestration.runs SET lease_until=now()-interval '1 second' WHERE run_id=:run"), {'run': run_id})
            resumed = await worker.claim()
            self.assertEqual(resumed['plan_version'], 1)
            self.assertEqual(len(resumed['workflow']), 4)
            await worker.execute(resumed)
        outcome = (await self.api.get(self.base + f'/runs/{run_id}')).json()
        self.assertEqual(outcome['status'], 'succeeded', outcome)
        self.assertEqual(completions, 2)
        progress = (await self.api.get(self.base + f'/runs/{run_id}/steps')).json()
        self.assertEqual([p['status'] for p in progress], ['succeeded'] * 4)


if __name__ == '__main__':
    unittest.main()
