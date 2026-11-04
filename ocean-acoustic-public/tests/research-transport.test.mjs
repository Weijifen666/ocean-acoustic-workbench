import test from 'node:test';
import assert from 'node:assert/strict';
import {researchApi} from '../src/researchTransport.js';

function transport(t,fetcher){const original=global.fetch;global.fetch=fetcher;t.after(()=>{global.fetch=original});}

test('browser fetch failure is uncertain workbench transport, not a provider rejection',async t=>{
 transport(t,async()=>{throw new TypeError('Failed to fetch')});
 await assert.rejects(researchApi('chat',{message:'question'}),error=>error.code==='WORKBENCH_NETWORK'&&error.kind==='transport'&&error.requestUnconfirmed===true&&/恢复连接/.test(error.message)&&!/密钥/.test(error.message));
});

test('body disconnect and HTML gateway/login content preserve unknown acceptance without exposing body',async t=>{
 transport(t,async()=>({ok:true,text:async()=>{throw new TypeError('private body transport detail')}}));
 await assert.rejects(researchApi('chat',{}),error=>error.code==='WORKBENCH_RESPONSE_INTERRUPTED'&&error.requestUnconfirmed&&!/private/.test(error.message));
 global.fetch=async()=>new Response('<html>private login detail</html>',{status:502,headers:{'Content-Type':'text/html'}});
 await assert.rejects(researchApi('chat',{}),error=>error.code==='WORKBENCH_RESPONSE_FORMAT'&&error.requestUnconfirmed&&!/private/.test(error.message));
});

test('structured server/provider errors retain their source and do not claim browser fetch failure',async t=>{
 transport(t,async()=>Response.json({detail:'供应商返回 HTTP 401：密钥无效或地域不匹配',code:'PROVIDER_RESPONSE'},{status:422}));
 await assert.rejects(researchApi('runs/research-run/step',{}),error=>error.code==='PROVIDER_RESPONSE'&&error.kind==='server'&&error.status===422&&!error.requestUnconfirmed&&/401/.test(error.message));
 global.fetch=async()=>Response.json({detail:'服务暂不可用',code:'UPSTREAM_UNAVAILABLE'},{status:503});
 await assert.rejects(researchApi('chat',{}),error=>error.kind==='server'&&error.requestUnconfirmed===true&&error.code==='UPSTREAM_UNAVAILABLE');
});

test('successful creation uses same-origin endpoint and exact request envelope',async t=>{
 const payload={session:'session-example',request_id:'fixed-request-id',message:'什么是简正波',knowledge_node_ids:['normal_modes']};
 transport(t,async(url,options)=>{assert.equal(url,'/api/research/chat');assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),payload);return Response.json({id:'accepted-run',state:'running'},{status:202})});
 assert.equal((await researchApi('chat',payload)).id,'accepted-run');
});

test('only explicit lifecycle cancellation aborts a request, with no transport uncertainty',async t=>{
 const controller=new AbortController();controller.abort();let calls=0;
 transport(t,async()=>{calls++;return Response.json({})});
 await assert.rejects(researchApi('runs/run',undefined,undefined,{signal:controller.signal}),error=>error.code==='WORKBENCH_CANCELLED'&&error.kind==='cancelled'&&!error.requestUnconfirmed);
 assert.equal(calls,0);
 const reading=new AbortController();
 global.fetch=async(url,options)=>{assert.equal(options.signal,reading.signal);return {ok:true,text:async()=>{reading.abort();throw new Error('aborted body')}}};
 await assert.rejects(researchApi('runs/run',undefined,undefined,{signal:reading.signal}),error=>error.code==='WORKBENCH_CANCELLED');
});

test('long-running responses are not assigned a browser deadline',async t=>{
 transport(t,async(url,options)=>{assert.equal(options.signal,undefined);await new Promise(resolve=>setImmediate(resolve));return Response.json({state:'running'})});
 assert.equal((await researchApi('runs/run/step',{})).state,'running');
});
