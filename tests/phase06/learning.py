"""Stable legacy study objects and private UTC review scheduling with fake clocks."""
import asyncio
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import UUID, uuid4

import httpx
from sqlalchemy import text
from app.main import app, access, ActorInfo
from app.learning import concept_map, flashcards
from rag_db import open_database


class LearningTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.flag = os.environ.get('ADAPTIVE_FLASHCARDS_ENABLED')
        os.environ['ADAPTIVE_FLASHCARDS_ENABLED']='true'
        self.database = open_database()
        app.state.database = self.database
        self.workspace,self.user,self.other,self.artifact,self.document,self.chunk = [uuid4() for _ in range(6)]
        self.actor = self.user
        app.dependency_overrides[access] = lambda: ActorInfo(user_id=self.actor,role='VIEWER')
        self.api = httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://artifact',cookies={'rag_access':'fixture'})
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json=[{'document_id':str(self.document)}])))
        app.state.client = self.client
        self.citation = dict(document_id=str(self.document),chunk_id=str(self.chunk),name='Synthetic textbook',page=24,text='Definition',region=None)
        self.body = {'claims':[dict(text='Attention definition',fields={'front':'Attention là gì?','back':'Tổng có trọng số.'},citations=[self.citation])]}
        async with self.database.begin() as c:
            await c.execute(text('''INSERT INTO artifacts.items (artifact_id,workspace_id,user_id,run_id,name,kind,body,source_ids)
                VALUES (:id,:workspace,:user,:run,'Legacy deck','flashcards',CAST(:body AS jsonb),CAST(:sources AS uuid[]))'''),
                {'id':self.artifact,'workspace':self.workspace,'user':self.user,'run':uuid4(),'body':json.dumps(self.body),'sources':[self.document]})
        self.path=f'/v1/workspaces/{self.workspace}/artifacts/{self.artifact}'
        self.now=datetime(2026,11,22,23,59,tzinfo=timezone.utc)
        self.clock=patch('app.reviews.now_utc',lambda:self.now)
        self.clock.start()

    async def asyncTearDown(self):
        self.clock.stop()
        app.dependency_overrides.clear()
        if self.flag is None:os.environ.pop('ADAPTIVE_FLASHCARDS_ENABLED',None)
        else:os.environ['ADAPTIVE_FLASHCARDS_ENABLED']=self.flag
        await self.api.aclose();await self.client.aclose();await self.database.dispose()

    async def cards(self):
        result=await self.api.get(self.path+'/cards?due_only=true')
        self.assertEqual(result.status_code,200,result.text)
        return result.json()['cards']

    async def rate(self,card,rating=3,key=None):
        return await self.api.post(self.path+'/cards/'+card['card_id']+'/reviews',
            json={'rating':rating,'expected_version':card['version']},headers={'Idempotency-Key':str(key or uuid4())})

    async def test_private_progress_and_stable_legacy_ids(self):
        first=(await self.cards())[0]
        self.assertEqual(first,(await self.cards())[0])
        self.assertEqual(first['version'],0)
        response=await self.rate(first,4)
        self.assertEqual(response.status_code,200,response.text)
        due=datetime.fromisoformat(response.json()['due_at'])
        self.assertEqual(due.tzinfo,timezone.utc)
        self.assertGreater(due,self.now)
        self.assertEqual(await self.cards(),[])
        self.actor=self.other
        other=(await self.cards())[0]
        self.assertEqual(other['card_id'],first['card_id'])
        self.assertEqual(other['version'],0)
        self.assertEqual((await self.rate(other,1)).status_code,200)
        async with self.database.connect() as c:
            stored=await c.scalar(text('SELECT body FROM artifacts.items WHERE artifact_id=:id'),{'id':self.artifact})
        self.assertEqual(stored,self.body)

    async def test_replay_and_double_click_only_record_once(self):
        card=(await self.cards())[0]
        key=uuid4()
        first,second=await asyncio.gather(self.rate(card,key=key),self.rate(card,key=key))
        self.assertEqual((first.status_code,second.status_code),(200,200))
        self.assertEqual(first.json(),second.json())
        self.assertEqual((await self.rate(card,key=uuid4())).status_code,409)
        self.assertEqual((await self.rate(card,4,key)).json()['code'],'idempotency_conflict')
        async with self.database.connect() as c:
            count=await c.scalar(text('SELECT count(*) FROM artifacts.card_reviews WHERE artifact_id=:id'),{'id':self.artifact})
        self.assertEqual(count,1)

    async def test_again_crosses_day_and_becomes_due_with_fake_clock(self):
        card=(await self.cards())[0]
        reviewed=await self.rate(card,1)
        self.assertEqual(reviewed.status_code,200,reviewed.text)
        self.assertEqual(await self.cards(),[])
        self.now=datetime.fromisoformat(reviewed.json()['due_at'])+timedelta(seconds=1)
        self.assertEqual(self.now.day,23)
        due=(await self.cards())[0]
        self.assertEqual(due['version'],1)
        next_review=await self.rate(due,3)
        self.assertEqual(next_review.status_code,200,next_review.text)
        self.assertGreater(datetime.fromisoformat(next_review.json()['due_at']),self.now)

    async def test_flags_scope_removed_sources_and_validation(self):
        card=(await self.cards())[0]
        os.environ['ADAPTIVE_FLASHCARDS_ENABLED']='false'
        self.assertEqual((await self.api.get(self.path+'/cards')).status_code,409)
        self.assertEqual((await self.rate(card)).status_code,409)
        os.environ['ADAPTIVE_FLASHCARDS_ENABLED']='true'
        self.assertEqual((await self.api.get(self.path.replace(str(self.workspace),str(uuid4()))+'/cards')).status_code,404)
        self.assertEqual((await self.rate({**card,'card_id':str(uuid4())})).status_code,404)
        self.assertEqual((await self.rate(card,5)).status_code,422)
        await self.client.aclose()
        self.client=httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json=[])))
        app.state.client=self.client
        self.assertEqual((await self.api.get(self.path+'/cards')).json()['code'],'source_unavailable')
        self.assertEqual((await self.rate(card)).status_code,409)

    async def test_concept_nodes_merge_cycles_and_citations_stay_stable(self):
        item={'artifact_id':self.artifact,'body':{'claims':[
            {'fields':{'parent':' Cơ chế Attention ','child':'Q / K / V','relationship':'requires'},'citations':[self.citation]},
            {'fields':{'parent':'cơ chế attention','child':'Q / K / V','relationship':'requires'},'citations':[self.citation]},
            {'fields':{'parent':'Q / K / V','child':'Cơ chế Attention','relationship':'contributes'},'citations':[self.citation]},
            {'fields':{'parent':'Cơ chế Attention','child':'Cơ chế Attention','relationship':'self'},'citations':[self.citation]},
        ]}}
        graph=concept_map(item)
        self.assertEqual(len(graph['nodes']),2)
        self.assertEqual(len(graph['edges']),3)
        self.assertEqual(graph,concept_map(item))
        self.assertTrue(all(len(node['citations'])==1 for node in graph['nodes']))
        item['body']['claims'].append({'fields':{'parent':'Q / K / V','child':'Cơ chế Attention','relationship':'other','context':'chapter 9'},'citations':[]})
        self.assertEqual(len(concept_map(item)['nodes']),4)


if __name__=='__main__':unittest.main()
