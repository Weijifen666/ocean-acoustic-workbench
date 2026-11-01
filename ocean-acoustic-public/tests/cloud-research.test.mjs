import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setup,decrypt,encrypt} from './test-support.mjs';
import {assertMessagesBudget,estimateMessages} from '../server/context-budget.mjs';

const assets=JSON.parse(readFileSync(new URL('../data/research-assets.json',import.meta.url),'utf8'));
const cfg={provider:'DeepSeek',base_url:'https://api.deepseek.com',model:'deepseek-flash',api_key:'TEST-ONLY-RESEARCH-VISITOR-KEY'};
const plan={solver:'kraken',template:'pekeris_100m',frequencies_hz:[50],source_depths_m:[50],receiver_depth_m:50,range_min_km:0.1,range_max_km:5};
const toolCall=(name,args={},id='call-'+name)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const provider=(content='',calls=[],finish='stop',reasoning='Provider reasoning retained for API continuity.')=>new Response(JSON.stringify({model:'reported-research-model',choices:[{finish_reason:finish,message:{role:'assistant',content,...(calls.length?{tool_calls:calls,reasoning_content:reasoning}:{})}}]}),{headers:{'content-type':'application/json'}});
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
const step=(s,cookie,id,body={})=>s.call(`/api/research/runs/${id}/step`,'POST',body,cookie);
const get=(s,cookie,id)=>s.call(`/api/research/runs/${id}`,'GET',undefined,cookie);
async function stored(s,id){const row=s.sqlite.prepare('SELECT * FROM cloud_research_runs WHERE id=?').get(id);return {...row,data:await decrypt(row.ciphertext,s.env.GATEWAY_SECRET)};}
function completeToolGroups(messages){
 for(let i=0;i<messages.length;i++){
  const message=messages[i];
  assert.notEqual(message.role,'tool','A tool result must follow its retained assistant tool_calls group');
  if(!message.tool_calls?.length)continue;
  const expected=message.tool_calls.map(call=>call.id),actual=[];
  while(messages[i+1]?.role==='tool')actual.push(messages[++i].tool_call_id);
  assert.equal(new Set(expected).size,expected.length);assert.deepEqual(actual.sort(),[...expected].sort(),'Keep or drop assistant calls and all corresponding observations as a whole');
 }
}

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
 for(const [path,method,body] of [[`/api/research/runs/${id}`,'GET'],[`/api/research/runs/${id}/step`,'POST',{}],[`/api/research/runs/${id}/stop`,'POST',{}],[`/api/research/runs/${id}/resume`,'POST',{context_budget:65536}],['/api/research/sessions/session-research-0001','DELETE'],['/api/research/sessions/session-research-0001','PATCH',{title:'foreign'}]])assert.equal((await s.call(path,method,body,b)).r.status,404,path);
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

test('a large registered Skill result cannot strand the next real research round at the default 32K budget',async()=>{
 const resource=assets.resources['at-environment/references/casebook.json'];
 assert.ok(Buffer.byteLength(JSON.stringify(resource),'utf8')>100000,'Use the actual large published resource, not a mocked loop state');
 const question='请读取 AT 算例目录，说明模型适用范围；保留这条原始问题🌊，不要把历史记录当成新的物理验证。';
 const s=harness([provider('',[toolCall('read_skill_resource',{id:'at-environment',path:'references/casebook.json'},'large-casebook-read')]),provider('已读取目录；历史模型经验不表示本次已经完成计算。')]);
 try{
  const cookie=await visitor(s),id=await start(s,cookie,chatBody({message:question}));
  const observed=await step(s,cookie,id);assert.equal(observed.data.state,'running');assert.equal(observed.data.trace[0].state,'done');
  const checkpoint=await stored(s,id);assert.equal(checkpoint.lease_until,0);assert.equal(checkpoint.data.rounds,1);
  assert.equal(checkpoint.data.messages.find(m=>m.role==='user').content,question);
  const continued=await step(s,cookie,id);
  assert.equal(continued.data.state,'done',JSON.stringify({state:continued.data.state,error:continued.data.error,rounds:continued.data.rounds,provider_requests:s.providerRequests.length}));
  assert.equal(s.providerRequests.length,2);assert.equal(s.nodeRequests.length,0);
  const second=s.providerRequests[1].body;
  assert.equal(second.messages.find(m=>m.role==='user').content,question);
  completeToolGroups(second.messages);
  assert.doesNotThrow(()=>assertMessagesBudget(second.messages,'auto',second.tools||[]));
 }finally{s.sqlite.close();}
});

