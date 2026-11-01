import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {handleOceanData} from '../server/ocean-data.mjs';

// Real, deliberately small WOA18 A5B7 / ETOPO1 export subset. All scientific
// values are copied from the teacher's files, never synthesized examples.
// The fixture is NOT a full production dataset: MockR2 overrides complete=true
// solely to test queries against its retained cells/tiles.
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/ocean-data-real.json.gz',import.meta.url))));
const prefix='ocean-data/woa18-etopo1-v1';
const clone=x=>JSON.parse(JSON.stringify(x));
class MockR2 {
  constructor({complete=true}={}) {
    this.objects=new Map();this.reads=[];
    this.putJSON('ocean-data/current.json',{version:fixture.manifest.version,manifest_key:`${prefix}/manifest.json`});
    this.putJSON(`${prefix}/manifest.json`,{...clone(fixture.manifest),complete});
    for(const [key,value] of Object.entries(fixture.objects))this.objects.set(`${prefix}/${key}`,Buffer.from(value,'base64'));
    for(const [key,value] of Object.entries(fixture.profile_tiles))this.putGzip(`${prefix}/${key}`,value);
  }
  putJSON(key,value){this.objects.set(key,Buffer.from(JSON.stringify(value)));}
  putGzip(key,value){this.objects.set(key,gzipSync(JSON.stringify(value)));}
  async get(key){
    this.reads.push(key);const bytes=this.objects.get(key);
    if(!bytes)return null;
    return {size:bytes.length,body:new Blob([bytes]).stream(),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  }
}
async function query(bucket,path='/api/ocean-data') {
  const response=await handleOceanData(new Request('https://workbench.test'+path),{BUCKET:bucket});
  return {response,body:await response.json()};
}
function cell(period,iy,ix) {
  const path=`profiles/p${String(period).padStart(2,'0')}/y${String(Math.floor(iy/10)).padStart(2,'0')}_x${String(Math.floor(ix/10)).padStart(2,'0')}.json.gz`;
  return fixture.profile_tiles[path].cells[String(iy*360+ix)];
}
const axes=JSON.parse(gunzipSync(Buffer.from(fixture.objects['terrain/axes.json.gz'],'base64')));
function closest(axis,v){let best=0;for(let i=1;i<axis.length;i++)if(Math.abs(axis[i]-v)<Math.abs(axis[best]-v))best=i;return best;}
function native(lon,lat) {
  const x=closest(axes.lons,lon),y=closest(axes.lats,lat),tx=Math.floor(x/300),ty=Math.floor(y/300);
  const path=`terrain/native/y${String(ty).padStart(3,'0')}_x${String(tx).padStart(3,'0')}.i16.bin`;
  const bytes=Buffer.from(fixture.objects[path],'base64'),width=Math.min(300,axes.lons.length-tx*300);
  return {lon:axes.lons[x],lat:axes.lats[y],elevation_m:bytes.readInt16LE(((y%300)*width+x%300)*2)};
}

test('scientific fixture records provenance and unchanged source tile hashes',()=>{
  assert.match(fixture.notice,/Not a production complete dataset/);
  assert.equal(fixture.manifest.complete,false);
  assert.equal(fixture.manifest.source_dataset,'WOA18 A5B7 2005—2017 + ETOPO1 Bedrock');
  for(const [key,hash] of Object.entries(fixture.sha256))assert.equal(createHash('sha256').update(Buffer.from(fixture.objects[key],'base64')).digest('hex'),hash);
  for(const source of fixture.manifest.profile.source_files){assert.match(source.temperature_sha256,/^[a-f0-9]{64}$/);assert.match(source.salinity_sha256,/^[a-f0-9]{64}$/);}
});

test('catalog is independent of bridge heartbeat and local files',async()=>{
  const bucket=new MockR2(),{response,body}=await query(bucket);
  assert.equal(response.status,200);assert.equal(body.available,true);assert.equal(body.requires_local_data,false);
  assert.equal(body.data_mode,'cloud');assert.equal(body.periods.length,17);
  assert.equal(body.version,fixture.manifest.version);assert.equal(body.path,'云端数据服务');
  assert.deepEqual(bucket.reads,['ocean-data/current.json',`${prefix}/manifest.json`]);
  assert.equal(response.headers.get('x-ocean-data-version'),body.version);
});

test('unpublished and incomplete data return explicit 503, never fake profiles',async()=>{
  for(const bucket of [new MockR2({complete:false}),{get:async()=>null}]){
    const {response,body}=await query(bucket);
    assert.equal(response.status,503);assert.match(body.detail,/发布|缺失/);assert.equal(body.available,undefined);
  }
  const response=await handleOceanData(new Request('https://workbench.test/api/ocean-data'),{});
  assert.equal(response.status,503);
});

test('real annual/monthly/seasonal profiles preserve exact values, depths, missing mask and different seabeds',async()=>{
  for(const period of [0,1,13])for(const [lon,lat,iy,ix] of [[120,20,109,299],[120.2,20.2,110,300]]){
    const bucket=new MockR2(),{response,body}=await query(bucket,`/api/ocean-data/profile?lon=${lon}&lat=${lat}&period=${period}`);
    assert.equal(response.status,200,JSON.stringify(body));
    const expected=cell(period,iy,ix);
    assert.deepEqual(body.selected,{lon:fixture.manifest.profile.lons[ix],lat:fixture.manifest.profile.lats[iy]});
    assert.deepEqual(body.rows.map(row=>fixture.manifest.profile.row_fields.map(k=>row[k])),expected.rows);
    assert.deepEqual(body.missing_depths_m,expected.missing_depths_m);
    assert.equal(body.missing_or_excluded_layers,expected.missing_or_excluded_layers);
    assert.deepEqual(body.bottom,native(lon,lat));assert.deepEqual(body.grid_bottom,expected.grid_bottom);
    assert.equal(body.depth_limit_m,expected.depth_limit_m);
    assert.notEqual(body.bottom.elevation_m,body.grid_bottom.elevation_m);
    assert(body.warnings.some(x=>x.includes('非实时')));
    if(period===1)assert(body.depth_limit_m<=1500);
  }
});

test('WOA and native terrain block boundaries use global indices and real source cells',async()=>{
  const bucket=new MockR2();
  for(const [lon,lat] of [[119.98,19.98],[120.02,19.98],[119.98,20.02],[120.02,20.02]]){
    const {response,body}=await query(bucket,`/api/ocean-data/profile?lon=${lon}&lat=${lat}&period=13`);
    assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(body.bottom,native(lon,lat));
    const ix=lon<120?299:300,iy=lat<20?109:110;
    assert.deepEqual(body.rows.map(row=>fixture.manifest.profile.row_fields.map(k=>row[k])),cell(13,iy,ix).rows);
  }
  assert(bucket.reads.some(k=>k.endsWith('profiles/p13/y10_x29.json.gz')));
  assert(bucket.reads.some(k=>k.endsWith('profiles/p13/y11_x30.json.gz')));
  for(const y of ['021','022'])for(const x of ['059','060'])assert(bucket.reads.some(k=>k.endsWith(`terrain/native/y${y}_x${x}.i16.bin`)));
});

test('longitude +180 normalizes to -180 and circular WOA tie selects first index',async()=>{
  const {response,body}=await query(new MockR2(),'/api/ocean-data/profile?lon=180&lat=20&period=0');
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.requested.lon,-180);
  assert.equal(body.selected.lon,-179.5);assert.equal(body.selected.lat,19.5);
  assert.deepEqual(body.bottom,native(-180,20));
  assert.deepEqual(body.rows.map(row=>fixture.manifest.profile.row_fields.map(k=>row[k])),cell(0,109,0).rows);
});

