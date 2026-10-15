// OpenAI-compatible SSE content parser. Reasoning/tool internals are not emitted.
export async function readProviderStream(response,onDelta,signal){
 if(!response.body)throw new Error('供应商没有返回响应流');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',reply='',model=null,usage=null,finished=false,finishReason=null;
 const abort=()=>{void reader.cancel().catch(()=>{})};signal?.addEventListener('abort',abort,{once:true});
 try{
  while(true){
   if(signal?.aborted)throw Object.assign(new Error('请求已停止'),{name:'AbortError',code:'CANCELLED'});
   const {done,value}=await reader.read();
   if(done)break;buffer+=decoder.decode(value,{stream:true});
   if(buffer.length>262144)throw new Error('供应商流式消息过长');
   let boundary;
   while((boundary=buffer.search(/\r?\n\r?\n/))>=0){
    const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+(buffer[boundary]==='\r'?4:2));
    const data=frame.split(/\r?\n/).filter(s=>s.startsWith('data:')).map(s=>s.slice(5).trimStart()).join('\n');
    if(!data)continue;if(data==='[DONE]'){finished=true;break}
    let payload;try{payload=JSON.parse(data)}catch{throw new Error('供应商流式消息格式不兼容')}
    if(payload.error)throw new Error('供应商流式生成未完成');
    if(typeof payload.model==='string')model=payload.model;if(payload.usage)usage=payload.usage;
    const choice=payload.choices?.[0];if(choice?.finish_reason)finishReason=choice.finish_reason;
    const text=choice?.delta?.content;
    if(typeof text==='string'&&text){reply+=text;if(reply.length>65536)throw new Error('供应商返回文字超过限制');await onDelta(text)}
   }
   if(finished)break;
  }
  if(signal?.aborted)throw Object.assign(new Error('请求已停止'),{name:'AbortError',code:'CANCELLED'});
  if(!finished&&!finishReason)throw new Error('供应商连接中断，回答尚未完成');
  if(!reply)throw new Error('供应商未返回文字内容');
  return {reply,model,usage,finish_reason:finishReason};
 }finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock()}
}
export function eventStreamResponse(work,{signal,onCancel,headers={}}={}){
 const encoder=new TextEncoder(),controller=new AbortController();let closed=false;
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted)controller.abort();
 const stream=new ReadableStream({
  start(output){
   const send=(event,data)=>{if(!closed&&!controller.signal.aborted)output.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))};
   // Heartbeats keep intermediaries active while retrieval or provider prefill runs.
   const pulse=setInterval(()=>{try{if(!closed)output.enqueue(encoder.encode(': keepalive\n\n'))}catch{}},12000);
   Promise.resolve().then(()=>work(send,controller.signal)).catch(error=>{
    if(!controller.signal.aborted)send('error',{detail:error.publicMessage||'本次生成未完成，请稍后重试',code:error.code||'CHAT_FAILED'});
   }).finally(()=>{clearInterval(pulse);signal?.removeEventListener('abort',abort);if(!closed){closed=true;try{output.close()}catch{}}});
  },
  cancel(){closed=true;controller.abort();signal?.removeEventListener('abort',abort);return onCancel?.()}
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Content-Type-Options':'nosniff',...headers}});
}