test('research context_budget is honored before sending a complete original question and rejects invalid controls',async()=>{
 const question='原问题开始🌊\n'+'海'.repeat(10000)+'\n原问题结束✅';
 const s=harness([provider('只回答提供的问题，不产生新物理数值。')]);
 try{
  const cookie=await visitor(s);
  const tooSmall=await s.call('/api/research/chat','POST',chatBody({message:question,context_budget:16384}),cookie);
  assert.equal(tooSmall.r.status,422);assert.equal(s.providerRequests.length,0);
  const id=await start(s,cookie,chatBody({message:question,context_budget:65536}));
  assert.equal((await stored(s,id)).data.context_budget,65536);
  const answer=await step(s,cookie,id);assert.equal(answer.data.state,'done',JSON.stringify(answer.data));
  assert.equal(s.providerRequests.length,1);
  const sent=s.providerRequests[0].body;
  assert.equal(sent.messages.find(m=>m.role==='user').content,question);
  assert.doesNotThrow(()=>assertMessagesBudget(sent.messages,65536,sent.tools||[]));
  for(const [index,budget] of ['65536',true,null,0,8192.5,1048576].entries()){
   const invalid=await s.call('/api/research/chat','POST',chatBody({request_id:'invalid-budget-request-'+index,context_budget:budget}),cookie);
   assert.equal(invalid.r.status,422,JSON.stringify({budget,result:invalid.data}));
  }
  assert.equal(s.providerRequests.length,1);assert.equal(s.nodeRequests.length,0);
 }finally{s.sqlite.close();}
});

test('multi-round registered observations fit the selected budget without orphaning tool groups or calling a summary model',async()=>{
 const question='对照创建流程与算例目录，指出执行范围；只引用实际返回的资料，不添加未计算的物理结果。';
 const s=harness([
  provider('',[toolCall('read_skill_resource',{id:'at-environment',path:'references/casebook-summary.json'},'casebook-summary-read'),toolCall('get_simulation_schema',{},'fixed-schema-read')]),
  provider('',[toolCall('read_skill_resource',{id:'at-environment',path:'references/creation-workflows.json'},'workflow-read')]),
  provider('这是资料范围说明，尚未执行仿真。'),
 ]);
 try{
  const cookie=await visitor(s),id=await start(s,cookie,chatBody({message:question,context_budget:32768}));
  const first=await step(s,cookie,id);assert.equal(first.data.state,'running');assert.equal(first.data.trace.length,2);
  const second=await step(s,cookie,id);assert.equal(second.data.state,'running',JSON.stringify(second.data));assert.equal(second.data.trace.length,3);
  const final=await step(s,cookie,id);assert.equal(final.data.state,'done',JSON.stringify(final.data));
  assert.equal(s.providerRequests.length,3,'Only the three explicitly requested planning rounds may call the fake provider');
  for(const request of s.providerRequests){
   const {messages,tools=[]}=request.body;
   assert.equal(messages.find(m=>m.role==='user').content,question);completeToolGroups(messages);
   assert.doesNotThrow(()=>assertMessagesBudget(messages,32768,tools));
  }
  assert.equal(s.submissions.size,0);assert.equal(s.nodeRequests.length,0);
 }finally{s.sqlite.close();}
});

test('running step budget changes are explicit, validated, persisted and never applied by GET polling',async()=>{
 const question='保持这条原始问题🌊；先读取固定表单，再解释所用条件。';
 const s=harness([provider('',[toolCall('get_simulation_schema',{},'budget-change-schema')]),provider('只说明已返回的条件。')]);
 try{
  const cookie=await visitor(s),id=await start(s,cookie,chatBody({message:question,context_budget:32768}));
  for(const budget of ['65536',true,0,1048576]){
   const invalid=await step(s,cookie,id,{context_budget:budget});assert.equal(invalid.r.status,422,JSON.stringify(invalid.data));
  }
  assert.equal(s.providerRequests.length,0);assert.equal((await stored(s,id)).data.context_budget,32768);
  const first=await step(s,cookie,id,{context_budget:65536});assert.equal(first.data.state,'running',JSON.stringify(first.data));
  assert.equal((await stored(s,id)).data.context_budget,65536);
  await s.call(`/api/research/runs/${id}?context_budget=131072`,'GET',undefined,cookie);
  assert.equal((await stored(s,id)).data.context_budget,65536);assert.equal(s.providerRequests.length,1);
  assert.equal((await step(s,cookie,id)).data.state,'done');assert.equal(s.providerRequests.length,2);
  for(const request of s.providerRequests){assert.equal(request.body.messages.find(m=>m.role==='user').content,question);completeToolGroups(request.body.messages);assert.doesNotThrow(()=>assertMessagesBudget(request.body.messages,65536,request.body.tools||[]));}
 }finally{s.sqlite.close();}
});

