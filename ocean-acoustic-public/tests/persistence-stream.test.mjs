import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,encrypt,decrypt} from './test-support.mjs';
import {createChatStore} from '../server/chat-store.mjs';
import {readProviderStream} from '../server/provider-stream.mjs';

const frame=p=>'data: '+JSON.stringify(p)+'\n\n';
function streamResponse(){return new Response(frame({model:'returned-model',choices:[{delta:{reasoning_content:'PRIVATE REASONING',content:'声速'},finish_reason:null}]})+frame({model:'returned-model',choices:[{delta:{content:'剖面'},finish_reason:'stop'}],usage:{prompt_tokens:200,prompt_cache_hit_tokens:0}})+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})}
async function direct(s,path,body,cookie,extra={}){
 const url=new URL(path,'https://course.test'),headers={origin:url.origin,'content-type':'application/json',cookie,...extra};
 return s.handler(new Request(url,{method:'POST',headers,body:JSON.stringify(body)}),s.env,s.ctx,url);
}

test('legacy history migrates once; encrypted messages remain separate from provider settings',async()=>{
 const s=setup();try{
  const a=await s.call('/api/config'),id=a.cookie.split('=')[1],state=await decrypt(s.sqlite.prepare('SELECT ciphertext FROM cloud_visitors WHERE id=?').get(id).ciphertext,s.env.GATEWAY_SECRET);
  state.history=[{role:'user',text:'LEGACY PRIVATE QUESTION'},{role:'assistant',text:'LEGACY PRIVATE ANSWER'}];
  s.sqlite.prepare('UPDATE cloud_visitors SET ciphertext=? WHERE id=?').run(await encrypt(state,s.env.GATEWAY_SECRET),id);
  const first=await s.call('/api/chat/history','GET',undefined,a.cookie);assert.equal(first.data.length,2);
  await s.call('/api/chat/history','GET',undefined,a.cookie);assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_messages').get().n,2);
  assert(!JSON.stringify(s.sqlite.prepare('SELECT ciphertext FROM cloud_messages').all()).includes('LEGACY PRIVATE'));
 }finally{s.sqlite.close()}
});

test('independent conversations retain their own history and reject another visitor',async()=>{
 const s=setup();try{
  const a=await s.call('/api/config'),b=await s.call('/api/config'),first=await s.call('/api/conversations','GET',undefined,a.cookie),id1=first.data.selected_id;
  await s.call('/api/chat','POST',{message:'Munk 声速剖面',conversation_id:id1},a.cookie);
  const c=await s.call('/api/conversations','POST',{title:'频率实验'},a.cookie);assert.equal(c.r.status,200);
  assert.deepEqual((await s.call('/api/chat/history','GET',undefined,a.cookie)).data,[]);
  await s.call('/api/chat','POST',{message:'声源深度',conversation_id:c.data.id},a.cookie);
  const old=await s.call('/api/chat/history?conversation_id='+id1,'GET',undefined,a.cookie);assert.equal(old.data.length,2);assert.equal(old.data[0].text,'Munk 声速剖面');
  const denied=await s.call('/api/chat/history?conversation_id='+id1,'GET',undefined,b.cookie);assert.equal(denied.r.status,404);
  assert.equal((await s.call('/api/conversations/selected','PUT',{id:id1},b.cookie)).r.status,404);
 }finally{s.sqlite.close()}
});

test('indexed history is not silently discarded after forty messages or eighty thousand characters',async()=>{
 const s=setup();try{
  const a=await s.call('/api/config'),visitor=a.cookie.split('=')[1],store=createChatStore(s.env,encrypt,decrypt),conversation=await store.ensure(visitor);
  for(let i=0;i<30;i++){const token=await store.begin(visitor,conversation,'request-'+i,{i});await store.finish(token,'Q'+i+'x'.repeat(1500),{reply:'A'+i+'y'.repeat(2000),model_used:false})}
  const rows=await store.history(visitor,conversation);assert.equal(rows.length,60);assert.match(rows[0].text,/^Q0/);assert.match(rows.at(-1).text,/^A29/);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_messages').get().n,60);
 }finally{s.sqlite.close()}
});

