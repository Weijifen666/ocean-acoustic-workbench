import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCodeArtifacts,executeCodeTool,sourceHash,validateCode,CODE_TOOL_SPECS} from '../server/code-artifacts.mjs';
import {RESEARCH_TOOLS} from '../server/cloud-research.mjs';
import {setup,encrypt,decrypt} from './test-support.mjs';

const source={title:'声速分析',language:'python',code:'print("声速")\n',input_csv:'depth,speed\n0,1500\n'};
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQv0AAAAASUVORK5CYII=';
const fixture=()=>{const s=setup(),store=createCodeArtifacts({encrypt,decrypt});return {...s,store};};
const receipt=async record=>({status:'succeeded',stdout:'样本1\n',stderr:'',code_sha256:await sourceHash(record.code),input_sha256:await sourceHash(record.input_csv),runtime:'pyodide-314.0.7',seconds:1.2,warnings:['示例数据'],artifacts:[{name:'profile.png',mime:'image/png',base64:PNG},{name:'summary.json',mime:'application/json',text:'{"samples":1}'}]});

test('code documents are private, encrypted, revisioned and never execute source',async()=>{
 const {store,env,sqlite}=fixture();try{
  const a=await store.save(env,'visitor-a',source);assert.equal(a.revision,1);assert.equal(a.result,null);assert.equal(a.code_sha256,await sourceHash(a.code));
  assert(!sqlite.prepare('SELECT ciphertext FROM code_artifacts').get().ciphertext.includes(source.code));
  assert.deepEqual(await store.read(env,'visitor-a',a.id),a);
  assert.deepEqual(await store.list(env,'visitor-b'),[]);await assert.rejects(store.read(env,'visitor-b',a.id),e=>e.status===404);
  const listed=(await store.list(env,'visitor-a'))[0];assert.equal(listed.id,a.id);assert(!('code' in listed));assert(!('input_csv' in listed));
  const attempts=await Promise.allSettled(['one','two'].map(title=>store.save(env,'visitor-a',{...source,title,expected_revision:1},a.id)));
  assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);assert.equal(attempts.find(item=>item.status==='rejected').reason.status,409);
  assert.equal((await store.read(env,'visitor-a',a.id)).revision,2);
 }finally{sqlite.close();}
});

test('results bind exact code and CSV hashes, retain metadata and cannot claim authority',async()=>{
 const {store,env,sqlite}=fixture();try{
  const a=await store.save(env,'visitor-a',source),result={...await receipt(a),server_verified:true,provenance:'server',physical_accuracy:'proven'};
  for(const field of ['code_sha256','input_sha256'])await assert.rejects(store.save(env,'visitor-a',{expected_revision:1,result:{...result,[field]:'0'.repeat(64)}},a.id,true),e=>e.status===409);
  const saved=await store.save(env,'visitor-a',{expected_revision:1,result},a.id,true);
  assert.equal(saved.revision,2);assert.equal(saved.result.source_revision,1);assert.equal(saved.result.runtime,'pyodide-314.0.7');assert.equal(saved.result.seconds,1.2);
  assert.deepEqual(saved.result.warnings,['示例数据']);assert.equal(saved.result.provenance,'browser_client_report');assert.equal(saved.result.server_verified,false);assert.equal(saved.result.physical_accuracy,'not_established');
  assert.equal(saved.result.artifacts[0].data_base64,PNG);assert(!('base64' in saved.result.artifacts[0]));
  await assert.rejects(store.save(env,'visitor-b',{expected_revision:2,result},a.id,true),e=>e.status===404);
  const edited=await store.save(env,'visitor-a',{...source,input_csv:'depth,speed\n0,1490\n',expected_revision:2},a.id);
  assert.equal(edited.result,null);await assert.rejects(store.save(env,'visitor-a',{expected_revision:3,result},a.id,true),e=>e.status===409);
 }finally{sqlite.close();}
});

test('failed/cancelled results stay failed/cancelled and unsafe or oversized artifacts fail',async()=>{
 const {store,env,sqlite}=fixture();try{
  let a=await store.save(env,'visitor-a',source);
  for(const status of ['cancelled','failed','stopped','timed_out']){a=await store.save(env,'visitor-a',{expected_revision:a.revision,result:{...await receipt(a),status}},a.id,true);assert.equal(a.result.status,status);}
  const good=await receipt(a);
  for(const artifacts of [[{name:'x.svg',mime:'image/svg+xml',text:'<svg/>'}],[{name:'../x.png',mime:'image/png',base64:PNG}],[{name:'x.png',mime:'image/png',base64:btoa('not a png')}],[{name:'x.csv',mime:'text/csv',text:'x'.repeat(150001)}]])await assert.rejects(store.save(env,'visitor-a',{expected_revision:a.revision,result:{...good,artifacts}},a.id,true),e=>e.status===422);
  await assert.rejects(store.save(env,'visitor-a',{expected_revision:a.revision,result:{...good,status:'unknown'}},a.id,true),e=>e.status===422);
  assert.throws(()=>validateCode({...source,code:'中'.repeat(16667)}),e=>e.status===422);
  assert.throws(()=>validateCode({...source,input_csv:'x'.repeat(100001)}),e=>e.status===422);
 }finally{sqlite.close();}
});

