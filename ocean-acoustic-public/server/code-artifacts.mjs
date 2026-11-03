import {textPage} from './research-context.mjs';
const fail=(message,status=422)=>Object.assign(new Error(message),{status});
const bytes=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).length;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const object=value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw fail('代码文档须为对象');return value;};
function text(value,label,max){if(typeof value!=='string'||bytes(value)>max)throw fail(label+'过长或格式无效');return value;}
function identity(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(value))throw fail('代码标识无效');return value;}
export const sourceHash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const workspace=id=>'/#code/'+id;
export function validateCode(body){
 object(body);if(!['python','matlab'].includes(body.language))throw fail('代码语言请选择python或matlab');
 const code=text(body.code,'代码',50000);if(!code.trim())throw fail('代码不能为空');
 return {title:text(body.title??'未命名代码','标题',240).trim()||'未命名代码',language:body.language,code,input_csv:text(body.input_csv??'','CSV数据',100000)};
}
export async function validateCodeResult(value,code,inputCSV){
 object(value);if(bytes(value)>600000)throw fail('运行结果格式无效或超过600KB');
 const hashes={code_sha256:await sourceHash(code),input_sha256:await sourceHash(inputCSV)};
 for(const [name,expected] of Object.entries(hashes))if(typeof value[name]!=='string'||!/^[a-f0-9]{64}$/i.test(value[name])||value[name].toLowerCase()!==expected)throw fail('运行结果与当前代码或CSV数据不一致，请重新运行',409);
 const artifacts=value.artifacts??[];if(!Array.isArray(artifacts)||artifacts.length>8)throw fail('最多保存8个输出文件');
 const names=new Set();
 const files=artifacts.map(item=>{
  object(item);if(typeof item.name!=='string'||!/^[\w\u4e00-\u9fff -][\w.\u4e00-\u9fff -]{0,100}$/.test(item.name)||item.name.includes('..')||!item.name.trim()||names.has(item.name))throw fail('输出文件名无效或重复');names.add(item.name);
  if(item.mime==='image/png'){
   if(item.base64!==undefined&&item.data_base64!==undefined&&item.base64!==item.data_base64)throw fail('PNG编码字段不一致');
   const data=text(item.data_base64??item.base64,'PNG数据',550000);if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw fail('PNG编码无效');
   let raw;try{raw=atob(data);}catch{throw fail('PNG编码无效');}
   if(raw.length<24||!raw.startsWith('\x89PNG\r\n\x1a\n')||raw.slice(12,16)!=='IHDR')throw fail('输出不是PNG文件');
   const size=offset=>((raw.charCodeAt(offset)*16777216)+(raw.charCodeAt(offset+1)<<16)+(raw.charCodeAt(offset+2)<<8)+raw.charCodeAt(offset+3));
   if(!size(16)||!size(20)||size(16)>4096||size(20)>4096)throw fail('PNG尺寸须为1–4096像素');
   return {name:item.name,mime:'image/png',data_base64:data};
  }
  if(!['text/plain','text/csv','application/json'].includes(item.mime))throw fail('只保存PNG或文本分析产物');
  return {name:item.name,mime:item.mime,text:text(item.text??'','文本产物',150000)};
 });
 const status=value.status??'succeeded';if(!['succeeded','failed','cancelled','stopped','timed_out'].includes(status))throw fail('运行结果状态无效');
 const warnings=value.warnings??[];if(!Array.isArray(warnings)||warnings.length>12)throw fail('运行警告格式无效');
 if(value.seconds!==undefined&&(!Number.isFinite(value.seconds)||value.seconds<0||value.seconds>3600))throw fail('运行时长无效');
 return {stdout:text(value.stdout??'','标准输出',20000),stderr:text(value.stderr??'','错误输出',8000),artifacts:files,status,...hashes,
  runtime:text(value.runtime??'browser-python','运行环境',100),...(value.seconds!==undefined?{seconds:value.seconds}:{}),warnings:warnings.map(item=>text(item,'运行警告',600)),stdout_truncated:value.stdout_truncated===true,
  ...(value.error_code?{error_code:text(value.error_code,'错误标识',100)}:{}),execution_location:'browser',
  provenance:'browser_client_report',server_verified:false,physical_accuracy:'not_established',
  note:'用户浏览器隔离计算的回传结果；服务端校验格式、归属和代码/输入版本，没有重新执行或认证科学结论。'};
}
function meta(row){return {...Object.fromEntries(['id','title','language','revision','created','updated','code_sha256','input_sha256'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]])),input_contract:{format:'UTF-8 CSV text',variables:['input_csv','INPUT_CSV'],delivery:row.language==='python'?'python_module_globals':'matlab_workspace_variables',environment_variable:false,working_directory_file:'input.csv',requires_explicit_run:true,note:'使用注入变量中的CSV文本，或读取input.csv；不要依赖os.environ/getenv取得CSV。保存源码不会执行；MATLAB需要本地执行器。'}};}
export function createCodeArtifacts({encrypt,decrypt}){
 const one=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).first();
 async function read(env,owner,id){identity(id);const row=await one(env,'SELECT * FROM code_artifacts WHERE owner_id=? AND id=?',owner,id);if(!row)throw fail('代码不存在或不属于当前用户',404);return {...await decrypt(row.ciphertext,env.GATEWAY_SECRET),id:row.id,revision:row.revision,created:row.created,updated:row.updated};}
 async function list(env,owner){const rows=(await env.DB.prepare('SELECT id,revision,created,updated,ciphertext FROM code_artifacts WHERE owner_id=? ORDER BY updated DESC LIMIT 50').bind(owner).all()).results||[];return Promise.all(rows.map(async row=>{const data=await decrypt(row.ciphertext,env.GATEWAY_SECRET);return {...meta({...data,...row}),has_result:!!data.result};}));}
 async function save(env,owner,body,id=null,resultOnly=false,creation={}){
  object(body);const previous=id?await read(env,owner,id):null;
  if(previous&&body.expected_revision!==previous.revision)throw fail('代码已更新，请重新载入后再保存',409);
  if(resultOnly&&!previous)throw fail('请先保存代码后再提交运行结果');
  const value=resultOnly?{...previous,result:{...await validateCodeResult({...object(body.result),code_sha256:body.result.code_sha256??body.code_sha256,input_sha256:body.result.input_sha256??body.input_sha256},previous.code,previous.input_csv),source_revision:previous.revision}}:{...validateCode(previous&&body.input_csv===undefined?{...body,input_csv:previous.input_csv}:body),result:null};
  if(previous?.creation_fingerprint)value.creation_fingerprint=previous.creation_fingerprint;
  else if(creation.fingerprint)value.creation_fingerprint=creation.fingerprint;
  value.code_sha256=await sourceHash(value.code);value.input_sha256=await sourceHash(value.input_csv);
  for(const key of ['id','revision','created','updated'])delete value[key];
  if(bytes(value)>700000)throw fail('代码与结果总计超过700KB');
  if(!previous){const count=await one(env,'SELECT COUNT(*) AS n FROM code_artifacts WHERE owner_id=?',owner);if(count.n>=50)throw fail('最多保留50份代码文档');}
  const idToSave=id||creation.id||crypto.randomUUID(),now=Date.now(),revision=(previous?.revision||0)+1,cipher=await encrypt(value,env.GATEWAY_SECRET);
  if(previous){const update=await env.DB.prepare('UPDATE code_artifacts SET ciphertext=?,revision=?,updated=? WHERE owner_id=? AND id=? AND revision=?').bind(cipher,revision,now,owner,idToSave,previous.revision).run();if(!(update.meta?.changes??update.changes))throw fail('代码正在被其他操作更新，请重新载入',409);}
  else try{await env.DB.prepare('INSERT INTO code_artifacts(id,owner_id,ciphertext,revision,created,updated) VALUES(?,?,?,?,?,?)').bind(idToSave,owner,cipher,revision,now,now).run();}
  catch(error){
   if(!creation.id)throw error;
   let existing;try{existing=await read(env,owner,idToSave);}catch{throw error;}
   if(existing.creation_fingerprint!==creation.fingerprint)throw fail('同一创建请求不能用于不同代码内容',409);
   return {...existing,reused:true};
  }
  return read(env,owner,idToSave);
 }
 async function createOnce(env,owner,body,requestKey){
  const normalized=validateCode(body),fingerprint=await sourceHash(JSON.stringify(normalized)),id='code-'+(await sourceHash(owner+':'+text(requestKey,'代码创建请求标识',300))).slice(0,40);
  let existing;try{existing=await read(env,owner,id);}catch(error){if(error.status!==404)throw error;}
  if(existing){if(existing.creation_fingerprint!==fingerprint)throw fail('同一创建请求不能用于不同代码内容',409);return {...existing,reused:true};}
  return save(env,owner,normalized,null,false,{id,fingerprint});
 }
 async function handle(request,env,owner){
  const url=new URL(request.url),match=url.pathname.match(/^\/api\/research\/code\/artifacts(?:\/([A-Za-z0-9_-]{8,100})(?:\/(results))?)?$/);if(!match)throw fail('代码接口不存在',404);
  const [,id,results]=match;
  if(request.method==='GET'&&!results)return json(id?await read(env,owner,id):await list(env,owner));
  if(request.method==='POST'){
   const raw=await request.text();if(bytes(raw)>750000)throw fail('请求超过750KB',413);let body;try{body=JSON.parse(raw);}catch{throw fail('请求不是合法JSON');}
   return json(await save(env,owner,body,id,!!results));
  }
  if(request.method==='DELETE'&&id&&!results){await read(env,owner,id);await env.DB.prepare('DELETE FROM code_artifacts WHERE owner_id=? AND id=?').bind(owner,id).run();return json({deleted:true});}
  throw fail('请求方法不匹配',405);
 }
 return {handle,save,read,list,createOnce};
}
const string={type:'string'},integer={type:'integer'};
const tool=(name,description,properties={},required=Object.keys(properties))=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
export const CODE_TOOL_SPECS=[
 tool('list_code_artifacts','列出当前用户保存的代码草稿，不运行代码'),
 tool('read_code_artifact','按字符位置分页读取本人代码或显式CSV；片段不等于完整文件',{id:string,field:{type:'string',enum:['code','input_csv']},offset:integer,max_bytes:integer},['id']),
 tool('write_code_artifact','保存Python/MATLAB源码草稿；修改需原revision。只保存文档，浏览器运行须用户明确点击，不能写入或伪造执行结果',{id:string,expected_revision:integer,title:string,language:{type:'string',enum:['python','matlab']},code:string,input_csv:string},['title','language','code']),
 tool('read_code_result','读取本人浏览器回传运行记录、错误或文本结果；这不是服务端独立核验。PNG只列元数据，不读取base64到模型',{id:string,field:{type:'string',enum:['stdout','stderr','file']},name:string,offset:integer,max_bytes:integer},['id']),
];
export async function executeCodeTool(store,name,args,env,owner,options={}){
 object(args);
 if(name==='list_code_artifacts')return {artifacts:await store.list(env,owner),scope:'current_visitor',execution:false};
 if(name==='write_code_artifact'){
  const row=!args.id&&options.request_key?await store.createOnce(env,owner,args,options.request_key):await store.save(env,owner,args,args.id??null);
  return {...meta(row),workspace_url:workspace(row.id),executed:false,...(row.reused?{reused:true}:{}),note:row.reused?'复用本次工具调用此前创建的草稿；用户可能已修改，请重新读取。没有重新执行或覆盖代码。':'代码已保存；请在代码与分析页面审阅后显式运行。生成或保存源码不代表已经执行。'};
 }
 const row=await store.read(env,owner,args.id),base={...meta(row),workspace_url:workspace(row.id)};
 if(name==='read_code_artifact'){
  const field=args.field??'code';if(!['code','input_csv'].includes(field))throw fail('只能读取代码或CSV');
  return {...base,field,...textPage(row[field],args.offset??0,args.max_bytes??6000),executed:false,note:'保存的源文本，不是执行结果。按next_offset继续读取完整内容。'};
 }
 if(name==='read_code_result'){
  const result=row.result;if(!result)return {...base,result:null,executed:false,note:'此代码版本没有浏览器运行回执。'};
  const artifacts=result.artifacts.map(item=>{const data=item.data_base64||item.base64||'';return {name:item.name,mime:item.mime,bytes:item.text!==undefined?bytes(item.text):Math.floor(data.length*3/4)-(data.match(/=*$/)?.[0].length||0)};});
  const field=args.field??'stdout';if(!['stdout','stderr','file'].includes(field))throw fail('运行结果读取字段无效');
  const receipt={...base,...Object.fromEntries(['status','source_revision','code_sha256','input_sha256','runtime','seconds','warnings','error_code','provenance','server_verified','physical_accuracy'].filter(key=>result[key]!==undefined).map(key=>[key,result[key]])),artifacts,field};
  if(field==='file'){
   const file=result.artifacts.find(item=>item.name===args.name);if(!file)throw fail('运行输出文件不存在',404);
   if(file.text===undefined)return {...receipt,name:file.name,content_unavailable:true,note:'图片在代码与分析页面查看或下载；没有把图片内容交给模型。'};
   return {...receipt,name:file.name,...textPage(file.text,args.offset??0,args.max_bytes??6000)};
  }
  return {...receipt,...textPage(result[field]||'',args.offset??0,args.max_bytes??6000)};
 }
 throw fail('代码工具不存在',404);
}