test('an idempotent completion is replayed without another provider charge or duplicate messages',async()=>{
 let calls=0;const s=setup(async()=>{calls++;return new Response(JSON.stringify({model:'test',choices:[{message:{content:'once'}}]}))});
 try{
  const a=await s.call('/api/config');await s.call('/api/config','PUT',{api_key:'TEST-ONLY-IDEMPOTENT'},a.cookie);
  const body={message:'Munk 声速剖面'},key={'idempotency-key':'same-request-1234'};
  const first=await direct(s,'/api/chat',body,a.cookie,key);assert.equal(first.status,200);const answer=await first.json();
  const replay=await direct(s,'/api/chat',body,a.cookie,key);assert.equal(replay.status,200);assert.equal((await replay.json()).request_id,answer.request_id);
  assert.equal(calls,1);assert.equal((await s.call('/api/chat/history','GET',undefined,a.cookie)).data.length,2);
  assert.equal((await direct(s,'/api/chat',{message:'不同问题'},a.cookie,key)).status,409);
 }finally{s.sqlite.close()}
});

test('SSE emits real supplier deltas, actual identity and cache zero; history is committed on done',async()=>{
 const bodies=[];const s=setup(async(url,options)=>{bodies.push(JSON.parse(options.body));return streamResponse()});try{
  const a=await s.call('/api/config');await s.call('/api/config','PUT',{api_key:'TEST-ONLY-STREAM'},a.cookie);
  const response=await direct(s,'/api/chat',{message:'Munk 声速剖面',stream:true},a.cookie);assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const text=await response.text();assert.match(text,/event: delta/);assert(!text.includes('PRIVATE REASONING'));
  const done=text.split('\n\n').find(s=>s.startsWith('event: done'));assert(done);const answer=JSON.parse(done.split('\ndata: ')[1]);
  assert.equal(answer.reply,'声速剖面');assert.equal(answer.response_model,'returned-model');assert.equal(answer.context.cached_tokens,0);assert.equal(answer.context.provider_prompt_tokens,200);
  assert.equal(bodies[0].stream,true);assert.equal((await s.call('/api/chat/history','GET',undefined,a.cookie)).data.at(-1).text,'声速剖面');
 }finally{s.sqlite.close()}
});

test('cancelling the SSE body aborts the upstream request and never saves a completed answer',{timeout:5000},async()=>{
 let observedAbort;const aborted=new Promise(r=>{observedAbort=r});
 const s=setup(async(url,options)=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(frame({model:'test',choices:[{delta:{content:'partial'}}]})));options.signal.addEventListener('abort',()=>{observedAbort();try{controller.close()}catch{}},{once:true})}}),{headers:{'content-type':'text/event-stream'}}));
 try{
  const a=await s.call('/api/config');await s.call('/api/config','PUT',{api_key:'TEST-ONLY-CANCEL'},a.cookie);
  const response=await direct(s,'/api/chat',{message:'Munk 声速剖面',stream:true},a.cookie),reader=response.body.getReader();let read='';
  while(!read.includes('event: delta')){const item=await reader.read();assert(!item.done);read+=new TextDecoder().decode(item.value)}
  await reader.cancel();await aborted;
  assert.equal((await s.call('/api/chat/history','GET',undefined,a.cookie)).data.length,0);
  assert.equal(s.sqlite.prepare('SELECT state FROM cloud_chat_runs').get().state,'cancelled');
 }finally{s.sqlite.close()}
});

test('truncated provider stream errors instead of committing a partial completion',{timeout:5000},async()=>{
 const s=setup(async()=>new Response(frame({choices:[{delta:{content:'partial'}}]}),{headers:{'content-type':'text/event-stream'}}));try{
  const a=await s.call('/api/config');await s.call('/api/config','PUT',{api_key:'TEST-ONLY-TRUNCATED'},a.cookie);
  const response=await direct(s,'/api/chat',{message:'Munk 声速剖面',stream:true},a.cookie),text=await response.text();assert.match(text,/event: error/);assert(!text.includes('event: done'));
  assert.equal((await s.call('/api/chat/history','GET',undefined,a.cookie)).data.length,0);
 }finally{s.sqlite.close()}
});

