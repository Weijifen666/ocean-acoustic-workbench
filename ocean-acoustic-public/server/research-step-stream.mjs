// Keep a long research step attached to its HTTP request. Heartbeats carry no
// model data; the final frame preserves the ordinary JSON response and status.
export function researchStepStream(request,handle,{heartbeatMs=5000}={}){
 const controller=new AbortController(),encoder=new TextEncoder();
 let output,finished=false,timer;
 const cleanup=()=>{clearInterval(timer);request.signal.removeEventListener('abort',abort)};
 const emit=value=>{if(!finished)output.enqueue(encoder.encode(JSON.stringify(value)+'\n'))};
 const abort=()=>{
  if(finished)return;finished=true;cleanup();controller.abort();
  try{output.error(Object.assign(new Error('研究连接已中断'),{name:'AbortError'}))}catch{}
 };
 const stream=new ReadableStream({
  start(target){
   output=target;
   request.signal.addEventListener('abort',abort,{once:true});
   if(request.signal.aborted){abort();return;}
   emit({type:'heartbeat'});
   timer=setInterval(()=>emit({type:'heartbeat'}),heartbeatMs);
   void (async()=>{
    try{
     const response=await handle(new Request(request,{signal:controller.signal}));
     const body=await response.json();
     emit({type:'response',status:response.status,body});
    }catch(error){
     const status=[400,403,404,405,409,413,422,429,502,503,504].includes(error.status)?error.status:503;
     emit({type:'response',status,body:{detail:'研究步骤暂未完成，请确认保存的进度后继续。',code:'WORKBENCH_STEP_FAILED'}});
    }finally{
     cleanup();if(!finished){finished=true;output.close()}
    }
   })();
  },
  cancel(){if(finished)return;finished=true;cleanup();controller.abort()},
 });
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