test('an existing ContextBudget-failed run explicitly resumes to unlimited without resubmitting its completed compute tool',async()=>{
 // The large numerical payload is explicitly a protocol fixture, not a claim
 // about an ocean location or a real solver result. Preserve its supplied
 // masked surface and known scalar values; never replace them with guesses.
 const observation=id=>({id,state:'SUCCEEDED',summary:{solver:'kraken',frequency_hz:50,source_depth_m:50,
  water_depth_m:100,mode_count:4,tl_min_db:70.125,tl_max_db:70.125,physical_accuracy_proven:false},
  result:{shape:[51,51],tl_db:Array.from({length:51},(_,y)=>Array(51).fill(y===0?null:70.125))},
  log:'TEST-ONLY ORIGINAL OBSERVATION; not a physical measurement.\n'.repeat(600)});
 const s=harness([
  provider('',[toolCall('submit_simulation',{plan},'one-existing-compute')]),
  init=>{const messages=JSON.parse(init.body).messages,receipt=JSON.parse(messages.findLast(m=>m.role==='tool').content);return provider('',[toolCall('get_job',{id:receipt.ids[0]},'inspect-existing-compute')]);},
  provider('已有任务结果已读取；没有再次提交计算，也没有宣称物理精度已验证。'),
 ],{onNode:async(record,index,value)=>record.method==='GET'&&record.path.startsWith('/api/jobs/')?Response.json(observation(value.id)):undefined});
 try{
  const cookie=await visitor(s),id=await start(s,cookie,chatBody({context_budget:32768,message:'运行已给定的计划后只检查同一个任务，保留原始问题与已生成的任务标识。'}));
  assert.equal((await step(s,cookie,id)).data.state,'running');assert.equal(s.submissions.size,1);
  assert.equal((await step(s,cookie,id)).data.state,'running');assert.equal(s.providerRequests.length,2);
  const checkpoint=await stored(s,id),createdReceipt=[...s.submissions.values()][0];
  assert.equal(checkpoint.data.trace.length,2);assert.equal(checkpoint.lease_until,0);
  // Reproduce the durable record produced by the deployed pre-fix loop: it
  // saved the real trace/messages but only stored this error text, no new
  // error_code. Recovery must support these existing records after deployment.
  const legacy={...checkpoint.data,error:'当前问题或工具结果超过所选上下文预算，请调大预算或缩小读取范围后重试；未自动调用模型压缩。',stage:'研究请求未完成'};
  delete legacy.error_code;
  s.sqlite.prepare("UPDATE cloud_research_runs SET state='failed',lease_until=0,ciphertext=? WHERE id=?").run(await encrypt(legacy,s.env.GATEWAY_SECRET),id);
  const failed=await get(s,cookie,id);assert.equal(failed.data.state,'failed');assert.equal(failed.data.recoverable,true);assert.equal(s.providerRequests.length,2);
  assert.equal((await step(s,cookie,id,{context_budget:'unlimited'})).data.state,'failed','Ordinary step/poll must not silently recover a failed paid run');
  assert.equal(s.providerRequests.length,2);
  const resume=await s.call(`/api/research/runs/${id}/resume`,'POST',{context_budget:'unlimited'},cookie);
  assert.equal(resume.r.status,200,JSON.stringify(resume.data));assert.equal(resume.data.state,'running');assert.equal(resume.data.id,id);
  assert.equal(s.providerRequests.length,2,'Explicit resume changes persistent scheduling state without charging a model request');
  const resumed=await step(s,cookie,id);
  assert.equal(resumed.data.state,'done',JSON.stringify(resumed.data));assert.equal(resumed.data.id,id);
  assert.equal(s.providerRequests.length,3);assert.equal(s.submissions.size,1);
  assert.equal(s.nodeRequests.filter(r=>r.path==='/api/simulation/jobs').length,1);
  assert.deepEqual([...s.submissions.values()][0].ids,createdReceipt.ids);
  const final=await stored(s,id);assert.equal(final.data.context_budget,'unlimited');assert.equal(final.data.trace.length,2);
  assert.equal(resumed.data.context.budget_limited,false);assert.equal(resumed.data.context.budget_tokens,null);
  const sent=s.providerRequests[2].body;
  completeToolGroups(sent.messages);assert.doesNotThrow(()=>assertMessagesBudget(sent.messages,'unlimited',sent.tools||[]));
  assert.equal(sent.messages.find(m=>m.role==='user').content,checkpoint.data.question);
  const latest=sent.messages.find(m=>m.role==='tool'&&m.tool_call_id==='inspect-existing-compute');
  assert.ok(latest,'Retain the completed job observation, paired with its original tool call');
  assert.ok(latest.content.includes(createdReceipt.ids[0]));assert.ok(latest.content.includes('SUCCEEDED'));
  const parse=JSON.parse(latest.content);
  function suppliedScalars(value){
   if(!value||typeof value!=='object')return;
   for(const [key,entry]of Object.entries(value)){
    if(key in observation(createdReceipt.ids[0]).summary&&typeof entry==='number')assert.equal(entry,observation(createdReceipt.ids[0]).summary[key],key);
    if(key==='physical_accuracy_proven')assert.equal(entry,false);
    if(key!=='tl_db')suppliedScalars(entry);
   }
  }
  suppliedScalars(parse);
 }finally{s.sqlite.close();}
});

