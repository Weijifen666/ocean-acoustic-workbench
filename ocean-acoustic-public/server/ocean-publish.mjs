// Administrative dataset import only. Never ship this token to the browser.
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const encoder=new TextEncoder();
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
const digest=async b=>hex(await crypto.subtle.digest('SHA-256',b));
const versionOK=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(v);
const keyOK=k=>typeof k==='string'&&k.length<200&&!k.includes('..')&&/^[a-zA-Z0-9_/-]+\.(json(?:\.gz)?|i16\.bin)$/.test(k);
const hashOK=h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
const positive=n=>Number.isSafeInteger(n)&&n>0;
const shapeOK=s=>Array.isArray(s)&&s.length===2&&s.every(n=>positive(n)&&n<=30000);
const axisOK=a=>Array.isArray(a)&&a.length>=2&&a.every((n,i)=>Number.isFinite(n)&&(!i||n>a[i-1]));
const textOK=s=>typeof s==='string'&&s.length>0;
const rowFields=['depth_m','temperature_c','practical_salinity','pressure_dbar','absolute_salinity_g_kg','sound_speed_m_s'];

// Verify the query manifest and every object it references, rather than trusting
// a complete flag or an inventory that could omit entire data families.
function requiredManifestKeys(manifest){
 const p=manifest.profile,t=manifest.terrain;
 if(!p||!t||!shapeOK(p.shape)||!axisOK(p.lons)||!axisOK(p.lats)||p.shape[0]!==p.lats.length||p.shape[1]!==p.lons.length||p.lons.some(n=>n< -180||n>180)||p.lats.some(n=>n< -90||n>90)||!positive(p.tile_size)||p.tile_size>10||JSON.stringify(p.row_fields)!==JSON.stringify(rowFields)||!textOK(p.method))return null;
 if(!Array.isArray(p.periods)||!p.periods.length||p.periods.length>17||p.periods.some(o=>!o||!Number.isInteger(o.id)||o.id<0||o.id>16||!textOK(o.label)))return null;
 const periods=new Set(p.periods.map(o=>o.id));
 if(periods.size!==p.periods.length||!Array.isArray(p.source_files)||p.source_files.length!==periods.size)return null;
 const sources=new Set();
 for(const s of p.source_files){
  if(!s||!periods.has(s.period_id)||sources.has(s.period_id)||!textOK(s.temperature_file)||!textOK(s.salinity_file)||!hashOK(s.temperature_sha256)||!hashOK(s.salinity_sha256)||!axisOK(s.depths_m)||s.depths_m[0]<0)return null;
  sources.add(s.period_id);
 }
 if(!shapeOK(t.shape)||!positive(t.tile_size)||t.tile_size>300||t.dtype!=='int16'||t.byte_order!=='little'||!keyOK(t.axes_key)||!textOK(t.source_file)||!hashOK(t.source_sha256)||!Array.isArray(t.preview_levels)||!t.preview_levels.length||t.preview_levels.length>8)return null;
 const keys=new Set(),strides=new Set();
 const add=key=>{if(!keyOK(key)||keys.has(key)||keys.size>=30000)throw new Error('Invalid or duplicate data key');keys.add(key);};
 const tiles=(grid,period)=>{
  if(!textOK(grid.key_template)||grid.key_template.length>=200)throw new Error('Invalid key template');
  const ny=Math.ceil(grid.shape[0]/grid.tile_size),nx=Math.ceil(grid.shape[1]/grid.tile_size);
  if(ny*nx+keys.size>30000)throw new Error('Too many data keys');
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
   const values={period,tile_y:y,tile_x:x,tileY:y,tileX:x};
   const key=grid.key_template.replace(/\{(\w+)(?::0?(\d+)d)?\}/g,(_,name,width)=>{
    if(!Number.isInteger(values[name])||(width&&Number(width)>6))throw new Error('Invalid template field');
    return String(values[name]).padStart(Number(width||0),'0');
   });
   add(key);
  }
 };
 try{
  for(const period of periods)tiles(p,period);
  add(t.axes_key);tiles(t);
  for(const level of t.preview_levels){
   if(!level||!positive(level.stride)||strides.has(level.stride)||!shapeOK(level.shape)||!positive(level.tile_size)||level.tile_size>256||!keyOK(level.axes_key))return null;
   const sampled=t.shape.map(n=>Math.floor((n-1)/level.stride)+1+((n-1)%level.stride?1:0));
   if(level.shape.some((n,i)=>n!==sampled[i]))return null;
   strides.add(level.stride);add(level.axes_key);tiles(level);
  }
 }catch{return null;}
 return keys;
}
async function authorized(request,env){
 if(!env.DATA_PUBLISH_TOKEN)return false;
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token)return false;
 const a=await digest(encoder.encode(token)),b=await digest(encoder.encode(env.DATA_PUBLISH_TOKEN));
 let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;
}
export async function handleOceanPublish(request,env){
 const path=new URL(request.url).pathname;if(!path.startsWith('/_ocean-admin/'))return null;
 if(request.method!=='POST')return reply({detail:'仅支持 POST'},405);
 if(!await authorized(request,env))return reply({detail:'不可访问'},403);
 if(!env.BUCKET)return reply({detail:'R2 未连接'},503);
 if(Number(request.headers.get('content-length')||0)>12000000)return reply({detail:'批次过大'},413);
 const raw=await request.text();if(raw.length>12000000)return reply({detail:'批次过大'},413);
 let body;try{body=JSON.parse(raw)}catch{return reply({detail:'JSON 无效'},422)}
 if(!versionOK(body.version))return reply({detail:'版本标识无效'},422);
 const prefix='ocean-data/'+body.version+'/';
 if(path==='/_ocean-admin/batch'){
  if(!Array.isArray(body.objects)||!body.objects.length||body.objects.length>16)return reply({detail:'每批需要1—16个对象'},422);
  // Validate every item before the first write, including its exact byte hash.
  const items=[];const seen=new Set();
  for(const item of body.objects){
   if(!keyOK(item.key)||seen.has(item.key)||!/^[a-f0-9]{64}$/.test(item.sha256||'')||typeof item.body!=='string')return reply({detail:'对象描述无效'},422);
   seen.add(item.key);let bytes;try{if(Uint8Array.fromBase64)bytes=Uint8Array.fromBase64(item.body);else{const decoded=atob(item.body);bytes=new Uint8Array(decoded.length);for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i)}}catch{return reply({detail:'对象编码无效'},422)}
   if(bytes.byteLength>4000000||await digest(bytes)!==item.sha256)return reply({detail:'对象哈希或体积校验失败'},422);
   items.push({...item,bytes});
  }
  const receipts=[];
  for(const item of items){
   const key=prefix+item.key;
   const stored=await env.BUCKET.put(key,item.bytes,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:item.sha256,customMetadata:{sha256:item.sha256},httpMetadata:{contentType:item.key.endsWith('.json')?'application/json':'application/octet-stream'}});
   if(stored===null){
    const existing=await env.BUCKET.head(key);
    if(!existing||existing.customMetadata?.sha256!==item.sha256||existing.size!==item.bytes.byteLength)return reply({detail:'版本对象已存在且内容不同，请使用新版本'},409);
   }
   receipts.push({key:item.key,sha256:item.sha256,bytes:item.bytes.byteLength,skipped:stored===null});
  }
  return reply({ok:true,version:body.version,objects:receipts});
 }
 if(path==='/_ocean-admin/activate'){
  const object=await env.BUCKET.get(prefix+'manifest.json'),inventoryObject=await env.BUCKET.get(prefix+'objects.json');
  if(!object||!inventoryObject)return reply({detail:'发布清单缺失'},422);
  const manifestText=await object.text(),inventoryText=await inventoryObject.text();
  if(await digest(encoder.encode(manifestText))!==body.manifest_sha256||await digest(encoder.encode(inventoryText))!==body.inventory_sha256)return reply({detail:'清单哈希不一致'},422);
  let manifest,inventory;try{manifest=JSON.parse(manifestText);inventory=JSON.parse(inventoryText)}catch{return reply({detail:'发布清单 JSON 无效'},422)}
  if(!manifest||!inventory||manifest.complete!==true||manifest.schema_version!==1||manifest.version!==body.version||inventory.schema_version!==1||inventory.version!==body.version||!Array.isArray(inventory.objects)||!inventory.objects.length)return reply({detail:'只允许激活完整且版本一致的数据'},422);
  if(inventory.objects.length>30000)return reply({detail:'对象数量超过首版发布范围'},422);
  if(manifest.objects_manifest_key!=='objects.json'||manifest.objects_manifest_sha256!==body.inventory_sha256||!positive(inventory.total_objects)||!positive(inventory.total_bytes)||manifest.totals?.objects!==inventory.total_objects||manifest.totals?.bytes!==inventory.total_bytes)return reply({detail:'主清单与对象清单不一致'},422);
  if(inventory.objects.some(o=>!o||!keyOK(o.key)||!positive(o.bytes)||o.bytes>4000000||!hashOK(o.sha256))||inventory.total_objects!==inventory.objects.length||inventory.total_bytes!==inventory.objects.reduce((sum,o)=>sum+o.bytes,0))return reply({detail:'对象清单描述或统计无效'},422);
  const required=requiredManifestKeys(manifest);
  if(!required||required.size!==inventory.objects.length||inventory.objects.some(o=>!required.has(o.key)))return reply({detail:'数据清单结构无效或必需数据块缺失'},422);
  const expected=new Map(inventory.objects.map(o=>[prefix+o.key,o]));
  if(expected.size!==inventory.objects.length||inventory.objects.some(o=>!keyOK(o.key)))return reply({detail:'对象清单重复或无效'},422);
  let cursor,checked=0,total=0,pages=0;
  do{
   const page=await env.BUCKET.list({prefix,limit:1000,include:['customMetadata'],...(cursor?{cursor}:{})});
   for(const o of page.objects){const e=expected.get(o.key);if(!e)continue;if(o.size!==e.bytes||o.customMetadata?.sha256!==e.sha256)return reply({detail:'远端对象校验失败',key:e.key},422);expected.delete(o.key);checked++;total+=o.size;}
   cursor=page.truncated?page.cursor:undefined;
   if(++pages>40)return reply({detail:'发布校验分页过多'},422);
  }while(cursor);
  if(expected.size)return reply({detail:'仍有对象未上传',missing:Array.from(expected.values()).slice(0,10).map(o=>o.key),count:expected.size},422);
  if(total!==inventory.total_bytes||checked!==inventory.total_objects)return reply({detail:'清单统计不一致'},422);
  const current={schema_version:1,version:body.version,prefix:prefix.slice(0,-1),manifest_key:prefix+'manifest.json',manifest_sha256:body.manifest_sha256,inventory_sha256:body.inventory_sha256,activated_at:new Date().toISOString()};
  // The active pointer changes only after all immutable objects have passed verification.
  await env.BUCKET.put('ocean-data/current.json',JSON.stringify(current),{httpMetadata:{contentType:'application/json'}});
  return reply({ok:true,...current,verified_objects:checked,verified_bytes:total});
 }
 return reply({detail:'管理路由不存在'},404);
}
