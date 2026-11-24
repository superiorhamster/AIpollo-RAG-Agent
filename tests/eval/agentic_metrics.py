"""Count correlated gateway/retrieval calls without recording request content."""
import json
import sys
from pathlib import Path

data=json.loads(Path(sys.argv[1]).read_text())
requests={item['run']['request_id']:{'case':item['case'],'mode':item['mode'],'poll_retries':item.get('poll_retries',0),'completion_calls':0,'embedding_calls':0,'search_calls':0} for item in data['model_runs']}
for line in Path(sys.argv[2]).read_text(errors='replace').splitlines():
    start=line.find('{')
    if start<0:continue
    try:event=json.loads(line[start:])
    except ValueError:continue
    row=requests.get(event.get('request_id'))
    if row is None or event.get('event')!='http.request':continue
    route=event.get('route','')
    if route=='/internal/v1/completions':row['completion_calls']+=1
    elif route=='/internal/v1/embeddings':row['embedding_calls']+=1
    elif route.endswith('/search'):row['search_calls']+=1
print(json.dumps({'latency_p50_ms':data['latency_p50_ms'],'latency_p95_ms':data['latency_p95_ms'],
    'matrix_cells':data['matrix_cells'],'verified_matrix_cells':data['verified_matrix_cells'],
    'baseline_cited_papers':data['baseline_cited_papers'],'runs':list(requests.values())},indent=2))
