// Private course excerpts live in versioned R2 objects, never in the JS bundle.
// Only normalized search text is cached; displayed source text keeps Unicode.
export const COURSE_DOCUMENT_LIMITS={compressed:6*1024*1024,uncompressed:16*1024*1024,rows:12000,textCharacters:4000};
const CURRENT='course-knowledge/current.json',VERSION=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SOURCE=/^S\d{2,4}$/,ID=/^D-S\d{2,4}-[A-Za-z0-9_-]{1,100}$/,NODE=/^[A-Za-z][A-Za-z0-9_]{0,99}$/,SHA=/^[a-f0-9]{64}$/;
const ROW_FIELDS=new Set(['id','source_id','pdf_page','label','text','source_revision','ingestion_version','node_id','node_ids','printed_page','char_start','char_end','offset_basis','conditions','formula','text_policy','math_layout_verified','evidence_type','verification_status']);
const COVERAGE_FIELDS=new Set(['source_id','title','source_revision','type','total_pages','selected_pages','processed_pages','indexed_pages','chunks','processed_units','indexed_units','failed_or_needs_ocr_pages','blank_or_short_pages','unreadable_pages','coverage_ratio','selected_success_ratio','full_document_selected']);
const CACHE=new WeakMap(),encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const bad=code=>Object.assign(new Error('课程全文索引校验失败。'),{status:422,code,isCourseDocumentError:true});
const integer=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isInteger(n)&&n>=min&&n<=max;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const chars=value=>typeof value==='string'?[...value].length:0;
const pathValue=value=>/^[A-Za-z]:[\\/]|^\\\\|^\/|file:\/\//i.test(value);
function metadataSafe(value,depth=0,budget={keys:0}){
 if(depth>7)throw bad('metadata_too_deep');
 if(typeof value==='string'){if(value.length>3000||pathValue(value))throw bad('private_metadata');return;}
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
 if(Array.isArray(value)){if(value.length>300)throw bad('metadata_too_large');for(const item of value)metadataSafe(item,depth+1,budget);return;}
 if(!plain(value))throw bad('invalid_metadata');
 for(const [key,item] of Object.entries(value)){
  const name=key.replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase();
  if(++budget.keys>5000||key.length>100||name==='key'||/(?:^|_)(?:path|local|private|api_key|secret|token|password|credential|database|authorization|connection_string)(?:$|_)/i.test(name))throw bad('private_metadata');
  metadataSafe(item,depth+1,budget);
 }
}
function validateManifest(manifest,version){
 if(!plain(manifest)||manifest.schema_version!==1||!VERSION.test(manifest.version||'')||(version!==undefined&&manifest.version!==version)||manifest.chunks_key!=='chunks.json.gz'||!SHA.test(manifest.chunks_sha256||''))throw bad('invalid_manifest');
 metadataSafe(manifest);
 if(!integer(manifest.compressed_bytes,1,COURSE_DOCUMENT_LIMITS.compressed)||!integer(manifest.uncompressed_bytes,1,COURSE_DOCUMENT_LIMITS.uncompressed)||!integer(manifest.chunks,1,COURSE_DOCUMENT_LIMITS.rows)||!integer(manifest.indexed_sources,1,200)||!integer(manifest.indexed_pages,0,COURSE_DOCUMENT_LIMITS.rows)||!integer(manifest.ingestion_version,2,100)||!Array.isArray(manifest.source_coverage)||manifest.source_coverage.length>200)throw bad('invalid_manifest_counts');
}

