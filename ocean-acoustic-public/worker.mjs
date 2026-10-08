// Public cloud UI; encrypted outbound-only bridge to the owner's MATLAB node.
import {FILES,GRAPH,MODELS,SOURCES} from './generated-assets.mjs';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const encoder=new TextEncoder();
const bytes64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
function base64(b){let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s)}
async function key(secret){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode(secret)),'AES-GCM',false,['encrypt','decrypt'])}
async function encrypt(data,secret){const iv=crypto.getRandomValues(new Uint8Array(12));const out=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(secret),encoder.encode(JSON.stringify(data))));return base64(new Uint8Array([...iv,...out]))}
async function decrypt(data,secret){const b=bytes64(data);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12)},await key(secret),b.slice(12))))}
const db=env=>({one:async(sql,...args)=>env.DB.prepare(sql).bind(...args).first(),run:async(sql,...args)=>env.DB.prepare(sql).bind(...args).run(),all:async(sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results});
const offline=()=>({version:'0.3.0',public_mode:true,matlab_available:false,solver_available:false,model_configured:false,knowledge_cards:46,sources:20,model_name:'选择具体模型',provider_name:'未连接',paused:false,offline:true});
const coursePages=new Set(GRAPH.nodes.flatMap(n=>(n.images||[]).map(i=>i.url)).filter(u=>/^\/api\/source\/S\d{2}\/page\/\d+$/.test(u)));
function graphPath(source,target){
 const ids=new Set(GRAPH.nodes.map(n=>n.id));if(!ids.has(source)||!ids.has(target))return null;
 const queue=[{nodes:[source],edges:[]}],visited=new Set([source]);
 while(queue.length){const path=queue.shift(),id=path.nodes.at(-1);if(id===target)return {...path,direction_note:'按概念关联查找连接，允许逆向遍历；不代表因果推导。'};for(const e of GRAPH.edges){if(e.group!=='related')continue;const next=e.source===id?e.target:e.target===id?e.source:null;if(next&&!visited.has(next)){visited.add(next);queue.push({nodes:[...path.nodes,next],edges:[...path.edges,e.id]})}}}
 return {nodes:[],edges:[],direction_note:'当前人工整理的关系中，未找到连接。'};
}
async function sameSecret(a,b){if(!a||!b)return false;const x=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(a))),y=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(b)));let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0}
async function bridge(request,env,ctx,path){
 if(request.method!=='POST'||!await sameSecret(request.headers.get('x-ocean-bridge'),env.GATEWAY_SECRET))return json({detail:'不可访问'},403);
 const store=db(env),now=Date.now();
 if(path==='/_bridge/poll'){
  const body=await request.json(),pollId=body.poll_id;if(!/^[0-9a-f-]{36}$/.test(pollId||''))return json({detail:'无效轮询标识'},422);
  await store.run("INSERT INTO bridge_state(id,seen) VALUES('matlab',?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen",now);
  const claim='claimed:'+pollId;let requests=await store.all('SELECT id,payload FROM bridge_requests WHERE state=?',claim);
  if(!requests.length)requests=await store.all("UPDATE bridge_requests SET state=? WHERE id IN (SELECT id FROM bridge_requests WHERE state='queued' AND created>? ORDER BY created LIMIT 12) RETURNING id,payload",claim,now-95000);
  if(Math.random()<.02){const expired=await store.all('SELECT id FROM bridge_requests WHERE created<? LIMIT 20',now-180000);ctx.waitUntil(Promise.all(expired.map(async row=>{await env.BUCKET.delete('rpc/'+row.id);await store.run('DELETE FROM bridge_requests WHERE id=?',row.id)})))}
  return json({requests});
 }
 if(path==='/_bridge/complete'){
  const body=await request.json();if(!/^[0-9a-f-]{36}$/.test(body.id||'')||typeof body.payload!=='string'||body.payload.length>24000000)return json({detail:'无效响应'},422);
  const row=await store.one("SELECT id,state FROM bridge_requests WHERE id=? AND (state LIKE 'claimed%' OR state='done')",body.id);if(!row)return json({detail:'请求已结束'},410);
  if(row.state==='done')return json({ok:true});
  await env.BUCKET.put('rpc/'+body.id,body.payload,{httpMetadata:{contentType:'text/plain'}});await store.run("UPDATE bridge_requests SET state='done' WHERE id=?",body.id);return json({ok:true});
 }
 return json({detail:'不存在'},404);
}
async function dynamic(request,env,ctx,url){
 if(request.method!=='GET'&&request.method!=='HEAD'&&request.headers.get('origin')!==url.origin)return json({detail:'请从当前网站提交请求'},403);
 const store=db(env),heart=await store.one("SELECT seen FROM bridge_state WHERE id='matlab'");
 if(!heart||Date.now()-heart.seen>15000){if(url.pathname==='/api/health')return json(offline());return json({detail:'MATLAB 计算节点暂未连接。知识图谱仍可浏览；请稍后重试。'},503)}
 const body=await request.text();if(body.length>65536)return json({detail:'请求内容过长'},413);
 const queued=await store.one("SELECT COUNT(*) AS n FROM bridge_requests WHERE state!='done' AND created>?",Date.now()-95000);if(queued.n>=80)return json({detail:'访问繁忙，请稍后重试'},429);
 const id=crypto.randomUUID(),payload=await encrypt({path:url.pathname+url.search,method:request.method,body,headers:{cookie:request.headers.get('cookie')||'',origin:url.origin,'x-ocean-client-ip':request.headers.get('cf-connecting-ip')||'cloud-visitor'}},env.GATEWAY_SECRET);
 await store.run("INSERT INTO bridge_requests(id,created,state,payload) VALUES(?,?,'queued',?)",id,Date.now(),payload);
 try{
  for(let i=0;i<44;i++){
   await sleep(i<4?500:2000);const row=await store.one('SELECT state FROM bridge_requests WHERE id=?',id);
   if(row?.state==='done'){
    const object=await env.BUCKET.get('rpc/'+id);if(!object)throw Error('missing response');
    const result=await decrypt(await object.text(),env.GATEWAY_SECRET),headers=new Headers(result.headers);
    headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');return new Response(bytes64(result.body),{status:result.status,headers});
   }
  }
  return json({detail:'计算节点响应超时，请刷新任务列表或稍后重试'},504);
 }finally{ctx.waitUntil(Promise.all([store.run('DELETE FROM bridge_requests WHERE id=?',id),env.BUCKET.delete('rpc/'+id)]))}
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 try{
  if(url.pathname.startsWith('/_bridge/'))return await bridge(request,env,ctx,url.pathname);
  if(request.method==='GET'){
   if(url.pathname==='/api/graph')return json(GRAPH);
   if(url.pathname==='/api/models/catalog')return json(MODELS);
   if(url.pathname==='/api/sources')return json(SOURCES);
   if(url.pathname==='/api/graph/path'){
    const path=graphPath(url.searchParams.get('source'),url.searchParams.get('target'));
    if(path===null)return json({detail:'知识点不存在'},404);
    return json(path);
   }
   if(coursePages.has(url.pathname)){
    const cached=await env.BUCKET.get('course-pages'+url.pathname);
    if(cached)return new Response(cached.body,{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
    const response=await dynamic(request,env,ctx,url);
    if(response.status===200&&response.headers.get('Content-Type')?.startsWith('image/png'))ctx.waitUntil(env.BUCKET.put('course-pages'+url.pathname,response.clone().body,{httpMetadata:{contentType:'image/png'}}));
    return response;
   }
  }
  if(url.pathname.startsWith('/api/'))return await dynamic(request,env,ctx,url);
  if(request.method!=='GET'&&request.method!=='HEAD')return json({detail:'不可访问'},405);
  const asset=FILES[url.pathname==='/'?'/index.html':url.pathname]||(!url.pathname.includes('.')?FILES['/index.html']:null);
  if(!asset)return json({detail:'文件不存在'},404);
  return new Response(request.method==='HEAD'?null:bytes64(asset.data),{headers:{'Content-Type':asset.type,'Cache-Control':url.pathname.startsWith('/assets/')?'public, max-age=86400':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
 }catch(error){console.error('Public request failed:',String(error.message).slice(0,160));return json({detail:'服务暂未完成请求，请稍后重试'},503)}
}};