test('unlimited public research is persisted and sends accumulated necessary context beyond 128K without another submission',async()=>{
 const question='按已给定计划只提交一次计算，然后检查同一任务；完整保留这条原始问题🌊。';
 const reasoning='Verify existing evidence; do not invent measurements. '.repeat(285);
 const replies=[provider('',[toolCall('submit_simulation',{plan},'unlimited-single-compute')],'tool_calls',reasoning)];
 for(let i=1;i<9;i++)replies.push(init=>{
  const messages=JSON.parse(init.body).messages,last=JSON.parse(messages.findLast(m=>m.role==='tool').content),id=last.ids?.[0]||last.id;
  assert.match(id,/^[a-f0-9]{12}$/);return provider('',[toolCall('get_job',{id},'unlimited-existing-job-'+i)],'tool_calls',reasoning);
 });
 replies.push(provider('仅核对已有任务，未再次提交，也未声称物理精度得到证明。'));
 const s=harness(replies);
 try{
  const cookie=await visitor(s),capabilities=await s.call('/api/research/capabilities','GET',undefined,cookie);
  assert.equal(capabilities.r.status,200);assert.ok(capabilities.data.context_budgets.includes('unlimited'));
  const id=await start(s,cookie,chatBody({message:question,context_budget:'unlimited'}));
  assert.equal((await stored(s,id)).data.context_budget,'unlimited');
  for(let round=0;round<9;round++)assert.equal((await step(s,cookie,id)).data.state,'running');
  const final=await step(s,cookie,id);assert.equal(final.data.state,'done',JSON.stringify(final.data));
  assert.equal(s.providerRequests.length,10);assert.equal(s.submissions.size,1);assert.equal(s.nodeRequests.filter(r=>r.path==='/api/simulation/jobs').length,1);
  const sent=s.providerRequests.at(-1).body;
  assert.ok(estimateMessages(sent.messages,sent.tools||[])>131072,'Necessary retained reasoning must actually exceed the largest finite budget');
  assert.equal(sent.messages.filter(m=>m.role==='tool').length,9);assert.equal(sent.messages.find(m=>m.role==='user').content,question);completeToolGroups(sent.messages);
  assert.doesNotThrow(()=>assertMessagesBudget(sent.messages,'unlimited',sent.tools||[]));
  assert.equal(final.data.context.budget_limited,false);assert.equal(final.data.context.budget_tokens,null);
  assert.equal(final.data.context.dropped_tool_messages,0);assert.equal(final.data.context.dropped_history_messages,0);
  assert.equal(JSON.parse(JSON.stringify(final.data.context)).budget_tokens,null);
 }finally{s.sqlite.close();}
});

