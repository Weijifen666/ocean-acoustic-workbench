// Read versioned, bounded subsets from R2. No MATLAB node or original NetCDF is
// needed at request time; the export preserves the original grid and masks.
const CURRENT = 'ocean-data/current.json';
const ROW_FIELDS = ['depth_m','temperature_c','practical_salinity','pressure_dbar','absolute_salinity_g_kg','sound_speed_m_s'];
const MAX_CACHE = 12 * 1024 * 1024;
const MAX_JSON = 8 * 1024 * 1024;
const MAX_TILES = 16;
const caches = new WeakMap();

class DataError extends Error {
  constructor(status, detail, code = 'ocean_data_unavailable') { super(detail); this.status = status; this.code = code; }
}
const unavailable = detail => new DataError(503, detail || '云端海洋数据尚未发布或发布不完整，请联系维护者完成数据发布。');
function json(value, status = 200, version) {
  return new Response(JSON.stringify(value), {status, headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':status === 200 ? 'public, max-age=300' : 'no-store',
    'X-Content-Type-Options':'nosniff',
    ...(version ? {'X-Ocean-Data-Version':version} : {}),
  }});
}
function cacheFor(bucket) {
  if (!caches.has(bucket)) caches.set(bucket, {entries:new Map(), bytes:0});
  return caches.get(bucket);
}
async function boundedBytes(stream, limit) {
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw unavailable('云端数据块超过读取限制。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}
async function readObject(bucket, key, kind = 'json', cache = true) {
  const state = cacheFor(bucket), id = `${kind}:${key}`;
  if (cache && state.entries.has(id)) {
    const saved = state.entries.get(id);
    state.entries.delete(id); state.entries.set(id, saved);
    return saved.value;
  }
  const object = await bucket.get(key);
  if (!object) throw unavailable('云端海洋数据对象缺失，请联系维护者校验发布完整性。');
  if (object.size > MAX_JSON) throw unavailable('云端数据块超过读取限制。');
  let body = object.body;
  if (!body) body = new Blob([await object.arrayBuffer()]).stream();
  if (kind === 'gzip') body = body.pipeThrough(new DecompressionStream('gzip'));
  const bytes = await boundedBytes(body, MAX_JSON);
  const value = kind === 'binary' ? bytes : JSON.parse(new TextDecoder().decode(bytes));
  // Parsed JSON generally costs more than the serialized bytes. Conservatively
  // account for this while keeping all isolates far below the Worker heap limit.
  const cost = bytes.byteLength * (kind === 'binary' ? 1 : 3);
  if (cache && cost <= MAX_CACHE) {
    while (state.bytes + cost > MAX_CACHE && state.entries.size) {
      const first = state.entries.keys().next().value;
      state.bytes -= state.entries.get(first).cost; state.entries.delete(first);
    }
    state.entries.set(id, {value, cost}); state.bytes += cost;
  }
  return value;
}
function relativeKey(prefix, key) {
  if (typeof key !== 'string' || !key || key.startsWith('/') || key.includes('..') || key.includes('\\') || key.includes('://')) throw unavailable('云端数据索引无效。');
  return `${prefix}/${key}`;
}
function renderKey(template, values) {
  values = {...values,tile_y:values.tileY,tile_x:values.tileX};
  if (typeof template !== 'string') throw unavailable('云端数据索引模板无效。');
  return template.replace(/\{(\w+)(?::0?(\d+)d)?\}/g, (_, key, width) => {
    if (!Number.isInteger(values[key])) throw unavailable('云端数据索引模板无效。');
    return String(values[key]).padStart(Number(width || 0), '0');
  });
}
function axisValid(axis) {
  return Array.isArray(axis) && axis.length > 0 && axis.every((x, i) => Number.isFinite(x) && (!i || x > axis[i-1]));
}
async function dataset(bucket, url) {
  const current = await readObject(bucket, CURRENT, 'json', false);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(current.version || '')) throw unavailable();
  if (url.searchParams.has('version') && url.searchParams.get('version') !== current.version) throw new DataError(409, '海洋数据版本已更新，请刷新页面后重试。', 'ocean_data_version_changed');
  const prefix = `ocean-data/${current.version}`;
  const key = current.manifest_key || `${prefix}/manifest.json`;
  if (key !== `${prefix}/manifest.json`) throw unavailable('云端数据版本索引无效。');
  const manifest = await readObject(bucket, key);
  if (manifest.schema_version !== 1 || manifest.version !== current.version || manifest.complete !== true) throw unavailable();
  const p = manifest.profile, t = manifest.terrain;
  if (!p || !t || !axisValid(p.lons) || !axisValid(p.lats) || !Number.isInteger(p.tile_size) || p.tile_size < 1 || p.tile_size > 10 || !Number.isInteger(t.tile_size) || t.tile_size < 1 || t.tile_size > 300 || p.shape?.[0] !== p.lats.length || p.shape?.[1] !== p.lons.length || JSON.stringify(p.row_fields) !== JSON.stringify(ROW_FIELDS)) throw unavailable('云端数据清单无效。');
  return {manifest, prefix, bucket, version:current.version};
}
function numberParam(params, key, fallback) {
  const raw = params.get(key);
  const value = raw === null ? fallback : raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(value)) throw new DataError(422, `参数 ${key} 必须是有限数值。`, 'invalid_ocean_query');
  return value;
}
function nearest(axis, value, circular = false) {
  let best = 0, distance = Infinity;
  for (let i = 0; i < axis.length; i++) {
    const d = circular ? Math.abs(((axis[i] - value + 180) % 360 + 360) % 360 - 180) : Math.abs(axis[i] - value);
    if (d < distance) { best = i; distance = d; }
  }
  return best;
}
async function nativeAxes(data) {
  const axes = await readObject(data.bucket, relativeKey(data.prefix, data.manifest.terrain.axes_key), 'gzip');
  const shape = data.manifest.terrain.shape;
  if (!axisValid(axes.lons) || !axisValid(axes.lats) || shape?.[0] !== axes.lats.length || shape?.[1] !== axes.lons.length) throw unavailable('云端地形坐标无效。');
  return axes;
}
async function elevation(data, axes, lon, lat) {
  const terrain = data.manifest.terrain, ix = nearest(axes.lons, lon), iy = nearest(axes.lats, lat);
  const tileX = Math.floor(ix/terrain.tile_size), tileY = Math.floor(iy/terrain.tile_size);
  const key = renderKey(terrain.key_template, {tileX,tileY});
  const bytes = await readObject(data.bucket, relativeKey(data.prefix,key), 'binary');
  const width = Math.min(terrain.tile_size, axes.lons.length - tileX*terrain.tile_size);
  const height = Math.min(terrain.tile_size, axes.lats.length - tileY*terrain.tile_size);
  if (bytes.byteLength !== width*height*2) throw unavailable('云端地形块长度校验失败。');
  const at = ((iy%terrain.tile_size)*width + ix%terrain.tile_size)*2;
  return {lon:axes.lons[ix],lat:axes.lats[iy],elevation_m:new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getInt16(at,true)};
}
async function profile(data, params) {
  let lon = numberParam(params,'lon',120);
  const lat = numberParam(params,'lat',20), period = numberParam(params,'period',0);
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90 || !Number.isInteger(period) || period < 0 || period > 16) throw new DataError(422,'经纬度或时段超出范围。','invalid_ocean_query');
  if (lon === 180) lon = -180;
  const axes = await nativeAxes(data), bottom = await elevation(data,axes,lon,lat);
  if (bottom.elevation_m >= 0) throw new DataError(422,'该坐标的 ETOPO1 网格为陆地，请选择海洋位置。','ocean_point_on_land');
  const p = data.manifest.profile, ix = nearest(p.lons,lon,true), iy = nearest(p.lats,lat);
  const periodInfo = p.periods?.find(x=>x.id===period), source = p.source_files?.find(x=>x.period_id===period);
  if (!periodInfo || !source) throw unavailable('云端数据未包含所选时段。');
  const tileX = Math.floor(ix/p.tile_size), tileY = Math.floor(iy/p.tile_size);
  const tile = await readObject(data.bucket,relativeKey(data.prefix,renderKey(p.key_template,{period,tileX,tileY})),'gzip');
  if (tile.schema_version !== 1 || tile.period_id !== period || tile.tile_x !== tileX || tile.tile_y !== tileY) throw unavailable('云端温盐块索引校验失败。');
  const cell = tile.cells?.[String(iy*p.shape[1]+ix)];
  if (!cell) throw unavailable('云端数据缺少所选格点。');
  if (cell.error) throw new DataError(422,String(cell.error),'ocean_profile_unavailable');
  if (!Number.isFinite(cell.grid_bottom?.elevation_m)) throw unavailable('云端剖面海底信息无效。');
  if (cell.grid_bottom.elevation_m >= 0) throw new DataError(422,'最近的1°温盐网格位于陆地，未自动跨海岸寻找其他剖面。','ocean_profile_on_land');
  if (!Array.isArray(cell.rows) || cell.rows.length < 2) throw new DataError(422,'最近的温盐网格有效层不足，未填补缺测。','ocean_profile_insufficient');
  if (!cell.rows.every((row,i)=>Array.isArray(row) && row.length===6 && row.every(Number.isFinite) && row[0]>=0 && row[0]<=-cell.grid_bottom.elevation_m && (!i || row[0]>cell.rows[i-1][0]))) throw unavailable('云端温盐剖面数值校验失败。');
  return {
    requested:{lon,lat}, selected:{lon:p.lons[ix],lat:p.lats[iy]},
    period:periodInfo.label, period_id:period,
    rows:cell.rows.map(row=>Object.fromEntries(ROW_FIELDS.map((key,i)=>[key,row[i]]))),
    missing_depths_m:cell.missing_depths_m,
    missing_or_excluded_layers:cell.missing_or_excluded_layers,
    bottom,grid_bottom:cell.grid_bottom,depth_limit_m:cell.depth_limit_m,
    temperature_file:source.temperature_file,salinity_file:source.salinity_file,
    method:p.method,warnings:p.warnings || [],
    version:data.version,dataset_version:data.version,source_dataset:data.manifest.source_dataset,gsw_version:data.manifest.gsw_version,
  };
}
function lowerBound(axis,value) { let l=0,r=axis.length; while(l<r){const m=(l+r)>>>1;if(axis[m]<value)l=m+1;else r=m;}return l; }
function sampleAxis(axis, stride) {
  const result = axis.filter((_,i)=>i%stride===0);
  if (result.at(-1) !== axis.at(-1)) result.push(axis.at(-1));
  return result;
}
function selectedIndices(axis, low, high, limit) {
  const first = Math.min(axis.length-1,lowerBound(axis,low));
  const last = Math.min(axis.length-1,lowerBound(axis,high));
  const count = Math.min(last-first+1,limit);
  // Spread original indices across the viewport, retaining both endpoints.
  // A fixed ceil(count/limit) step can unnecessarily halve the resolution.
  return Array.from({length:count},(_,i)=>first+(count===1?0:Math.round(i*(last-first)/(count-1))));
}
async function terrainMap(data, params) {
  const west=numberParam(params,'west',95),east=numberParam(params,'east',145),south=numberParam(params,'south',-5),north=numberParam(params,'north',45);
  if (!(-180<=west && west<east && east<=180 && -90<=south && south<north && north<=90) || east-west<.1 || north-south<.1) throw new DataError(422,'地图经纬范围无效，范围不能小于0.1度。','invalid_ocean_query');
  const t=data.manifest.terrain, full=await nativeAxes(data);
  // Native blocks already exist for point queries. Reuse them for close zooms
  // while larger views use the finest preview that fits the read budget.
  const levels=[{...t,stride:1},...(t.preview_levels || []).filter(level=>level.stride!==1)].sort((a,b)=>a.stride-b.stride);
  let choice;
  for (const level of levels) {
    if (!Number.isInteger(level.stride) || level.stride<1 || !Number.isInteger(level.tile_size) || level.tile_size<1 || level.tile_size>300) throw unavailable('云端地形层级无效。');
    const lons=level.stride===1?full.lons:sampleAxis(full.lons,level.stride),lats=level.stride===1?full.lats:sampleAxis(full.lats,level.stride);
    if (level.shape?.[0]!==lats.length || level.shape?.[1]!==lons.length) throw unavailable('云端地形层级坐标校验失败。');
    const xs=selectedIndices(lons,west,east,240),ys=selectedIndices(lats,south,north,160);
    const tileXs=new Set(xs.map(x=>Math.floor(x/level.tile_size))),tileYs=new Set(ys.map(y=>Math.floor(y/level.tile_size)));
    if(tileXs.size*tileYs.size>MAX_TILES)continue;
    const tileKeys=new Set();for(const y of tileYs)for(const x of tileXs)tileKeys.add(`${y},${x}`);
    choice={level,lons,lats,xs,ys,tileKeys};break;
  }
  if (!choice) throw unavailable('地形查询超过分块读取限制。');
  const {level,lons,lats,xs,ys,tileKeys}=choice;
  const tiles=new Map();
  for(const key of tileKeys) {
    const [tileY,tileX]=key.split(',').map(Number);
    const bytes=await readObject(data.bucket,relativeKey(data.prefix,renderKey(level.key_template,{tileX,tileY,stride:level.stride})),'binary');
    const width=Math.min(level.tile_size,lons.length-tileX*level.tile_size),height=Math.min(level.tile_size,lats.length-tileY*level.tile_size);
    if (bytes.byteLength!==width*height*2) throw unavailable('地形预览块长度校验失败。');
    tiles.set(key,{width,view:new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)});
  }
  const elevation_m=ys.map(y=>xs.map(x=>{
    const key=`${Math.floor(y/level.tile_size)},${Math.floor(x/level.tile_size)}`,tile=tiles.get(key);
    return tile.view.getInt16(((y%level.tile_size)*tile.width+x%level.tile_size)*2,true);
  }));
  return {lons:xs.map(x=>lons[x]),lats:ys.map(y=>lats[y]),elevation_m,
    source:t.source || 'ETOPO1 基岩高程（m，相对海平面）',
    note:'地图为原始地形的分级采样预览；点选深度按原始网格读取。温盐采用最近1°格点。',
    preview_stride:level.stride,version:data.version};
}

