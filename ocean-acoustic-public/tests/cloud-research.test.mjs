import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setup,decrypt} from './test-support.mjs';

const assets=JSON.parse(readFileSync(new URL('../data/research-assets.json',import.meta.url),'utf8'));
const cfg={provider:'DeepSeek',base_url:'https://api.deepseek.com',model:'deepseek-flash',api_key:'TEST-ONLY-RESEARCH-VISITOR-KEY'};
const plan={solver:'kraken',template:'pekeris_100m',frequencies_hz:[50],source_depths_m:[50],receiver_depth_m:50,range_min_km:0.1,range_max_km:5};
const toolCall=(name,args={},id='call-'+name)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const provider=(content='',calls=[],finish='stop')=>new Response(JSON.stringify({model:'reported-research-model',choices:[{finish_reason:finish,message:{role:'assistant',content,...(calls.length?{tool_calls:calls,reasoning_content:'Provider reasoning retained for API continuity.'}:{})}}]}),{headers:{'content-type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const chatBody=(overrides={})=>({session:'session-research-0001',request_id:'research-request-0001',message:'请分析海洋声学研究流程',backend:'api',rounds:40,...overrides});
function harness(replies=[],options={}){
 const providerRequests=[],nodeRequests=[],oceanRequests=[],submissions=new Map();
 const s=setup(async(url,init)=>{
  providerRequests.push({url,auth:init.headers.get('authorization'),body:JSON.parse(init.body)});
  const next=replies.shift();assert.ok(next,'Unexpected paid provider request');return typeof next==='function'?next(init):next;
 },{researchAssets:assets,heartbeat:async()=>options.online!==false,
  proxy:async request=>{
   const path=new URL(request.url).pathname,body=request.method==='GET'?undefined:JSON.parse(await request.text());
   const record={path,method:request.method,headers:Object.fromEntries(request.headers),body};nodeRequests.push(record);
   assert.equal(request.headers.get('authorization'),null);assert.ok(!JSON.stringify(record).includes(cfg.api_key));
   let value;
   if(path==='/api/simulation/jobs'){
    const key=request.headers.get('idempotency-key');assert.match(key,/^research-[a-f0-9]{48}$/);
    if(!submissions.has(key))submissions.set(key,{ids:[createHash('sha256').update(key).digest('hex').slice(0,12)],batch_id:'b'.repeat(32),reused:false});
    value=submissions.get(key);
   }else if(path==='/api/simulation/plans/preview')value={plan:body,case_count:1,cases:[{frequency_hz:50,source_depth_m:50}]};
   else if(path==='/api/jobs')value=[];
   else if(/^\/api\/jobs\/[a-f0-9]{12}$/.test(path))value={id:path.split('/').at(-1),state:'SUCCEEDED'};
   else assert.fail('Unapproved private path '+path);
   const override=await options.onNode?.(record,nodeRequests.length,value);return override||Response.json(value);
  },
  oceanQuery:async request=>{
   const url=new URL(request.url),period=Number(url.searchParams.get('period'));oceanRequests.push(Object.fromEntries(url.searchParams));
   return Response.json({period:'Quarter '+period,period_id:period,dataset_version:'real-fixture-v1',selected:{lon:119.5,lat:19.5},rows:[{depth_m:0,temperature_c:20,sound_speed_m_s:1500},{depth_m:10,temperature_c:20,sound_speed_m_s:1501},{depth_m:30,temperature_c:19.6,sound_speed_m_s:1502},{depth_m:60,temperature_c:19,sound_speed_m_s:1500}]});
  }});
 // D1 batches serialize transactions. The in-memory SQLite test adapter's
 // async wrapper otherwise tries nested BEGINs during concurrent HTTP tests.
 let pending=Promise.resolve();const batch=s.env.DB.batch.bind(s.env.DB);
 s.env.DB.batch=statements=>{const result=pending.then(()=>batch(statements));pending=result.catch(()=>{});return result;};
 return {...s,providerRequests,nodeRequests,oceanRequests,submissions};
}
async function visitor(s,key=true){const a=await s.call('/api/config');if(key)assert.equal((await s.call('/api/config','PUT',cfg,a.cookie)).r.status,200);return a.cookie;}
async function start(s,cookie,body=chatBody()){const r=await s.call('/api/research/chat','POST',body,cookie);assert.equal(r.r.status,202,JSON.stringify(r.data));return r.data.id;}
const step=(s,cookie,id)=>s.call(`/api/research/runs/${id}/step`,'POST',{},cookie);
const get=(s,cookie,id)=>s.call(`/api/research/runs/${id}`,'GET',undefined,cookie);
async function stored(s,id){const row=s.sqlite.prepare('SELECT * FROM cloud_research_runs WHERE id=?').get(id);return {...row,data:await decrypt(row.ciphertext,s.env.GATEWAY_SECRET)};}

test('no-key research and all GET polling remain free and never start computation',async()=>{
 const s=harness(),cookie=await visitor(s,false),id=await start(s,cookie,{...chatBody(),api_key:cfg.api_key});
 for(const path of ['/api/research/capabilities','/api/research-skills','/api/model-workflows','/api/project/files',`/api/research/runs/${id}`,'/api/research/history?session=session-research-0001','/api/research/sessions','/api/research/active?session=session-research-0001'])assert.equal((await s.call(path,'GET',undefined,cookie)).r.status,200,path);
 const done=await step(s,cookie,id);assert.equal(done.data.state,'done');assert.match(done.data.reply,/未配置.*API Key/);
 assert.equal(s.providerRequests.length,0);assert.equal(s.nodeRequests.length,0);
 const history=await s.call('/api/research/history?session=session-research-0001','GET',undefined,cookie);assert.equal(history.data.length,2);assert.equal(history.data[1].model_used,false);s.sqlite.close();
});

test('real provider tool_calls load assets, run diagnostics, submit fixed jobs and persist the exchange',async()=>{
 const skill=assets.skills[0].id;
 const calls=[toolCall('load_research_skill',{id:skill}),toolCall('diagnose_seasonal_layers',{lon:120,lat:20}),toolCall('preview_simulation',{plan}),toolCall('submit_simulation',{plan})];
 const s=harness([provider('I will use the registered tools.',calls),provider('基于工具的研究结果已返回。')]),cookie=await visitor(s),id=await start(s,cookie);
 assert.equal(s.providerRequests.length,0);await get(s,cookie,id);assert.equal(s.providerRequests.length,0);
 const first=await step(s,cookie,id);assert.equal(first.data.state,'running');assert.equal(first.data.trace.length,4);
 assert.equal(s.providerRequests[0].auth,'Bearer '+cfg.api_key);assert.ok(s.providerRequests[0].body.tools.length>10);
 assert.equal(s.oceanRequests.length,4);assert.deepEqual(s.oceanRequests.map(x=>x.period),['13','14','15','16']);
 assert.ok(s.oceanRequests.slice(1).every(x=>x.version==='real-fixture-v1'));
 assert.deepEqual(s.nodeRequests.map(x=>x.path),['/api/simulation/plans/preview','/api/simulation/jobs']);assert.equal(s.submissions.size,1);
 const saved=await stored(s,id),tools=saved.data.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
 assert.equal(tools[1].executed,true);assert.equal(tools[1].diagnostics.length,4);assert.equal(tools[1].diagnostics[0].density_mld.status,'not_computed');
 assert.equal(saved.data.messages.find(m=>m.tool_calls).reasoning_content,'Provider reasoning retained for API continuity.');
 const final=await step(s,cookie,id);assert.equal(final.data.state,'done');assert.equal(s.providerRequests.length,2);
 assert.equal((await step(s,cookie,id)).data.state,'done');assert.equal(s.providerRequests.length,2);
 const history=await s.call('/api/research/history?session=session-research-0001','GET',undefined,cookie);assert.equal(history.data.length,2);assert.equal(history.data[1].model_used,true);
 const cipher=s.sqlite.prepare('SELECT ciphertext FROM cloud_research_runs WHERE id=?').get(id).ciphertext;assert.ok(!cipher.includes(cfg.api_key));assert.ok(!JSON.stringify((await stored(s,id)).data).includes(cfg.api_key));s.sqlite.close();
});

test('persistent request keys and concurrent chat POSTs create one question and one active run',async()=>{
 const s=harness(),cookie=await visitor(s);
 const results=await Promise.all(Array.from({length:6},()=>s.call('/api/research/chat','POST',chatBody(),cookie)));
 assert.ok(results.every(r=>[200,202].includes(r.r.status)),JSON.stringify(results.map(r=>r.data)));
 assert.equal(new Set(results.map(r=>r.data.id)).size,1);assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_research_runs').get().n,1);
 assert.equal((await s.call('/api/research/history?session=session-research-0001','GET',undefined,cookie)).data.length,1);
 assert.equal((await s.call('/api/research/chat','POST',chatBody({message:'different'}),cookie)).r.status,409);
 assert.equal((await s.call('/api/research/chat','POST',chatBody({request_id:'different-request-key'}),cookie)).r.status,409);
 assert.equal(s.providerRequests.length,0);s.sqlite.close();
});

test('foreign visitors cannot read, step, stop, rename or delete another visitor research',async()=>{
 const s=harness(),a=await visitor(s),b=await visitor(s,false),id=await start(s,a);
 for(const [path,method,body] of [[`/api/research/runs/${id}`,'GET'],[`/api/research/runs/${id}/step`,'POST',{}],[`/api/research/runs/${id}/stop`,'POST',{}],['/api/research/sessions/session-research-0001','DELETE'],['/api/research/sessions/session-research-0001','PATCH',{title:'foreign'}]])assert.equal((await s.call(path,method,body,b)).r.status,404,path);
 assert.deepEqual((await s.call('/api/research/history?session=session-research-0001','GET',undefined,b)).data,[]);
 assert.equal((await s.call('/api/research/sessions/session-research-0001','DELETE',undefined,a)).r.status,409);
 assert.equal((await s.call('/api/research/sessions/session-research-0001','PATCH',{title:'while busy'},a)).r.status,409);
 assert.equal((await s.call(`/api/research/runs/${id}/stop`,'POST',{},a)).data.stopped,true);
 assert.equal((await s.call('/api/research/sessions/session-research-0001','DELETE',undefined,a)).r.status,200);
 assert.equal((await get(s,a,id)).r.status,404);assert.equal(s.providerRequests.length,0);s.sqlite.close();
});

test('one active step holds the lease and a late provider result cannot undo stop or deleted history',async()=>{
 const entered=deferred(),release=deferred(),s=harness([async()=>{entered.resolve();await release.promise;return provider('late result',[toolCall('submit_simulation',{plan})]);}]),cookie=await visitor(s),id=await start(s,cookie);
 const first=step(s,cookie,id);await entered.promise;
 const busy=await step(s,cookie,id);assert.equal(busy.data.step_busy,true);assert.equal(s.providerRequests.length,1);
 await s.call(`/api/research/runs/${id}/stop`,'POST',{},cookie);release.resolve();assert.equal((await first).data.state,'stopped');
 assert.equal(s.nodeRequests.length,0);assert.equal((await s.call('/api/research/history?session=session-research-0001','GET',undefined,cookie)).data.length,1);
 assert.equal((await s.call('/api/research/sessions/session-research-0001','DELETE',undefined,cookie)).r.status,200);s.sqlite.close();
});

test('expired lease replacement wins over an old provider completion',async()=>{
 const entered=deferred(),release=deferred(),s=harness([async()=>{entered.resolve();await release.promise;return provider('STALE SHOULD NOT WIN');},provider('replacement completion')]),cookie=await visitor(s),id=await start(s,cookie);
 const stale=step(s,cookie,id);await entered.promise;s.sqlite.prepare('UPDATE cloud_research_runs SET lease_until=0 WHERE id=?').run(id);
 const replacement=await step(s,cookie,id);assert.equal(replacement.data.reply,'replacement completion');release.resolve();
 assert.equal((await stale).data.reply,'replacement completion');
 const history=await s.call('/api/research/history?session=session-research-0001','GET',undefined,cookie);assert.equal(history.data.length,2);assert.equal(history.data[1].text,'replacement completion');s.sqlite.close();
});

test('an interrupted submitted tool resumes persisted call ids without another model call or duplicate job',async()=>{
 const entered=deferred(),release=deferred();
 const s=harness([provider('',[toolCall('submit_simulation',{plan},'persisted-submit-id')]),provider('submission recovered')],{onNode:async(record,index,value)=>{if(index===1){entered.resolve();await release.promise;return Response.json(value);}}}),cookie=await visitor(s),id=await start(s,cookie);
 const interrupted=step(s,cookie,id);await entered.promise;
 const pending=await stored(s,id);assert.equal(pending.data.pending.index,0);assert.equal(pending.data.pending.calls[0].id,'persisted-submit-id');assert.equal(s.submissions.size,1);
 s.sqlite.prepare('UPDATE cloud_research_runs SET lease_until=0 WHERE id=?').run(id);
 const recovered=await step(s,cookie,id);assert.equal(recovered.data.state,'running');assert.equal(s.providerRequests.length,1);
 assert.equal(s.nodeRequests.length,2);assert.equal(s.nodeRequests[0].headers['idempotency-key'],s.nodeRequests[1].headers['idempotency-key']);assert.equal(s.submissions.size,1);
 release.resolve();await interrupted;
 const saved=await stored(s,id);assert.equal(saved.data.trace.length,1);assert.equal(saved.data.messages.filter(m=>m.role==='tool').length,1);
 assert.equal((await step(s,cookie,id)).data.reply,'submission recovered');assert.equal(s.providerRequests.length,2);s.sqlite.close();
});

test('tool round limits reject unexpected final-round tool calls and arbitrary scripts remain unavailable',async()=>{
 const s=harness([provider('',[toolCall('run_python_script',{script:'not permitted'})]),provider('',[toolCall('submit_simulation',{plan})])]),cookie=await visitor(s),id=await start(s,cookie,chatBody({rounds:1}));
 const first=await step(s,cookie,id);assert.equal(first.data.trace[0].state,'failed');assert.match(first.data.trace[0].summary,/没有这个工具/);
 const second=await step(s,cookie,id);assert.equal(second.data.state,'failed');assert.match(second.data.error,/轮数/);assert.equal(s.providerRequests[1].body.tools,undefined);assert.equal(s.nodeRequests.length,0);
 for(const path of ['/api/research/execute','/api/research/python','/api/research/script'])assert.equal((await s.call(path,'POST',{script:'unsafe'},cookie)).r.status,404);
 assert.equal((await s.call('/api/research/chat','POST',chatBody({backend:'dsh',request_id:'new-backend-request'}),cookie)).r.status,503);s.sqlite.close();
});

test('logged-in identity sends its server-derived node cookie and never forwards model or browser auth headers',async()=>{
 const s=harness([provider('',[toolCall('submit_simulation',{plan})])]);
 async function account(path,method='GET',body){
  const url=new URL(path,'https://course.test'),headers={origin:url.origin,'content-type':'application/json',cookie:'ocean_visitor='+'A'.repeat(64),authorization:'Bearer BROWSER-ONLY-SECRET','oai-authenticated-user-id':'test-account-001','oai-authenticated-user-email':'account@example.test'};
  const response=await s.handler(new Request(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),s.env,s.ctx,url);return {response,data:await response.json()};
 }
 assert.equal((await account('/api/config','PUT',cfg)).response.status,200);
 const started=await account('/api/research/chat','POST',chatBody());assert.equal(started.response.status,202);
 await account(`/api/research/runs/${started.data.id}/step`,'POST',{});
 assert.equal(s.nodeRequests.length,1);assert.match(s.nodeRequests[0].headers.cookie,/^ocean_visitor=[a-f0-9]{64}$/);
 assert.notEqual(s.nodeRequests[0].headers.cookie,'ocean_visitor='+'A'.repeat(64));
 assert.equal(s.nodeRequests[0].headers['oai-authenticated-user-id'],undefined);assert.equal(s.nodeRequests[0].headers.authorization,undefined);s.sqlite.close();
});
