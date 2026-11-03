import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';

const region={west:95,east:145,south:-5,north:45};
const palette=[[0,[210,238,237]],[200,[136,205,216]],[1000,[55,155,185]],[3000,[26,104,157]],[6000,[19,55,110]],[11000,[10,22,60]]];
function color(z){if(z==null)return [210,210,210];if(z>=0)return [207,213,175];const depth=-z;for(let i=1;i<palette.length;i++){if(depth<=palette[i][0]){const [lo,a]=palette[i-1],[hi,b]=palette[i],t=(depth-lo)/(hi-lo);return a.map((v,j)=>Math.round(v+(b[j]-v)*t))}}return palette.at(-1)[1]}
function bounded(b){const w=Math.min(360,Math.max(.2,b.east-b.west)),h=Math.min(180,Math.max(.2,b.north-b.south));const west=Math.max(-180,Math.min(180-w,b.west)),south=Math.max(-90,Math.min(90-h,b.south));return {west,east:west+w,south,north:south+h}}
export function oceanDataQuery(params,dataVersion){const query=new URLSearchParams(params);if(dataVersion)query.set('version',dataVersion);return query}

// Ordinary wheel events belong to page scrolling. Only an explicit Ctrl gesture
// changes map bounds; buttons and keyboard remain available without that gesture.
export function handleOceanMapWheel(event,rect,setBounds){
 if(!event.ctrlKey||!rect.width||!rect.height)return false;
 event.preventDefault();
 const px=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),py=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
 setBounds(b=>{const factor=event.deltaY<0?.8:1.25,w=Math.max(.2,Math.min(360,(b.east-b.west)*factor)),h=Math.max(.2,Math.min(180,(b.north-b.south)*factor)),lon=b.west+px*(b.east-b.west),lat=b.north-py*(b.north-b.south);return bounded({west:lon-px*w,east:lon+(1-px)*w,south:lat-(1-py)*h,north:lat+py*h})});
 return true;
}

export function oceanMapPointerAction(start,event,box){
 const dx=event.clientX-start.x,dy=event.clientY-start.y;
 if(Math.hypot(dx,dy)<=6)return {type:'pick'};
 if(start.pointerType==='touch'){
  if(Math.abs(dy)>=Math.abs(dx))return {type:'page-scroll'};
  return {type:'pan',dx:-dx/box.width,dy:0};
 }
 return {type:'pan',dx:-dx/box.width,dy:dy/box.height};
}

