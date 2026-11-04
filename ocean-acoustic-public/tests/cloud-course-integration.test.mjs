import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {setup,decrypt} from './test-support.mjs';

const assets=JSON.parse(readFileSync(new URL('../data/research-assets.json',import.meta.url),'utf8'));
function corpusBucket(){
 const version='integration-test-v1',text='TEST FIXTURE: normal modes are vertical eigenfunctions of a stratified acoustic waveguide. This is synthetic test material.';
 const row={id:'D-S17-CLOUD-TEST',source_id:'S17',pdf_page:356,label:'Synthetic course fixture',text,source_revision:'a'.repeat(64),ingestion_version:2,node_id:'normal_mode_field',node_ids:['normal_mode_field'],char_start:0,char_end:text.length,offset_basis:'display_page_text_v2',text_policy:'unicode_display_preserved_search_nfkc_v2',math_layout_verified:false,evidence_type:'source_excerpt',verification_status:'source_text_unreviewed'};
 const payload=Buffer.from(JSON.stringify({schema_version:1,version,chunks:[row]})),packed=gzipSync(payload),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const manifest=Buffer.from(JSON.stringify({schema_version:1,version,ingestion_version:2,chunks_key:'chunks.json.gz',chunks_sha256:sha(packed),compressed_bytes:packed.length,uncompressed_bytes:payload.length,chunks:1,indexed_sources:1,indexed_pages:1,source_coverage:[{source_id:'S17',title:'Synthetic course fixture',source_revision:'a'.repeat(64),chunks:1,indexed_pages:1}]}));
 const prefix='course-knowledge/'+version+'/',objects=new Map([[prefix+'chunks.json.gz',packed],[prefix+'manifest.json',manifest],['course-knowledge/current.json',Buffer.from(JSON.stringify({schema_version:1,version,manifest_key:prefix+'manifest.json',manifest_sha256:sha(manifest)}))]]);
 return {get:async key=>{const bytes=objects.get(key);return bytes?{size:bytes.length,body:new Blob([bytes]).stream(),arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null}};
}

test('API research injects cloud-uploaded textbook text and course cards without contacting a local node',async()=>{
 let nodeCalls=0,providerCalls=0,sent;
 const s=setup(async(url,options)=>{providerCalls++;sent=JSON.parse(options.body);return Response.json({choices:[{message:{role:'assistant',content:'TEST FIXTURE ANSWER'}}]})},{researchAssets:assets,heartbeat:async()=>true,proxy:async()=>{nodeCalls++;throw Error('Public questions must not query local materials')}});
 s.env.BUCKET=corpusBucket();
 try{
  const visitor=await s.call('/api/config');
  await s.call('/api/config','PUT',{provider:'DeepSeek',base_url:'https://api.deepseek.com',model:'deepseek-flash',api_key:'TEST-ONLY-CLOUD-COURSE'},visitor.cookie);
  const created=await s.call('/api/research/chat','POST',{session:'cloud-course-session',request_id:'cloud-course-request',message:'什么是简正波？',backend:'api',rounds:1,context_budget:'unlimited'},visitor.cookie);
  assert.equal(created.r.status,202);assert.equal(nodeCalls,0);assert.equal(providerCalls,0);
  const record=s.sqlite.prepare('SELECT ciphertext FROM cloud_research_runs WHERE id=?').get(created.data.id),saved=await decrypt(record.ciphertext,s.env.GATEWAY_SECRET);
  assert(saved.messages[0].content.includes('K017'));
  assert(saved.messages[0].content.includes('D-S17-CLOUD-TEST'));
  assert(saved.messages[0].content.includes('vertical eigenfunctions'));
  const answer=await s.call('/api/research/runs/'+created.data.id+'/step','POST',{},visitor.cookie);
  assert.equal(answer.data.state,'done');assert.equal(providerCalls,1);assert.equal(nodeCalls,0);
  assert(sent.messages[0].content.includes('D-S17-CLOUD-TEST'));
 }finally{s.sqlite.close()}
});

test('cloud corpus status and ordinary knowledge search remain available with no desktop gateway',async()=>{
 const s=setup(undefined,{heartbeat:async()=>{throw Error('Knowledge routes must not inspect the desktop')},proxy:async()=>{throw Error('Desktop calls forbidden')}});
 s.env.BUCKET=corpusBucket();
 try{
  const visitor=await s.call('/api/config'),status=await s.call('/api/knowledge/status','GET',undefined,visitor.cookie);
  assert.equal(status.r.status,200);assert.equal(status.data.retrieval_scope,'cloud_only');assert.equal(status.data.chunks,1);assert.equal(status.data.indexed_sources,1);assert.equal(status.data.indexed_pages,1);
  const found=await s.call('/api/knowledge/search?q='+encodeURIComponent('normal-mode'),'GET',undefined,visitor.cookie);
  assert.equal(found.r.status,200);assert.equal(found.data[0].node_id,'normal_mode_field');assert(found.data.some(row=>row.id==='D-S17-CLOUD-TEST'));
  assert(found.data.every(row=>row.retrieval.local_node_used===false));
 }finally{s.sqlite.close()}
});
