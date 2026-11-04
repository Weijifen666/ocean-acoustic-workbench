import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createCourseDocumentIndex,validateCourseDocumentPayload,COURSE_DOCUMENT_LIMITS} from '../server/course-document-index.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const row=(id,source,page,text)=>({id:`D-${source}-${id}`,source_id:source,pdf_page:page,label:'Computational Ocean Acoustics.pdf',text,source_revision:'a'.repeat(64),ingestion_version:2,node_id:null,node_ids:[],printed_page:null,char_start:0,char_end:[...text].length,offset_basis:'display_page_text_v2',conditions:'Text layer excerpt.',formula:'',text_policy:'unicode_display_preserved_search_nfkc_v2',math_layout_verified:false,evidence_type:'source_excerpt',verification_status:'source_text_unreviewed'});
function bundle(rows,version='v1'){
 const payload={schema_version:1,version,chunks:rows},raw=Buffer.from(JSON.stringify(payload)),packed=gzipSync(raw),grouped=new Map();
 for(const value of rows){if(!grouped.has(value.source_id))grouped.set(value.source_id,[]);grouped.get(value.source_id).push(value)}
 const source_coverage=[...grouped].map(([source_id,values])=>({source_id,title:'Test textbook',chunks:values.length,indexed_pages:new Set(values.filter(value=>value.pdf_page!==null).map(value=>value.pdf_page)).size}));
 const manifest={schema_version:1,version,chunks_key:'chunks.json.gz',chunks_sha256:sha(packed),compressed_bytes:packed.length,uncompressed_bytes:raw.length,chunks:rows.length,indexed_sources:grouped.size,indexed_pages:source_coverage.reduce((sum,value)=>sum+value.indexed_pages,0),source_coverage,ingestion_version:2};
 return {payload,raw,packed,manifest};
}
class Bucket{
 constructor(data){this.objects=new Map();this.reads=[];if(data)this.publish(data)}
 publish(data){const prefix='course-knowledge/'+data.manifest.version;this.objects.set(CURRENT,Buffer.from(JSON.stringify({version:data.manifest.version,manifest_key:prefix+'/manifest.json'})));this.objects.set(prefix+'/manifest.json',Buffer.from(JSON.stringify(data.manifest)));this.objects.set(prefix+'/chunks.json.gz',data.packed)}
 async get(key){this.reads.push(key);const value=this.objects.get(key);return value?{size:value.length,body:new Blob([value]).stream()}:null}
}
const CURRENT='course-knowledge/current.json';

test('missing or failed course storage is explicitly unavailable instead of an apparently ready empty index',async()=>{
 const index=createCourseDocumentIndex();assert.equal((await index.status({})).available,false);
 const env={BUCKET:new Bucket()},result=await index.search('简正波',env);assert.deepEqual(result.matches,[]);assert.equal(result.status.state,'not_uploaded');assert.equal(result.status.index_ready,false);
 const faulty={BUCKET:{get:async()=>{throw Object.assign(Error('private diagnostic'),{code:'TEST-SECRET-MUST-NOT-LEAK'})}}};
 assert.equal((await index.status(faulty)).error_code,'index_unavailable');
});

test('cloud excerpts keep original Unicode and rank the focused theory page above repeated-keyword distractors',async()=>{
 const original='Normal-mode methods represent the pressure field as vertical eigenfunctions. ψₘ(z), 𝑝(r,z), ① preserve Unicode.';
 const data=bundle([row('definition','S17',356,original),row('distractor','S18',50,'normal modes '.repeat(120)),row('boundary','S17',359,'Normal modes satisfy boundary conditions and an eigenvalue problem.'),row('unrelated','S17',600,'A sediment experiment contains porosity and mud sampling.')]),bucket=new Bucket(data),index=createCourseDocumentIndex(),env={BUCKET:bucket};
 const cards=[{node_id:'normal_mode_field',retrieval:{focus:true},all_references:[{source_id:'S17',pdf_page:356},{source_id:'S17',pdf_page:359}]}];
 for(const query of ['简正波','什么是简正波？','normal modes','normal-mode']){
  const result=await index.search(query,env,cards);assert.equal(result.status.available,true);assert.equal(result.matches[0].source_id,'S17');assert(result.matches.length<=4);
  const found=result.matches.find(value=>value.id==='D-S17-definition');assert.equal(found.text,original);assert.equal(found.revision,'a'.repeat(64));assert.equal(found.claim_support_verified,false);assert.equal(found.citation.pdf_page,356);assert.equal(found.node_id,'normal_mode_field');assert.equal(found.source_index_version,'v1');
 }
 assert.equal(bucket.reads.filter(key=>key.endsWith('.gz')).length,1,'The same R2 version must reuse its normalized text cache');
 assert.deepEqual((await index.search('basketball tournament playoffs',env)).matches,[]);
});

