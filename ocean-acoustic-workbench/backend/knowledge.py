import json,re,collections
from pathlib import Path
DATA=Path(__file__).resolve().parent/'data/course_graph.json'
def graph_data():
    g=json.loads(DATA.read_text(encoding='utf-8'))
    for n in g['nodes']:
        n['images']=[]
        if n.get('diagram'):n['images'].append({'url':'/assets/knowledge/'+n['diagram']+'.svg','caption':'课程原理示意 · 非求解器声场结果'})
        for i,r in enumerate(n.get('references',[])):
            if r.get('pdf_page'):n['images'].append({'url':f"/api/source/{r['source_id']}/page/{r['pdf_page']}",'caption':f"{r['source_id']} · 教材原页 {r['pdf_page']}",'source_url':f"/api/source/{r['source_id']}#page={r['pdf_page']}"})
            else:r['code_url']=f"/api/knowledge/code?node={n['id']}&reference={i}"
    return g
def knowledge_cards():
    cards=[]
    for n in graph_data()['nodes']:
        if n['kind']!='knowledge':continue
        r=n['references'][0]
        cards.append({'id':n['source_claim_ids'][0],'node_id':n['id'],'label':n['label'],'text':n['overview']+' '+ ' '.join(n['key_points']),'formula':n.get('formula',''),'conditions':n.get('conditions') or '适用条件请参见所列教材或代码；关联与学习顺序为人工课程整理。','source_id':r['source_id'],'pdf_page':r.get('pdf_page'),'locator':r.get('locator',''),'all_references':n['references']})
    return cards
def retrieve(q,limit=8):
    g=graph_data();byid={n['id']:n for n in g['nodes']};cards=knowledge_cards();q=q.lower().strip()
    aliases={'tl':'传播损失','ssp':'声速剖面','源深':'声源深度','kraken':'kraken','bellhop':'bellhop','ram':'ram','pe':'抛物方程','ctd':'ctd'}
    present=lambda t:bool(re.search(r'(?<![a-z])'+re.escape(t)+r'(?![a-z])',q)) if t.isascii() else t in q
    terms={q,*[v for k,v in aliases.items() if present(k)]}
    focus={n['id'] for n in g['nodes'] if n['kind']=='knowledge' and n['label'].lower() in q}
    alias_ids={'tl':'transmission_loss','ssp':'sound_speed_profile','源深':'source_depth','kraken':'matlab_kraken_wrapper','bellhop':'bellhop','ram':'ram','pe':'parabolic_equation','ctd':'ctd'}
    focus.update(id for t,id in alias_ids.items() if present(t))
    context=set(focus)
    for e in g['edges']:
        if e['group']!='hierarchy' and (e['source'] in focus or e['target'] in focus):context.update([e['source'],e['target']])
    terms.update(t.lower() for n in g['nodes'] if n['kind']=='knowledge' for t in [n['label']] if len(t)>1 and t.lower() in q)
    # Match meaningful overlapping phrases, avoiding single-character Chinese noise.
    terms.update(re.findall(r'[a-z0-9_]{2,}',q))
    for n in g['nodes']:
        if n['kind']=='knowledge':
            for width in (4,3,2):
                label=n['label']
                for i in range(max(0,len(label)-width+1)):
                    token=label[i:i+width]
                    if re.fullmatch(r'[\u4e00-\u9fff]+',token) and token in q:terms.add(token)
    ranked=[]
    for c in cards:
        if focus and c['node_id'] not in context:continue
        content=' '.join([c['label'],c['text'],c['formula'],c['conditions'],*byid[c['node_id']]['tags']]).lower()
        score=sum((8 if t in c['label'].lower() else 2) * min(len(t),6) for t in terms if t and t in content)
        if c['node_id'] in focus:score+=1000
        elif c['node_id'] in context:score+=100
        if score:ranked.append((score,c))
    ranked.sort(key=lambda pair:(-pair[0],pair[1]['id']))
    result=[c for _,c in ranked[:limit]]
    for c in result:
        c['related_triples']=[{'source':byid[e['source']]['label'],'relation':e['label'],'target':byid[e['target']]['label'],'relation_kind':e['group'],'note':e['note']} for e in g['edges'] if e['group']!='hierarchy' and c['node_id'] in [e['source'],e['target']]][:10]
    return result
def shortest_path(source,target):
    g=graph_data();ids={n['id'] for n in g['nodes']}
    if source not in ids or target not in ids:raise ValueError('知识点不存在')
    queue=collections.deque([(source,[source],[])]);visited={source}
    while queue:
        current,nodes,edges=queue.popleft()
        if current==target:return {'nodes':nodes,'edges':edges,'direction_note':'按概念关联查找连接，允许逆向遍历；不代表因果推导。'}
        for e in g['edges']:
            if e['group']!='related' or current not in [e['source'],e['target']]:continue
            other=e['target'] if current==e['source'] else e['source']
            if other not in visited:visited.add(other);queue.append((other,nodes+[other],edges+[e['id']]))
    return {'nodes':[],'edges':[],'direction_note':'当前人工整理的关系中，未找到连接。'}
