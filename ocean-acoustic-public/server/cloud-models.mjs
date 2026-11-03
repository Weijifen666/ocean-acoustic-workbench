// Anonymous visitor state stays server-side, encrypted at rest. No owner's key.
import {courseCitation,COURSE_SYSTEM,noModelAnswer,normalize,focusEvidenceGate} from './course-retrieval.mjs';
import {answerPolicy,noteKnowledgeGap} from './knowledge-policy.mjs';
import {buildContext,inactiveContext,resolveBudget,withProviderUsage} from './context-budget.mjs';
import {createChatStore} from './chat-store.mjs';
import {readProviderStream,eventStreamResponse} from './provider-stream.mjs';
import {isCoxMunkOnly} from './query-planning.mjs';
import {resolveVisitorIdentity,visitorCookie} from './identity.mjs';
import {createWorkspaceApi} from './workspaces.mjs';
import {createCloudResearch} from './cloud-research.mjs';
export function defaults(catalog){const provider=catalog.providers.find(p=>p.id==='Qwen')||catalog.providers[0],model=catalog.models.find(m=>m.provider===provider.id&&m.id==='qwen3.7-plus')||catalog.models.find(m=>m.provider===provider.id);return {provider:provider.id,base_url:provider.base_url,model:model.id,api_key:''}}
export const publicConfig=cfg=>({provider:cfg.provider,base_url:cfg.base_url,model:cfg.model,api_key_set:!!cfg.api_key,public_mode:true,storage:'cloud_encrypted'});
export function validateConnection(cfg,catalog){
 if(!catalog.providers.some(p=>p.id===cfg.provider))throw new Error('未知供应商');let url;try{url=new URL(cfg.base_url)}catch{throw new Error('模型地址不是有效 HTTPS 地址')}
 const host=url.hostname,allowed={DeepSeek:host==='api.deepseek.com',Kimi:['api.moonshot.cn','api.moonshot.ai'].includes(host),GLM:host==='open.bigmodel.cn',Qwen:['dashscope.aliyuncs.com','dashscope-us.aliyuncs.com','dashscope-intl.aliyuncs.com'].includes(host)||host.endsWith('.maas.aliyuncs.com')};
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||url.search||url.hash||!allowed[cfg.provider])throw new Error('请使用与供应商匹配的官方 HTTPS API 地址');
 const api_key=String(cfg.api_key||'').trim();
 if(typeof cfg.model!=='string'||!cfg.model.trim()||cfg.model.length>160||/[\r\n]/.test(cfg.model)||api_key.length>4096)throw new Error('模型标识或密钥长度不合法');
 if(/^Bearer\s/i.test(api_key))throw new Error('API Key 只填写密钥本身，不要添加 Bearer 前缀');
 if(/[^\x21-\x7e]/.test(api_key))throw new Error('API Key 含空格、换行或非英文字符，请重新复制完整密钥');
 return {...cfg,model:cfg.model.trim(),api_key,base_url:cfg.base_url.trim().replace(/\/+$/,'')};
}
const providerError=status=>({401:'密钥无效或地域不匹配',402:'余额或额度不足',403:'账户没有该模型权限',404:'模型或接口不存在',429:'请求频率或额度受限'})[status]||'请求未成功，请核对官方参数';
function transportError(message,code){const error=new Error(message);error.code=code;error.status=502;return error}
export async function providerResponseError(response){
 // Inspect only a bounded error payload. Provider text can echo request data,
 // URLs and credentials, so none of it is included in a public diagnostic.
 let fields=[];
 try{
  if(response.body){
   const reader=response.body.getReader(),chunks=[];let size=0,complete=false;
   try{
    while(size<=32768){const item=await reader.read();if(item.done){complete=true;break}size+=item.value.byteLength;if(size<=32768)chunks.push(item.value)}
   }finally{if(!complete)await reader.cancel().catch(()=>{})}
   if(complete){const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}const data=JSON.parse(new TextDecoder().decode(bytes)),error=data?.error;
    fields=[data?.code,data?.error_code,data?.message,data?.error_msg,typeof error==='string'?error:null,error?.code,error?.type,error?.message];}
  }
 }catch{/* Invalid, interrupted or oversized error responses use a fixed fallback. */}
 const contextLimit=/context[_\s-]*length[_\s-]*exceeded|context\s+window|maximum\s+context\s+length|input[\s_-]*tokens?\s+exceeds?\b|prompt[\s_-]+(?:is[\s_-]+)?too[\s_-]+long/i;
 if(fields.some(value=>typeof value==='string'&&contextLimit.test(value)))return transportError('模型接口拒绝请求：已超过模型自身的上下文限制。应用预算不限不代表模型可接收无限输入，请缩小输入或使用该模型支持的上下文预算。','PROVIDER_CONTEXT_LIMIT');
 const status=Number.isInteger(response.status)&&response.status>=100&&response.status<=599?response.status:502;
 return transportError(`供应商返回 HTTP ${status}：${providerError(status)}`,'PROVIDER_RESPONSE');
}
function safeNetworkMessage(error){
 // Return fixed diagnoses, never raw runtime messages, headers, URLs or secrets.
 const message=String(error?.message||'').toLowerCase();
 if(/redirect/.test(message))return '云端请求运行时的重定向配置不兼容。';
 if(/certificate|tls|ssl/.test(message))return '与供应商建立 HTTPS 连接失败。';
 if(/dns|resolve|enotfound/.test(message))return '供应商域名解析失败。';
 if(/header|invalid character/.test(message))return '请求头格式不兼容，请核对密钥格式。';
 return '网络连接未建立，请稍后重试；这不表示 API Key 无效。';
}
export async function providerFetch(cfg,path,options={},fetcher=fetch){
 const {timeoutMs=70000,signal,...init}=options,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),abort=()=>controller.abort();
 timer.unref?.();
 let transferred=false,bodyAbort;
 const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(bodyAbort)controller.signal.removeEventListener('abort',bodyAbort)};
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
 try{
  const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+cfg.api_key);headers.set('Accept','application/json');
  // workerd supports manual/follow; redirect:error throws before sending a request.
  // Reject redirects explicitly so credentials are never forwarded to another host.
  const response=await fetcher(cfg.base_url+path,{...init,headers,signal:controller.signal,redirect:'manual'});
  if(response.status>=300&&response.status<400)throw transportError(`供应商接口返回 HTTP ${response.status} 重定向，已停止请求；请核对官方 API 地址。`,'PROVIDER_REDIRECT');
  if(!response.body)return response;
  const reader=response.body.getReader();
  const body=new ReadableStream({
   start(output){bodyAbort=()=>{void reader.cancel().catch(()=>{});cleanup();try{output.error(signal?.aborted?Object.assign(new Error('请求已停止'),{name:'AbortError',code:'CANCELLED'}):transportError('连接供应商超时，回答尚未完成。','PROVIDER_TIMEOUT'))}catch{}};controller.signal.addEventListener('abort',bodyAbort,{once:true});if(controller.signal.aborted)bodyAbort()},
   async pull(output){try{const item=await reader.read();if(item.done){cleanup();output.close()}else output.enqueue(item.value)}catch{cleanup();try{output.error(transportError('供应商响应连接中断。','PROVIDER_NETWORK'))}catch{}}},
   async cancel(){controller.abort();cleanup();await reader.cancel().catch(()=>{})}
  });
  transferred=true;
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 }catch(error){
  if(error.status===502)throw error;
  if(signal?.aborted)throw Object.assign(new Error('请求已停止'),{name:'AbortError',code:'CANCELLED'});
  if(controller.signal.aborted||['AbortError','TimeoutError'].includes(error.name))throw transportError('连接供应商超时，请稍后重试；这不表示 API Key 无效。','PROVIDER_TIMEOUT');
  const name=/^[A-Za-z]{1,40}$/.test(error.name||'')?error.name:'Error';
  throw transportError(`云端连接供应商失败（${name}）：${safeNetworkMessage(error,cfg)}`,'PROVIDER_NETWORK');
 }finally{if(!transferred)cleanup()}
}
function completionDiagnostic(data,cfg,responseFormat='json'){
 // Whitelisted metadata only: no raw provider body, reasoning, URLs or headers.
 const model=typeof data?.model==='string'&&data.model.length<=160&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(data.model)&&(!cfg.api_key||!data.model.includes(cfg.api_key))?data.model:null;
 const reason=data?.choices?.[0]?.finish_reason;
 return {response_format:responseFormat,response_model:model,finish_reason:['stop','length','content_filter','tool_calls','function_call','insufficient_system_resource'].includes(reason)?reason:null,reasoning_only:!!data?.choices?.[0]?.message?.reasoning_content&&!String(data?.choices?.[0]?.message?.content||'').trim()};
}
function completionError(message,code,data,cfg,responseFormat){
 const error=transportError(message,code);error.diagnostic=completionDiagnostic(data,cfg,responseFormat);return error;
}
async function readCompletionResponse(response,cfg,body,signal){
 let text;
 try{text=await response.text()}catch(error){
  if(error.status===502||error.code==='CANCELLED')throw error;
  throw transportError('供应商响应读取中断，尚未收到完整回答；请重试。','PROVIDER_NETWORK');
 }
 text=text.replace(/^\uFEFF/,'').trim();
 if(!text)throw completionError('供应商返回 HTTP 200，但响应为空，未完成模型调用。','PROVIDER_EMPTY_RESPONSE',null,cfg,'empty');
 if(text.length>4194304)throw completionError('供应商响应超过安全读取上限，未完成模型调用。','PROVIDER_RESPONSE_TOO_LARGE',null,cfg,'oversized');
 // Some compatible gateways return SSE even for stream:false. Accept complete
 // text streams for a text request; never mistake keepalive frames for a reply.
 if(/^(?:data:|:)/.test(text)){
  if(body.tools?.length)throw completionError('供应商对非流式工具请求返回了事件流，请核对接口兼容性。','PROVIDER_UNEXPECTED_STREAM',null,cfg,'event_stream');
  try{
   const stream=await readProviderStream(new Response(text+'\n\n',{headers:{'content-type':'text/event-stream'}}),async()=>{},signal);
   return {model:stream.model,usage:stream.usage,choices:[{message:{content:stream.reply},finish_reason:stream.finish_reason}],_response_format:'event_stream'};
  }catch(error){
   if(error.status===502||error.code==='CANCELLED')throw error;
   throw completionError('供应商返回了事件流，但未收到完整的文字回答。','PROVIDER_INCOMPLETE_STREAM',null,cfg,'event_stream');
  }
 }
 let data;
 try{data=JSON.parse(text)}catch{
  const html=/^</.test(text);
  throw completionError(html?'供应商返回 HTTP 200，但内容为网页而非模型 JSON；请核对服务状态与接口。':'供应商返回 HTTP 200，但响应不是完整的 Chat Completions JSON；请重试。',html?'PROVIDER_HTML_RESPONSE':'PROVIDER_JSON_INVALID',null,cfg,html?'html':'invalid_json');
 }
 if(data?.error)throw completionError('供应商返回 HTTP 200，但响应包含错误，模型调用未完成。','PROVIDER_ERROR_PAYLOAD',data,cfg,'json');
 if(!data?.choices?.[0]?.message||typeof data.choices[0].message!=='object')throw completionError('供应商响应未包含 Chat Completions 的消息结构。','PROVIDER_MESSAGE_MISSING',data,cfg,'json');
 return data;
}
function connectionReply(data,cfg){
 const choice=data.choices[0],content=choice.message.content,diagnostic=completionDiagnostic(data,cfg,data._response_format||'json');
 if(typeof content!=='string'||!content.trim()){
  const message=diagnostic.reasoning_only?'供应商只返回了思考内容，没有最终文字回答；本次测试未通过。':diagnostic.finish_reason==='content_filter'?'供应商过滤了测试回答，尚未验证文字生成。':'供应商接受了请求，但没有返回文字回答；本次测试未通过。';
  throw completionError(diagnostic.finish_reason==='length'?message+' 输出预算已耗尽（finish_reason=length）。':message,'PROVIDER_EMPTY_CONTENT',data,cfg,diagnostic.response_format);
 }
 if(diagnostic.finish_reason==='length'||diagnostic.finish_reason==='content_filter')throw completionError('供应商返回的测试回答未完成（finish_reason='+diagnostic.finish_reason+'）；本次测试未通过。','PROVIDER_INCOMPLETE_COMPLETION',data,cfg,diagnostic.response_format);
 return {reply:content.slice(0,200),...diagnostic};
}
async function remote(cfg,catalog,body,fetcher,signal,transport={}){
 cfg=validateConnection(cfg,catalog);
 const options=catalog.models.find(m=>m.provider===cfg.provider&&m.id===cfg.model)?.request_options||{};
  const r=await providerFetch(cfg,'/chat/completions',{...transport,method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...options,...body,model:cfg.model})},fetcher);
  if(!r.ok)throw await providerResponseError(r);return readCompletionResponse(r,cfg,body,signal);
}
async function remoteStream(cfg,catalog,body,fetcher,onDelta,signal){
 const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(()=>controller.abort(),90000);
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
 try{
  const options=catalog.models.find(m=>m.provider===cfg.provider&&m.id===cfg.model)?.request_options||{};
  const usageOptions=['DeepSeek','Qwen'].includes(cfg.provider)?{stream_options:{include_usage:true}}:{};
  const r=await providerFetch(cfg,'/chat/completions',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,model:cfg.model,...options,stream:true,...usageOptions})},fetcher);
  if(!r.ok)throw await providerResponseError(r);
  const result=await readProviderStream(r,onDelta,controller.signal);return result;
 }catch(error){
  if(signal?.aborted)throw Object.assign(new Error('请求已停止'),{name:'AbortError',code:'CANCELLED'});
  if(controller.signal.aborted)throw transportError('供应商生成超时，回答尚未完成；可稍后重试。','PROVIDER_TIMEOUT');
  if(error.status===502||error.code==='CANCELLED')throw error;
  throw transportError('供应商流式响应未完成，请稍后重试。','PROVIDER_STREAM');
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
export function createCloudModels({catalog,retrieve,encrypt,decrypt,proxy,heartbeat,template='',fetcher=fetch,publicKnowledge=null,researchAssets=null,oceanQuery=null,knowledgeCount=46,sourceCount=20}){
 const workspaceApi=createWorkspaceApi({encrypt,decrypt});
 const publicStatus=()=>publicKnowledge?.publicOceanStatus?.()||{registered_sources:0,indexed_sources:0,chunks:0,web_sources:[],live_web_search:false};
 const publicRetrieve=q=>publicKnowledge?.retrievePublicOcean?.(q,4)||[];
 function mergeEvidence(course,extra,q){
  if(isCoxMunkOnly(q))return focusEvidenceGate(q,[...course,...extra],8);
  const focused=course.some(c=>c.retrieval?.role==='question_focus'||c.retrieval?.focus===true);
  if(extra.length&&!focused){
   const generic=new Set(['海洋','海水','水下','ocean','marine','sea','water','underwater','sound']);
   const anchors=[...new Set(extra.flatMap(c=>c.search_aliases||[]).map(normalize).filter(term=>term.length>=2&&!generic.has(term)&&normalize(q).includes(term)))];
   if(anchors.length)course=course.filter(c=>anchors.some(term=>normalize([c.label,c.text,c.formula].join(' ')).includes(term)));
  }
  const rows=focused?[...course,...extra]:[...extra,...course];
  const seen=new Set();return focusEvidenceGate(q,rows.filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true}),8);
 }
 const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}}),store=env=>({one:async(sql,...args)=>env.DB.prepare(sql).bind(...args).first(),run:async(sql,...args)=>env.DB.prepare(sql).bind(...args).run()});
 async function load(request,env){
  if(!env.GATEWAY_SECRET)throw Error('连接配置尚未完成');const identity=await resolveVisitorIdentity(request,env),{id,fresh}=identity;
  let row=await store(env).one('SELECT ciphertext,version,updated FROM cloud_visitors WHERE id=?',id);
  // Cookie expiry controls access duration. Reading an old session never deletes
  // its encrypted configuration or research history as a side effect.
  if(!row){const data={selected:defaults(catalog),profiles:{},history:[],calls:[],gaps:[]};await store(env).run('INSERT INTO cloud_visitors(id,ciphertext,version,updated) VALUES(?,?,0,?) ON CONFLICT(id) DO NOTHING',id,await encrypt(data,env.GATEWAY_SECRET),Date.now());row=await store(env).one('SELECT ciphertext,version,updated FROM cloud_visitors WHERE id=?',id)}
  return {...identity,data:await decrypt(row.ciphertext,env.GATEWAY_SECRET),version:row.version};
 }
 async function mutate(id,env,change){
  for(let attempt=0;attempt<4;attempt++){
   const row=await store(env).one('SELECT ciphertext,version FROM cloud_visitors WHERE id=?',id),data=await decrypt(row.ciphertext,env.GATEWAY_SECRET);change(data);
   if(JSON.stringify(data).length>1000000)throw Error('访客配置超过容量限制，请导出资料并联系维护者');
   const result=await store(env).run('UPDATE cloud_visitors SET ciphertext=?,version=version+1,updated=? WHERE id=? AND version=?',await encrypt(data,env.GATEWAY_SECRET),Date.now(),id,row.version);
   if((result.meta?.changes??result.changes)>0)return data;
  }
  throw Error('配置正在更新，请稍后重试');
 }
 function ownRequest(request,id,path){const headers=new Headers({origin:new URL(request.url).origin,cookie:'ocean_visitor='+id});const ip=request.headers.get('cf-connecting-ip');if(ip)headers.set('cf-connecting-ip',ip);return new Request(new URL(path,request.url),{method:'GET',headers})}
 async function evidenceFor(q,request,env,ctx,id){
  if(await heartbeat(env)){
   try{const r=await proxy(ownRequest(request,id,'/api/knowledge/search?q='+encodeURIComponent(q)),env,ctx);if(r.ok){const rows=await r.json();if(Array.isArray(rows))return mergeEvidence(rows,publicRetrieve(q),q)}}catch{}
  }
  return mergeEvidence(retrieve(q),publicRetrieve(q),q);
 }
 const researchApi=createCloudResearch({assets:researchAssets,encrypt,decrypt,retrieve,retrieveEvidence:(q,request,env,ctx,identity)=>evidenceFor(q,request,env,ctx,identity.node_id),heartbeat,proxy,oceanQuery,remote:async(cfg,body,signal)=>{
  try{return await remote(cfg,catalog,body,fetcher,signal)}catch(error){if(!error.status)error.status=502;throw error}
 }});
 return async(request,env,ctx,url)=>{
  const path=url.pathname,isWorkspace=/^\/api\/workspaces(?:\/|$)/.test(path),isResearch=researchApi.matches(path),known=['/api/account','/api/config','/api/models/profiles','/api/models/test','/api/models/list','/api/chat','/api/chat/history','/api/conversations','/api/conversations/selected','/api/health','/api/knowledge/search','/api/knowledge/status','/api/knowledge/public-sources','/api/knowledge/gaps','/api/session/clear-keys','/api/environment/check'];if(!known.includes(path)&&!isWorkspace&&!isResearch)return null;
  if(!['GET','POST','PUT','DELETE',...(isResearch?['PATCH']:[])].includes(request.method))return json({detail:'此操作不支持该请求方法'},405);
  if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)return json({detail:'请从当前网站提交请求'},403);
  const methods={'/api/account':['GET'],'/api/config':['GET','PUT'],'/api/models/profiles':['GET'],'/api/models/test':['POST'],'/api/models/list':['POST'],'/api/chat':['POST'],'/api/chat/history':['GET'],'/api/conversations':['GET','POST'],'/api/conversations/selected':['PUT'],'/api/health':['GET'],'/api/knowledge/search':['GET'],'/api/knowledge/status':['GET'],'/api/knowledge/public-sources':['GET'],'/api/knowledge/gaps':['GET'],'/api/session/clear-keys':['POST'],'/api/environment/check':['POST']};if(!isWorkspace&&!isResearch&&!methods[path].includes(request.method))return json({detail:'请求方法不匹配'},405);
  let session;try{session=await load(request,env)}catch{return json({detail:'访客配置服务暂不可用，请稍后重试'},503)}
  const finish=r=>{const headers=new Headers(r.headers);headers.set('Set-Cookie',visitorCookie(session.cookie_id));headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');return new Response(r.body,{status:r.status,headers})};
  try{
   if(isResearch)return finish(await researchApi.handle(request,env,ctx,url,session));
   if(isWorkspace)return finish(await workspaceApi(request,env,ctx,url,session));
   const cfg=session.data.selected;
   if(path==='/api/account')return finish(json({authenticated:session.account.authenticated,display_name:session.account.display_name,storage_scope:session.account.authenticated?'account':'browser_visitor',sign_in_url:'/signin-with-chatgpt?return_to=%2F',sign_out_url:'/signout-with-chatgpt?return_to=%2F',note:'登录账户与浏览器访客使用独立配置；原访客记录保留在原浏览器空间。'}));
   if(path==='/api/config'&&request.method==='GET')return finish(json(publicConfig(cfg)));
   if(path==='/api/session/clear-keys'){const saved=await mutate(session.id,env,state=>{state.selected.api_key='';for(const value of Object.values(state.profiles))value.api_key=''});return finish(json({cleared:true,...publicConfig(saved.selected)}));}
   if(path==='/api/config'){
    const raw=await request.text();if(raw.length>16384)return finish(json({detail:'配置内容过长'},413));const body=JSON.parse(raw);const provider=body.provider||cfg.provider;if(!catalog.providers.some(p=>p.id===provider))throw Error('未知供应商');
    const entry=catalog.providers.find(p=>p.id===provider),base=provider===cfg.provider?cfg:session.data.profiles[provider]||{provider,base_url:entry.base_url,model:catalog.models.find(m=>m.provider===provider).id,api_key:''};
    let next={...base,provider};for(const key of ['base_url','model'])if(key in body)next[key]=String(body[key]);if(body.api_key)next.api_key=String(body.api_key);if(body.clear_api_key)next.api_key='';next=validateConnection(next,catalog);
    const saved=await mutate(session.id,env,state=>{state.profiles[state.selected.provider]=state.selected;state.selected=next;state.profiles[provider]=next});return finish(json(publicConfig(saved.selected)));
   }
   if(path==='/api/models/profiles')return finish(json(Object.fromEntries(Object.entries({...session.data.profiles,[cfg.provider]:cfg}).map(([p,c])=>[p,publicConfig(c)]))));
   const chats=createChatStore(env,encrypt,decrypt);
   async function conversation(requested){
    const legacy=await chats.ensure(session.id,session.data.history||[]),id=requested||session.data.selected_conversation||legacy;await chats.owned(session.id,id);return id;
   }
   if(path==='/api/chat/history')return finish(json(await chats.history(session.id,await conversation(url.searchParams.get('conversation_id')))));
   if(path==='/api/conversations'&&request.method==='GET'){const selected_id=await conversation();return finish(json({items:await chats.list(session.id),selected_id}))}
   if(path==='/api/conversations'||path==='/api/conversations/selected'){
    const raw=await request.text();if(raw.length>4096)throw Error('对话设置过长');const body=JSON.parse(raw);await conversation();
    if(path.endsWith('selected')){await chats.owned(session.id,body.id);await mutate(session.id,env,state=>{state.selected_conversation=body.id});return finish(json({selected_id:body.id}))}
    const created=await chats.create(session.id,body.title);await mutate(session.id,env,state=>{state.selected_conversation=created.id});return finish(json(created));
   }
   if(path==='/api/knowledge/gaps')return finish(json(session.data.gaps||[]));
   if(path==='/api/knowledge/search')return finish(json(await evidenceFor(url.searchParams.get('q')||'',request,env,ctx,session.node_id)));
   if(path==='/api/knowledge/status'||path==='/api/knowledge/public-sources'){
    if(await heartbeat(env)){try{const r=await proxy(ownRequest(request,session.node_id,'/api/knowledge/status'),env,ctx);if(r.ok){const data=await r.json(),ocean=data.public_ocean||publicStatus();return finish(json(path.endsWith('public-sources')?(data.web_sources||ocean.web_sources):{...data,public_ocean:ocean,web_sources:data.web_sources||ocean.web_sources}))}}catch{}}
    const ocean=publicStatus();
    return finish(json(path.endsWith('public-sources')?ocean.web_sources:{mode:'ocean_document_rag',cards:knowledgeCount,indexed_sources:0,indexed_pages:0,chunks:0,needs_ocr:0,source_coverage:[],coverage:null,public_ocean:ocean,web_sources:ocean.web_sources,methods:['BM25','typed_graph_context','public_document_bm25'],training_required:false,node_online:false,scope:'计算节点离线，当前仍可检索云端课程知识卡与公开海洋网页快照；私有教材全文索引未连接。'}));
   }
   if(path==='/api/health'||path==='/api/environment/check'){
    let data={version:'0.7.0',public_mode:true,matlab_available:false,solver_available:false,knowledge_cards:46,sources:20,paused:false,offline:true};if(await heartbeat(env)){try{const r=await proxy(ownRequest(request,session.node_id,'/api/health'),env,ctx);if(r.ok)data={...data,...await r.json(),offline:false}}catch{}}
    if(path==='/api/environment/check')return finish(json({checks:[{name:'MATLAB 计算节点',ok:data.matlab_available,detail:data.matlab_available?'计算节点已连接':'仅仿真依赖计算节点，云端知识卡和模型问答仍可用'},{name:'KRAKEN / FIELD',ok:data.solver_available,detail:'固定 Munk 模板，结果按输入和坐标验证'},{name:'你的模型 API Key',ok:!!cfg.api_key,detail:cfg.api_key?'云端加密保存，未代表已通过调用测试':'填写供应商 Key 后可调用模型'}]}));
    const model=catalog.models.find(m=>m.id===cfg.model&&m.provider===cfg.provider),provider=catalog.providers.find(p=>p.id===cfg.provider);return finish(json({...data,version:'0.7.0',knowledge_cards:knowledgeCount,sources:sourceCount,model_configured:!!cfg.api_key,model_name:model?.name||cfg.model,provider_name:provider?.name||cfg.provider,cloud_model_available:true,model_storage:'cloud_encrypted'}));
   }
   const raw=await request.text();if(raw.length>65536)return finish(json({detail:'请求内容过长'},413));const body=JSON.parse(raw);
   if(path.startsWith('/api/models/')){
    const provider=body.provider||cfg.provider,saved=provider===cfg.provider?cfg:session.data.profiles[provider]||{},selected=validateConnection({...saved,...body,provider,api_key:body.api_key||saved.api_key||''},catalog);
    if(!selected.api_key)throw Error('请填写你自己的供应商 API Key');
    if(path.endsWith('/list')){
     const r=await providerFetch(selected,'/models',{timeoutMs:25000},fetcher);
     if(!r.ok)return finish(json({detail:`供应商返回 HTTP ${r.status}：${providerError(r.status)}`},502));const payload=await r.json();if(!Array.isArray(payload.data))throw Error('模型目录格式不兼容');const ids=payload.data.slice(0,500).map(x=>String(x.id));return finish(json({ids,selected_listed:ids.includes(selected.model),note:'目录表示账户接口返回，实际调用仍需额度和权限。'}));
    }
    const testBody={messages:[{role:'user',content:'Reply with OK.'}],max_tokens:256,stream:false};if(provider==='DeepSeek')Object.assign(testBody,{thinking:{type:'disabled'}});
    // Providers may send HTTP 200 + whitespace while a completion is queued.
    // A model-list success cannot establish inference availability. Give this
    // explicit probe its own bounded queue budget, and propagate browser cancel.
    const data=await remote(selected,catalog,testBody,fetcher,request.signal,{timeoutMs:180000}),checked=connectionReply(data,selected);return finish(json({ok:true,provider,requested_model:selected.model,...checked,usage:data.usage||{},note:'已收到真实文字回答，当前模型调用通过。请保存并应用配置后在知识问答中使用；此测试不表示 Agent 工具已验证。'}));
   }
   const message=String(body.message||'');if(message.length<1||message.length>12000)throw Error('问题长度须为 1–12000 字符');if(!['chat','agent',undefined].includes(body.mode))throw Error('未知对话模式');
   const provider=body.provider||cfg.provider;
   if(!catalog.providers.some(p=>p.id===provider))throw Error('未知供应商');
   const entry=catalog.providers.find(p=>p.id===provider),saved=provider===cfg.provider?cfg:session.data.profiles[provider]||{provider,base_url:entry.base_url,model:catalog.models.find(m=>m.provider===provider).id,api_key:''};
   const selected=validateConnection({...saved,provider,model:body.model||saved.model},catalog);
   const knowledgeScope=body.knowledge_mode||'course';if(!['course','general'].includes(knowledgeScope))throw Error('请选择课程依据或模型一般知识');
   const requestedBudget=body.context_budget===undefined?'auto':body.context_budget;resolveBudget(requestedBudget);
   await mutate(session.id,env,state=>{state.calls=(state.calls||[]).filter(t=>Date.now()-t<60000);if(state.calls.length>=12)throw Error('对话过于频繁，请稍后再试');state.calls.push(Date.now())});
   const conversationId=await conversation(body.conversation_id),priorHistory=await chats.history(session.id,conversationId,80);
   let evidence=await evidenceFor(message,request,env,ctx,session.node_id),citations=evidence.map(c=>({...courseCitation(c),...(c.citation||{}),id:c.id,label:c.label,node_id:c.node_id||null}));const policy=answerPolicy(evidence,knowledgeScope,body.mode,message);
   const requestKey=request.headers.get('idempotency-key')||crypto.randomUUID(),token=await chats.begin(session.id,conversationId,requestKey,{message,provider:selected.provider,model:selected.model,mode:body.mode||'chat',knowledgeScope,requestedBudget},!!selected.api_key&&policy.can_generate);
   if(token.replay)return finish(body.stream===true?eventStreamResponse(async send=>send('done',token.replay)):json(token.replay));
   async function execute(onDelta,signal){
   let reply,used=false,responseModel=null,contextMetadata=inactiveContext(requestedBudget),simulationDraft=null,finishReason=null;
   if(signal?.aborted)throw Object.assign(new Error('请求已停止'),{code:'CANCELLED'});
   if(body.mode==='agent'&&/仿真|模拟|计算|运行|对比|频率|\bHz\b|\bMunk\b/i.test(message)&&await heartbeat(env)){
    try{
     const draftRequest=new Request(new URL('/api/plans/draft',request.url),{method:'POST',headers:{'content-type':'application/json',cookie:'ocean_visitor='+session.node_id,origin:url.origin},body:JSON.stringify({message})});
     const result=await proxy(draftRequest,env,ctx);if(result.ok)simulationDraft=await result.json();
    }catch{}
   }
   if(!evidence.length&&body.mode!=='agent')await mutate(session.id,env,state=>noteKnowledgeGap(state,message));
   if(policy.coverage_status==='missing_observation_data')reply=policy.coverage_notice;
   else if(!selected.api_key){
    reply=(knowledgeScope==='general'?'模型一般知识需要先配置你的 API Key。当前仅提供课程与公开资料检索。\n\n':'')+noModelAnswer(evidence);
    // Actual answer provenance is course retrieval. Keep the user's requested
    // mode separately; no pretrained generation or template analysis ran.
    Object.assign(policy,{knowledge_scope:'course',coverage_status:evidence.length?'course_evidence':'no_course_evidence',coverage_notice:evidence.length?'尚未配置模型 API Key；本次仅展示检索到的资料，未调用模型。':'尚未配置模型 API Key，且未检索到课程依据；本次没有使用模型一般知识。'});
   }
   else if(!policy.can_generate)reply=policy.coverage_notice+'\n这条问题已加入你的待补资料记录，不会把无关知识点当作答案。';
   else{
    const packed=buildContext({question:message,system:policy.system+'\n课程层级和建议阅读顺序不是物理因果；原文片段未经自动事实认证。'+(simulationDraft?'\n系统工具提取的参数草案（尚未执行；缺少的条件必须明确询问，不得宣称已仿真）：'+JSON.stringify(simulationDraft):''),evidence,history:priorHistory,template:body.mode==='agent'?template:'',context_budget:requestedBudget});
    if(knowledgeScope==='course'&&body.mode!=='agent'&&!packed.evidence.length)throw Object.assign(new Error('检索到了课程资料，但所选预算无法保留必要依据，请调大上下文预算后重试；未调用模型。'),{status:422,code:'CONTEXT_BUDGET_EXCEEDED'});
    evidence=packed.evidence;citations=evidence.map(c=>({...courseCitation(c),...(c.citation||{}),id:c.id,label:c.label,node_id:c.node_id||null}));
    const actualPolicy=answerPolicy(evidence,knowledgeScope,body.mode,message);Object.assign(policy,actualPolicy);
    if(!actualPolicy.can_generate)reply=actualPolicy.coverage_notice;
    else if(onDelta){const data=await remoteStream(selected,catalog,{messages:packed.messages,max_tokens:4096},fetcher,onDelta,signal);reply=data.reply;used=true;responseModel=data.model;finishReason=data.finish_reason;contextMetadata=withProviderUsage(packed.context,data.usage)}
    else{const data=await remote(selected,catalog,{messages:packed.messages,max_tokens:4096},fetcher,signal);reply=data.choices[0].message.content;if(typeof reply!=='string'||!reply.trim())throw completionError('供应商没有返回有效文字回答，本次生成未完成；请重试。','PROVIDER_EMPTY_CONTENT',data,selected,data._response_format||'json');used=true;responseModel=typeof data.model==='string'?data.model:null;finishReason=data.choices[0].finish_reason||null;contextMetadata=withProviderUsage(packed.context,data.usage)}
   }
   const methods=[...new Set(evidence.flatMap(c=>Array.isArray(c.retrieval?.methods)?c.retrieval.methods:c.retrieval?.method==='bm25+curated-graph'?['BM25','bilingual_term_aliases','typed_graph_context','concept_priority']:c.retrieval?.method==='bm25+editorial-bilingual-aliases'?['BM25','editorial_bilingual_topic_aliases']:c.retrieval?.method?[c.retrieval.method]:[]))];
   const scope=[...new Set(evidence.map(c=>c.evidence_type==='public_web_excerpt'?'公开网页快照':c.evidence_type==='public_reference_guide'?'项目参考导读':c.evidence_type==='source_excerpt'?'教材原文片段':'课程知识卡'))].join('、')||'未提供资料片段';
   const retrieval={methods,evidence_count:evidence.length,source_excerpts:evidence.filter(c=>c.evidence_type==='source_excerpt').length,public_web_excerpts:evidence.filter(c=>c.evidence_type==='public_web_excerpt').length,public_reference_guides:evidence.filter(c=>c.evidence_type==='public_reference_guide').length,scope};
   const metadata={conversation_id:conversationId,request_id:token.id,finish_reason:finishReason,completion_status:finishReason==='length'?'truncated':finishReason==='content_filter'?'filtered':'complete',completion_notice:finishReason==='length'?'模型达到输出上限，本条回答被截断。':finishReason==='content_filter'?'供应商限制了部分内容，本条回答未完整返回。':'',model_used:used,model_provider:used?selected.provider:null,requested_model:used?selected.model:null,response_model:responseModel,requested_knowledge_mode:knowledgeScope,knowledge_scope:policy.knowledge_scope,coverage_status:policy.coverage_status,coverage_notice:policy.coverage_notice,evidence_assessment:policy.evidence_assessment,context:contextMetadata};
   const answer={reply,...metadata,evidence_ids:evidence.map(c=>c.id),evidence,citations,retrieval,...(simulationDraft?{simulation_draft:simulationDraft}:{})};
   if(signal?.aborted)throw Object.assign(new Error('请求已停止'),{code:'CANCELLED'});
   await chats.finish(token,message,answer);return answer;
   }
   if(body.stream===true){
    return finish(eventStreamResponse(async(send,signal)=>{
     try{send('status',{stage:'generating',message:'正在依据资料处理',request_id:token.id});const answer=await execute(text=>send('delta',{text}),signal);send('done',answer)}
     catch(error){await chats.abandon(token,signal.aborted?'cancelled':'failed');error.publicMessage=error.status===502?error.message:'本次生成未完成，请稍后重试';throw error}
    },{signal:request.signal,onCancel:()=>chats.abandon(token,'cancelled')}));
   }
   try{return finish(json(await execute(null,request.signal)))}catch(error){await chats.abandon(token,error.code==='CANCELLED'?'cancelled':'failed');throw error}
  }catch(e){const msg=String(e.message||'').slice(0,220);const status=[400,403,404,405,409,413,422,429,502,503,504].includes(e.status)?e.status:msg.startsWith('供应商')||msg.includes('连接')||msg.includes('响应')?502:422;return finish(json({detail:msg.startsWith('Unexpected')||e instanceof SyntaxError?'请求必须是有效 JSON':msg||'请求未完成',...(e.code?{code:e.code}:{}),...(e.context?{context:e.context}:{}),...(e.diagnostic?{diagnostic:e.diagnostic}:{})},status))}
 };
}