/** Shared with the authenticated publisher. Hash/byte checks happen on bytes. */
export function validateCourseDocumentPayload(manifest,payload){
 validateManifest(manifest);
 if(!plain(payload)||Object.keys(payload).some(key=>!['schema_version','version','chunks'].includes(key))||payload.schema_version!==1||payload.version!==manifest.version||!Array.isArray(payload.chunks)||payload.chunks.length!==manifest.chunks)throw bad('invalid_payload');
 const ids=new Set(),sources=new Map(),pages=new Set(),rows=[];
 for(const value of payload.chunks){
  if(!plain(value)||Object.keys(value).some(key=>!ROW_FIELDS.has(key))||!ID.test(value.id||'')||!SOURCE.test(value.source_id||'')||!value.id.startsWith('D-'+value.source_id+'-')||ids.has(value.id))throw bad('invalid_chunk_identity');
  if(typeof value.text!=='string'||!value.text.trim()||chars(value.text)>COURSE_DOCUMENT_LIMITS.textCharacters||typeof value.label!=='string'||!value.label||value.label.length>400||pathValue(value.label)||!SHA.test(value.source_revision||'')||value.ingestion_version!==manifest.ingestion_version||value.evidence_type!=='source_excerpt'||value.verification_status!=='source_text_unreviewed'||value.math_layout_verified!==false)throw bad('invalid_chunk_text');
  if(value.pdf_page!==null&&!integer(value.pdf_page,1,100000)||value.printed_page!==undefined&&value.printed_page!==null&&!integer(value.printed_page,-10000,100000)||!integer(value.char_start,0,10000000)||!integer(value.char_end,value.char_start,10000000)||value.offset_basis!=='display_page_text_v2'||value.text_policy!=='unicode_display_preserved_search_nfkc_v2')throw bad('invalid_chunk_locator');
  if(value.node_id!==null&&value.node_id!==undefined&&!NODE.test(value.node_id)||!Array.isArray(value.node_ids)||value.node_ids.length>32||value.node_ids.some(id=>!NODE.test(id))||new Set(value.node_ids).size!==value.node_ids.length||value.node_id&& !value.node_ids.includes(value.node_id))throw bad('invalid_chunk_nodes');
  for(const key of ['conditions','formula'])if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>4000||pathValue(value[key])))throw bad('invalid_chunk_metadata');
  ids.add(value.id);if(value.pdf_page!==null)pages.add(value.source_id+':'+value.pdf_page);
  if(!sources.has(value.source_id))sources.set(value.source_id,{chunks:0,pages:new Set(),revision:value.source_revision});
  const source=sources.get(value.source_id);if(source.revision!==value.source_revision)throw bad('mixed_source_revisions');source.chunks++;if(value.pdf_page!==null)source.pages.add(value.pdf_page);
  rows.push({...value,node_id:value.node_id||null,node_ids:[...value.node_ids]});
 }
 if(sources.size!==manifest.indexed_sources||pages.size!==manifest.indexed_pages||manifest.source_coverage.length!==sources.size)throw bad('manifest_count_mismatch');
 const seen=new Set(),coverage=[];
 for(const item of manifest.source_coverage){
  if(!plain(item)||Object.keys(item).some(key=>!COVERAGE_FIELDS.has(key))||!sources.has(item.source_id)||seen.has(item.source_id)||typeof item.title!=='string'||!item.title||item.title.length>400||pathValue(item.title))throw bad('invalid_source_coverage');
  const source=sources.get(item.source_id);if(item.chunks!==source.chunks||item.indexed_pages!==source.pages.size||item.source_revision!==undefined&&item.source_revision!==source.revision)throw bad('source_count_mismatch');
  for(const [key,value] of Object.entries(item)){
   if(['source_id','title','source_revision','type'].includes(key))continue;
   if(key==='full_document_selected'){if(typeof value!=='boolean')throw bad('invalid_source_coverage');}
   else if(key.endsWith('_ratio')){if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1))throw bad('invalid_source_coverage');}
   else if(value!==null&&!integer(value,0,1000000))throw bad('invalid_source_coverage');
  }
  seen.add(item.source_id);coverage.push({...item});
 }
 return {chunks:rows.length,indexed_sources:sources.size,indexed_pages:pages.size,source_coverage:coverage,ingestion_version:manifest.ingestion_version,rows};
}

