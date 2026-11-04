import test from 'node:test';
import assert from 'node:assert/strict';
import {researchStepStream} from '../server/research-step-stream.mjs';
import {setup} from './test-support.mjs';
import {readFileSync} from 'node:fs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const request=signal=>new Request('https://course.test/api/research/runs/research-example/step',{method:'POST',body:'{}',...(signal?{signal}:{})});

test('long step sends headers and heartbeat before work completes, then its actual response',async()=>{
 const work=deferred();let started=0;
 const response=researchStepStream(request(),async scoped=>{started++;assert.equal(await scoped.text(),'{}');await work.promise;return Response.json({id:'research-example',state:'done',reply:'完整答案'})});
 assert.match(response.headers.get('content-type'),/application\/x-ndjson/);
 const reader=response.body.getReader(),decoder=new TextDecoder();
 assert.deepEqual(JSON.parse(decoder.decode((await reader.read()).value)),{type:'heartbeat'});
 assert.equal(started,1);work.resolve();
 const frames=decoder.decode((await reader.read()).value).trim().split('\n').map(JSON.parse);
 assert.deepEqual(frames,[{type:'response',status:200,body:{id:'research-example',state:'done',reply:'完整答案'}}]);
 assert.equal((await reader.read()).done,true);
});

test('stream keeps structured response status, and hides unexpected internal exception details',async()=>{
 let response=researchStepStream(request(),async()=>Response.json({detail:'预算不足',code:'CONTEXT_BUDGET_EXCEEDED'},{status:422}));
 let frames=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(frames.at(-1),{type:'response',status:422,body:{detail:'预算不足',code:'CONTEXT_BUDGET_EXCEEDED'}});
 response=researchStepStream(request(),async()=>{throw new Error('secret internal request metadata')});
 frames=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.equal(frames.at(-1).status,503);assert.ok(!JSON.stringify(frames).includes('secret'));
});

test('cancelling the response aborts exactly the in-flight step; late completion cannot enqueue',async()=>{
 const work=deferred();let signal;
 const response=researchStepStream(request(),async scoped=>{signal=scoped.signal;await work.promise;return Response.json({state:'done'})});
 const reader=response.body.getReader();await reader.read();await reader.cancel();assert.equal(signal.aborted,true);
 work.resolve();await new Promise(resolve=>setImmediate(resolve));
});

test('parent disconnect aborts the step and clears its heartbeat',async()=>{
 const parent=new AbortController(),work=deferred();let signal;
 const response=researchStepStream(request(parent.signal),async scoped=>{signal=scoped.signal;await work.promise;return Response.json({state:'done'})});
 const reader=response.body.getReader();await reader.read();parent.abort();assert.equal(signal.aborted,true);
 await assert.rejects(reader.read(),error=>error.name==='AbortError');work.resolve();
});

test('cloud research dispatch negotiates a live stream and preserves the visitor cookie and durable result',async()=>{
 const work=deferred(),entered=deferred();let calls=0;
 const assets=JSON.parse(readFileSync(new URL('../data/research-assets.json',import.meta.url),'utf8'));
 const app=setup(async()=>{calls++;entered.resolve();await work.promise;return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'完整研究结论'}}]})},{researchAssets:assets});
 try{
  const visitor=await app.call('/api/config');
  await app.call('/api/config','PUT',{provider:'DeepSeek',model:'deepseek-flash',base_url:'https://api.deepseek.com',api_key:'TEST-ONLY-STREAM-KEY'},visitor.cookie);
  const created=await app.call('/api/research/chat','POST',{session:'stream-session-123',request_id:'stream-request-123',backend:'api',message:'什么是简正波',rounds:0},visitor.cookie);
  const url=new URL('/api/research/runs/'+created.data.id+'/step','https://course.test');
  const response=await app.handler(new Request(url,{method:'POST',headers:{accept:'application/x-ndjson',origin:url.origin,cookie:visitor.cookie,'Content-Type':'application/json'},body:'{}'}),app.env,app.ctx,url);
  assert.match(response.headers.get('set-cookie'),/^ocean_visitor=/);
  const reader=response.body.getReader(),decoder=new TextDecoder();
  assert.deepEqual(JSON.parse(decoder.decode((await reader.read()).value)),{type:'heartbeat'});
  await entered.promise;assert.equal(calls,1);
  const active=await app.call('/api/research/runs/'+created.data.id,'GET',undefined,visitor.cookie);
  assert.equal(active.data.step_busy,true);
  work.resolve();
  const final=JSON.parse(decoder.decode((await reader.read()).value));
  assert.equal(final.status,200);assert.equal(final.body.state,'done');assert.equal(final.body.reply,'完整研究结论');assert.equal(final.body.step_busy,false);
  assert.equal((await reader.read()).done,true);
  const history=await app.call('/api/research/history?session=stream-session-123','GET',undefined,visitor.cookie);
  assert.equal(history.data.at(-1).text,'完整研究结论');
 }finally{work.resolve();app.sqlite.close()}
});