test('today regional numeric queries abstain even with a configured general model',async()=>{
 let calls=0;const s=setup(async()=>{calls++;throw Error('must not call')});try{
  const a=await s.call('/api/config');await s.call('/api/config','PUT',{api_key:'TEST-ONLY-NUMERIC'},a.cookie);
  const result=await s.call('/api/chat','POST',{message:'今天东海一千米深海水声速是多少',knowledge_mode:'general'},a.cookie);
  assert.equal(result.r.status,200);assert.equal(result.data.coverage_status,'missing_observation_data');assert.equal(result.data.model_used,false);assert.equal(calls,0);
 }finally{s.sqlite.close()}
});

test('provider SSE parser tolerates UTF-8 chunks split across individual bytes',async()=>{
 const encoded=new TextEncoder().encode(frame({model:'test',choices:[{delta:{content:'海洋🌊'},finish_reason:'stop'}]})+'data: [DONE]\n\n'),chunks=[];
 const response=new Response(new ReadableStream({start(c){for(const byte of encoded)c.enqueue(new Uint8Array([byte]));c.close()}}));
 const answer=await readProviderStream(response,t=>chunks.push(t));assert.equal(answer.reply,'海洋🌊');assert.equal(chunks.join(''),'海洋🌊');
});

test('a cancellation which wins the database transaction prevents both completion messages',async()=>{
 const s=setup();try{
  const a=await s.call('/api/config'),visitor=a.cookie.split('=')[1],store=createChatStore(s.env,encrypt,decrypt),conversation=await store.ensure(visitor),token=await store.begin(visitor,conversation,'cancel-before-commit',{message:'x'});
  await store.abandon(token,'cancelled');await assert.rejects(()=>store.finish(token,'question',{reply:'answer'}),e=>e.code==='CANCELLED');
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_messages').get().n,0);assert.equal(s.sqlite.prepare('SELECT state FROM cloud_chat_runs').get().state,'cancelled');
 }finally{s.sqlite.close()}
});

test('supplier output limit is saved and displayed as a truncated completion',async()=>{
 const s=setup(async()=>new Response(frame({model:'test',choices:[{delta:{content:'unfinished'},finish_reason:'length'}]})+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}));try{
  const a=await s.call('/api/config');await s.call('/api/config','PUT',{api_key:'TEST-ONLY-LENGTH'},a.cookie);
  const response=await direct(s,'/api/chat',{message:'Munk 声速剖面',stream:true},a.cookie),text=await response.text(),done=text.split('\n\n').find(x=>x.startsWith('event: done')),answer=JSON.parse(done.split('\ndata: ')[1]);
  assert.equal(answer.finish_reason,'length');assert.equal(answer.completion_status,'truncated');assert.match(answer.completion_notice,/截断/);
  assert.equal((await s.call('/api/chat/history','GET',undefined,a.cookie)).data.at(-1).completion_status,'truncated');
 }finally{s.sqlite.close()}
});

test('cancelling a JSON chat request also aborts provider transport',{timeout:5000},async()=>{
 let started;const began=new Promise(r=>{started=r});let aborted=false;
 const s=setup(async(url,options)=>{started();return await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(new Error('aborted'),{name:'AbortError'}))},{once:true})})});
 try{
  const a=await s.call('/api/config');await s.call('/api/config','PUT',{api_key:'TEST-ONLY-JSON-CANCEL'},a.cookie);
  const url=new URL('/api/chat','https://course.test'),controller=new AbortController();
  const pending=s.handler(new Request(url,{method:'POST',signal:controller.signal,headers:{origin:url.origin,'content-type':'application/json',cookie:a.cookie},body:JSON.stringify({message:'Munk 声速剖面'})}),s.env,s.ctx,url);
  await began;controller.abort();await pending;assert.equal(aborted,true);
  assert.equal((await s.call('/api/chat/history','GET',undefined,a.cookie)).data.length,0);
 }finally{s.sqlite.close()}
});
