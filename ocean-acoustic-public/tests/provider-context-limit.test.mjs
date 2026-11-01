import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {providerResponseError} from '../server/cloud-models.mjs';
import {setup} from './test-support.mjs';

const sensitive='TEST-ONLY-SECRET-CONTENT https://private.example/request Bearer TEST-ONLY-AUTH';
const cfg={provider:'DeepSeek',base_url:'https://api.deepseek.com',model:'deepseek-flash',api_key:'TEST-ONLY-VISITOR-KEY'};
function safeDiagnostic(error){
 assert.equal(error.status,502);
 assert(!error.message.includes('TEST-ONLY'));
 assert(!error.message.includes('private.example'));
 assert(!error.message.includes('Bearer'));
 assert(!error.message.includes('https://'));
}

test('structured provider context-limit diagnostics never expose error bodies',async()=>{
 for(const payload of [
  {error:{code:'context_length_exceeded',message:sensitive}},
  {error:{message:'The context window is exhausted. '+sensitive}},
  {message:'This model maximum context length was exceeded. '+sensitive},
  {error:{message:'input tokens exceeds the supported limit. '+sensitive}},
  {error:'Prompt too long. '+sensitive},
  {error:{message:'The prompt is too long. '+sensitive}},
 ]){
  const error=await providerResponseError(Response.json(payload,{status:400}));
  safeDiagnostic(error);assert.equal(error.code,'PROVIDER_CONTEXT_LIMIT');
  assert.match(error.message,/模型自身的上下文限制/);
 }
});

test('other HTTP errors, unreadable and oversized bodies retain fixed safe diagnoses',async()=>{
 const errors=[
  await providerResponseError(Response.json({error:{message:sensitive}},{status:401})),
  await providerResponseError(new Response('<html>'+sensitive+'</html>',{status:500})),
  await providerResponseError(new Response(new ReadableStream({start(controller){controller.error(Error(sensitive))}}),{status:429})),
  await providerResponseError(Response.json({error:{message:'x'.repeat(40000)+' context window '+sensitive}},{status:413})),
 ];
 for(const error of errors){safeDiagnostic(error);assert.equal(error.code,'PROVIDER_RESPONSE');assert.match(error.message,/HTTP (401|500|429|413)/);}
 assert.match(errors[0].message,/密钥无效/);
 assert.match(errors[2].message,/频率或额度/);
});

test('real research step retains provider-context code under unlimited application budget without retry',async()=>{
 const assets=JSON.parse(readFileSync(new URL('../data/research-assets.json',import.meta.url),'utf8'));
 let calls=0;
 const s=setup(async()=>{calls++;return Response.json({error:{code:'context_length_exceeded',message:sensitive}},{status:400})},{researchAssets:assets});
 try{
  const visitor=await s.call('/api/config'),cookie=visitor.cookie;
  assert.equal((await s.call('/api/config','PUT',cfg,cookie)).r.status,200);
  const created=await s.call('/api/research/chat','POST',{session:'session-provider-limit',request_id:'request-provider-limit',message:'请解释简正波传播',backend:'api',rounds:40,context_budget:'unlimited'},cookie);
  assert.equal(created.r.status,202,JSON.stringify(created.data));
  const path=`/api/research/runs/${created.data.id}`;
  const failed=await s.call(path+'/step','POST',{},cookie);
  assert.equal(failed.data.state,'failed');
  assert.equal(failed.data.error_code,'PROVIDER_CONTEXT_LIMIT');
  assert.match(failed.data.error,/模型自身的上下文限制/);
  assert.equal(failed.data.recoverable,false);
  assert(!JSON.stringify(failed.data).includes('TEST-ONLY'));
  await s.call(path,'GET',undefined,cookie);
  await s.call(path+'/step','POST',{},cookie);
  assert.equal(calls,1);
 }finally{s.sqlite.close();}
});

test('legacy streaming chat reuses the same safe provider-context diagnostic',async()=>{
 let calls=0;
 const s=setup(async()=>{calls++;return Response.json({error:{message:'maximum context length exceeded '+sensitive}},{status:400})});
 try{
  const visitor=await s.call('/api/config'),cookie=visitor.cookie;
  await s.call('/api/config','PUT',cfg,cookie);
  const url=new URL('/api/chat','https://course.test');
  const response=await s.handler(new Request(url,{method:'POST',headers:{origin:url.origin,cookie,'content-type':'application/json'},body:JSON.stringify({message:'请解释 Munk 声道',mode:'chat',knowledge_mode:'general',stream:true,request_id:'stream-provider-limit'})}),s.env,s.ctx,url);
  const text=await response.text();
  assert.match(text,/event: error/);
  assert.match(text,/PROVIDER_CONTEXT_LIMIT/);
  assert.match(text,/模型自身的上下文限制/);
  assert(!text.includes('TEST-ONLY'));
  assert(!text.includes('private.example'));
  assert.equal(calls,1);
 }finally{s.sqlite.close();}
});
