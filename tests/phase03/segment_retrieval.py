"""Verify stored citation maps cannot escape the active retrieval scope."""

import json
import unittest
from uuid import uuid4

import httpx

from app.search import DelegatedSearchRequest, SearchRequest, candidates
from rag_index import point_id, segment_id


class SegmentRetrieval(unittest.IsolatedAsyncioTestCase):
    async def test_scope_and_malformed_payload_preserve_legacy_rank(self):
        workspace, source, generation, foreign = (uuid4() for _ in range(4))
        parent = point_id(generation, 0)
        stored = str(segment_id(parent, 0))

        def service(request):
            if request.url.path.endswith("/embedding-config"):
                return httpx.Response(200, json={"fingerprint": "a" * 64, "dimensions": 1})
            if request.url.path.endswith("/active-indexes"):
                return httpx.Response(200, json=[{
                    "document_id": str(source), "index_generation": str(generation),
                }])
            assert request.url.path.endswith("/embeddings")
            self.assertEqual(json.loads(request.content)["input_type"], "query")
            self.assertEqual(json.loads(request.content)["texts"], ["Evidence"])
            return httpx.Response(200, json={"vectors": [[1.0]]})

        payload = {"workspace_id": str(workspace), "document_id": str(source),
                   "generation": str(generation), "page": 1, "text": "Evidence.",
                   "citation_segments_v1": [
                       {"id": stored, "ordinal": 0, "start": 0, "end": 9, "page": 1},
                   ]}
        active = {"id": str(parent), "payload": payload, "score": 1}
        outdated = {"id": str(uuid4()), "payload": payload | {"generation": str(foreign)}, "score": 2}
        outsider = {"id": str(uuid4()), "payload": payload | {"workspace_id": str(foreign)}, "score": 3}

        def qdrant(_request):
            return httpx.Response(200, json={"result": {"points": [outdated, outsider, active]}})

        async with httpx.AsyncClient(transport=httpx.MockTransport(service)) as client, \
                httpx.AsyncClient(base_url="http://qdrant", transport=httpx.MockTransport(qdrant)) as vectors:
            base = dict(query="Evidence", document_ids=[source])
            public = await candidates(client, vectors, workspace, SearchRequest(**base), {source: "PDF"}, {})
            opt_in = DelegatedSearchRequest(**base, include_segments=True)
            result = await candidates(client, vectors, workspace, opt_in, {source: "PDF"}, {})
            self.assertEqual([item.chunk_id for item in public.evidence], [parent])
            self.assertEqual([item.chunk_id for item in result.evidence], [parent])
            self.assertIsNone(public.evidence[0].citation_segments_v1)
            self.assertEqual(str(result.evidence[0].citation_segments_v1[0].id), stored)
            payload["citation_segments_v1"][0]["id"] = str(foreign)
            bad = await candidates(client, vectors, workspace, opt_in, {source: "PDF"}, {})
            self.assertEqual([item.chunk_id for item in bad.evidence], [parent])
            self.assertIsNone(bad.evidence[0].citation_segments_v1)


if __name__ == "__main__":
    unittest.main()