test('requested land is rejected before loading a WOA tile',async()=>{
  const bucket=new MockR2(),{response,body}=await query(bucket,'/api/ocean-data/profile?lon=120.5&lat=22.5&period=0');
  assert(native(120.5,22.5).elevation_m>=0);assert.equal(response.status,422);
  assert.equal(body.code,'ocean_point_on_land');assert(!bucket.reads.some(k=>k.includes('/profiles/')));
});

test('ocean coordinate whose nearest WOA cell is land is not moved across the coast',async()=>{
  let point;
  for(let y=22.05;y<22.95&&!point;y+=.1)for(let x=120.05;x<120.95&&!point;x+=.1)if(native(x,y).elevation_m<0)point={lon:x,lat:y};
  assert(point,'Real fixture must contain a coastal ocean coordinate');
  const {response,body}=await query(new MockR2(),`/api/ocean-data/profile?lon=${point.lon}&lat=${point.lat}&period=0`);
  assert.equal(response.status,422);assert.match(body.detail,/陆地|跨海岸/);
});

test('invalid coordinates, periods and extents return 422',async()=>{
  for(const suffix of ['lon=181','lon=-181','lat=91','lat=-91','lon=NaN','lon=Infinity','lon=','period=17','period=-1','period=1.5']){
    const {response}=await query(new MockR2(),'/api/ocean-data/profile?'+suffix);assert.equal(response.status,422,suffix);
  }
  for(const suffix of ['west=145&east=95','west=-181','north=91','west=100&east=100.01','south=NaN']){
    const {response}=await query(new MockR2(),'/api/ocean-data/terrain?'+suffix);assert.equal(response.status,422,suffix);
  }
});

