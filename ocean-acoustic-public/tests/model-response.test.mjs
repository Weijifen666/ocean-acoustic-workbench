import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {setup} from './test-support.mjs';

const cfg={provider:'DeepSeek',model:'deepseek-flash',base_url:'https://api.deepseek.com',api_key:'TEST-ONLY-MODEL-KEY'};
const answer=(content='OK',finish_reason='stop',extra={})=>({model:'actual-provider-model',choices:[{message:{content,...extra},finish_reason}],usage:{total_tokens:12}});
async function check(fetcher,assertion,overrides){
 const s=setup(fetcher,overrides);
 try{const visitor=await s.call('/api/config');const result=await s.call('/api/models/test','POST',cfg,visitor.cookie);await assertion(result)}finally{s.sqlite.close()}
}
test('connection test overrides thinking defaults and preserves actual response metadata',async()=>{
 const catalog=JSON.parse(fs.readFileSync(new URL('../data/models.json',import.meta.url),'utf8'));
 catalog.models.find(m=>m.provider===cfg.provider&&m.id===cfg.model).request_options={thinking:{type:'enabled'}};
 await check(async(_url,options)=>{
  const payload=JSON.parse(options.body);
  assert.deepEqual(payload.thinking,{type:'disabled'});assert.equal(payload.reasoning_effort,undefined);
  assert.equal(payload.max_tokens,256);assert.equal(payload.stream,false);
  return new Response('\uFEFF \n'+JSON.stringify(answer()));
 },({r,data})=>{assert.equal(r.status,200);assert.equal(data.reply,'OK');assert.equal(data.response_model,'actual-provider-model');assert.equal(data.finish_reason,'stop');assert.equal(data.reasoning_only,false)}, {catalog});
});
test('empty, reasoning-only and truncated answers never pass the connection test',async()=>{
 for(const response of [answer(''),answer(null,'length',{reasoning_content:'PRIVATE REASONING '+cfg.api_key}),answer('OK','length'),answer('','content_filter')]){
  await check(async()=>new Response(JSON.stringify(response)),({r,data})=>{
   assert.equal(r.status,502);assert.equal(data.ok,undefined);
   assert.match(data.code,/PROVIDER_(?:EMPTY_CONTENT|INCOMPLETE_COMPLETION)/);
   assert.equal(data.diagnostic.response_model,'actual-provider-model');assert.equal(data.diagnostic.finish_reason,response.choices[0].finish_reason);
   assert(!JSON.stringify(data).includes(cfg.api_key));assert(!JSON.stringify(data).includes('PRIVATE REASONING'));
  });
 }
});
test('safe response diagnostics distinguish empty, HTML, invalid JSON and missing message',async()=>{
 for(const [text,code,format] of [['','PROVIDER_EMPTY_RESPONSE','empty'],['<html>'+cfg.api_key+'</html>','PROVIDER_HTML_RESPONSE','html'],['{"secret":"'+cfg.api_key+'"','PROVIDER_JSON_INVALID','invalid_json'],['{"choices":[]}','PROVIDER_MESSAGE_MISSING','json'],[JSON.stringify({error:{message:cfg.api_key}}),'PROVIDER_ERROR_PAYLOAD','json']]){
  await check(async()=>new Response(text),({r,data})=>{assert.equal(r.status,502);assert.equal(data.code,code);assert.equal(data.diagnostic.response_format,format);assert(!JSON.stringify(data).includes(cfg.api_key))});
 }
});
test('response stream interruption retains transport diagnosis instead of becoming a format error',async()=>{
 await check(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"choices":'));controller.error(new Error('private '+cfg.api_key))}})),({r,data})=>{
  assert.equal(r.status,502);assert.equal(data.code,'PROVIDER_NETWORK');assert.match(data.detail,/中断/);assert(!JSON.stringify(data).includes(cfg.api_key));
 });
});
test('complete SSE fallback passes while keepalive-only streams fail',async()=>{
 const sse=': keepalive\n\n'+[
  {model:'actual-stream-model',choices:[{delta:{content:'O'},finish_reason:null}]},
  {model:'actual-stream-model',choices:[{delta:{content:'K'},finish_reason:'stop'}]},
 ].map(packet=>'data: '+JSON.stringify(packet)+'\n\n').join('')+'data: [DONE]\n\n';
 await check(async()=>new Response(sse,{headers:{'content-type':'text/event-stream'}}),({r,data})=>{assert.equal(r.status,200);assert.equal(data.reply,'OK');assert.equal(data.response_model,'actual-stream-model');assert.equal(data.finish_reason,'stop');assert.equal(data.response_format,'event_stream')});
 await check(async()=>new Response(': keepalive\n\n'),({r,data})=>{assert.equal(r.status,502);assert.equal(data.code,'PROVIDER_INCOMPLETE_STREAM')});
});
test('nonstream chat never stores an empty supplier answer as model-generated success',async()=>{
 const s=setup(async()=>Response.json(answer(null,'stop',{reasoning_content:'PRIVATE'})));
 try{
  const visitor=await s.call('/api/config');await s.call('/api/config','PUT',cfg,visitor.cookie);
  const response=await s.call('/api/chat','POST',{message:'Munk 声速剖面'},visitor.cookie);
  assert.equal(response.r.status,502);assert.equal(response.data.code,'PROVIDER_EMPTY_CONTENT');
  assert.deepEqual((await s.call('/api/chat/history','GET',undefined,visitor.cookie)).data,[]);
 }finally{s.sqlite.close()}
});
