/** Offline public ocean document retrieval. The Worker supplies bundled JSON.
 * This is a small BM25 implementation, not an installed GraphRAG framework.
 * Editorial Chinese guides/aliases are distinguishable from official excerpts.
 */
const STOP=new Set(['请问','如何','怎么','什么','为何','为什么','一下','解释','说明','有关','相关','知识','课程','我们','这个','以及','哪些','是否','可以','问题','进行','the','and','with','what','how','please','explain','is','of','to','a','an']);
const norm=value=>String(value??'').normalize('NFKC').toLowerCase().trim();
function contains(text,term){term=norm(term);return /^[\x00-\x7f]*$/.test(term)?new RegExp(`(?<![a-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![a-z0-9_])`).test(text):text.includes(term)}
function tokens(value){const text=norm(value),result=text.match(/[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?/g)||[];for(const block of text.match(/[\u4e00-\u9fff]+/g)||[])for(const width of [2,3,4])for(let i=0;i<=block.length-width;i++)result.push(block.slice(i,i+width));return result.filter(t=>!STOP.has(t))}
const copy=value=>JSON.parse(JSON.stringify(value));
function stale(source,now){const date=Date.parse(source.fetched_at??'');return !Number.isFinite(date)||now-date>(source.ttl_hours??168)*3600000}

export function createPublicOceanKnowledge({sources=[],chunks=[]}={}){
 const registry=Array.isArray(sources)?sources:(sources.sources||[]),rows=copy(chunks),sourceRows=copy(registry);
 const texts=rows.map(row=>norm([row.text,row.title,row.title_zh,row.guide_zh,...(row.search_aliases||[])].join(' ')));
 const documents=texts.map(tokens),frequencies=documents.map(doc=>{const count=new Map();for(const term of doc)count.set(term,(count.get(term)||0)+1);return count});
 const df=new Map();for(const count of frequencies)for(const term of count.keys())df.set(term,(df.get(term)||0)+1);
 const average=documents.reduce((sum,doc)=>sum+doc.length,0)/Math.max(documents.length,1),N=documents.length;
 function retrievePublicOcean(query,limit=6){
  const q=norm(query),terms=tokens(q),cap=Math.max(0,Math.min(Number(limit)||0,20));if(!cap||!terms.length)return [];
  const ranked=[];
  for(let i=0;i<rows.length;i++){
   const row=rows[i],matched=terms.filter(term=>contains(texts[i],term)),aliases=(row.search_aliases||[]).filter(term=>contains(q,term));
   if(!matched.length||!(aliases.length||matched.some(t=>t.length>=4&&/^[\x00-\x7f]*$/.test(t))||new Set(matched).size>=2))continue;
   let score=aliases.length*2;
   for(const term of terms){const tf=frequencies[i].get(term)||0;if(!tf)continue;const idf=Math.log(1+(N-(df.get(term)||0)+.5)/((df.get(term)||0)+.5));score+=idf*tf*2.5/(tf+1.5*(.25+.75*documents[i].length/(average||1)))}
   ranked.push({index:i,score});
  }
  ranked.sort((a,b)=>b.score-a.score||rows[a.index].id.localeCompare(rows[b.index].id));
  const found=[],count=new Map();
  for(const {index,score} of ranked){const row=rows[index];if((count.get(row.source_id)||0)>=2)continue;
   const citation={source_id:row.source_id,url:row.url,title:row.title,organization:row.organization,fetched_at:row.fetched_at,source_updated_at:row.source_updated_at,sha256:row.sha256,text_sha256:row.text_sha256,license:row.license,snapshot_not_realtime:true};
   found.push({...copy(row),retrieval:{method:'bm25+editorial-bilingual-aliases',role:'public_document',score:Number(score.toFixed(7)),snapshot_not_realtime:true},citation,all_references:[{source_id:row.source_id,url:row.url,locator:`${row.evidence_type==='public_reference_guide'?'项目自写导读':'公开网页快照'}，正文字符 ${row.char_start}–${row.char_end}`} ]});
   count.set(row.source_id,(count.get(row.source_id)||0)+1);if(found.length>=cap)break;
  }
  return found;
 }
 function publicOceanStatus(now=Date.now()){
  const count=new Map();for(const row of rows)count.set(row.source_id,(count.get(row.source_id)||0)+1);
  const times=sourceRows.map(s=>s.fetched_at).filter(Boolean).sort();
  const web_sources=sourceRows.map(source=>({...copy(source),chunks:count.get(source.id)||0,stale:stale(source,now)}));
  return {mode:'public_ocean_document_rag',registered_sources:sourceRows.length,indexed_sources:count.size,successful_web_documents:sourceRows.filter(s=>s.content_policy==='public_domain_text'&&count.has(s.id)).length,reference_guides:sourceRows.filter(s=>s.content_policy==='original_project_summary'&&count.has(s.id)).length,data_service_entries:sourceRows.filter(s=>s.content_policy==='metadata_only').length,chunks:rows.length,latest_fetched_at:times.at(-1)||null,oldest_fetched_at:times[0]||null,stale_sources:web_sources.filter(s=>s.content_policy==='public_domain_text'&&s.stale).length,methods:['BM25','editorial_bilingual_topic_aliases'],web_sources,refresh:{running:false,mode:'bundled_offline_snapshot'},realtime_observations_connected:false,live_web_search:false,training_performed:false,note:'官方知识网页正文快照 + 项目自写参考导读；公开网页数量与课程 PDF 页数分别统计。刷新页面不代表获取最新观测值；当前没有接入实时海况数据接口。'};
 }
 return {retrievePublicOcean,publicOceanStatus};
}

let configured=createPublicOceanKnowledge();
export function configurePublicOcean(data){configured=createPublicOceanKnowledge(data);return configured}
export function retrievePublicOcean(query,limit=6){return configured.retrievePublicOcean(query,limit)}
export function publicOceanStatus(now=Date.now()){return configured.publicOceanStatus(now)}
