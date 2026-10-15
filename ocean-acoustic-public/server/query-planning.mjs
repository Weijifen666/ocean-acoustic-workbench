import specification from '../data/knowledge-retrieval-rules.json' with {type:'json'};
const coxMunk=/\bcox\s*[-–—]?\s*munk\b/gi;
export const focusQuery=question=>String(question??'').normalize('NFKC').toLowerCase().replace(coxMunk,'');
export const isCoxMunkOnly=question=>/\bcox\s*[-–—]?\s*munk\b/i.test(String(question??'').normalize('NFKC'))&&!/\bmunk\b/i.test(focusQuery(question));

/** Maintained contextual rewrites, not vector search or a model call. */
export function planQuery(question){
 const query=String(question??'').normalize('NFKC').toLowerCase().trim();
 const matched=specification.rules.filter(rule=>(rule.all||[]).every(p=>new RegExp(p,'i').test(query))&&(!rule.any||rule.any.some(p=>new RegExp(p,'i').test(query)))&&!(rule.unless||[]).some(p=>new RegExp(p,'i').test(query)));
 return {query,queries:[...new Set([query,...matched.flatMap(r=>r.queries)])].slice(0,4),rule_ids:matched.map(r=>r.id),target_node_ids:[...new Set(matched.flatMap(r=>r.node_ids))],method:'maintained_contextual_query_rules',model_called:false};
}
export function reciprocalRankFusion(rankLists,limit=8,preferredNodes=[]){
 const scores=new Map(),rows=new Map(),preferred=new Set(preferredNodes);
 for(const ranking of rankLists)ranking.forEach((row,i)=>{if(!rows.has(row.id))rows.set(row.id,row);scores.set(row.id,(scores.get(row.id)||0)+1/(60+i+1))});
 return [...rows].sort(([aid,a],[bid,b])=>Number(preferred.has(b.node_id))-Number(preferred.has(a.node_id))||scores.get(bid)-scores.get(aid)||aid.localeCompare(bid)).slice(0,limit).map(([id,row])=>({row,score:Number(scores.get(id).toFixed(8))}));
}
