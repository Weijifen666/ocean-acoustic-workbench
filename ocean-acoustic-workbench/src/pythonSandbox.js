import manifest from './pyodide-manifest.json';
import workerSource from './python-sandbox-worker.js?raw';

export const PYTHON_LIMITS={codeBytes:50000,csvBytes:100000,executionMs:20000,initializationMs:120000,resultBytes:550000};
const encoded=text=>new TextEncoder().encode(String(text));
export const byteLength=text=>encoded(text).length;
export async function sha256(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoded(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const caches=new Map();
async function asset(record,signal){
  if(caches.has(record.name))return caches.get(record.name).slice(0);
  const response=await fetch(manifest.base_url+record.name,{credentials:'omit',cache:'force-cache',signal,referrerPolicy:'no-referrer'});
  if(!response.ok)throw Error('运行依赖下载失败：'+record.name+'（HTTP '+response.status+'）');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==record.bytes)throw Error('运行依赖长度不一致：'+record.name);
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==record.sha256)throw Error('运行依赖SHA256校验失败：'+record.name);
  caches.set(record.name,bytes);return bytes.slice(0);
}
function frameHtml(channel){
  // No same-origin permission, forms, top navigation, popups, downloads or
  // network. The parent downloads verified public runtime bytes before code.
  const source=`const channel=${JSON.stringify(channel)};let worker;
window.addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==channel)return;
const message=event.data;try{if(message.type==='boot'){
 const url=URL.createObjectURL(new Blob([message.worker],{type:'text/javascript'}));
 worker=new Worker(url,{type:'module'});
 worker.onmessage=event=>{if(event.data?.type==='ready')URL.revokeObjectURL(url);parent.postMessage({channel,...event.data},'*')};
 worker.onerror=event=>{URL.revokeObjectURL(url);parent.postMessage({channel,type:'error',message:'隔离Python运行环境失败：'+String(event.message||'浏览器拒绝执行计算线程').slice(0,1000)},'*')};
 const assets=message.assets;worker.postMessage({type:'init',assets},assets.map(item=>item.bytes));
}else if(message.type==='execute')worker?.postMessage({type:'execute',code:message.code,input_csv:message.input_csv});
else if(message.type==='stop'){worker?.terminate();worker=null;}}catch(error){parent.postMessage({channel,type:'error',message:'隔离Python环境未启动：'+String(error?.message||error).slice(0,1000)},'*')}});
parent.postMessage({channel,type:'frame-ready'},'*');`;
  const policy="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src data: blob:; style-src 'none'; base-uri 'none'; form-action 'none'";
  return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+policy+'"><script>'+source.replaceAll('</script','<\\/script')+'</'+'script>';
}
export function runPythonSandbox({code,input_csv='',onStatus=()=>{},onStream=()=>{},timeoutMs=PYTHON_LIMITS.executionMs}){
  if(byteLength(code)>PYTHON_LIMITS.codeBytes)throw Error('代码最多50KB');
  if(byteLength(input_csv)>PYTHON_LIMITS.csvBytes)throw Error('输入CSV最多100KB');
  if(!globalThis.crypto?.subtle)throw Error('代码运行需要HTTPS或localhost安全环境');
  const controller=new AbortController(),channel=crypto.randomUUID(),iframe=document.createElement('iframe');
  iframe.setAttribute('sandbox','allow-scripts');iframe.setAttribute('aria-hidden','true');iframe.title='隔离Python计算环境';iframe.style.display='none';
  let settled=false,timer,resolvePromise,resolveFrame,runtimeReady=false,stdout='',stderr='';
  const started=performance.now();
  const promise=new Promise(resolve=>{resolvePromise=resolve});
  const frameReady=new Promise(resolve=>{resolveFrame=resolve});
  function finish(result){
    if(settled)return;settled=true;clearTimeout(timer);controller.abort();
    iframe.contentWindow?.postMessage({channel,type:'stop'},'*');
    window.removeEventListener('message',receive);iframe.remove();
    resolveFrame(false);
    resolvePromise({...result,runtime:result.runtime||'pyodide-314.0.7',execution_location:'browser',server_verified:false,
      seconds:result.seconds??Math.round(performance.now()-started)/1000});
  }
  function receive(event){
    if(settled||event.source!==iframe.contentWindow||event.data?.channel!==channel)return;
    const data=event.data;
    if(data.type==='frame-ready'){resolveFrame(true);}
    else if(data.type==='ready'&&!runtimeReady){
      runtimeReady=true;onStatus('运行Python代码');clearTimeout(timer);
      timer=setTimeout(()=>finish({status:'failed',error_code:'EXECUTION_TIMEOUT',stdout,stderr:'运行超时，计算线程已终止。',artifacts:[]}),Math.max(1000,Math.min(timeoutMs,60000)));
      iframe.contentWindow.postMessage({channel,type:'execute',code,input_csv},'*');
    }else if(data.type==='stream'&&runtimeReady){
      if(data.kind==='stdout')stdout=String(data.text||'').slice(0,16000);else stderr=String(data.text||'').slice(0,8000);
      onStream({stdout,stderr});
    }else if(data.type==='result'&&runtimeReady){
      const value=data.result;
      if(!value||!['succeeded','failed'].includes(value.status)||!Array.isArray(value.artifacts)||byteLength(JSON.stringify(value))>PYTHON_LIMITS.resultBytes)
        finish({status:'failed',stdout,stderr:'运行结果超出大小或格式限制，未接收。',artifacts:[]});
      else finish(value);
    }else if(data.type==='error')finish({status:'failed',stdout,stderr:String(data.message||'计算失败').slice(0,6000),artifacts:[]});
  }
  window.addEventListener('message',receive);iframe.srcdoc=frameHtml(channel);document.body.appendChild(iframe);
  timer=setTimeout(()=>finish({status:'failed',error_code:'RUNTIME_LOAD_TIMEOUT',stdout:'',stderr:'运行依赖加载超时；未执行代码。请检查网络后重试。',artifacts:[]}),PYTHON_LIMITS.initializationMs);
  (async()=>{
    try {
      let complete=0;const records=[];const pending=[...manifest.files];
      onStatus('首次加载约27MB运行依赖（逐项校验）');
      await Promise.all(Array.from({length:4},async()=>{while(pending.length&&!settled){const file=pending.shift();records.push({name:file.name,bytes:await asset(file,controller.signal)});onStatus('校验运行依赖 '+(++complete)+' / '+manifest.files.length);}}));
      if(settled)return;
      if(!await frameReady || settled)return;
      onStatus('在隔离线程初始化NumPy与Matplotlib');
      iframe.contentWindow.postMessage({channel,type:'boot',worker:workerSource,assets:records},'*',records.map(item=>item.bytes));
    }catch(error){if(!settled)finish({status:'failed',error_code:'RUNTIME_UNAVAILABLE',stdout:'',stderr:String(error?.message||error),artifacts:[]});}
  })();
  return {promise,stop:()=>finish({status:'cancelled',stdout,stderr:runtimeReady?'运行已停止，计算线程已终止。':'依赖加载已停止，未执行代码。',artifacts:[]})};
}
