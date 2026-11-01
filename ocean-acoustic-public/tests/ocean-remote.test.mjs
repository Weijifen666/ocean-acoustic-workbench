import test from 'node:test';
import assert from 'node:assert/strict';
import {handleOceanData} from '../server/ocean-data.mjs';
test('existing Site reuses data without forwarding identity or model secrets',async()=>{
 let called;
 const request=new Request('https://course.test/api/ocean-data/profile?lon=120&lat=20&period=13&version=v1',{headers:{cookie:'private-cookie',Authorization:'private-token','oai-authenticated-user-id':'private-user'}});
 const response=await handleOceanData(request,{OCEAN_DATA_REMOTE_URL:'https://data.chatgpt.site'},{fetcher:async(url,options)=>{called={url,options};return new Response(JSON.stringify({rows:[],dataset_version:'v1'}),{headers:{'content-type':'application/json','x-ocean-data-version':'v1'}})}});
 assert.equal(response.status,200);assert.equal(response.headers.get('x-ocean-data-version'),'v1');
 assert.equal(called.url,'https://data.chatgpt.site/api/ocean-data/profile?lon=120&lat=20&period=13&version=v1');
 assert.deepEqual(called.options.headers,{Accept:'application/json'});assert.equal(called.options.redirect,'manual');
});
test('upstream version conflicts survive and unsafe origins never receive a request',async()=>{
 const request=new Request('https://course.test/api/ocean-data');
 for(const origin of ['http://data.chatgpt.site','https://user:pass@data.chatgpt.site','https://127.0.0.1','https://data.chatgpt.site/private']){
  const response=await handleOceanData(request,{OCEAN_DATA_REMOTE_URL:origin},{fetcher:()=>{throw Error('must not fetch')}});assert.equal(response.status,503);
 }
 const response=await handleOceanData(request,{OCEAN_DATA_REMOTE_URL:'https://data.chatgpt.site'},{fetcher:async()=>new Response(JSON.stringify({code:'ocean_data_version_changed'}),{status:409,headers:{'content-type':'application/json'}})});
 assert.equal(response.status,409);assert.equal((await response.json()).code,'ocean_data_version_changed');
});
