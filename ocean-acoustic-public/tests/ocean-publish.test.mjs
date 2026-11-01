import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {handleOceanPublish} from '../server/ocean-publish.mjs';
import {handleOceanData} from '../server/ocean-data.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
class Bucket{
 constructor(pageSize=1000){this.objects=new Map();this.calls=[];this.pageSize=pageSize;}
 async head(key){this.calls.push('head');const o=this.objects.get(key);return o?{key,size:o.bytes.length,customMetadata:o.metadata}:null;}
 async get(key){this.calls.push('get');const o=this.objects.get(key);return o?{size:o.bytes.length,text:async()=>o.bytes.toString(),body:new Blob([o.bytes]).stream()}:null;}
 async put(key,data,options={}){
  this.calls.push('put');
  // Conditional test and storage happen atomically, as on R2. An unconditional
  // head-then-put implementation will let both competing writes succeed.
  if(options.onlyIf?.get('If-None-Match')==='*'&&this.objects.has(key))return null;
  const bytes=Buffer.from(data);if(options.sha256)assert.equal(sha(bytes),options.sha256);
  const metadata=options.customMetadata||{};this.objects.set(key,{bytes,metadata});
  return {key,size:bytes.length,customMetadata:metadata};
 }
 async list({prefix,limit,cursor,include}){
  this.calls.push('list');
  const all=[...this.objects.entries()].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b));
  const start=Number(cursor||0),end=Math.min(all.length,start+Math.min(limit,this.pageSize));
  return {truncated:end<all.length,...(end<all.length?{cursor:String(end)}:{}),objects:all.slice(start,end).map(([key,o])=>({key,size:o.bytes.length,...(include?.includes('customMetadata')?{customMetadata:o.metadata}:{})}))};
 }
}
const request=(path,body,token='test-token')=>new Request('https://site.test/_ocean-admin/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
const item=(key,bytes)=>({key,body:Buffer.from(bytes).toString('base64'),sha256:sha(bytes)});
const environment=(pageSize)=>({DATA_PUBLISH_TOKEN:'test-token',BUCKET:new Bucket(pageSize)});

// A deliberately small, structurally complete export. Synthetic payloads here
// exercise import integrity; scientific numeric parity is tested separately.
function dataset(){
 const axes=gzipSync(JSON.stringify({lons:[-1,1],lats:[-1,1]}));
 const binary=Buffer.from([255,255,254,255,253,255,252,255]);
 const objects=[
  {key:'profiles/p00/y00_x00.json.gz',bytes:gzipSync(JSON.stringify({schema_version:1,period_id:0,tile_y:0,tile_x:0,cells:{}}))},
  {key:'terrain/axes.json.gz',bytes:axes},
  {key:'terrain/native/y000_x000.i16.bin',bytes:binary},
  {key:'terrain/preview/s004/axes.json.gz',bytes:axes},
  {key:'terrain/preview/s004/y000_x000.i16.bin',bytes:binary},
 ];
 const inventory={schema_version:1,version:'v1',objects:objects.map(o=>({key:o.key,bytes:o.bytes.length,sha256:sha(o.bytes)})),total_bytes:objects.reduce((sum,o)=>sum+o.bytes.length,0),total_objects:objects.length};
 const inventoryText=JSON.stringify(inventory);
 const manifest={schema_version:1,version:'v1',complete:true,objects_manifest_key:'objects.json',objects_manifest_sha256:sha(inventoryText),totals:{bytes:inventory.total_bytes,objects:inventory.total_objects},
  profile:{shape:[2,2],tile_size:10,lons:[-1,1],lats:[-1,1],row_fields:['depth_m','temperature_c','practical_salinity','pressure_dbar','absolute_salinity_g_kg','sound_speed_m_s'],key_template:'profiles/p{period:02d}/y{tile_y:02d}_x{tile_x:02d}.json.gz',periods:[{id:0,label:'Annual'}],source_files:[{period_id:0,temperature_file:'temperature.nc',salinity_file:'salinity.nc',temperature_sha256:sha('temperature-source'),salinity_sha256:sha('salinity-source'),depths_m:[0,10]}],method:'TEOS-10 / GSW sound_speed_t_exact',warnings:[]},
  terrain:{shape:[2,2],tile_size:300,dtype:'int16',byte_order:'little',axes_key:'terrain/axes.json.gz',key_template:'terrain/native/y{tile_y:03d}_x{tile_x:03d}.i16.bin',source_file:'etopo.grd',source_sha256:sha('terrain-source'),units:'m',preview_levels:[{stride:4,shape:[2,2],axes_key:'terrain/preview/s004/axes.json.gz',tile_size:256,key_template:'terrain/preview/s004/y{tile_y:03d}_x{tile_x:03d}.i16.bin'}]},
 };
 return {objects,inventory,inventoryText,manifest};
}
function metadata(data){return [item('manifest.json',JSON.stringify(data.manifest)),item('objects.json',data.inventoryText)];}
function activation(data){return {version:'v1',manifest_sha256:sha(JSON.stringify(data.manifest)),inventory_sha256:sha(data.inventoryText)};}
async function upload(env,objects){const r=await handleOceanPublish(request('batch',{version:'v1',objects}),env);assert.equal(r.status,200,await r.clone().text());return r.json();}

test('publisher authenticates before touching storage and rejects corrupt batches atomically',async()=>{
 const env=environment();
 assert.equal((await handleOceanPublish(request('batch',{},'bad'),env)).status,403);assert.equal(env.BUCKET.calls.length,0);
 const one=item('terrain/native/y000_x000.i16.bin',Buffer.from([1,0]));
 const bad={...item('manifest.json','{}'),sha256:'0'.repeat(64)};
 assert.equal((await handleOceanPublish(request('batch',{version:'v1',objects:[one,bad]}),env)).status,422);
 assert.equal(env.BUCKET.objects.size,0);
 assert.equal((await handleOceanPublish(request('batch',{version:'v1',objects:[item('../bad.json','{}')]}),env)).status,422);
});

test('activation requires all declared data, paginates metadata, and publishes a queryable manifest',async()=>{
 const env=environment(2),data=dataset();
 await upload(env,metadata(data));
 assert.equal((await handleOceanPublish(request('activate',activation(data)),env)).status,422);
 assert.equal(await env.BUCKET.get('ocean-data/current.json'),null);
 await upload(env,data.objects.map(o=>item(o.key,o.bytes)));
 env.BUCKET.calls=[];
 const response=await handleOceanPublish(request('activate',activation(data)),env);
 assert.equal(response.status,200,await response.clone().text());const result=await response.json();
 assert.equal(result.verified_objects,5);assert.equal(result.verified_bytes,data.inventory.total_bytes);
 assert.equal(env.BUCKET.calls.filter(c=>c==='list').length,4);assert.ok(env.BUCKET.calls.length<=50);
 const current=JSON.parse(await(await env.BUCKET.get('ocean-data/current.json')).text());assert.equal(current.version,'v1');
 const query=await handleOceanData(new Request('https://site.test/api/ocean-data'),env);
 assert.equal(query.status,200);assert.equal((await query.json()).available,true);
});

test('empty or inconsistent manifests cannot replace an active pointer',async()=>{
 const cases=[
  data=>{data.manifest={schema_version:1,version:'v1',complete:true};data.inventoryText=JSON.stringify({schema_version:1,version:'v1',objects:[],total_objects:0,total_bytes:0});},
  data=>{data.manifest.objects_manifest_sha256='f'.repeat(64);},
  data=>{data.manifest.totals.bytes++;},
  data=>{data.manifest.complete='true';},
  data=>{data.manifest.profile.source_files=[];},
  data=>{data.manifest.profile.periods=[];},
  data=>{data.manifest.profile.lats=[];},
  data=>{delete data.manifest.terrain.axes_key;},
  data=>{data.manifest.terrain.preview_levels=[];},
  data=>{data.manifest.profile.key_template='profiles/missing.json.gz';},
 ];
 for(const change of cases){
  const env=environment(),data=dataset();change(data);
  await env.BUCKET.put('ocean-data/current.json','{"version":"previous"}');
  await upload(env,[...data.objects.map(o=>item(o.key,o.bytes)),...metadata(data)]);
  const response=await handleOceanPublish(request('activate',activation(data)),env);
  assert.equal(response.status,422);assert.deepEqual(JSON.parse(await(await env.BUCKET.get('ocean-data/current.json')).text()),{version:'previous'});
 }
});

test('a self-consistent inventory still cannot omit a manifest-required native tile',async()=>{
 const env=environment(),data=dataset();
 data.inventory.objects=data.inventory.objects.filter(o=>!o.key.includes('/native/'));
 data.inventory.total_objects=data.inventory.objects.length;
 data.inventory.total_bytes=data.inventory.objects.reduce((sum,o)=>sum+o.bytes,0);
 data.inventoryText=JSON.stringify(data.inventory);
 data.manifest.objects_manifest_sha256=sha(data.inventoryText);
 data.manifest.totals={objects:data.inventory.total_objects,bytes:data.inventory.total_bytes};
 await upload(env,[...data.objects.map(o=>item(o.key,o.bytes)),...metadata(data)]);
 assert.equal((await handleOceanPublish(request('activate',activation(data)),env)).status,422);
 assert.equal(await env.BUCKET.get('ocean-data/current.json'),null);
});

test('concurrent conflicting uploads cannot overwrite an immutable version object',async()=>{
 const env=environment(),key='terrain/native/y000_x000.i16.bin';
 const values=[Buffer.from([1,0]),Buffer.from([2,0])];
 const responses=await Promise.all(values.map(bytes=>handleOceanPublish(request('batch',{version:'v1',objects:[item(key,bytes)]}),env)));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const winner=responses.findIndex(r=>r.status===200);
 assert.deepEqual(env.BUCKET.objects.get('ocean-data/v1/'+key).bytes,values[winner]);
 const retry=await upload(env,[item(key,values[winner])]);assert.equal(retry.objects[0].skipped,true);
});

test('resume checks both size and hash and stays within 32 R2 operations per batch',async()=>{
 const env=environment(),objects=Array.from({length:16},(_,i)=>item('part'+i+'.json','{"ok":true}'));
 await upload(env,objects);env.BUCKET.calls=[];
 const retried=await upload(env,objects);assert.ok(retried.objects.every(o=>o.skipped));assert.equal(env.BUCKET.calls.length,32);
 const stored=env.BUCKET.objects.get('ocean-data/v1/part0.json');stored.bytes=Buffer.from('{}');
 const response=await handleOceanPublish(request('batch',{version:'v1',objects:[objects[0]]}),env);
 assert.equal(response.status,409);assert.equal(stored.bytes.toString(),'{}');
});