test('owned result exports register real artifact links in run and history without fetching ZIP bytes or recomputing',async()=>{
 const job='aabbccddeeff',names=['result.json','summary.json','tl_map.png','curve.csv','case.env'];
 const calls=[toolCall('list_job_artifacts',{id:job,limit:2},'owned-file-list'),toolCall('export_job_results',{id:job},'owned-export-once'),toolCall('export_job_results',{id:job},'owned-export-repeat')];
 const sentinel='BINARY_OR_PRIVATE_DATA_MUST_NOT_ENTER_MODEL_CONTEXT';
 const s=harness([provider('',calls),provider('已登记本人任务的现有下载入口；ZIP在点击时生成，本轮没有重算或创建新文件。')],
  {onNode:async(record,index,value)=>Response.json({...value,artifacts:names,private_path:'C:/private/task-output',unrequested_binary:sentinel})});
 try{
  const cookie=await visitor(s),foreign=await visitor(s,false),id=await start(s,cookie,chatBody({message:'列出并导出本人已有任务文件，不要重新计算。'}));
  const first=await step(s,cookie,id);assert.equal(first.data.state,'running');assert.equal(first.data.trace.length,3);assert.ok(first.data.trace.every(t=>t.state==='done'));
  assert.deepEqual(s.nodeRequests.map(r=>[r.method,r.path]),Array(3).fill(['GET','/api/jobs/'+job]));
  assert.equal(s.submissions.size,0);assert.equal(first.data.exports.length,1,'Repeated exports of the same job are deduplicated');
  const metadata=first.data.exports[0];
  assert.equal(metadata.id,job);assert.equal(metadata.state,'SUCCEEDED');assert.equal(metadata.artifact_count,names.length);
  assert.deepEqual(metadata.artifacts,names.map(name=>({name,url:`/api/jobs/${job}/artifact/${name}`})));
  assert.equal(metadata.next_offset,null);assert.deepEqual(metadata.download,{url:`/api/jobs/${job}/download`,filename:`ocean-${job}.zip`});
  assert.equal(metadata.download_on_click,true);assert.equal(metadata.archive_created,false);assert.equal(metadata.partial,false);assert.equal(metadata.scope,'existing_task_files');
  const checkpoint=await stored(s,id),listed=JSON.parse(checkpoint.data.messages.find(m=>m.tool_call_id==='owned-file-list').content);
  assert.deepEqual(listed.artifacts,names.slice(0,2).map(name=>({name,url:`/api/jobs/${job}/artifact/${name}`})));assert.equal(listed.next_offset,2);
  assert.deepEqual(checkpoint.data.exports,[metadata]);assert.ok(!JSON.stringify(checkpoint.data.messages).includes(sentinel));assert.ok(!JSON.stringify(checkpoint.data.messages).includes('C:/private/'));
  const final=await step(s,cookie,id);assert.equal(final.data.state,'done');assert.deepEqual(final.data.exports,[metadata]);
  const history=await s.call('/api/research/history?session=session-research-0001','GET',undefined,cookie);
  assert.deepEqual(history.data.at(-1).exports,[metadata]);
  assert.equal((await get(s,foreign,id)).r.status,404);assert.deepEqual((await s.call('/api/research/history?session=session-research-0001','GET',undefined,foreign)).data,[]);
  assert.equal(s.nodeRequests.length,3);assert.equal(s.providerRequests.length,2);
  for(const request of s.providerRequests){assert.ok(!JSON.stringify(request.body).includes(sentinel));completeToolGroups(request.body.messages);}
 }finally{s.sqlite.close();}
});

