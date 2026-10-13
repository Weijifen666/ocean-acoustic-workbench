// Anonymous visitor state stays server-side, encrypted at rest. No owner's key.
import {courseCitation,COURSE_SYSTEM,noModelAnswer} from './course-retrieval.mjs';
export function defaults(catalog){const provider=catalog.providers.find(p=>p.id==='Qwen')||catalog.providers[0],model=catalog.models.find(m=>m.provider===provider.id&&m.id==='qwen3.7-plus')||catalog.models.find(m=>m.provider===provider.id);return {provider:provider.id,base_url:provider.base_url,model:model.id,api_key:''}}
export const publicConfig=cfg=>({provider:cfg.provider,base_url:cfg.base_url,model:cfg.model,api_key_set:!!cfg.api_key,public_mode:true,storage:'cloud_encrypted'});
export function validateConnection(cfg,catalog){
 if(!catalog.providers.some(p=>p.id===cfg.provider))throw new Error('未知供应商');let url;try{url=new URL(cfg.base_url)}catch{throw new Error('模型地址不是有效 HTTPS 地址')}
 const host=url.hostname,allowed={DeepSeek:host==='api.deepseek.com',Kimi:['api.moonshot.cn','api.moonshot.ai'].includes(host),GLM:host==='open.bigmodel.cn',Qwen:['dashscope.aliyuncs.com','dashscope-us.aliyuncs.com','dashscope-intl.aliyuncs.com'].includes(host)||host.endsWith('.maas.aliyuncs.com')};
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||url.search||url.hash||!allowed[cfg.provider])throw new Error('请使用与供应商匹配的官方 HTTPS API 地址');
 if(!cfg.model||cfg.model.length>160||String(cfg.api_key||'').length>4096)throw new Error('模型标识或密钥长度不合法');return {...cfg,base_url:cfg.base_url.replace(/\/+$/,'')};
}
const providerError=status=>({401:'密钥无效或地域不匹配',402:'余额或额度不足',403:'账户没有该模型权限',404:'模型或接口不存在',429:'请求频率或额度受限'})[status]||'请求未成功，请核对官方参数';
async function remote(cfg,catalog,body,fetcher){
 const options=catalog.models.find(m=>m.provider===cfg.provider&&m.id===cfg.model)?.request_options||{};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),70000);try{
  const r=await fetcher(cfg.base_url+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cfg.api_key},body:JSON.stringify({...body,model:cfg.model,...options}),signal:controller.signal,redirect:'error'});
  if(!r.ok)throw new Error(`供应商返回 HTTP ${r.status}：${providerError(r.status)}`);let data;try{data=await r.json()}catch{throw new Error('供应商响应格式不兼容')}
  if(!data.choices?.[0]?.message)throw new Error('供应商响应缺少文字消息');return data;
 }catch(e){if(e.message.startsWith('供应商'))throw e;throw new Error('模型服务连接未完成，请检查网络、地址与配置')}finally{clearTimeout(timer)}
}
export function createCloudModels({catalog,retrieve,encrypt,decrypt,proxy,heartbeat,template='',fetcher=fetch}){
 const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}}),store=env=>({one:async(sql,...args)=>env.DB.prepare(sql).bind(...args).first(),run:async(sql,...args)=>env.DB.prepare(sql).bind(...args).run()});
 async function load(request,env){
  if(!env.GATEWAY_SECRET)throw Error('连接配置尚未完成');let id=(request.headers.get('cookie')||'').match(/(?:^|;\s*)ocean_visitor=([A-Za-z0-9_-]{40,86})(?:;|$)/)?.[1];let fresh=false;
  if(!id){id=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');fresh=true}
  let row=await store(env).one('SELECT ciphertext,version,updated FROM cloud_visitors WHERE id=?',id);
  if(row&&Date.now()-row.updated>2592000000){await store(env).run('DELETE FROM cloud_visitors WHERE id=? AND updated<?',id,Date.now()-2592000000);row=null;fresh=true}
  if(!row){const data={selected:defaults(catalog),profiles:{},history:[],calls:[]};await store(env).run('INSERT INTO cloud_visitors(id,ciphertext,version,updated) VALUES(?,?,0,?) ON CONFLICT(id) DO NOTHING',id,await encrypt(data,env.GATEWAY_SECRET),Date.now());row=await store(env).one('SELECT ciphertext,version,updated FROM cloud_visitors WHERE id=?',id)}
  return {id,fresh,data:await decrypt(row.ciphertext,env.GATEWAY_SECRET),version:row.version};
 }
 async function mutate(id,env,change){
  for(let attempt=0;attempt<4;attempt++){
   const row=await store(env).one('SELECT ciphertext,version FROM cloud_visitors WHERE id=?',id),data=await decrypt(row.ciphertext,env.GATEWAY_SECRET);change(data);
   while(JSON.stringify(data).length>80000&&data.history.length>2)data.history.splice(0,2);
   const result=await store(env).run('UPDATE cloud_visitors SET ciphertext=?,version=version+1,updated=? WHERE id=? AND version=?',await encrypt(data,env.GATEWAY_SECRET),Date.now(),id,row.version);
   if((result.meta?.changes??result.changes)>0)return data;
  }
  throw Error('配置正在更新，请稍后重试');
 }
 function ownRequest(request,id,path){const headers=new Headers(request.headers);headers.set('cookie','ocean_visitor='+id);return new Request(new URL(path,request.url),{method:'GET',headers})}
 async function evidenceFor(q,request,env,ctx,id){
  if(await heartbeat(env)){
   try{const r=await proxy(ownRequest(request,id,'/api/knowledge/search?q='+encodeURIComponent(q)),env,ctx);if(r.ok){const rows=await r.json();if(Array.isArray(rows))return rows.slice(0,8)}}catch{}
  }
  return retrieve(q);
 }
 return async(request,env,ctx,url)=>{
  const path=url.pathname,known=['/api/config','/api/models/profiles','/api/models/test','/api/models/list','/api/chat','/api/chat/history','/api/health','/api/knowledge/search','/api/knowledge/status','/api/session/clear-keys','/api/environment/check'];if(!known.includes(path))return null;
  if(!['GET','POST','PUT'].includes(request.method))return json({detail:'此操作不支持该请求方法'},405);
  if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)return json({detail:'请从当前网站提交请求'},403);
  const methods={'/api/config':['GET','PUT'],'/api/models/profiles':['GET'],'/api/models/test':['POST'],'/api/models/list':['POST'],'/api/chat':['POST'],'/api/chat/history':['GET'],'/api/health':['GET'],'/api/knowledge/search':['GET'],'/api/knowledge/status':['GET'],'/api/session/clear-keys':['POST'],'/api/environment/check':['POST']};if(!methods[path].includes(request.method))return json({detail:'请求方法不匹配'},405);
  let session;try{session=await load(request,env)}catch{return json({detail:'访客配置服务暂不可用，请稍后重试'},503)}
  const finish=r=>{const headers=new Headers(r.headers);if(session.fresh)headers.set('Set-Cookie',`ocean_visitor=${session.id}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');return new Response(r.body,{status:r.status,headers})};
  try{
   const cfg=session.data.selected;
   if(path==='/api/config'&&request.method==='GET')return finish(json(publicConfig(cfg)));
   if(path==='/api/session/clear-keys'){const saved=await mutate(session.id,env,state=>{state.selected.api_key='';for(const value of Object.values(state.profiles))value.api_key=''});return finish(json({cleared:true,...publicConfig(saved.selected)}));}
   if(path==='/api/config'){
    const raw=await request.text();if(raw.length>16384)return finish(json({detail:'配置内容过长'},413));const body=JSON.parse(raw);const provider=body.provider||cfg.provider;if(!catalog.providers.some(p=>p.id===provider))throw Error('未知供应商');
    const entry=catalog.providers.find(p=>p.id===provider),base=provider===cfg.provider?cfg:session.data.profiles[provider]||{provider,base_url:entry.base_url,model:catalog.models.find(m=>m.provider===provider).id,api_key:''};
    const next={...base,provider};for(const key of ['base_url','model'])if(key in body)next[key]=String(body[key]);if(body.api_key)next.api_key=String(body.api_key);if(body.clear_api_key)next.api_key='';validateConnection(next,catalog);
    const saved=await mutate(session.id,env,state=>{state.profiles[state.selected.provider]=state.selected;state.selected=next;state.profiles[provider]=next});return finish(json(publicConfig(saved.selected)));
   }
   if(path==='/api/models/profiles')return finish(json(Object.fromEntries(Object.entries({...session.data.profiles,[cfg.provider]:cfg}).map(([p,c])=>[p,publicConfig(c)]))));
   if(path==='/api/chat/history')return finish(json(session.data.history));
   if(path==='/api/knowledge/search')return finish(json(await evidenceFor(url.searchParams.get('q')||'',request,env,ctx,session.id)));
   if(path==='/api/knowledge/status'){
    if(await heartbeat(env)){try{const r=await proxy(ownRequest(request,session.id,path),env,ctx);if(r.ok)return finish(r)}catch{}}
    return finish(json({mode:'course_graph_rag',cards:46,indexed_sources:0,indexed_pages:0,chunks:0,needs_ocr:0,methods:['BM25','typed_graph_context','RRF'],training_required:false,node_online:false,scope:'计算节点离线，当前检索云端课程知识卡；教材全文索引未连接。'}));
   }
   if(path==='/api/health'||path==='/api/environment/check'){
    let data={version:'0.4.0',public_mode:true,matlab_available:false,solver_available:false,knowledge_cards:46,sources:20,paused:false,offline:true};if(await heartbeat(env)){try{const r=await proxy(ownRequest(request,session.id,'/api/health'),env,ctx);if(r.ok)data={...data,...await r.json(),offline:false}}catch{}}
    if(path==='/api/environment/check')return finish(json({checks:[{name:'MATLAB 计算节点',ok:data.matlab_available,detail:data.matlab_available?'计算节点已连接':'仅仿真依赖计算节点，云端知识卡和模型问答仍可用'},{name:'KRAKEN / FIELD',ok:data.solver_available,detail:'固定 Munk 模板，结果按输入和坐标验证'},{name:'你的模型 API Key',ok:!!cfg.api_key,detail:cfg.api_key?'云端加密保存，未代表已通过调用测试':'填写供应商 Key 后可调用模型'}]}));
    const model=catalog.models.find(m=>m.id===cfg.model&&m.provider===cfg.provider),provider=catalog.providers.find(p=>p.id===cfg.provider);return finish(json({...data,version:'0.4.0',model_configured:!!cfg.api_key,model_name:model?.name||cfg.model,provider_name:provider?.name||cfg.provider,cloud_model_available:true,model_storage:'cloud_encrypted'}));
   }
   const raw=await request.text();if(raw.length>65536)return finish(json({detail:'请求内容过长'},413));const body=JSON.parse(raw);
   if(path.startsWith('/api/models/')){
    const provider=body.provider||cfg.provider,saved=provider===cfg.provider?cfg:session.data.profiles[provider]||{},selected=validateConnection({...saved,...body,provider,api_key:body.api_key||saved.api_key||''},catalog);
    if(!selected.api_key)throw Error('请填写你自己的供应商 API Key');
    if(path.endsWith('/list')){
     let r;try{r=await fetcher(selected.base_url+'/models',{headers:{Authorization:'Bearer '+selected.api_key},redirect:'error',signal:AbortSignal.timeout(25000)})}catch{throw Error('无法连接供应商模型目录')}
     if(!r.ok)return finish(json({detail:`供应商返回 HTTP ${r.status}：${providerError(r.status)}`},502));const payload=await r.json();if(!Array.isArray(payload.data))throw Error('模型目录格式不兼容');const ids=payload.data.slice(0,500).map(x=>String(x.id));return finish(json({ids,selected_listed:ids.includes(selected.model),note:'目录表示账户接口返回，实际调用仍需额度和权限。'}));
    }
    const data=await remote(selected,catalog,{messages:[{role:'user',content:'Reply with OK.'}],max_tokens:256},fetcher);return finish(json({ok:true,provider,requested_model:selected.model,response_model:data.model||selected.model,reply:(data.choices[0].message.content||'').slice(0,200),usage:data.usage||{},note:'短请求已通过，不表示 Agent 工具已接通。'}));
   }
   const message=String(body.message||'');if(message.length<1||message.length>12000)throw Error('问题长度须为 1–12000 字符');if(!['chat','agent',undefined].includes(body.mode))throw Error('未知对话模式');
   await mutate(session.id,env,state=>{state.calls=(state.calls||[]).filter(t=>Date.now()-t<60000);if(state.calls.length>=12)throw Error('对话过于频繁，请稍后再试');state.calls.push(Date.now())});
   const evidence=await evidenceFor(message,request,env,ctx,session.id),citations=evidence.map(c=>({...courseCitation(c),...(c.citation||{}),id:c.id,label:c.label,node_id:c.node_id||null}));let reply;
   if(!cfg.api_key)reply=noModelAnswer(evidence);
   else{validateConnection(cfg,catalog);const context={evidence,graph_context_note:'课程层级和建议阅读顺序不是物理因果；原文片段未经自动事实认证。'};const messages=[{role:'system',content:COURSE_SYSTEM+'\n'+JSON.stringify(context)+(body.mode==='agent'?'\n课程公开 MATLAB 模板（只读）：\n'+template:'')},...session.data.history.slice(-10).map(m=>({role:m.role,content:m.text})),{role:'user',content:message}];const data=await remote(cfg,catalog,{messages,max_tokens:4096},fetcher);reply=data.choices[0].message.content||'模型未返回文字内容';}
   const retrieval={methods:evidence.some(c=>c.retrieval?.method==='bm25+curated-graph')?['BM25','bilingual_term_aliases','typed_graph_context','concept_priority']:['BM25','typed_graph_context','RRF'],evidence_count:evidence.length,source_excerpts:evidence.filter(c=>c.evidence_type==='source_excerpt').length,scope:evidence.some(c=>c.evidence_type==='source_excerpt')?'课程知识卡与教材原文片段':'课程知识卡'};
   await mutate(session.id,env,state=>{state.history.push({role:'user',text:message},{role:'assistant',text:reply,evidence,citations,retrieval,model_used:!!cfg.api_key});state.history=state.history.slice(-40)});
   return finish(json({reply,model_used:!!cfg.api_key,evidence_ids:evidence.map(c=>c.id),evidence,citations,retrieval}));
  }catch(e){const msg=String(e.message||'').slice(0,220);const status=msg.startsWith('供应商')||msg.includes('连接')||msg.includes('响应')?502:422;return finish(json({detail:msg.startsWith('Unexpected')||e instanceof SyntaxError?'请求必须是有效 JSON':msg||'请求未完成'},status))}
 };
}