test('map previews preserve real source tile values across preview block edges and stay bounded',async()=>{
  // These extents require preview levels and only use the real preview blocks
  // retained by the small scientific fixture. Default-view fine levels are
  // additionally checked against the complete real export outside this fixture.
  for(const suffix of ['west=-20&east=140&south=-40&north=40','west=-180&east=180&south=-90&north=90']){
    const bucket=new MockR2(),{response,body}=await query(bucket,'/api/ocean-data/terrain?'+suffix);
    assert.equal(response.status,200,JSON.stringify(body));assert(body.lons.length<=240);assert(body.lats.length<=160);
    const level=fixture.manifest.terrain.preview_levels.find(l=>l.stride===body.preview_stride);
    const levelAxes=JSON.parse(gunzipSync(Buffer.from(fixture.objects[level.axes_key],'base64')));
    for(let y=0;y<body.lats.length;y++)for(let x=0;x<body.lons.length;x++){
      const iy=levelAxes.lats.indexOf(body.lats[y]),ix=levelAxes.lons.indexOf(body.lons[x]);assert(iy>=0&&ix>=0);
      const ty=Math.floor(iy/256),tx=Math.floor(ix/256),key=`terrain/preview/s${String(level.stride).padStart(3,'0')}/y${String(ty).padStart(3,'0')}_x${String(tx).padStart(3,'0')}.i16.bin`;
      const bytes=Buffer.from(fixture.objects[key],'base64'),width=Math.min(256,levelAxes.lons.length-tx*256);
      assert.equal(body.elevation_m[y][x],bytes.readInt16LE(((iy%256)*width+ix%256)*2));
    }
    assert(bucket.reads.filter(k=>k.includes('/terrain/preview/')&&k.endsWith('.bin')).length<=16);
    if(suffix.startsWith('west=-20')){
      assert(bucket.reads.some(k=>k.endsWith('y000_x000.i16.bin')));
      assert(bucket.reads.some(k=>k.endsWith('y000_x001.i16.bin')));
    }else{
      assert.equal(body.preview_stride,64);assert.equal(body.lons.length,240);assert.equal(body.lats.length,160);
    }
  }
});

test('close map zoom reuses native blocks and retains exact original coordinates and heights',async()=>{
  const bucket=new MockR2(),{response,body}=await query(bucket,'/api/ocean-data/terrain?west=119.9&east=120.1&south=19.9&north=20.1');
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.preview_stride,1);
  assert.ok(body.lons.length>=12&&body.lats.length>=12);
  assert.ok(body.lons.length<=240&&body.lats.length<=160);
  for(let y=0;y<body.lats.length;y++)for(let x=0;x<body.lons.length;x++){
    const expected=native(body.lons[x],body.lats[y]);
    assert.equal(expected.lon,body.lons[x]);assert.equal(expected.lat,body.lats[y]);
    assert.equal(body.elevation_m[y][x],expected.elevation_m);
  }
  assert.equal(bucket.reads.filter(k=>k.includes('/terrain/native/')&&k.endsWith('.bin')).length,4);
  assert.ok(!bucket.reads.some(k=>k.includes('/terrain/preview/')));assert.ok(bucket.reads.length<=19);
});

test('version mismatch and missing/corrupt data fail explicitly',async()=>{
  let result=await query(new MockR2(),'/api/ocean-data?version=obsolete');assert.equal(result.response.status,409);
  result=await query(new MockR2(),'/api/ocean-data?version=woa18-etopo1-v1');assert.equal(result.response.status,200);
  const bucket=new MockR2();bucket.objects.delete(`${prefix}/profiles/p00/y10_x29.json.gz`);
  result=await query(bucket,'/api/ocean-data/profile');assert.equal(result.response.status,503);assert.equal(result.body.rows,undefined);
  const corrupt=new MockR2();corrupt.objects.set(`${prefix}/terrain/native/y022_x060.i16.bin`,Buffer.from([0]));
  result=await query(corrupt,'/api/ocean-data/profile');assert.equal(result.response.status,503);
});

test('immutable object cache is reused but active publication pointer is rechecked',async()=>{
  const bucket=new MockR2();await query(bucket,'/api/ocean-data/profile');
  const before=bucket.reads.length;await query(bucket,'/api/ocean-data/profile');
  assert.deepEqual(bucket.reads.slice(before),['ocean-data/current.json']);
  bucket.objects.delete('ocean-data/current.json');assert.equal((await query(bucket)).response.status,503);
});

test('unrelated routes remain untouched and unsupported methods/routes are rejected',async()=>{
  assert.equal(await handleOceanData(new Request('https://workbench.test/api/graph'),{}),null);
  assert.equal((await handleOceanData(new Request('https://workbench.test/api/ocean-data',{method:'POST'}),{})).status,405);
  assert.equal((await handleOceanData(new Request('https://workbench.test/api/ocean-data/unknown'),{})).status,404);
});
