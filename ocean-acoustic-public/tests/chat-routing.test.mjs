import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setup} from './test-support.mjs';

const deepseek={provider:'DeepSeek',base_url:'https://api.deepseek.com',model:'deepseek-flash',api_key:'TEST-ONLY-DEEPSEEK-KEY'};
const qwen={provider:'Qwen',base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3.7-plus',api_key:'TEST-ONLY-QWEN-KEY'};
function response(model='reported-model'){return new Response(JSON.stringify({model,choices:[{message:{content:'Answer from the mocked provider.'}}]}),{headers:{'content-type':'application/json'}})}

test('same-provider model selection retains key and records actual response identity in history',async()=>{
 const calls=[],s=setup(async(url,options)=>{calls.push({url,auth:options.headers.get('Authorization'),body:JSON.parse(options.body)});return response('deepseek-flash')});
 const a=await s.call('/api/config');await s.call('/api/config','PUT',deepseek,a.cookie);
 const selected=await s.call('/api/config','PUT',{provider:'DeepSeek',model:'deepseek-v4-pro'},a.cookie);assert(selected.data.api_key_set);
 const r=await s.call('/api/chat','POST',{message:'Munk 声速剖面',provider:'DeepSeek',model:'deepseek-v4-pro'},a.cookie);
 assert.equal(r.r.status,200);assert.equal(calls[0].auth,'Bearer '+deepseek.api_key);assert.equal(calls[0].body.model,'deepseek-v4-pro');
 assert.equal(r.data.requested_model,'deepseek-v4-pro');assert.equal(r.data.response_model,'deepseek-flash');assert.equal(r.data.model_provider,'DeepSeek');
 const history=await s.call('/api/chat/history','GET',undefined,a.cookie);assert.equal(history.data.at(-1).response_model,'deepseek-flash');assert(!JSON.stringify(history.data).includes(deepseek.api_key));s.sqlite.close();
});

test('per-message provider snapshot selects its own key without changing persisted selection',async()=>{
 const sent=[],s=setup(async(url,options)=>{sent.push({url,auth:options.headers.get('Authorization')});return response()});const a=await s.call('/api/config');
 await s.call('/api/config','PUT',deepseek,a.cookie);await s.call('/api/config','PUT',qwen,a.cookie);
 await s.call('/api/chat','POST',{message:'Munk 声速剖面',provider:'DeepSeek',model:'deepseek-flash'},a.cookie);
 assert.equal(sent[0].url,'https://api.deepseek.com/chat/completions');assert.equal(sent[0].auth,'Bearer '+deepseek.api_key);
 assert.equal((await s.call('/api/config','GET',undefined,a.cookie)).data.provider,'Qwen');s.sqlite.close();
});

test('another visitor cannot use a configured provider or inject a chat API key',async()=>{
 let calls=0;const s=setup(async()=>{calls++;return response()}),a=await s.call('/api/config'),b=await s.call('/api/config');await s.call('/api/config','PUT',deepseek,a.cookie);
 const r=await s.call('/api/chat','POST',{message:'Munk',provider:'DeepSeek',model:'deepseek-flash',api_key:deepseek.api_key},b.cookie);
 assert.equal(r.data.model_used,false);assert.equal(calls,0);assert.equal(r.data.model_provider,null);s.sqlite.close();
});

test('course mode with no evidence abstains without a paid call and tracks only own gaps',async()=>{
 let calls=0;const s=setup(async()=>{calls++;return response()}),a=await s.call('/api/config'),b=await s.call('/api/config');await s.call('/api/config','PUT',deepseek,a.cookie);
 const r=await s.call('/api/chat','POST',{message:'世界杯足球冠军是哪国',knowledge_mode:'course'},a.cookie);
 assert.equal(r.data.model_used,false);assert.equal(calls,0);assert.equal(r.data.coverage_status,'no_course_evidence');assert.deepEqual(r.data.citations,[]);
 assert.equal((await s.call('/api/knowledge/gaps','GET',undefined,a.cookie)).data.length,1);assert.deepEqual((await s.call('/api/knowledge/gaps','GET',undefined,b.cookie)).data,[]);s.sqlite.close();
});

test('general mode permits pretrained knowledge with empty sources and explicit coverage notice',async()=>{
 let body;const s=setup(async(url,options)=>{body=JSON.parse(options.body);return response('actual-model')});const a=await s.call('/api/config');await s.call('/api/config','PUT',deepseek,a.cookie);
 const r=await s.call('/api/chat','POST',{message:'世界杯足球冠军是哪国',knowledge_mode:'general'},a.cookie);
 assert.equal(r.data.model_used,true);assert.equal(r.data.knowledge_scope,'general');assert.equal(r.data.coverage_status,'no_course_evidence');assert.deepEqual(r.data.citations,[]);
 assert.match(body.messages[0].content,/允许使用模型已有的一般知识/);assert.match(body.messages[0].content,/不生成课程引用/);assert.match(r.data.coverage_notice,/未经/);s.sqlite.close();
});

test('unknown scopes/providers and malformed model IDs are rejected before generation',async()=>{
 let calls=0;const s=setup(async()=>{calls++;return response()}),a=await s.call('/api/config');await s.call('/api/config','PUT',deepseek,a.cookie);
 for(const body of [{knowledge_mode:'internet'},{provider:'unknown'},{model:123},{model:'bad\nmodel'}])assert.equal((await s.call('/api/chat','POST',{message:'Munk',...body},a.cookie)).r.status,422);
 assert.equal(calls,0);s.sqlite.close();
});