test('cache refresh follows the pointer version and TTL without reusing the previous textbook revision',async()=>{
 const first=bundle([row('old','S17',356,'Normal modes old source revision.')]),bucket=new Bucket(first),index=createCourseDocumentIndex({pointerTtlMs:0,cacheTtlMs:0}),env={BUCKET:bucket};
 assert.equal((await index.status(env)).version,'v1');await new Promise(resolve=>setTimeout(resolve,3));
 const next=bundle([row('new','S17',356,'Normal modes new source revision.')],'v2');bucket.publish(next);
 const result=await index.search('normal modes',env);assert.equal(result.status.version,'v2');assert.equal(result.matches[0].id,'D-S17-new');assert(!result.matches.some(value=>value.id==='D-S17-old'));
});

test('payload validation checks manifest statistics, private metadata, row identity and safe schema extensions',()=>{
 const data=bundle([row('one','S17',356,'Normal modes form the field.')]);
 assert.equal(validateCourseDocumentPayload({...data.manifest,schema:{encoding:'utf-8'}},data.payload).chunks,1);
 const legacy={...data.payload,chunks:[{...data.payload.chunks[0],node_id:'SW06_CTD',node_ids:['SW06_CTD','ASIAEX_CTD']}]};assert.deepEqual(validateCourseDocumentPayload(data.manifest,legacy).rows[0].node_ids,['SW06_CTD','ASIAEX_CTD']);
 for(const extra of [{api_key:'TEST-ONLY'},{apiKey:'TEST-ONLY'},{accessToken:'TEST-ONLY'},{gatewaySecret:'TEST-ONLY'},{schema:{source_path:'C:/private/book.pdf'}},{schema:{file:'file:///private/book.pdf'}}])assert.throws(()=>validateCourseDocumentPayload({...data.manifest,...extra},data.payload));
 assert.throws(()=>validateCourseDocumentPayload({...data.manifest,indexed_pages:2},data.payload));
 assert.throws(()=>validateCourseDocumentPayload({...data.manifest,source_coverage:[{...data.manifest.source_coverage[0],chunks:2}]},data.payload));
 assert.throws(()=>validateCourseDocumentPayload(data.manifest,{...data.payload,chunks:[{...data.payload.chunks[0],api_key:'TEST-ONLY'}]}));
 const long=bundle([row('long','S17',356,'𝑝'.repeat(4001))]);assert.throws(()=>validateCourseDocumentPayload(long.manifest,long.payload));
});

test('corrupt, incomplete, oversized and decompression-bomb objects fail with bounded unavailable status',async()=>{
 const data=bundle([row('one','S17',356,'Normal modes form the field.')]);
 const corrupt=new Bucket(data);corrupt.objects.set('course-knowledge/v1/chunks.json.gz',Buffer.from('not gzip'));
 assert.equal((await createCourseDocumentIndex().status({BUCKET:corrupt})).available,false);
 const absent=new Bucket(data);absent.objects.delete('course-knowledge/v1/chunks.json.gz');assert.equal((await createCourseDocumentIndex().status({BUCKET:absent})).available,false);
 const large=new Bucket(data),get=large.get.bind(large);large.get=async key=>key.endsWith('.gz')?{size:COURSE_DOCUMENT_LIMITS.compressed+1,get body(){throw Error('Oversized object must not be read')}}:get(key);
 assert.equal((await createCourseDocumentIndex().status({BUCKET:large})).error_code,'object_too_large');
 const bomb=new Bucket(data),packed=gzipSync(Buffer.alloc(COURSE_DOCUMENT_LIMITS.uncompressed+1,120));
 bomb.objects.set('course-knowledge/v1/chunks.json.gz',packed);bomb.objects.set('course-knowledge/v1/manifest.json',Buffer.from(JSON.stringify({...data.manifest,compressed_bytes:packed.length,uncompressed_bytes:COURSE_DOCUMENT_LIMITS.uncompressed,chunks_sha256:sha(packed)})));
 assert.equal((await createCourseDocumentIndex().status({BUCKET:bomb})).error_code,'object_too_large');
 const traversal=new Bucket(data);traversal.objects.set(CURRENT,Buffer.from(JSON.stringify({version:'v1',manifest_key:'private/config.json'})));
 const result=await createCourseDocumentIndex().status({BUCKET:traversal});assert.equal(result.available,false);assert.deepEqual(traversal.reads,[CURRENT]);
});
