import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {handleCourseKnowledgePublish} from '../server/course-knowledge-publish.mjs';

// Every text and credential below is synthetic and confined to controlled tests.
const TOKEN='SYNTHETIC-COURSE-PUBLISH-TOKEN',MIB=1024*1024;
const sha=value=>createHash('sha256').update(value).digest('hex');
class Bucket{
 constructor(){this.objects=new Map();this.calls=[];this.failKey=null;}
 async get(key){
  this.calls.push({method:'get',key});const item=this.objects.get(key);if(!item)return null;
  return {key,size:item.bytes.length,customMetadata:item.metadata,body:new Blob([item.bytes]).stream(),arrayBuffer:async()=>Uint8Array.from(item.bytes).buffer,text:async()=>item.bytes.toString('utf8'),json:async()=>JSON.parse(item.bytes.toString('utf8'))};
 }
 async put(key,value,options={}){
  this.calls.push({method:'put',key,conditional:options.onlyIf?.get('If-None-Match')});
  if(this.failKey===key)throw Error('synthetic storage write failure');
  if(options.onlyIf?.get('If-None-Match')==='*'&&this.objects.has(key))return null;
  const bytes=Buffer.from(value);if(options.sha256)assert.equal(sha(bytes),options.sha256);
  this.objects.set(key,{bytes,metadata:options.customMetadata||{}});return {key,size:bytes.length};
 }
}
const environment=()=>({COURSE_KNOWLEDGE_PUBLISH_TOKEN:TOKEN,GATEWAY_SECRET:'UNRELATED-SYNTHETIC-GATEWAY-SECRET',BUCKET:new Bucket()});
const request=(input,token=TOKEN,options={})=>new Request('https://course.test/_knowledge-admin/import',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(options.headers||{})},body:JSON.stringify(input)});
const row=(extra={})=>({id:'D-S01-synthetic01',source_id:'S01',pdf_page:1,label:'合成教材第1页',text:'合成测试段落：声学课程资料索引。',source_revision:sha('synthetic-source'),ingestion_version:2,node_id:null,node_ids:[],char_start:0,char_end:20,offset_basis:'display_page_text_v2',text_policy:'unicode_display_preserved_search_nfkc_v2',math_layout_verified:false,evidence_type:'source_excerpt',verification_status:'source_text_unreviewed',...extra});
function dataset(rows=[row()],version='synthetic-v1'){
 const payload={schema_version:1,version,chunks:rows},raw=Buffer.from(JSON.stringify(payload)),compressed=gzipSync(raw),sources=new Map();
 for(const item of rows){if(!sources.has(item.source_id))sources.set(item.source_id,{source_id:item.source_id,title:'合成教材 '+item.source_id,chunks:0,pages:new Set()});const source=sources.get(item.source_id);source.chunks++;if(item.pdf_page!==null)source.pages.add(item.pdf_page)}
 const source_coverage=[...sources.values()].map(({pages,...item})=>({...item,indexed_pages:pages.size}));
 return {manifest:{schema_version:1,version,chunks_key:'chunks.json.gz',chunks_sha256:sha(compressed),compressed_bytes:compressed.length,uncompressed_bytes:raw.length,chunks:rows.length,indexed_sources:sources.size,indexed_pages:source_coverage.reduce((sum,source)=>sum+source.indexed_pages,0),source_coverage,ingestion_version:2},body:compressed.toString('base64')};
}
function replaceCompressed(data,bytes){data.body=Buffer.from(bytes).toString('base64');data.manifest.compressed_bytes=bytes.length;data.manifest.chunks_sha256=sha(bytes);return data}
const publish=(env,data)=>handleCourseKnowledgePublish(request(data),env);
const pointer=env=>env.BUCKET.objects.get('course-knowledge/current.json')?.bytes.toString('utf8');

test('only the exact administrative POST route is handled, with its own Bearer secret',async()=>{
 const env=environment(),data=dataset();
 for(const url of ['https://course.test/api/course-knowledge/raw','https://course.test/_knowledge-admin/other','https://course.test/_knowledge-admin/import/'])assert.equal(await handleCourseKnowledgePublish(new Request(url),env),null);
 assert.equal((await handleCourseKnowledgePublish(new Request('https://course.test/_knowledge-admin/import'),env)).status,405);
 for(const token of ['wrong-token',env.GATEWAY_SECRET,''])assert.equal((await handleCourseKnowledgePublish(request(data,token),env)).status,403);
 const missing={BUCKET:env.BUCKET,GATEWAY_SECRET:TOKEN};assert.equal((await handleCourseKnowledgePublish(request(data),missing)).status,403,'Gateway secret is never an import credential');
 assert.equal(env.BUCKET.calls.length,0,'Authenticate before touching any R2 object');
});

