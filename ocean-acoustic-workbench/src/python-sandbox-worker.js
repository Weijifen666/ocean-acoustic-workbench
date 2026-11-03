// Executed only as a Blob classic Worker inside an opaque, network-disabled frame.
// Runtime bytes have already been pinned and verified by the parent application.
let python;
const encoder = new TextEncoder();
const textLimit = (text, maximum) => {
  const bytes = encoder.encode(String(text));
  return bytes.length <= maximum ? String(text) : new TextDecoder().decode(bytes.subarray(0, maximum), {stream:true});
};
let output = '', errors = '', outputTruncated = false;
function stream(kind, text) {
  const current = kind === 'stdout' ? output : errors, limit = kind === 'stdout' ? 12000 : 6000;
  const next = textLimit(current + text + '\n', limit);
  if (next.length < current.length + text.length + 1) outputTruncated = true;
  if (next !== current) self.postMessage({type:'stream',kind,text:next});
  if (kind === 'stdout') output = next; else errors = next;
}
function encode(bytes) {
  let result='';
  for(let offset=0;offset<bytes.length;offset+=16384) result+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
  return btoa(result);
}
function disableNetworkAndWorkers() {
  // CSP connect-src 'none' is the enforcement boundary; these guards give a
  // clear error and also prevent nested worker trees from outliving a run.
  for(const name of ['XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker','BroadcastChannel']) {
    try {Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false});} catch {}
  }
}
async function initialize(items) {
  const files = new Map(items.map(item=>[item.name,item.bytes]));
  const lookup = value => {
    const url = new URL(typeof value==='string'?value:value instanceof URL?value.href:value.url,'https://runtime.invalid/');
    if(url.origin!=='https://runtime.invalid' || url.search || url.hash) throw Error('代码运行环境禁止网络请求');
    const name=url.pathname.replace(/^\//,'');
    if(!files.has(name))throw Error('未预加载的运行依赖：'+name+'；执行环境不提供网络安装');
    return {name,bytes:files.get(name)};
  };
  Object.defineProperty(globalThis,'fetch',{value:async value=>{
    const {name,bytes}=lookup(value);
    return new Response(bytes.slice(0),{status:200,headers:{'Content-Type':name.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});
  },writable:false,configurable:false});
  disableNetworkAndWorkers();
  const urls=[];
  function moduleUrl(name){const url=URL.createObjectURL(new Blob([files.get(name)],{type:'text/javascript'}));urls.push(url);return url;}
  try {
    const {loadPyodide}=await import(moduleUrl('pyodide.mjs'));
    const createPyodideModule=(await import(moduleUrl('pyodide.asm.mjs'))).default;
    python=await loadPyodide({
      indexURL:'https://runtime.invalid/',packageBaseUrl:'https://runtime.invalid/',
      createPyodideModule,lockFileContents:JSON.parse(new TextDecoder().decode(files.get('pyodide-lock.json'))),
      jsglobals:Object.create(null),packages:['numpy','matplotlib'],
      stdout:text=>stream('stdout',text),stderr:text=>stream('stderr',text),
      env:{MPLBACKEND:'Agg'},
    });
    await python.runPythonAsync("import os, matplotlib\nmatplotlib.use('Agg')\nos.makedirs('/work', exist_ok=True)\nos.chdir('/work')\n");
    self.postMessage({type:'ready',version:python.version});
  } finally { for(const url of urls)URL.revokeObjectURL(url); }
}
async function execute(code, csv) {
  output='';errors='';outputTruncated=false;
  const started=performance.now(), files=[], warnings=[];
  let status='succeeded';
  const namespace=python.globals.get('dict')();
  namespace.set('__name__','__main__');namespace.set('input_csv',csv||'');namespace.set('INPUT_CSV',csv||'');
  python.FS.writeFile('/work/input.csv',csv||'',{encoding:'utf8'});
  try {
    await python.runPythonAsync(code,{globals:namespace});
    await python.runPythonAsync("import matplotlib.pyplot as _plt\nfor _i, _n in enumerate(_plt.get_fignums()[:6], 1):\n    _plt.figure(_n).savefig('/work/figure-%d.png' % _i, dpi=100, bbox_inches='tight')\n_plt.close('all')\n");
  } catch(error) {status='failed';stream('stderr',String(error?.message||error));}
  finally {namespace.destroy();}
  let total=0,serializedTotal=0;
  for(const name of python.FS.readdir('/work')) {
    if(name==='input.csv'||name.startsWith('.')||!/^[-\w.]{1,80}\.(?:png|csv|json|txt)$/i.test(name))continue;
    if(files.length>=6){warnings.push('结果最多保留6个文件，其余未上传。');break;}
    const path='/work/'+name, stat=python.FS.lstat(path);
    if(!python.FS.isFile(stat.mode))continue;
    if(stat.size>256000 || total+stat.size>300000){warnings.push(name+' 超过结果大小限制，未上传。');continue;}
    const bytes=python.FS.readFile(path),extension=name.split('.').at(-1).toLowerCase();
    const mime={png:'image/png',csv:'text/csv',json:'application/json',txt:'text/plain'}[extension];
    if(extension!=='png'&&stat.size>150000){warnings.push(name+' 超过文本产物150KB大小限制，未上传。');continue;}
    if(extension==='png'){
      if(bytes.length<24 || ![137,80,78,71,13,10,26,10].every((value,i)=>bytes[i]===value)){warnings.push(name+' 不是有效PNG，未上传。');continue;}
      const size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      if(size.getUint32(16)>4096 || size.getUint32(20)>4096){warnings.push(name+' 的图片尺寸超过4096像素，未上传。');continue;}
    }
    const item=['csv','json','txt'].includes(extension)?{name,mime,text:new TextDecoder().decode(bytes)}:{name,mime,base64:encode(bytes)};
    const serializedSize=encoder.encode(JSON.stringify(item)).length;
    if(serializedTotal+serializedSize>400000){warnings.push(name+' 编码后的结果超过传输大小限制，未上传。');continue;}
    files.push(item);serializedTotal+=serializedSize;
    total+=stat.size;
  }
  self.postMessage({type:'result',result:{status,stdout:output,stderr:errors,artifacts:files,warnings,
    stdout_truncated:outputTruncated,seconds:Math.round((performance.now()-started))/1000,
    runtime:'pyodide-314.0.7',execution_location:'browser',server_verified:false}});
}
self.onmessage=async event=>{
  try {
    const data=event.data;
    if(data.type==='init')await initialize(data.assets);
    else if(data.type==='execute')await execute(data.code,data.input_csv);
  } catch(error) {self.postMessage({type:'error',message:String(error?.message||error)});}
};
