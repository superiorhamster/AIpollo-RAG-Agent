"""Preview-only academic paragraphs verified before the explicit artifact save."""
from langgraph.graph import END, START, StateGraph
from .research import ResearchGraph, State, balanced_context
from .types import GeneratedAnswer


class CitedDraft(ResearchGraph):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        graph = StateGraph(State)
        for name in ('retrieve', 'draft', 'verify'):
            graph.add_node(name, self.record(getattr(self, name)))
        graph.add_edge(START, 'retrieve')
        graph.add_edge('retrieve', 'draft')
        graph.add_edge('draft', 'verify')
        graph.add_edge('verify', END)
        self.graph = graph.compile(name='verified-academic-draft-v1')

    async def retrieve(self, state):
        if state.get('initial_calls'):
            return {}
        evidence = await self.worker.retrieve(self.run, self.objective)
        return {'initial_calls': ['selected-sources'], 'evidence': {
            document: [item for item in evidence if item['document_id']==document] for document in self.documents}}

    async def draft(self, state, repair=False):
        if state.get('verified') or (state.get('answer') and not repair):
            return {}
        context, supplied = balanced_context({document:parts for document,parts in state.get('evidence',{}).items() if parts},
                                             self.worker.max_input_bytes-3000)
        if not context:
            return {'answer': {'kind':'draft','claims':[],'insufficient_evidence':True}}
        def validate(parsed):
            claims=[]
            for claim in parsed.claims:
                ids=list(dict.fromkeys(str(identifier) for identifier in claim.evidence))
                if any(identifier not in supplied for identifier in ids):
                    raise ValueError('Citation outside supplied evidence')
                claims.append({'text':claim.text,'fields':{},'citations':[supplied[identifier] for identifier in ids]})
            return {'kind':'draft','claims':claims,'insufficient_evidence':not claims}
        answer=await self.model('Draft a cited paragraph for each academic claim, using only the supplied passages. '
            'Keep one verifiable factual claim per entry. Preserve exact numbers and units; omit claims without evidence. '
            'Schema: {"claims":[{"text":string,"evidence":[passage UUID]}]}. ' +
            ('Rewrite or remove unsupported claims from the prior attempt.' if repair else ''),
            {'objective':self.objective.query,'passages':context},GeneratedAnswer,validate)
        return {'answer':answer}

    async def synthesize(self, state, repair=False):
        return await self.draft(state,repair)

    def result(self, exhausted=None):
        answer=self.state.get('answer') if self.state.get('verified') else None
        return {**(answer or {'kind':'draft','claims':[],'insufficient_evidence':True}),
                'verified_draft':True,'budget_exhausted':exhausted}
