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

function streamResponse(lines,{split=false}={}){
 const bytes=new TextEncoder().encode(lines),chunks=split?Array.from(bytes,value=>Uint8Array.of(value)):[bytes];
 return new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close()}}),{headers:{'Content-Type':'application/x-ndjson; charset=utf-8'}});
}

test('step requests accept heartbeat streams and decode a split UTF-8 final snapshot',async t=>{
 transport(t,async(url,options)=>{
  assert.equal(options.headers.Accept,'application/x-ndjson');
  return streamResponse('\n'+JSON.stringify({type:'heartbeat'})+'\n'+JSON.stringify({type:'heartbeat'})+'\n'+JSON.stringify({type:'response',status:200,body:{id:'run',state:'done',reply:'声场已计算完成'}})+'\n',{split:true});
 });
 assert.deepEqual(await researchApi('runs/run/step',{}),{id:'run',state:'done',reply:'声场已计算完成'});
});

test('step requests retain JSON compatibility and only step POST advertises streaming',async t=>{
 transport(t,async(url,options)=>{assert.equal(options.headers.Accept,url.endsWith('/step')&&options.method==='POST'?'application/x-ndjson':undefined);return Response.json({state:'running'})});
 await researchApi('runs/run/step',{});await researchApi('runs/run');await researchApi('chat',{});
});

test('stream final status preserves structured provider rejection and uncertain server failure',async t=>{
 transport(t,async()=>streamResponse(JSON.stringify({type:'response',status:422,body:{detail:'模型拒绝调用',error_code:'PROVIDER_RESPONSE'}})+'\n'));
 await assert.rejects(researchApi('runs/run/step',{}),error=>error.kind==='server'&&error.status===422&&error.code==='PROVIDER_RESPONSE'&&!error.requestUnconfirmed);
 global.fetch=async()=>streamResponse(JSON.stringify({type:'response',status:503,body:{detail:'暂不可用'}})+'\n');
 await assert.rejects(researchApi('runs/run/step',{}),error=>error.kind==='server'&&error.status===503&&error.requestUnconfirmed);
});

test('early EOF and malformed streams require durable reconciliation without exposing their content',async t=>{
 transport(t,async()=>streamResponse('{"type":"heartbeat"}\n'));
 await assert.rejects(researchApi('runs/run/step',{}),error=>error.code==='WORKBENCH_RESPONSE_INTERRUPTED'&&error.requestUnconfirmed);
 for(const content of ['private upstream raw response\n','{"type":"response","status":200}\n','{"type":"response","status":0,"body":{}}\n']){
  global.fetch=async()=>streamResponse(content);
  await assert.rejects(researchApi('runs/run/step',{}),error=>error.code==='WORKBENCH_RESPONSE_FORMAT'&&error.requestUnconfirmed&&!error.message.includes('private'));
 }
});

test('stream read failure is uncertain while explicit cancellation stops reconciliation',async t=>{
 transport(t,async()=>new Response(new ReadableStream({start(controller){controller.error(new TypeError('private connection error'))}}),{headers:{'Content-Type':'application/x-ndjson'}}));
 await assert.rejects(researchApi('runs/run/step',{}),error=>error.code==='WORKBENCH_RESPONSE_INTERRUPTED'&&error.requestUnconfirmed&&!error.message.includes('private'));
 const controller=new AbortController();
 global.fetch=async()=>new Response(new ReadableStream({pull(output){controller.abort();output.close()}}),{headers:{'Content-Type':'application/x-ndjson'}});
 await assert.rejects(researchApi('runs/run/step',{},undefined,{signal:controller.signal}),error=>error.code==='WORKBENCH_CANCELLED'&&!error.requestUnconfirmed);
});
