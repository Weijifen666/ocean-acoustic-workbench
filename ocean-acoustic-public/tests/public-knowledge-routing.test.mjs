import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setup} from './test-support.mjs';
import {createPublicOceanKnowledge} from '../server/open-ocean-retrieval.mjs';
const sources=JSON.parse(fs.readFileSync(new URL('../data/open-ocean-sources.json',import.meta.url),'utf8'));
const chunks=JSON.parse(fs.readFileSync(new URL('../data/open-ocean-chunks.json',import.meta.url),'utf8'));
const publicKnowledge=createPublicOceanKnowledge({sources,chunks});

test('public ocean evidence remains searchable without the private node or a model key',async()=>{
 const state=setup(undefined,{publicKnowledge});
 const first=await state.call('/api/config');
 const answer=await state.call('/api/chat','POST',{message:'海洋酸化如何影响珊瑚礁',knowledge_mode:'general',context_budget:8192},first.cookie);
 assert.equal(answer.r.status,200);assert.equal(answer.data.model_used,false);
 assert.ok(answer.data.evidence.some(row=>row.evidence_type==='public_web_excerpt'));
 assert.match(answer.data.retrieval.scope,/公开网页快照/);assert.ok(answer.data.retrieval.methods.includes('RRF'));
 assert.ok(answer.data.citations.some(row=>row.url?.startsWith('https://oceanservice.noaa.gov/')));
 assert.match(answer.data.coverage_notice,/未调用模型/);
 assert.equal(answer.data.context.applied,false);assert.equal(answer.data.context.budget_tokens,8192);
 assert.ok(answer.data.citations.filter(row=>row.url?.startsWith('https://')).every(row=>row.fetched_at));
 state.sqlite.close();
});

test('source status separates official excerpts, editorial guides and unconnected data services',async()=>{
 const state=setup(undefined,{publicKnowledge}),first=await state.call('/api/config');
 const status=await state.call('/api/knowledge/status','GET',undefined,first.cookie);
 assert.equal(status.data.indexed_pages,0);assert.equal(status.data.public_ocean.successful_web_documents,30);
 assert.equal(status.data.public_ocean.reference_guides,9);assert.equal(status.data.public_ocean.indexed_sources,39);
 assert.equal(status.data.public_ocean.realtime_observations_connected,false);
 const rows=await state.call('/api/knowledge/public-sources','GET',undefined,first.cookie);
 assert.equal(rows.data.length,42);assert.equal(rows.data.filter(row=>row.content_policy==='metadata_only').length,3);
 assert.ok(rows.data.every(row=>row.url.startsWith('https://')&&row.license));
 state.sqlite.close();
});

test('an exact Munk course concept stays first when the node is offline',async()=>{
 const state=setup(undefined,{publicKnowledge}),first=await state.call('/api/config');
 const answer=await state.call('/api/chat','POST',{message:'Munk 声速剖面',knowledge_mode:'course'},first.cookie);
 assert.equal(answer.r.status,200);assert.equal(answer.data.model_used,false);
 assert.equal(answer.data.evidence[0].node_id,'munk_profile');state.sqlite.close();
});

test('actual model context retains public snapshot provenance and reports measured usage separately',async()=>{
 let sent;const state=setup(async(url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({model:'test-model',usage:{prompt_tokens:128,prompt_cache_hit_tokens:0},choices:[{message:{content:'TEST ONLY'}}]}),{headers:{'content-type':'application/json'}})},{publicKnowledge});
 const first=await state.call('/api/config');
 await state.call('/api/config','PUT',{provider:'DeepSeek',base_url:'https://api.deepseek.com',model:'deepseek-flash',api_key:'TEST-ONLY-PUBLIC-CONTEXT'},first.cookie);
 const answer=await state.call('/api/chat','POST',{message:'海洋酸化如何影响珊瑚礁',knowledge_mode:'general',context_budget:32768},first.cookie);
 assert.equal(answer.r.status,200);assert.ok(answer.data.model_used);
 assert.ok(answer.data.evidence.some(row=>row.snapshot_not_realtime&&row.fetched_at));
 assert.ok(sent.messages[0].content.includes('fetched_at'));assert.ok(sent.messages[0].content.includes('source_updated_at'));
 assert.ok(answer.data.context.estimated_input_tokens<=32768-1024);
 assert.equal(answer.data.context.provider_prompt_tokens,128);assert.equal(answer.data.context.cached_tokens,0);
 assert.ok(answer.data.citations.every(row=>answer.data.evidence.some(e=>e.id===row.id)));
 const stored=await state.call('/api/chat/history','GET',undefined,first.cookie);
 assert.equal(stored.data.at(-1).context.cached_tokens,0);state.sqlite.close();
});