test('valid import verifies actual statistics, writes immutable objects first and activates last',async()=>{
 const env=environment(),data=dataset([row(),row({id:'D-S01-synthetic02',pdf_page:2}),row({id:'D-S02-synthetic01',source_id:'S02'})]);
 data.manifest.schema={encoding:'utf-8',future_format:'allowed-schema-metadata'};
 const response=await publish(env,data);assert.equal(response.status,200,await response.clone().text());const result=await response.json();
 assert.equal(result.chunks,3);assert.equal(result.indexed_sources,2);assert.equal(result.indexed_pages,3);
 const writes=env.BUCKET.calls.filter(call=>call.method==='put');
 assert.deepEqual(writes.map(call=>call.key),['course-knowledge/synthetic-v1/chunks.json.gz','course-knowledge/synthetic-v1/manifest.json','course-knowledge/current.json']);
 assert.deepEqual(writes.map(call=>call.conditional),['*','*',undefined]);
 const current=JSON.parse(pointer(env)),manifestBytes=env.BUCKET.objects.get(current.manifest_key).bytes;
 assert.equal(current.schema_version,1);assert.equal(current.version,'synthetic-v1');assert.equal(current.manifest_sha256,sha(manifestBytes));assert(!Number.isNaN(Date.parse(current.activated_at)));
 assert.equal(JSON.parse(manifestBytes).schema.encoding,'utf-8');assert.equal(JSON.parse(gunzipSync(env.BUCKET.objects.get('course-knowledge/synthetic-v1/chunks.json.gz').bytes)).chunks.length,3);
 assert(!JSON.stringify(result).includes(TOKEN));
});

test('wrong hashes, malformed Base64 and invalid UTF-8 JSON never write storage',async()=>{
 const cases=[
  data=>{data.manifest.chunks_sha256='f'.repeat(64)},
  data=>{data.body='not base64!'},
  data=>{data.manifest.compressed_bytes++},
  data=>{replaceCompressed(data,gzipSync(Buffer.from([0xff,0xfe])));data.manifest.uncompressed_bytes=2},
 ];
 for(const change of cases){const env=environment(),data=dataset();change(data);assert.equal((await publish(env,data)).status,422);assert.equal(env.BUCKET.calls.length,0)}
});

test('gzip checksum corruption and truncation are rejected after a matching upload SHA',async()=>{
 for(const truncate of [false,true]){
  const env=environment(),data=dataset();let bytes=Buffer.from(data.body,'base64');if(truncate)bytes=bytes.subarray(0,bytes.length-4);else bytes[bytes.length-8]^=0x40;
  replaceCompressed(data,bytes);const response=await publish(env,data);assert.equal(response.status,422);assert.match((await response.json()).detail,/Gzip/);assert.equal(env.BUCKET.calls.length,0);
 }
});

test('request streaming and declared compressed sizes have hard bounds',async()=>{
 const env=environment(),data=dataset();data.manifest.compressed_bytes=6*MIB+1;
 assert.equal((await publish(env,data)).status,413);
 let cancelled=false;const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8*MIB));controller.enqueue(new Uint8Array(1))},cancel(){cancelled=true}});
 const streamed=new Request('https://course.test/_knowledge-admin/import',{method:'POST',headers:{Authorization:'Bearer '+TOKEN},body,duplex:'half'});
 assert.equal((await handleCourseKnowledgePublish(streamed,env)).status,413);assert.equal(cancelled,true);assert.equal(env.BUCKET.calls.length,0);
 assert.equal((await handleCourseKnowledgePublish(request(dataset(),TOKEN,{headers:{'content-length':String(8*MIB+1)}}),env)).status,413);
});

test('a gzip expansion bomb is stopped even if the declared expanded size lies',async()=>{
 const env=environment(),data=dataset();replaceCompressed(data,gzipSync(Buffer.alloc(16*MIB+1,0x20)));data.manifest.uncompressed_bytes=1000;
 assert.equal((await publish(env,data)).status,413);assert.equal(env.BUCKET.calls.length,0);
});

test('chunk count, Unicode text limit, duplicate ids and actual coverage are enforced',async()=>{
 const invalid=[
  dataset([row({text:'🌊'.repeat(4001)})]),
  dataset([row(),row()]),
  dataset(Array.from({length:12001},(_,index)=>row({id:'D-S01-limit'+index}))),
  (()=>{const value=dataset();value.manifest.source_coverage[0].chunks=99;return value})(),
  (()=>{const value=dataset();value.manifest.indexed_pages=2;return value})(),
 ];
 for(const value of invalid){const env=environment();assert.equal((await publish(env,value)).status,422);assert.equal(env.BUCKET.calls.length,0)}
 const env=environment();assert.equal((await publish(env,dataset([row({text:'🌊'.repeat(4000),char_end:4000})]))).status,200,'Text size uses Unicode codepoints, not UTF-16 length');
});