test('artifact listing paginates actual names and rejects malformed IDs and page controls before node access',async()=>{
 const job='aabbccddeeff',names=Array.from({length:45},(_,i)=>`field_${String(i).padStart(2,'0')}.csv`);
 const invalid=[{id:'../config.json'},{id:job+'%2fresult.json'},{id:job,offset:-1},{id:job,offset:1.5},{id:job,limit:0},{id:job,limit:101},{id:job,limit:'40'}];
 const s=harness([provider('',[toolCall('list_job_artifacts',{id:job},'page-first'),toolCall('list_job_artifacts',{id:job,offset:40,limit:5},'page-last')]),provider('',invalid.map((args,i)=>toolCall('list_job_artifacts',args,'invalid-files-'+i)))],
  {onNode:async(record,index,value)=>Response.json({...value,artifacts:names})});
 try{
  const cookie=await visitor(s),id=await start(s,cookie);
  const first=await step(s,cookie,id);assert.ok(first.data.trace.every(t=>t.state==='done'));
  let tools=(await stored(s,id)).data.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
  assert.equal(tools[0].artifacts.length,40);assert.equal(tools[0].next_offset,40);assert.equal(tools[0].artifact_count,45);
  assert.deepEqual(tools[1].artifacts.map(a=>a.name),names.slice(40));assert.equal(tools[1].next_offset,null);
  const second=await step(s,cookie,id);assert.ok(second.data.trace.slice(-invalid.length).every(t=>t.state==='failed'));
  assert.equal(s.nodeRequests.length,2,'Malformed names and paging values must fail before requesting private task details');
  tools=(await stored(s,id)).data.messages.filter(m=>m.role==='tool').slice(-invalid.length).map(m=>JSON.parse(m.content));
  assert.ok(tools.every(r=>typeof r.error==='string'));assert.equal(s.submissions.size,0);assert.deepEqual(second.data.exports||[],[]);
 }finally{s.sqlite.close();}
});

test('unsafe artifact names never become hrefs and existing active task files are honestly marked partial',async()=>{
 const job='aabbccddeeff',unsafe=['.','../config.json','case..env','folder/result.csv','folder\\result.csv','result%2fsecret.csv','中文.csv'];
 const s=harness([provider('',[toolCall('list_job_artifacts',{id:job},'mixed-file-names'),toolCall('export_job_results',{id:job},'partial-active-export')])],
  {onNode:async(record,index,value)=>Response.json({...value,state:'RUNNING',artifacts:['run.log',...unsafe]})});
 try{
  const cookie=await visitor(s),id=await start(s,cookie),response=await step(s,cookie,id);
  assert.ok(response.data.trace.every(t=>t.state==='done'));
  const outputs=(await stored(s,id)).data.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
  for(const output of outputs){
   assert.deepEqual(output.artifacts,[{name:'run.log',url:`/api/jobs/${job}/artifact/run.log`}]);
   const unavailable=(output.unavailable_names||[]).map(value=>typeof value==='string'?value:value.name);
   for(const name of unsafe)assert.ok(unavailable.includes(name),'Explain why the actual name has no direct download: '+name);
   assert.equal(output.state,'RUNNING');
  }
  assert.equal(outputs[1].partial,true);
  assert.equal(response.data.exports[0].archive_created,false);assert.equal(response.data.exports[0].download_on_click,true);
  assert.ok(s.nodeRequests.every(r=>r.method==='GET'&&r.path==='/api/jobs/'+job));assert.equal(s.submissions.size,0);
 }finally{s.sqlite.close();}
});

test('offline, foreign, missing and empty jobs never produce invented exports or trigger downloads',async()=>{
 const job='aabbccddeeff';
 for(const kind of ['offline','foreign','missing','empty']){
  const s=harness([provider('',[toolCall('export_job_results',{id:job},'unavailable-export')])],{online:kind!=='offline',onNode:async(record,index,value)=>
   ['foreign','missing'].includes(kind)?Response.json({detail:kind==='foreign'?'任务不存在或不属于当前访客':'任务不存在'},{status:404}):Response.json({...value,artifacts:[]})});
  try{
   const cookie=await visitor(s),id=await start(s,cookie),response=await step(s,cookie,id);
   assert.equal(response.data.trace[0].state,'failed',kind);
   const result=JSON.parse((await stored(s,id)).data.messages.find(m=>m.role==='tool').content);
   assert.equal(typeof result.error,'string',kind);assert.equal(result.download,undefined);assert.equal(result.artifacts,undefined);
   assert.deepEqual(response.data.exports||[],[]);assert.equal(s.submissions.size,0);
   assert.equal(s.nodeRequests.length,kind==='offline'?0:1);assert.ok(s.nodeRequests.every(r=>r.method==='GET'&&r.path==='/api/jobs/'+job));
  }finally{s.sqlite.close();}
 }
});