export async function handleOceanData(request, env) {
  const url=new URL(request.url),path=url.pathname;
  if (path!=='/api/ocean-data' && !path.startsWith('/api/ocean-data/')) return null;
  if (!['/api/ocean-data','/api/ocean-data/profile','/api/ocean-data/terrain'].includes(path)) return json({detail:'海洋数据接口不存在。'},404);
  if (request.method!=='GET') return json({detail:'海洋数据接口只接受 GET 查询。'},405);
  try {
    if (!env?.BUCKET) throw unavailable();
    const data=await dataset(env.BUCKET,url);
    if(path==='/api/ocean-data') return json({available:true,files:[],count:data.manifest.totals?.objects || 0,bytes:data.manifest.totals?.bytes || 0,
      periods:data.manifest.profile.periods,name:'WOA18 温盐气候场与 ETOPO1 海底地形',path:'云端数据服务',method:data.manifest.profile.method,
      version:data.version,dataset_version:data.version,storage:'cloud',source_dataset:data.manifest.source_dataset,data_mode:'cloud',requires_local_data:false},200,data.version);
    const result=path.endsWith('/profile') ? await profile(data,url.searchParams) : await terrainMap(data,url.searchParams);
    return json(result,200,data.version);
  } catch(error) {
    const known=error instanceof DataError;
    return json({detail:known?error.message:'云端海洋数据读取失败，请联系维护者校验数据发布。',code:known?error.code:'ocean_data_unavailable'},known?error.status:503);
  }
}
