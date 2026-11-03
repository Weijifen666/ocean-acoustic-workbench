import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {setup} from './test-support.mjs';

test('cloud get_job forwards distinct node field and receiver statistics to the model',async()=>{
 const id='aabbccddeeff',field={scope:'full_depth_range_field',source_file:'summary.json',tl_unit:'dB',min_tl_db:64.3,max_tl_db:78.95,shape:[51,51]},curve={scope:'receiver_depth_range_curve',source_file:'curve.csv',tl_unit:'dB',range_unit:'m',available:true,actual_receiver_depth_m:1000,range_min_m:1000,range_max_m:5000,min_tl_db:64.3,max_tl_db:71.32};
 const detail={id,state:'SUCCEEDED',field_statistics:field,receiver_curve_statistics:curve,summary:{tl_max_db:78.95}};
 let providerCalls=0;
 const s=setup(async(_url,options)=>{
  const body=JSON.parse(options.body);providerCalls++;
  if(providerCalls===1)return Response.json({model:'fixture-model',choices:[{finish_reason:'tool_calls',message:{content:null,reasoning_content:'private protocol',tool_calls:[{id:'scoped-job',type:'function',function:{name:'get_job',arguments:JSON.stringify({id})}}]}}]});
  const result=JSON.parse(body.messages.find(message=>message.role==='tool').content);
  assert.deepEqual(result.field_statistics,field);assert.deepEqual(result.receiver_curve_statistics,curve);
  assert.notEqual(result.field_statistics.max_tl_db,result.receiver_curve_statistics.max_tl_db);
  return Response.json({model:'fixture-model',choices:[{finish_reason:'stop',message:{content:'全场最大78.95 dB；1000m接收曲线最大71.32 dB。'}}]});
 },{researchAssets:JSON.parse(readFileSync(new URL('../data/research-assets.json',import.meta.url),'utf8')),heartbeat:async()=>true,proxy:async request=>{
  const path=new URL(request.url).pathname;
  if(path==='/api/knowledge/search')return Response.json([]);
  assert.equal(path,'/api/jobs/'+id);return Response.json(detail);
 }});
 try{
  const visitor=await s.call('/api/config');await s.call('/api/config','PUT',{provider:'DeepSeek',model:'deepseek-flash',base_url:'https://api.deepseek.com',api_key:'TEST-SCOPED-JOB-KEY'},visitor.cookie);
  const created=await s.call('/api/research/chat','POST',{session:'scoped-job-session',request_id:'scoped-job-request',message:'分别解释全场和接收深度曲线的实际TL范围。',backend:'api',rounds:3,context_budget:'unlimited'},visitor.cookie);
  assert.equal(created.r.status,202);
  const path='/api/research/runs/'+created.data.id+'/step';assert.equal((await s.call(path,'POST',{},visitor.cookie)).data.state,'running');
  assert.equal((await s.call(path,'POST',{},visitor.cookie)).data.state,'done');assert.equal(providerCalls,2);
 }finally{s.sqlite.close()}
});
