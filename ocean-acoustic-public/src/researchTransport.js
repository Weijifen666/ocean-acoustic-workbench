// Keep browser transport failures separate from structured provider/server errors.
// No response body, headers, credentials or URLs enter the public diagnostic.
function uncertain(message,code,cause){
 return Object.assign(new Error(message),{code,kind:'transport',requestUnconfirmed:true,...(cause?{cause}: {})});
}

function cancelled(){return Object.assign(new Error('请求已停止'),{code:'WORKBENCH_CANCELLED',kind:'cancelled',requestUnconfirmed:false})}

async function readStepStream(response,signal){
 const reader=response.body?.getReader();
 if(!reader)throw uncertain('工作台步骤响应不完整；正在核对本次状态。','WORKBENCH_RESPONSE_INTERRUPTED');
 const decoder=new TextDecoder();let buffer='';
 const frame=line=>{
  if(!line.trim())return null;
  const value=JSON.parse(line);
  if(value?.type==='heartbeat')return null;
  if(value?.type!=='response'||!Number.isInteger(value.status)||value.status<200||value.status>599||!Object.hasOwn(value,'body'))throw new SyntaxError('Invalid step frame');
  return value;
 };
 try{
  while(true){
   if(signal?.aborted)throw cancelled();
   const item=await reader.read();buffer+=decoder.decode(item.value,{stream:!item.done});
   if(buffer.length>4*1024*1024)throw new SyntaxError('Step frame too large');
   let end;
   while((end=buffer.indexOf('\n'))!==-1){const value=frame(buffer.slice(0,end));buffer=buffer.slice(end+1);if(value)return value}
   if(item.done){const value=frame(buffer);if(value)return value;throw uncertain('工作台连接在步骤结果返回前中断；正在核对本次状态。','WORKBENCH_RESPONSE_INTERRUPTED')}
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}

export async function researchApi(path,body,method,{signal}={}){
 let response;const verb=method||(body?'POST':'GET'),step=verb==='POST'&&/^runs\/[^/]+\/step$/.test(path);
 try{
  if(signal?.aborted)throw cancelled();
  response=await fetch('/api/research/'+path,{method:verb,headers:{'Content-Type':'application/json',...(step?{Accept:'application/x-ndjson'}:{})},...(body?{body:JSON.stringify(body)}:{}),...(signal?{signal}:{})});
 }catch(cause){
  if(signal?.aborted)throw cancelled();
  throw uncertain('浏览器未取得工作台响应，请检查网络后恢复连接。','WORKBENCH_NETWORK',cause);
 }
 let value,status=response.status,ok=response.ok;
 try{
  if(step&&response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/x-ndjson'){
   const result=await readStepStream(response,signal);value=result.body;status=result.status;ok=status>=200&&status<300;
  }else{
   // Normal JSON remains compatible with local servers and older gateways.
   value=typeof response.text==='function'?JSON.parse(await response.text()):await response.json();
  }
 }catch(cause){
  if(signal?.aborted)throw cancelled();
  if(cause.kind==='transport')throw cause;
  const format=cause instanceof SyntaxError;
  throw uncertain(format?'工作台返回的内容不是有效 JSON，可能是登录页面或网关错误；本次状态需要确认。':'工作台响应读取中断；本次状态需要确认。',format?'WORKBENCH_RESPONSE_FORMAT':'WORKBENCH_RESPONSE_INTERRUPTED',cause);
 }
 if(signal?.aborted)throw cancelled();
 if(!ok){
  throw Object.assign(new Error(typeof value?.detail==='string'?value.detail:'工作台暂未完成请求，请稍后确认状态。'),{
   code:value?.error_code||value?.code||'WORKBENCH_HTTP_ERROR',kind:'server',status,
   context:value?.context,recoverable:value?.recoverable,
   requestUnconfirmed:status>=500||status===408,
  });
 }
 return value;
}
