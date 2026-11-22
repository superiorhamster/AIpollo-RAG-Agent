"""External metadata discovery stays read-only until an authorized explicit save."""
import unittest
from uuid import uuid4
import httpx
from sqlalchemy import text
from app.main import app, current_identity, Identity
from rag_db import open_database


class DiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.database=open_database();app.state.database=self.database
        self.workspace,self.owner,self.viewer=[uuid4() for _ in range(3)]
        self.actor=self.owner;self.calls=0;self.status=200
        app.dependency_overrides[current_identity]=lambda:Identity(user_id=self.actor,role='USER')
        async with self.database.begin() as c:
            await c.execute(text("INSERT INTO workspace.workspaces (workspace_id,owner_id,name) VALUES (:id,:owner,'Discovery fixture')"),{'id':self.workspace,'owner':self.owner})
            await c.execute(text("INSERT INTO workspace.memberships (workspace_id,user_id,role) VALUES (:id,:user,'VIEWER')"),{'id':self.workspace,'user':self.viewer})
        self.provider=httpx.AsyncClient(base_url='https://crossref.test',transport=httpx.MockTransport(self.upstream))
        app.state.crossref=self.provider
        self.api=httpx.AsyncClient(base_url='http://workspace',transport=httpx.ASGITransport(app=app))
        self.path=f'/v1/workspaces/{self.workspace}/references'

    def upstream(self,request):
        self.calls+=1
        if self.status is None:raise httpx.ReadTimeout('fixture timeout',request=request)
        return httpx.Response(self.status,json={'message':{'items':[{'DOI':'10.1234/DEMO','title':['Synthetic paper'],'author':[{'family':'Test'}],'issued':{'date-parts':[[2026]]}}]}})

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        async with self.database.begin() as c:await c.execute(text('DELETE FROM workspace.workspaces WHERE workspace_id=:id'),{'id':self.workspace})
        await self.api.aclose();await self.provider.aclose();await self.database.dispose()

    async def test_429_timeout_and_unknown_workspace_are_bounded(self):
        for status in [429,None]:
            self.status=status
            response=await self.api.post(self.path+'/discover',json={'query':'Attention evidence'})
            self.assertEqual((response.status_code,response.json()['code']),(503,'discovery_unavailable'))
        self.assertEqual(self.calls,2)
        self.actor=uuid4()
        self.assertEqual((await self.api.post(self.path+'/discover',json={'query':'Attention evidence'})).status_code,404)
        self.assertEqual(self.calls,2)

    async def test_discover_does_not_save_duplicate_doi_upserts_and_viewer_cannot_save(self):
        result=await self.api.post(self.path+'/discover',json={'query':'Attention evidence'})
        self.assertEqual(result.status_code,200,result.text)
        ref=result.json()[0]
        self.assertEqual(ref['doi'],'10.1234/demo')
        self.assertEqual((await self.api.get(self.path)).json(),[])
        for _ in range(2):self.assertEqual((await self.api.post(self.path,json=ref)).status_code,201)
        self.assertEqual(len((await self.api.get(self.path)).json()),1)
        self.actor=self.viewer
        self.assertEqual((await self.api.post(self.path,json=ref)).status_code,403)
        self.assertEqual((await self.api.post(self.path+'/discover',json={'query':'Attention evidence'})).status_code,200)


if __name__=='__main__':unittest.main()
