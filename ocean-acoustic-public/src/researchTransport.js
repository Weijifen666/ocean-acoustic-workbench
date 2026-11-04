// Keep browser transport failures separate from structured provider/server errors.
// No response body, headers, credentials or URLs enter the public diagnostic.
function uncertain(message,code,cause){
 return Object.assign(new Error(message),{code,kind:'transport',requestUnconfirmed:true,...(cause?{cause}: {})});
}

export async function researchApi(path,body,method){
 let response;
 try{
  response=await fetch('/api/research/'+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 }catch(cause){
  throw uncertain('浏览器未取得工作台响应，请检查网络后恢复连接。','WORKBENCH_NETWORK',cause);
 }
 let value;
 try{
  // The json fallback keeps simple controlled test transports supported.
  value=typeof response.text==='function'?JSON.parse(await response.text()):await response.json();
 }catch(cause){
  const format=cause instanceof SyntaxError;
  throw uncertain(format?'工作台返回的内容不是有效 JSON，可能是登录页面或网关错误；本次状态需要确认。':'工作台响应读取中断；本次状态需要确认。',format?'WORKBENCH_RESPONSE_FORMAT':'WORKBENCH_RESPONSE_INTERRUPTED',cause);
 }
 if(!response.ok){
  throw Object.assign(new Error(typeof value?.detail==='string'?value.detail:'工作台暂未完成请求，请稍后确认状态。'),{
   code:value?.error_code||value?.code||'WORKBENCH_HTTP_ERROR',kind:'server',status:response.status,
   context:value?.context,recoverable:value?.recoverable,
   requestUnconfirmed:response.status>=500||response.status===408,
  });
 }
 return value;
}
