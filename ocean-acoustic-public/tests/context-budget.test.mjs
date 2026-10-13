import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildContext,resolveBudget,assertMessagesBudget,withProviderUsage,inactiveContext,CONTEXT_BUDGETS} from '../server/context-budget.mjs';
import {setup} from './test-support.mjs';

test('allowed application budgets and auto have explicit sizes; malformed sizes are rejected',()=>{
 assert.equal(resolveBudget('auto'),32768);
 for(const size of CONTEXT_BUDGETS)assert.equal(resolveBudget(size),size);
 for(const size of [true,null,'4096',4096.5,1,1048576])assert.throws(()=>resolveBudget(size));
});
test('current question and mandatory system survive exactly; old history drops as complete turns',()=>{
 const history=Array.from({length:20},(_,i)=>[{role:'user',text:'question-'+i+'x'.repeat(100)},{role:'assistant',text:'answer-'+i+'y'.repeat(150)}]).flat();
 const a=buildContext({question:'当前问题🌊',system:'必须保留的系统说明',history,context_budget:4096});
 const b=buildContext({question:'当前问题🌊',system:'必须保留的系统说明',history,context_budget:16384});
 assert.equal(a.messages.at(-1).content,'当前问题🌊');assert(a.messages[0].content.startsWith('必须保留的系统说明'));
 assert(a.context.dropped_history_messages>0);assert.equal(a.context.history_messages_used%2,0);
 assert(b.context.history_messages_used>a.context.history_messages_used);
 assert(a.context.estimated_input_tokens<=4096-1024);
});
test('oversized current problem is rejected without truncation or automatic summarization',()=>{
 assert.throws(()=>buildContext({question:'海'.repeat(1500),system:'系统',context_budget:4096}),/调大|缩短/);
 assert.equal(buildContext({question:'海'.repeat(1500),system:'系统',context_budget:8192}).messages.at(-1).content,'海'.repeat(1500));
});
test('a nearly full old exchange cannot crowd the highest-ranked source out of a 4K request',()=>{
 const history=[{role:'user',text:'x'.repeat(1400)},{role:'assistant',text:'y'.repeat(1300)}];
 const evidence=[{id:'essential',source_id:'TEST',text:'可核查课程依据'.repeat(60),conditions:'以实际资料为依据'}];
 const historyAlone=buildContext({question:'当前问题',system:'系统',history,context_budget:4096});
 assert.equal(historyAlone.context.history_messages_used,2);
 const withSource=buildContext({question:'当前问题',system:'系统',history,evidence,context_budget:4096});
 assert.equal(withSource.context.history_messages_used,0);assert.equal(withSource.context.dropped_history_messages,2);
 assert.equal(withSource.evidence.length,1);assert.equal(withSource.evidence[0].text,evidence[0].text);
 assert.equal(withSource.context.evidence_truncated,false);assert(withSource.context.estimated_input_tokens<=3072);
});
test('only supplied evidence survives; clipped text is marked while conditions and formula remain intact',()=>{
 const rows=[{id:'first',source_id:'TEST',text:'原文🌊'.repeat(1500),formula:'TL = -20 log10 |p|',conditions:'仅相干 FIELD 归一化压力。'},{id:'dropped',source_id:'TEST',text:'low priority'}];
 const a=buildContext({question:'解释 TL',system:'系统',evidence:rows,context_budget:4096});
 assert.equal(a.evidence.length,1);assert.equal(a.evidence[0].id,'first');assert(a.evidence[0].context_truncated);
 assert.equal(a.evidence[0].formula,rows[0].formula);assert.equal(a.evidence[0].conditions,rows[0].conditions);
 assert(a.messages[0].content.includes('first'));assert(!a.messages[0].content.includes('dropped'));
 assert(a.context.evidence_truncated);assert.equal(rows[0].text,'原文🌊'.repeat(1500));
});
test('template clipping and large tool observations cannot bypass the selected budget',()=>{
 const a=buildContext({question:'阅读代码',system:'系统',template:'function example\n'+'% 测试代码\n'.repeat(1200),context_budget:4096});
 assert(a.context.template_truncated);assert(a.messages[0].content.includes('仅提供了前部片段'));
 assert.throws(()=>assertMessagesBudget([...a.messages,{role:'tool',content:'x'.repeat(10000)}],4096),/工具结果|调大/);
});
test('vendor usage and cache hits remain nullable and separate from conservative estimates',()=>{
 const inactive=inactiveContext(4096);assert.equal(inactive.applied,false);assert.equal(inactive.provider_prompt_tokens,null);assert.equal(inactive.cached_tokens,null);
 const measured=withProviderUsage({...inactive,estimated_input_tokens:2000},{prompt_tokens:321,prompt_cache_hit_tokens:120});
 assert.equal(measured.estimated_input_tokens,2000);assert.equal(measured.provider_prompt_tokens,321);assert.equal(measured.cached_tokens,120);
 assert.equal(withProviderUsage(inactive,{prompt_tokens_details:{cached_tokens:0}}).cached_tokens,0);
 assert.equal(withProviderUsage(inactive,{}).cached_tokens,null);
});
test('chat applies a 4K send budget and records only supplied citations and actual provider usage',async()=>{
 const sent=[];const s=setup(async(url,options)=>{const body=JSON.parse(options.body);sent.push(body);return new Response(JSON.stringify({model:body.model,choices:[{message:{content:'test-only reply'}}],usage:{prompt_tokens:123,prompt_tokens_details:{cached_tokens:40}}}),{headers:{'content-type':'application/json'}})});
 try{
  const a=await s.call('/api/config');await s.call('/api/config','PUT',{api_key:'TEST-ONLY-CONTEXT-KEY'},a.cookie);
  const result=await s.call('/api/chat','POST',{message:'Munk 声速剖面',context_budget:4096},a.cookie);
  assert.equal(result.r.status,200);assert.equal(sent.length,1);assert.equal(result.data.context.budget_tokens,4096);assert(result.data.context.estimated_input_tokens<=3072);
  assert.equal(result.data.context.provider_prompt_tokens,123);assert.equal(result.data.context.cached_tokens,40);
  const ids=new Set(result.data.evidence.map(row=>row.id));assert(result.data.citations.every(row=>ids.has(row.id||row.evidence_id)));
  for(const row of result.data.evidence)assert(sent[0].messages[0].content.includes(row.id));
  const saved=(await s.call('/api/chat/history','GET',undefined,a.cookie)).data.at(-1);assert.equal(saved.context.budget_tokens,4096);
 }finally{s.sqlite.close()}
});
test('oversized question is stopped before any provider request and no-key answers mark budgeting inactive',async()=>{
 let calls=0;const s=setup(async()=>{calls++;throw Error('Provider should not be called')});
 try{
  const a=await s.call('/api/config');
  const noKey=await s.call('/api/chat','POST',{message:'Munk 声速剖面',context_budget:4096},a.cookie);assert.equal(noKey.data.context.applied,false);
  await s.call('/api/config','PUT',{api_key:'TEST-ONLY-CONTEXT-KEY'},a.cookie);
  const rejected=await s.call('/api/chat','POST',{message:'海'.repeat(1500),knowledge_mode:'general',context_budget:4096},a.cookie);
  assert.equal(rejected.r.status,422);assert.equal(rejected.data.code,'CONTEXT_BUDGET_EXCEEDED');assert.equal(calls,0);
 }finally{s.sqlite.close()}
});
