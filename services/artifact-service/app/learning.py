"""Stable study objects projected from immutable shared artifact content."""
import json
import unicodedata
from uuid import UUID, uuid5


def stable_id(artifact_id, value):
    return str(uuid5(UUID(str(artifact_id)), value))


def flashcards(item):
    cards = []
    for index, claim in enumerate(item['body']['claims']):
        fields = claim.get('fields', {})
        front, back = fields.get('front') or claim['text'], fields.get('back') or claim['text']
        fingerprint = json.dumps([index, front, back], ensure_ascii=False, separators=(',', ':'))
        cards.append({'card_id': stable_id(item['artifact_id'], 'flashcard:v1:' + fingerprint),
                      'front': front, 'back': back, 'citations': claim['citations']})
    return cards


def concept_map(item):
    nodes, edges = {}, {}
    normalize = lambda text: ' '.join(unicodedata.normalize('NFC', text).casefold().split())
    for claim in item['body']['claims'][:100]:
        fields = claim.get('fields', {})
        parent, child = fields.get('parent'), fields.get('child')
        if not parent or not child:
            continue
        context = normalize(fields.get('context', ''))
        ids = []
        for label in (parent, child):
            identifier = stable_id(item['artifact_id'], 'concept:v1:' + context + ':' + normalize(label))
            ids.append(identifier)
            node = nodes.setdefault(identifier, {'id': identifier, 'label': label, 'context': fields.get('context', ''), 'citations': []})
            seen = {(c.get('citation_id') or c['chunk_id'], c['page']) for c in node['citations']}
            for citation in claim['citations']:
                key = (citation.get('citation_id') or citation['chunk_id'], citation['page'])
                if key not in seen:
                    node['citations'].append(citation)
                    seen.add(key)
        relation = fields.get('relationship', '')
        edge = stable_id(item['artifact_id'], 'relation:v1:' + ':'.join(ids) + ':' + normalize(relation))
        edges[edge] = {'id': edge, 'source': ids[0], 'target': ids[1], 'label': relation}
    return {'nodes': list(nodes.values()), 'edges': list(edges.values())}
