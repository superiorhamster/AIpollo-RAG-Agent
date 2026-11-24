"""Conservative extraction gate: never flatten indices, drop units or invent coordinates."""
import unicodedata


def compact(value):
    return ''.join(unicodedata.normalize('NFC',value).split())


def evaluate(manifest,chunks):
    cases=[]
    for case in manifest['cases']:
        page=[chunk for chunk in chunks if chunk['page']==case['page']]
        text=compact(' '.join(chunk['text'] for chunk in page))
        symbols=compact(case['formula']) in text
        units=all(compact(unit) in text for unit in case['units'])
        anchors=[]
        for chunk in page:
            region=chunk.get('region')
            if compact(case['formula']) in compact(chunk['text']) and isinstance(region,(list,tuple)) and len(region)==4:
                l,t,r,b=region
                if 0<=l<r<=1 and 0<=t<b<=1:anchors.append(list(region))
        cases.append({'id':case['id'],'family':case['family'],'page':case['page'],
                      'symbols_preserved':symbols,'units_preserved':units,'coordinates_valid':bool(anchors),
                      'regions':anchors,'extraction_pass':symbols and units and bool(anchors)})
    reviewed=isinstance(manifest.get('reviewed_by'),str) and bool(manifest['reviewed_by'].strip()) and manifest['reviewed_by'].strip().lower()!='pending'
    families={family:reviewed and all(case['extraction_pass'] for case in cases if case['family']==family)
              for family in dict.fromkeys(case['family'] for case in cases)}
    return {'version':manifest['version'],'human_review_confirmed':reviewed,'cases':cases,
            'eligible_families':families,'extraction_accuracy':sum(case['extraction_pass'] for case in cases)/max(1,len(cases)),
            'inspector_enabled':reviewed and bool(cases) and all(case['extraction_pass'] for case in cases)}