test('private fields and absolute paths are rejected while safe schema extensions remain usable',async()=>{
 const invalid=[
  dataset([row({local_path:'C:/synthetic/private.pdf'})]),
  dataset([row({api_key:'synthetic-private-value'})]),
  (()=>{const value=dataset();value.manifest.schema={api_key:'synthetic-private-value'};return value})(),
  (()=>{const value=dataset();value.manifest.schema={local_path:'C:/synthetic/private.pdf'};return value})(),
  (()=>{const value=dataset();value.manifest.schema={filename:'C:/synthetic/private.pdf'};return value})(),
 ];
 for(const value of invalid){const env=environment();assert.equal((await publish(env,value)).status,422);assert.equal(env.BUCKET.calls.length,0)}
 for(const version of ['../escape','UPPERCASE','v.'+'a'.repeat(79),'a'.repeat(81)]){const env=environment();assert.equal((await publish(env,dataset(undefined,version))).status,422);assert.equal(env.BUCKET.calls.length,0)}
});

test('same-content publication is idempotent, including the active pointer timestamp',async()=>{
 const env=environment(),data=dataset();assert.equal((await publish(env,data)).status,200);const previous=pointer(env);env.BUCKET.calls=[];
 const repeated=await publish(env,data);assert.equal(repeated.status,200);assert.equal((await repeated.json()).reused,true);assert.equal(pointer(env),previous);
 assert.equal(env.BUCKET.calls.filter(call=>call.method==='put'&&call.key==='course-knowledge/current.json').length,0);
});

test('an existing version cannot be overwritten by different chunks or manifest metadata',async()=>{
 const env=environment(),data=dataset();await publish(env,data);const previous=pointer(env),stored=Buffer.from(env.BUCKET.objects.get('course-knowledge/synthetic-v1/chunks.json.gz').bytes);
 assert.equal((await publish(env,dataset([row({text:'另一段合成测试内容。'})]))).status,409);
 const changed=dataset();changed.manifest.schema={encoding:'another-safe-encoding'};assert.equal((await publish(env,changed)).status,409);
 assert.equal(pointer(env),previous);assert.deepEqual(env.BUCKET.objects.get('course-knowledge/synthetic-v1/chunks.json.gz').bytes,stored);
 const next=dataset([row({text:'新版本合成内容。'})],'synthetic-v2');assert.equal((await publish(env,next)).status,200);assert.equal(JSON.parse(pointer(env)).version,'synthetic-v2');assert.deepEqual(env.BUCKET.objects.get('course-knowledge/synthetic-v1/chunks.json.gz').bytes,stored);
});

test('storage write failures never activate incomplete data and a retry resumes immutable objects',async()=>{
 for(const target of ['chunks.json.gz','manifest.json','current.json']){
  const env=environment(),data=dataset(),old=JSON.stringify({schema_version:1,version:'previous'});env.BUCKET.objects.set('course-knowledge/current.json',{bytes:Buffer.from(old),metadata:{}});
  env.BUCKET.failKey=target==='current.json'?'course-knowledge/current.json':'course-knowledge/synthetic-v1/'+target;
  const failed=await publish(env,data);assert.equal(failed.status,503);assert.equal(pointer(env),old,'The previous active pointer survives '+target+' failure');
  env.BUCKET.failKey=null;assert.equal((await publish(env,data)).status,200);assert.equal(JSON.parse(pointer(env)).version,'synthetic-v1');
 }
});

test('concurrent conflicting content has one immutable winner, and stored bytes are rechecked on replay',async()=>{
 const env=environment(),candidates=[dataset(),dataset([row({text:'并发合成内容。'})])];
 const responses=await Promise.all(candidates.map(data=>publish(env,data)));assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
 const winner=responses.findIndex(response=>response.status===200),key='course-knowledge/synthetic-v1/chunks.json.gz';
 assert.equal(sha(env.BUCKET.objects.get(key).bytes),candidates[winner].manifest.chunks_sha256);
 const previous=pointer(env),corrupt=Buffer.from(env.BUCKET.objects.get(key).bytes);corrupt[corrupt.length-1]^=1;env.BUCKET.objects.get(key).bytes=corrupt;
 assert.equal((await publish(env,candidates[winner])).status,409,'Old customMetadata cannot conceal corrupt stored bytes');assert.equal(pointer(env),previous);
});