async function bytes(stream,limit){
 const reader=stream.getReader(),parts=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw bad('object_too_large')}parts.push(value)}}finally{reader.releaseLock()}
 const result=new Uint8Array(total);let at=0;for(const part of parts){result.set(part,at);at+=part.byteLength}return result;
}
async function objectBytes(bucket,key,limit){
 const object=await bucket.get(key);if(!object)throw bad('object_missing');if(object.size>limit)throw bad('object_too_large');
 return bytes(object.body||new Blob([await object.arrayBuffer()]).stream(),limit);
}
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(n=>n.toString(16).padStart(2,'0')).join('');
const norm=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015]/g,'-');
const STOP=new Set(['什么','么是','是什','请问','如何','怎么','讲讲','一下','解释','说明','这个','有关','知识','课程','海洋','海水','水下','the','and','with','what','how','please','explain','are','is','of','to','a','an','ocean','marine','underwater']);
const ALIASES=[[/简正波|\bnormal[\s-]+modes?\b/i,'normal modes'],[/声速剖面|\bssp\b|sound speed profile/i,'sound speed profile'],[/声速|sound speed/i,'sound speed'],[/传播损失|\btl\b|transmission loss/i,'transmission loss'],[/模态激励|模态激发|mode excitation/i,'source mode excitation'],[/本征值|斯图姆|sturm/i,'sturm liouville eigenvalue boundary'],[/波数积分|wavenumber integration/i,'wavenumber integration'],[/抛物方程|parabolic equation/i,'parabolic equation'],[/射线|ray tracing/i,'ray tracing'],[/海底|seabed/i,'bottom seabed'],[/声道|sofar/i,'sound channel']];
function queryTerms(query){
 let text=norm(query).slice(0,1200);for(const [pattern,expansion] of ALIASES)if(pattern.test(text))text+=' '+expansion;
 const terms=text.match(/[a-z][a-z0-9_]+/g)||[];for(const block of text.match(/[\u3400-\u9fff]+/g)||[])for(const width of [2,3,4])for(let at=0;at<=block.length-width;at++)terms.push(block.slice(at,at+width));
 return [...new Set(terms.filter(term=>!STOP.has(term)))].slice(0,48);
}
function termCount(text,term){
 let count=0,at=0;const latin=/^[a-z0-9_]+$/.test(term),word=char=>char!==undefined&&/[a-z0-9_]/.test(char);
 while(count<64&&(at=text.indexOf(term,at))!==-1){if(!latin||!word(text[at-1])&&!word(text[at+term.length]))count++;at+=term.length}return count;
}
const unavailable=(code='index_unavailable',state='unavailable')=>({available:false,index_ready:false,state,error_code:code,chunks:0,indexed_sources:0,indexed_pages:0,training_performed:false,scope:'云端教材索引尚未发布或暂不可用。'});
function stateFor(bucket){if(!CACHE.has(bucket))CACHE.set(bucket,{pointer:null,pointerUntil:0,entry:null,pending:null});return CACHE.get(bucket)}