test('model tools page real sources and text results, never expose PNG base64 or write results',async()=>{
 const {store,env,sqlite}=fixture();try{
  const code=('#中文说明\n').repeat(180),saved=await executeCodeTool(store,'write_code_artifact',{...source,code,result:{status:'succeeded'}},env,'visitor-a');
  assert.equal(saved.input_contract.delivery,'python_module_globals');assert.equal(saved.input_contract.environment_variable,false);
  assert.deepEqual(saved.input_contract.variables,['input_csv','INPUT_CSV']);assert.equal(saved.input_contract.working_directory_file,'input.csv');assert.equal(saved.input_contract.requires_explicit_run,true);
  assert.equal(saved.executed,false);assert.equal(saved.workspace_url,'/#code/'+saved.id);
  assert.equal((await store.read(env,'visitor-a',saved.id)).result,null);
  const page=await executeCodeTool(store,'read_code_artifact',{id:saved.id,max_bytes:256},env,'visitor-a');assert(page.has_more);assert(page.returned_bytes<=256);assert(code.startsWith(page.content));assert.deepEqual(page.input_contract,saved.input_contract);
  const next=await executeCodeTool(store,'read_code_artifact',{id:saved.id,offset:page.next_offset,max_bytes:256},env,'visitor-a');assert.equal(page.content+next.content,Array.from(code).slice(0,next.next_offset).join(''));
  const row=await store.read(env,'visitor-a',saved.id);await store.save(env,'visitor-a',{expected_revision:1,result:await receipt(row)},saved.id,true);
  const report=await executeCodeTool(store,'read_code_result',{id:saved.id},env,'visitor-a');assert.equal(report.content,'样本1\n');assert.equal(report.server_verified,false);assert.equal(report.artifacts[0].bytes,68);assert(!JSON.stringify(report).includes(PNG));
  const file=await executeCodeTool(store,'read_code_result',{id:saved.id,field:'file',name:'summary.json'},env,'visitor-a');assert.equal(file.content,'{"samples":1}');
  const image=await executeCodeTool(store,'read_code_result',{id:saved.id,field:'file',name:'profile.png'},env,'visitor-a');assert(image.content_unavailable);assert(!JSON.stringify(image).includes(PNG));
  await assert.rejects(executeCodeTool(store,'read_code_artifact',{id:saved.id},env,'visitor-b'),e=>e.status===404);
  assert.equal(new Set(CODE_TOOL_SPECS.map(item=>item.function.name)).size,4);
 }finally{sqlite.close();}
});

test('HTTP contract uses array lists, aliases PNG, rejects stale revisions and deletes only own rows',async()=>{
 const {store,env,sqlite}=fixture();const request=(path,method='GET',body)=>store.handle(new Request('https://course.test/api/research/code/artifacts'+path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})}),env,'visitor-a');
 try{
  const a=await (await request('','POST',source)).json();assert.equal(a.revision,1);assert(Array.isArray(await (await request('')).json()));
  const result=await receipt(a);result.artifacts[0]={name:'profile.png',mime:'image/png',data_base64:PNG};
  const updated=await (await request('/'+a.id+'/results','POST',{expected_revision:1,result})).json();assert.equal(updated.result.artifacts[0].data_base64,PNG);
  await assert.rejects(request('/'+a.id,'POST',{...source,expected_revision:1}),e=>e.status===409);
  assert.deepEqual(await (await request('/'+a.id,'DELETE')).json(),{deleted:true});await assert.rejects(request('/'+a.id),e=>e.status===404);
 }finally{sqlite.close();}
});

test('replaying one durable create call reuses its document without overwriting edits',async()=>{
 const {store,env,sqlite}=fixture();try{
  const options={request_key:'run-0001:1:call-create'};
  const writes=await Promise.all([executeCodeTool(store,'write_code_artifact',source,env,'visitor-a',options),executeCodeTool(store,'write_code_artifact',source,env,'visitor-a',options)]);
  assert.equal(writes[0].id,writes[1].id);assert.equal((await store.list(env,'visitor-a')).length,1);
  const edited=await executeCodeTool(store,'write_code_artifact',{...source,input_csv:undefined,id:writes[0].id,expected_revision:1,code:'print("user edited")'},env,'visitor-a');
  assert.equal((await store.read(env,'visitor-a',edited.id)).input_csv,source.input_csv);
  const replay=await executeCodeTool(store,'write_code_artifact',source,env,'visitor-a',options);assert(replay.reused);assert.equal(replay.revision,2);
  assert.equal((await store.read(env,'visitor-a',replay.id)).code,'print("user edited")');
  await assert.rejects(executeCodeTool(store,'write_code_artifact',{...source,code:'print("different")'},env,'visitor-a',options),e=>e.status===409);
 }finally{sqlite.close();}
});

test('public visitor routing exposes document APIs and tools without a private compute node',async()=>{
 const assets=JSON.parse(readFileSync(new URL('../data/research-assets.json',import.meta.url),'utf8'));
 const s=setup(undefined,{researchAssets:assets});try{
  const a=await s.call('/api/config'),b=await s.call('/api/config');
  const created=await s.call('/api/research/code/artifacts','POST',source,a.cookie);assert.equal(created.r.status,200,JSON.stringify(created.data));
  assert.equal((await s.call('/api/research/code/artifacts','GET',undefined,b.cookie)).data.length,0);
  assert.equal((await s.call('/api/research/code/artifacts/'+created.data.id,'GET',undefined,b.cookie)).r.status,404);
  const uploaded=await s.call('/api/research/code/artifacts/'+created.data.id+'/results','POST',{expected_revision:1,result:await receipt(created.data)},a.cookie);assert.equal(uploaded.r.status,200,JSON.stringify(uploaded.data));assert.equal(uploaded.data.result.server_verified,false);
  assert.equal((await s.call('/api/research/code/artifacts/'+created.data.id,'DELETE',undefined,b.cookie)).r.status,404);
  assert.equal((await s.call('/api/research/code/artifacts/'+created.data.id,'PUT',{},a.cookie)).r.status,405);
  for(const spec of CODE_TOOL_SPECS)assert(RESEARCH_TOOLS.some(item=>item.function.name===spec.function.name));
 }finally{s.sqlite.close();}
});
