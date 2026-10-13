import assert from 'node:assert/strict';import {test} from 'node:test';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
import {createCourseRetriever} from '../server/course-retrieval.mjs';import {createCloudModels,providerFetch} from '../server/cloud-models.mjs';
const graph=JSON.parse(fs.readFileSync(new URL('../data/graph.json',import.meta.url),'utf8')),catalog=JSON.parse(fs.readFileSync(new URL('../data/models.json',import.meta.url),'utf8'));
const retrieve=createCourseRetriever(graph);
async function cryptoKey(secret){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),'AES-GCM',false,['encrypt','decrypt'])}
const encrypt=async(value,secret)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await cryptoKey(secret),new TextEncoder().encode(JSON.stringify(value))));return Buffer.concat([Buffer.from(iv),Buffer.from(data)]).toString('base64')};
const decrypt=async(value,secret)=>{const bytes=Buffer.from(value,'base64');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12)},await cryptoKey(secret),bytes.subarray(12))))};
function setup(fetcher=async()=>{throw Error('Network calls forbidden')}){
 const sqlite=new DatabaseSync(':memory:');for(const name of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(s=>s.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this},async first(){return sqlite.prepare(sql).get(...args)||null},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}}}}}};
 const env={DB,GATEWAY_SECRET:'TEST-ONLY-CLOUD-ENCRYPTION-KEY'},ctx={waitUntil(){}};
 const handler=createCloudModels({catalog,retrieve,encrypt,decrypt,heartbeat:async()=>false,proxy:async()=>{throw Error('Node should be offline')},template:'% audited example',fetcher});
 async function call(path,method='GET',body, cookie=''){
  const url=new URL(path,'https://course.test'),headers={'content-type':'application/json',origin:url.origin,...(cookie?{cookie}:{})};const r=await handler(new Request(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx,url);return {r,data:await r.clone().json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||cookie};
 }
 return {call,sqlite,env,handler,ctx};
}
test('BM25 aliases, bounded relation context, unknown query and source URL',()=>{const rows=retrieve('Munk 声速剖面');assert.equal(rows[0].node_id,'munk_profile');assert(rows.every(c=>c.citation.source_id));assert(rows.some(c=>c.citation.url?.includes('/page/')));assert.deepEqual(retrieve('世界杯足球冠军是哪国'),[]);assert(retrieve('programming basics').every(c=>c.node_id!=='ram'))});
test('offline cloud health/knowledge/chat keep evidence without a model call',async()=>{const s=setup();const c=await s.call('/api/config');assert.match(c.r.headers.get('set-cookie'),/HttpOnly; Secure/);const health=await s.call('/api/health','GET',undefined,c.cookie);assert.equal(health.data.matlab_available,false);assert.equal(health.data.cloud_model_available,true);const chat=await s.call('/api/chat','POST',{message:'Munk 声速剖面'},c.cookie);assert.equal(chat.data.model_used,false);assert(chat.data.evidence.length&&chat.data.citations.length);assert.equal((await s.call('/api/chat/history','GET',undefined,c.cookie)).data.length,2);s.sqlite.close()});
test('keys encrypted, redacted, retained per provider and isolated by visitor',async()=>{const s=setup(),a=await s.call('/api/config'),b=await s.call('/api/config');const saved=await s.call('/api/config','PUT',{api_key:'TEST-NOT-A-REAL-KEY'},a.cookie);assert(saved.data.api_key_set);assert(!JSON.stringify(saved.data).includes('TEST-NOT'));assert(!s.sqlite.prepare('SELECT ciphertext FROM cloud_visitors').all().some(r=>r.ciphertext.includes('TEST-NOT')));assert.equal((await s.call('/api/config','GET',undefined,b.cookie)).data.api_key_set,false);await s.call('/api/config','PUT',{provider:'GLM',base_url:'https://open.bigmodel.cn/api/paas/v4',model:'glm-5.3'},a.cookie);assert.equal((await s.call('/api/config','GET',undefined,a.cookie)).data.api_key_set,false);await s.call('/api/config','PUT',{provider:'Qwen',base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3.7-plus'},a.cookie);assert.equal((await s.call('/api/config','GET',undefined,a.cookie)).data.api_key_set,true);await s.call('/api/session/clear-keys','POST',{},a.cookie);assert.equal((await s.call('/api/config','GET',undefined,a.cookie)).data.api_key_set,false);s.sqlite.close()});
test('invalid provider address, missing own key, invalid JSON and cross-origin rejected',async()=>{const s=setup(),a=await s.call('/api/config');assert.equal((await s.call('/api/config','PUT',{base_url:'https://example.org/api'},a.cookie)).r.status,422);assert.equal((await s.call('/api/models/test','POST',{provider:'Qwen',model:'qwen3.7-plus'},a.cookie)).r.status,422);const url=new URL('https://course.test/api/config');const r=await s.handler(new Request(url,{method:'PUT',headers:{origin:'https://other.test'},body:'{}'}),s.env,s.ctx,url);assert.equal(r.status,403);s.sqlite.close()});
test('short model test applies provider options and hides provider response errors',async()=>{let sent;const s=setup(async(url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({model:sent.model,choices:[{message:{content:'OK'}}]}),{headers:{'content-type':'application/json'}})}),a=await s.call('/api/config');const r=await s.call('/api/models/test','POST',{provider:'GLM',base_url:'https://open.bigmodel.cn/api/paas/v4',model:'glm-5.3',api_key:'TEST-ONLY-KEY'},a.cookie);assert.equal(r.r.status,200);assert.equal(sent.max_tokens,256);assert.deepEqual(sent.thinking,{type:'enabled'});s.sqlite.close();const blocked=setup(async()=>new Response('TEST-ONLY-KEY secret', {status:403})),b=await blocked.call('/api/config'),error=await blocked.call('/api/models/test','POST',{provider:'Qwen',base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3.7-plus',api_key:'TEST-ONLY-KEY'},b.cookie);assert.equal(error.r.status,502);assert(!JSON.stringify(error.data).includes('TEST-ONLY-KEY'));blocked.sqlite.close()});
test('concurrent independent updates retain both history messages through CAS',async()=>{const s=setup(),a=await s.call('/api/config');await Promise.all([s.call('/api/chat','POST',{message:'传播损失'},a.cookie),s.call('/api/chat','POST',{message:'声源深度'},a.cookie)]);const h=(await s.call('/api/chat/history','GET',undefined,a.cookie)).data;assert.equal(h.length,4);s.sqlite.close()});

const deepseekTestConfig={provider:'DeepSeek',base_url:'https://api.deepseek.com',model:'deepseek-flash',api_key:'TEST-ONLY-DEEPSEEK-KEY'};
const completion=(body)=>new Response(JSON.stringify({model:body.model,choices:[{message:{content:'OK'}}]}),{headers:{'content-type':'application/json'}});

test('DeepSeek connection test disables thinking while normal chat keeps model options',async()=>{
 const sent=[];
 const s=setup(async(url,options)=>{const body=JSON.parse(options.body);sent.push({url,body});return completion(body)});
 try{
  const a=await s.call('/api/config');
  const checked=await s.call('/api/models/test','POST',deepseekTestConfig,a.cookie);
  assert.equal(checked.r.status,200);
  assert.equal(sent[0].url,'https://api.deepseek.com/chat/completions');
  assert.equal(sent[0].body.model,'deepseek-flash');
  assert.equal(sent[0].body.max_tokens,64);
  assert.equal(sent[0].body.stream,false);
  assert.deepEqual(sent[0].body.thinking,{type:'disabled'});
  assert.equal(sent[0].body.reasoning_effort,'none');
  await s.call('/api/config','PUT',deepseekTestConfig,a.cookie);
  const chat=await s.call('/api/chat','POST',{message:'Munk 声速剖面'},a.cookie);
  assert.equal(chat.r.status,200);
  assert.equal(sent[1].body.max_tokens,4096);
  assert.equal(sent[1].body.thinking,undefined);
  assert.equal(sent[1].body.reasoning_effort,undefined);
 }finally{s.sqlite.close()}
});

test('invalid fake provider key returns HTTP 401 separately from a network failure',async()=>{
 const s=setup(async()=>new Response(JSON.stringify({error:{message:'Invalid API key '+deepseekTestConfig.api_key}}),{status:401,headers:{'content-type':'application/json'}}));
 try{
  const a=await s.call('/api/config');
  const rejected=await s.call('/api/models/test','POST',deepseekTestConfig,a.cookie);
  assert.equal(rejected.r.status,502);
  assert.match(rejected.data.detail,/HTTP 401/);
  assert.match(rejected.data.detail,/密钥|认证/);
  assert.doesNotMatch(rejected.data.detail,/连接未完成|无法连接/);
  assert(!JSON.stringify(rejected.data).includes(deepseekTestConfig.api_key));
 }finally{s.sqlite.close()}
});

test('provider model-list authentication probe uses GET and never creates a completion',async()=>{
 const seen=[];
 const s=setup(async(url,options)=>{seen.push({url,options});return new Response(JSON.stringify({data:[{id:'deepseek-flash'}]}),{headers:{'content-type':'application/json'}})});
 try{
  const a=await s.call('/api/config');
  const result=await s.call('/api/models/list','POST',deepseekTestConfig,a.cookie);
  assert.equal(result.r.status,200);
  assert.equal(result.data.selected_listed,true);
  assert.equal(seen.length,1);
  assert.equal(seen[0].url,'https://api.deepseek.com/models');
  assert.equal(seen[0].options.method||'GET','GET');
  assert.equal(seen[0].options.body,undefined);
 }finally{s.sqlite.close()}
});

test('providerFetch refuses redirects and never forwards a key to another origin',async()=>{
 let calls=0;
 await assert.rejects(providerFetch(deepseekTestConfig,'/models',{method:'GET',timeoutMs:1000},async(url,options)=>{
  calls++;
  assert.equal(url,'https://api.deepseek.com/models');
  assert.equal(options.redirect,'manual');
  assert.equal(new Headers(options.headers).get('authorization'),'Bearer '+deepseekTestConfig.api_key);
  return new Response('',{status:302,headers:{location:'https://untrusted.test/collect?key='+deepseekTestConfig.api_key}});
 }),error=>{
  assert.match(error.message,/重定向|redirect|302/i);
  assert(!error.message.includes(deepseekTestConfig.api_key));
  assert(!error.message.includes('untrusted.test'));
  return true;
 });
 assert.equal(calls,1);
});

test('providerFetch redacts network exception details including authorization and key',async()=>{
 await assert.rejects(providerFetch(deepseekTestConfig,'/models',{method:'GET',timeoutMs:1000},async()=>{
  const error=new TypeError('fetch failed; Authorization: Bearer '+deepseekTestConfig.api_key+'; internal-private-details');
  error.cause={code:'ENOTFOUND',message:'failed lookup '+deepseekTestConfig.api_key};
  throw error;
 }),error=>{
  assert.match(error.message,/DNS|网络|连接|域名/i);
  assert(!error.message.includes(deepseekTestConfig.api_key));
  assert(!error.message.includes('internal-private-details'));
  assert(!error.message.includes('Authorization'));
  return true;
 });
});

test('providerFetch identifies deadline expiry without exposing exception text',async()=>{
 await assert.rejects(providerFetch(deepseekTestConfig,'/models',{method:'GET',timeoutMs:1000},async()=>{
  throw new DOMException('timed out '+deepseekTestConfig.api_key,'TimeoutError');
 }),error=>{
  assert.match(error.message,/超时|timeout/i);
  assert(!error.message.includes(deepseekTestConfig.api_key));
  return true;
 });
});

test('providerFetch aborts an outstanding request when its deadline expires',{timeout:1500},async()=>{
 let observedAbort=false;
 await assert.rejects(providerFetch(deepseekTestConfig,'/models',{method:'GET',timeoutMs:25},async(url,options)=>new Promise((resolve,reject)=>{
  const aborted=()=>{observedAbort=true;reject(new DOMException('cancelled '+deepseekTestConfig.api_key,'AbortError'))};
  if(options.signal.aborted)aborted();else options.signal.addEventListener('abort',aborted,{once:true});
 })),error=>{
  assert.match(error.message,/超时|timeout/i);
  assert(!error.message.includes(deepseekTestConfig.api_key));
  return true;
 });
 assert.equal(observedAbort,true);
});

test('key whitespace is trimmed before configuration persistence and provider authorization',async()=>{
 const seen=[];
 const s=setup(async(url,options)=>{seen.push(new Headers(options.headers).get('authorization'));return completion(JSON.parse(options.body))});
 try{
  const a=await s.call('/api/config');
  const saved=await s.call('/api/config','PUT',{...deepseekTestConfig,api_key:' \t'+deepseekTestConfig.api_key+'\n '},a.cookie);
  assert.equal(saved.r.status,200);
  assert.equal(saved.data.api_key_set,true);
  const checked=await s.call('/api/models/test','POST',{provider:'DeepSeek',model:'deepseek-flash',base_url:'https://api.deepseek.com'},a.cookie);
  assert.equal(checked.r.status,200);
  assert.equal(seen[0],'Bearer '+deepseekTestConfig.api_key);
  const ciphertext=s.sqlite.prepare('SELECT ciphertext FROM cloud_visitors').get().ciphertext;
  const privateState=await decrypt(ciphertext,s.env.GATEWAY_SECRET);
  assert.equal(privateState.selected.api_key,deepseekTestConfig.api_key);
 }finally{s.sqlite.close()}
});

test('embedded key whitespace and a Bearer prefix receive input-format errors before fetch',async()=>{
 let calls=0;
 const s=setup(async()=>{calls++;throw Error('This mock must never be called')});
 try{
  const a=await s.call('/api/config');
  for(const api_key of ['TEST-ONLY KEY','TEST-ONLY\nKEY','Bearer '+deepseekTestConfig.api_key]){
   const rejected=await s.call('/api/models/test','POST',{...deepseekTestConfig,api_key},a.cookie);
   assert.equal(rejected.r.status,422);
   assert.match(rejected.data.detail,/格式|空白|空格|Bearer|前缀/i);
   assert.doesNotMatch(rejected.data.detail,/无法连接|连接未完成|HTTP 401/);
   assert(!JSON.stringify(rejected.data).includes(api_key));
  }
  assert.equal(calls,0);
 }finally{s.sqlite.close()}
});