export function createCourseDocumentIndex({cacheTtlMs=60000,pointerTtlMs=5000}={}){
 async function load(env){
  if(!env?.BUCKET||typeof env.BUCKET.get!=='function')return {status:unavailable('storage_unavailable')};
  const bucket=env.BUCKET,state=stateFor(bucket);
  try{
   if(!state.pointer||Date.now()>state.pointerUntil){
    const pointer=JSON.parse(decoder.decode(await objectBytes(bucket,CURRENT,4096)));
    if(!plain(pointer)||!VERSION.test(pointer.version||'')||pointer.manifest_key!==`course-knowledge/${pointer.version}/manifest.json`)throw bad('invalid_pointer');
    state.pointer=pointer;state.pointerUntil=Date.now()+pointerTtlMs;
   }
   const pointer=state.pointer;
   if(state.entry?.version===pointer.version&&Date.now()<state.entry.expiresAt)return state.entry;
   if(state.pending?.version===pointer.version)return await state.pending.promise;
   const promise=(async()=>{
    const manifest=JSON.parse(decoder.decode(await objectBytes(bucket,pointer.manifest_key,128*1024)));validateManifest(manifest,pointer.version);
    const packed=await objectBytes(bucket,`course-knowledge/${pointer.version}/chunks.json.gz`,COURSE_DOCUMENT_LIMITS.compressed);
    if(packed.byteLength!==manifest.compressed_bytes||await hash(packed)!==manifest.chunks_sha256)throw bad('compressed_integrity');
    const unpacked=await bytes(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),COURSE_DOCUMENT_LIMITS.uncompressed);
    if(unpacked.byteLength!==manifest.uncompressed_bytes)throw bad('uncompressed_integrity');
    const parsed=validateCourseDocumentPayload(manifest,JSON.parse(decoder.decode(unpacked))),documents=parsed.rows.map(row=>({row,normalized:norm(row.text),length:Math.max(1,row.text.length)}));
    const entry={version:pointer.version,expiresAt:Date.now()+cacheTtlMs,documents,averageLength:documents.reduce((sum,row)=>sum+row.length,0)/documents.length,status:{available:true,index_ready:true,state:'ready',version:pointer.version,chunks:parsed.chunks,indexed_sources:parsed.indexed_sources,indexed_pages:parsed.indexed_pages,source_coverage:parsed.source_coverage,ingestion_version:parsed.ingestion_version,training_performed:false,math_layout_verified:false,display_policy:'unicode_original',retrieval_method:'query_term_bm25+explicit_course_page_priors',scope:'云端教材正文检索'}};
    state.entry=entry;return entry;
   })();state.pending={version:pointer.version,promise};
   try{return await promise}finally{if(state.pending?.promise===promise)state.pending=null}
  }catch(error){const code=error?.isCourseDocumentError?error.code:'index_unavailable';return {status:unavailable(code==='object_missing'&&!state.pointer?'index_not_uploaded':code,code==='object_missing'&&!state.pointer?'not_uploaded':'unavailable')}}
 }
 async function status(env){return structuredClone((await load(env)).status)}
 async function search(query,env,cardRows=[]){
  const index=await load(env);if(!index.status.available)return {matches:[],status:structuredClone(index.status)};
  const terms=queryTerms(query);if(!terms.length)return {matches:[],status:structuredClone(index.status)};
  const focused=cardRows.filter(row=>row.retrieval?.focus===true||row.retrieval?.role==='question_focus'),refs=new Map(),nodes=new Set(focused.map(row=>row.node_id)),df=new Uint32Array(terms.length),candidates=[];
  for(const card of focused)for(const ref of card.all_references||[card])if(SOURCE.test(ref.source_id||'')&&integer(ref.pdf_page,1,100000))refs.set(ref.source_id+':'+ref.pdf_page,card.node_id);
  for(const document of index.documents){const tf=terms.map((term,i)=>{const count=termCount(document.normalized,term);if(count)df[i]++;return count});if(tf.some(Boolean))candidates.push({document,tf})}
  const ranked=candidates.map(({document,tf})=>{
   let score=0;for(let i=0;i<terms.length;i++)if(tf[i])score+=Math.log(1+(index.documents.length-df[i]+.5)/(df[i]+.5))*tf[i]*2.5/(tf[i]+1.5*(.25+.75*document.length/index.averageLength));
   const row=document.row,reference=refs.has(row.source_id+':'+row.pdf_page),node=nodes.has(row.node_id)||(row.node_ids||[]).some(id=>nodes.has(id));return {row,score,reference,node};
  }).sort((a,b)=>Number(b.reference)-Number(a.reference)||Number(b.node)-Number(a.node)||b.score-a.score||a.row.id.localeCompare(b.row.id));
  const matches=ranked.slice(0,4).map(({row,score,reference})=>{
   const locator=row.pdf_page?`PDF 第 ${row.pdf_page} 页，原页字符 ${row.char_start}–${row.char_end}`:`原文字符 ${row.char_start}–${row.char_end}`,node_id=refs.get(row.source_id+':'+row.pdf_page)||row.node_id;
   const value={...row,node_id,id:row.id,chunk_id:row.id,revision:row.source_revision,locator,all_references:[{source_id:row.source_id,pdf_page:row.pdf_page,locator}],support_status:'candidate_only',claim_support_verified:false,source_index_version:index.version,retrieval:{method:'query_term_bm25',score:Number(score.toFixed(6)),role:'source_excerpt',focused_source_page:reference,normalized_for_search_only:true,claim_support_verified:false}};
   value.citation={id:row.id,source_id:row.source_id,pdf_page:row.pdf_page,locator,source_revision:row.source_revision,url:row.pdf_page?`/api/source/${row.source_id}/page/${row.pdf_page}`:null,citation_role:'retrieval_candidate',claim_support_verified:false};return value;
  });return {matches,status:structuredClone(index.status)};
 }
 return {search,status};
}