export default function OceanMap({point,selected,onPick,dataVersion,pointSummary}){
 const [bounds,setBounds]=useState(region),[data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[offset,setOffset]=useState({x:0,y:0}),[dragging,setDragging]=useState(false);
 const canvas=useRef(null),drag=useRef(null),surface=useRef(null);
 const aspect=(bounds.east-bounds.west)*Math.max(.1,Math.cos((bounds.north+bounds.south)/2*Math.PI/180))/(bounds.north-bounds.south);
 useEffect(()=>{const node=surface.current;if(!node)return;const wheel=e=>handleOceanMapWheel(e,node.getBoundingClientRect(),setBounds);node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel)},[]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');
  const timer=setTimeout(()=>{const query=oceanDataQuery(bounds,dataVersion);fetch('/api/ocean-data/terrain?'+query,{signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(r.status===409?'环境数据版本已更新，请刷新页面后重试。':d.detail||'地形读取失败');return d}).then(d=>{if(controller.signal.aborted)return;setData({...d,viewBounds:bounds});setLoading(false)}).catch(e=>{if(!controller.signal.aborted){setError(e.message);setLoading(false);setOffset({x:0,y:0})}})},120);
  return()=>{clearTimeout(timer);controller.abort()}
 },[bounds,dataVersion]);
 useLayoutEffect(()=>{
  if(!data||!canvas.current)return;const width=data.lons.length,height=data.lats.length;if(!width||!height)return;
  canvas.current.width=width;canvas.current.height=height;const ctx=canvas.current.getContext('2d');if(!ctx)return;
  const pixels=ctx.createImageData(width,height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;pixels.data.set([...color(data.elevation_m[height-1-y][x]),255],at)}ctx.putImageData(pixels,0,0);setOffset({x:0,y:0})
 },[data]);
 function zoom(factor){setBounds(b=>{const cx=(b.west+b.east)/2,cy=(b.south+b.north)/2,w=(b.east-b.west)*factor,h=(b.north-b.south)*factor;return bounded({west:cx-w/2,east:cx+w/2,south:cy-h/2,north:cy+h/2})})}
 function pan(dx,dy){setBounds(b=>{const w=b.east-b.west,h=b.north-b.south;return bounded({west:b.west+w*dx,east:b.east+w*dx,south:b.south+h*dy,north:b.north+h*dy})})}
 function up(e){
  if(!drag.current)return;const start=drag.current;drag.current=null;setDragging(false);setOffset({x:0,y:0});
  const box=e.currentTarget.getBoundingClientRect(),action=oceanMapPointerAction(start,e,box);
  if(action.type==='page-scroll')return;
  if(action.type==='pan'){pan(action.dx,action.dy);return}
  if(!data||loading||error)return;
  const x=Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),y=Math.max(0,Math.min(1,(e.clientY-box.top)/box.height));
  onPick(Number((bounds.west+x*(bounds.east-bounds.west)).toFixed(4)),Number((bounds.north-y*(bounds.north-bounds.south)).toFixed(4)));
 }
 function marker(p,label,cls){
  const view=data?.viewBounds||region;
  if(!p||!Number.isFinite(p.lon)||!Number.isFinite(p.lat)||p.lon<view.west||p.lon>view.east||p.lat<view.south||p.lat>view.north)return null;
  return <span className={'ocean-map-marker '+cls} style={{left:(p.lon-view.west)/(view.east-view.west)*100+'%',top:(view.north-p.lat)/(view.north-view.south)*100+'%'}} title={label+' '+p.lon+'°, '+p.lat+'°'}><span>{label}</span></span>
 }
 function keyDown(e){
  if(e.key==='Enter'&&!loading&&!error&&data){e.preventDefault();onPick((bounds.west+bounds.east)/2,(bounds.south+bounds.north)/2)}
  else if(['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
   e.preventDefault();
   if(e.key==='+'||e.key==='=')zoom(.5);else if(e.key==='-')zoom(2);
   else pan(e.key==='ArrowLeft'?-.25:e.key==='ArrowRight'?.25:0,e.key==='ArrowUp'?.25:e.key==='ArrowDown'?-.25:0)
  }
 }
 return <section className="panel ocean-map-panel">
  <div className="panel-heading">海底水深地图 <span>点击海洋位置，读取温盐与声速剖面</span></div>
  <div className="ocean-map-tools"><span aria-live="polite">范围 {(bounds.east-bounds.west).toFixed(2)}° × {(bounds.north-bounds.south).toFixed(2)}°</span><button className="button" onClick={()=>setBounds(region)}>西太平洋</button><button className="button" onClick={()=>setBounds({west:-180,east:180,south:-90,north:90})}>全球</button><button className="button" onClick={()=>zoom(.5)} aria-label="放大地图">＋</button><button className="button" onClick={()=>zoom(2)} aria-label="缩小地图">－</button><button className="button" onClick={()=>pan(-.25,0)}>向西</button><button className="button" onClick={()=>pan(.25,0)}>向东</button><button className="button" onClick={()=>pan(0,.25)}>向北</button><button className="button" onClick={()=>pan(0,-.25)}>向南</button></div>
  <div className="ocean-map-frame" style={{maxWidth:Math.round(560*aspect)+'px',margin:'0 auto'}}>
   <div className="ocean-map-viewport"><div ref={surface} className="ocean-map-surface" style={{height:'auto',aspectRatio:aspect,cursor:dragging?'grabbing':'grab'}} role="button" tabIndex={0} aria-label="海底水深地图，点击选点；方向键平移，加减号缩放，回车选择中心；普通滚轮滚动页面，Ctrl加滚轮缩放" onKeyDown={keyDown}
    onPointerDown={e=>{if(e.button!==0||loading)return;drag.current={x:e.clientX,y:e.clientY,pointerType:e.pointerType};if(e.pointerType!=='touch'){e.preventDefault();setDragging(true);e.currentTarget.setPointerCapture(e.pointerId)}}}
    onPointerMove={e=>{if(!drag.current)return;const dx=e.clientX-drag.current.x,dy=e.clientY-drag.current.y;if(drag.current.pointerType==='touch'){if(Math.abs(dx)<=6||Math.abs(dx)<=Math.abs(dy))return;setDragging(true);setOffset({x:dx,y:0})}else setOffset({x:dx,y:dy})}}
    onPointerUp={up} onPointerCancel={()=>{drag.current=null;setDragging(false);setOffset({x:0,y:0})}}>
    <div className="ocean-map-layer" style={{transform:'translate3d('+offset.x+'px,'+offset.y+'px,0)'}}><canvas ref={canvas} aria-hidden="true"/>{data&&<><svg viewBox="0 0 1000 600" preserveAspectRatio="none" className="ocean-map-grid" aria-hidden="true">{[1,2,3].map(i=><g key={i}><line x1={i*250} x2={i*250} y1="0" y2="600"/><line x1="0" x2="1000" y1={i*150} y2={i*150}/></g>)}</svg>{marker(point,'所选坐标','requested')}{marker(selected,'温盐格点','selected')}</>}</div>
    {loading&&<span className={data?'ocean-map-updating':'ocean-map-overlay'} role="status">正在读取海底地形…</span>}
    {error&&<span className="ocean-map-overlay" role="alert">{error}</span>}
   </div>
   {pointSummary&&<div className="ocean-map-point-preview">{pointSummary}</div>}</div>
   <div className="ocean-map-axis"><span>{bounds.west.toFixed(2)}° 经度</span><span>{bounds.east.toFixed(2)}° 经度</span></div><div className="ocean-map-lat">纬度 {bounds.south.toFixed(2)}° — {bounds.north.toFixed(2)}°（上北下南）</div>
  </div>
  <div className="ocean-depth-legend"><span>浅海</span><i/><span>深海</span><span>0 · 200 · 1000 · 3000 · 6000 · 11000 m</span><span className="land-key">陆地</span></div>
  <p className="ocean-hint">ETOPO1 基岩地形降采样预览，深色更深；选点后读取原始网格。普通滚轮滚动页面，Ctrl＋滚轮或＋/－按钮缩放；方向键或按钮平移。触屏上下滑动滚动页面，左右拖动地图，南北用按钮。温盐为最近1°气候平均格点，沿岸可能缺测，并非实时观测。{data?.note && <> {data.note}</>}</p>
 </section>
}
