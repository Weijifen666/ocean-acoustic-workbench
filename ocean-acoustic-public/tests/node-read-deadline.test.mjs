import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {setup,decrypt,retrieve} from './test-support.mjs';

const assets=JSON.parse(fs.readFileSync(new URL('../data/research-assets.json',import.meta.url),'utf8'));
const catalog=JSON.parse(fs.readFileSync(new URL('../data/models.json',import.meta.url),'utf8'));
const chatBody={session:'deadline-session-0001',request_id:'deadline-request-0001',message:'什么是简正波',backend:'api',rounds:0};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const abortError=()=>new DOMException('Test request aborted','AbortError');

test('cloud research and knowledge never wait for a local node; hung health probing has a short deadline',async()=>{
 let paidCalls=0,resolveAbort;const aborted=[],entered=[],activeRequests=new Set(),abortReached=new Promise(resolve=>resolveAbort=resolve);
 const s=setup(async()=>{paidCalls++;throw Error('Paid API forbidden')},{researchAssets:assets,heartbeat:async()=>true,proxy:async request=>{
  const path=new URL(request.url).pathname;entered.push(path);
  // A real bridge loop retains its Request while awaiting and polling it.
  // Node forwards aborts through weak dependent signals; a spy that drops the
  // Request can be garbage-collected before the deadline under suite load.
  activeRequests.add(request);
  return new Promise((_,reject)=>{const abort=()=>{if(!activeRequests.delete(request))return;aborted.push(path);resolveAbort();reject(abortError())};request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort()});
 }});
 try{
  const visitor=await s.call('/api/config'),begin=performance.now();
  const healthPending=s.call('/api/health','GET',undefined,visitor.cookie);
  const [chat,knowledge]=await Promise.all([s.call('/api/research/chat','POST',chatBody,visitor.cookie),s.call('/api/knowledge/search?q='+encodeURIComponent(chatBody.message),'GET',undefined,visitor.cookie)]);
  assert(performance.now()-begin<1000,'Cloud research startup and retrieval must not await the node deadline');
  const health=await healthPending;
  const elapsed=performance.now()-begin;
  assert.equal(chat.r.status,202);assert.equal(health.r.status,200);assert.equal(knowledge.r.status,200);
  assert(elapsed>=3900&&elapsed<7500,`Optional reads took ${elapsed}ms`);
  assert.equal(paidCalls,0);assert(entered.length<=1);assert(entered.every(path=>path==='/api/health'));
  // If the event loop spent the short budget before entering the proxy, it
  // correctly avoids opening one. Every probe that did start must be aborted.
  if(entered.length){
   let timer;try{await Promise.race([abortReached,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The started node probe did not receive cancellation')),500)})])}finally{clearTimeout(timer)}
  }
  assert.deepEqual(aborted,entered);
  assert.equal(activeRequests.size,0);
  assert.equal(health.data.offline,true);assert.equal(health.data.node_status,'timeout');assert.equal(health.data.node_health_verified,false);
  assert.equal(health.data.matlab_available,false);assert.equal(health.data.cloud_model_available,true);assert.match(health.data.node_notice,/超时/);
  assert(knowledge.data.length>0);assert(knowledge.data.some(row=>row.node_id==='normal_mode_field'));assert(knowledge.data.every(row=>row.id!=='D-PRIVATE-TIMELY-TEST'));
  const row=s.sqlite.prepare('SELECT ciphertext FROM cloud_research_runs WHERE id=?').get(chat.data.id),saved=await decrypt(row.ciphertext,s.env.GATEWAY_SECRET);
  assert(saved.messages[0].content.includes('knowledge_card'));assert(saved.messages[0].content.includes('K017'));assert(!saved.messages[0].content.includes('D-PRIVATE-TIMELY-TEST'));
 }finally{s.sqlite.close()}
});

test('online node health remains usable but public chat does not query private local full text',async()=>{
 let paidCalls=0;const nodeRow={...retrieve(chatBody.message)[0],id:'D-PRIVATE-TIMELY-TEST',text:'TEST ONLY: authorized node excerpt',evidence_type:'source_excerpt'};
 const nodePaths=[];const s=setup(async()=>{paidCalls++;throw Error('Paid API forbidden')},{researchAssets:assets,heartbeat:async()=>true,proxy:async request=>{
  assert.equal(request.headers.get('authorization'),null);assert.match(request.headers.get('cookie'),/^ocean_visitor=/);
  nodePaths.push(new URL(request.url).pathname);
  return Response.json(new URL(request.url).pathname==='/api/health'?{matlab_available:true,solver_available:true}: [nodeRow]);
 }});
 try{
  const visitor=await s.call('/api/config'),chat=await s.call('/api/research/chat','POST',chatBody,visitor.cookie),health=await s.call('/api/health','GET',undefined,visitor.cookie);
  assert.equal(chat.r.status,202);assert.equal(health.data.offline,false);assert.equal(health.data.node_status,'online');assert.equal(health.data.node_health_verified,true);assert.equal(health.data.matlab_available,true);
  const row=s.sqlite.prepare('SELECT ciphertext FROM cloud_research_runs WHERE id=?').get(chat.data.id),saved=await decrypt(row.ciphertext,s.env.GATEWAY_SECRET);
  assert(!saved.messages[0].content.includes(nodeRow.id));assert(saved.messages[0].content.includes('K017'));assert.deepEqual(nodePaths,['/api/health']);assert.equal(paidCalls,0);
 }finally{s.sqlite.close()}
});

test('cancelling a health probe cancels its visitor-scoped bridge request promptly',async()=>{
 let entered;const ready=new Promise(resolve=>entered=resolve);let nodeAborted=false;
 const s=setup(undefined,{researchAssets:assets,heartbeat:async()=>true,proxy:async request=>{
  entered();return new Promise((_,reject)=>{const abort=()=>{nodeAborted=true;reject(abortError())};request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort()});
 }});
 try{
  const visitor=await s.call('/api/config'),controller=new AbortController(),url=new URL('https://course.test/api/health');
  const pending=s.handler(new Request(url,{headers:{cookie:visitor.cookie},signal:controller.signal}),s.env,s.ctx,url);
  await ready;const begin=performance.now();controller.abort();const response=await pending;
  assert(performance.now()-begin<500);assert.notEqual(response.status,200);assert.equal(nodeAborted,true);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_research_runs').get().n,0);
 }finally{s.sqlite.close()}
});

test('actual worker wakes bridge polling on optional health timeout and cleans RPCs without shortening solver RPCs',async()=>{
 const fixture=`export const FILES={};export const GRAPH={nodes:[],edges:[]};export const MODELS=${JSON.stringify(catalog)};export const SOURCES=[];export const TEMPLATE="";export const EXERCISES=[];export const OCEAN_SOURCES=[];export const OCEAN_CHUNKS=[];export const RESEARCH_ASSETS={};`;
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../worker.mjs',import.meta.url))],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,plugins:[{name:'static-fixture',setup(b){b.onResolve({filter:/generated-assets\.mjs$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js'}))}}]});
 const worker=(await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))).default;
 const s=setup(),deleted=[],cleanup=[],controller=new AbortController();s.env.BUCKET={get:async()=>null,delete:async key=>deleted.push(key)};
 const ctx={waitUntil(promise){cleanup.push(promise)}};
 s.sqlite.prepare("INSERT INTO bridge_state(id,seen) VALUES('matlab',?)").run(Date.now());
 try{
  const config=await worker.fetch(new Request('https://course.test/api/config'),s.env,ctx),cookie=config.headers.get('set-cookie').split(';')[0];
  let formalDone=false;
  const formal=worker.fetch(new Request('https://course.test/api/simulation/plans/preview',{method:'POST',headers:{origin:'https://course.test',cookie},body:'{}',signal:controller.signal}),s.env,ctx).then(response=>{formalDone=true;return response});
  const health=worker.fetch(new Request('https://course.test/api/health',{headers:{cookie}}),s.env,ctx);
  await delay(4200);const response=await health,body=await response.json();await Promise.all(cleanup);
  assert.equal(response.status,200);assert.equal(body.node_status,'timeout');assert.equal(body.offline,true);assert.equal(body.node_health_verified,false);
  assert.equal(formalDone,false,'A solver/preview RPC must retain its existing long deadline');
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM bridge_requests').get().n,1,'Only the formal request remains queued after optional health cancellation');
  const begin=performance.now();controller.abort();assert.equal((await formal).status,499);assert(performance.now()-begin<500,'Abort must wake the bridge sleep immediately');
  await Promise.all(cleanup);assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM bridge_requests').get().n,0);assert.equal(deleted.length,2);
 }finally{controller.abort();await Promise.all(cleanup);s.sqlite.close()}
});
