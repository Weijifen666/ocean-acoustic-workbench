import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
test('actual Worker handles data and publishing before the offline MATLAB bridge',async()=>{
 const result=await build({entryPoints:['worker.mjs'],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,plugins:[{name:'static-fixture',setup(b){b.onResolve({filter:/generated-assets\.mjs$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const FILES={};export const GRAPH={nodes:[],edges:[]};export const MODELS={providers:[],models:[]};export const SOURCES=[];export const TEMPLATE="";export const EXERCISES=[];export const OCEAN_SOURCES=[];export const OCEAN_CHUNKS=[];export const RESEARCH_ASSETS={};',loader:'js'}));}}]});
 const worker=(await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))).default;
 const env={BUCKET:{get:async()=>null},DB:{prepare:()=>{throw Error('Data APIs must never read bridge DB');}}};
 let r=await worker.fetch(new Request('https://site.test/api/ocean-data'),env,{});assert.equal(r.status,503);assert.equal((await r.json()).code,'ocean_data_unavailable');
 r=await worker.fetch(new Request('https://site.test/_ocean-admin/batch',{method:'POST',body:'{}'}),env,{});assert.equal(r.status,403);
});
