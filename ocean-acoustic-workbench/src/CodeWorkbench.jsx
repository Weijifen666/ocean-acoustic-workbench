import React,{useEffect,useRef,useState} from 'react';
import {Play,Square,Save,FileCode2,Download,RefreshCw,MessageSquare,Plus,Trash2} from 'lucide-react';
import {runPythonSandbox,sha256,byteLength,PYTHON_LIMITS} from './pythonSandbox';
import './code-workbench.css';

const BASE='/research/code/artifacts';
const CSV_EXAMPLE='depth_m,sound_speed_m_s\n0,1538.86\n50,1535.49\n100,1526.38\n200,1510.76\n500,1491.19\n1000,1483.83\n';
export const CODE_EXAMPLES={
 python:`import csv, io, json\nimport numpy as np\nimport matplotlib.pyplot as plt\n\n# input_csv 与 input.csv 仅包含你在此工作区载入的数据。\nrows = list(csv.DictReader(io.StringIO(input_csv)))\ndepth = np.array([float(row['depth_m']) for row in rows])\nspeed = np.array([float(row['sound_speed_m_s']) for row in rows])\nprint(f'有效样本: {len(rows)}')\nprint(f'声速范围: {speed.min():.2f}–{speed.max():.2f} m/s')\nprint('示例剖面用于程序演示，不是新的实测或传播仿真。')\nfig, ax = plt.subplots()\nax.plot(speed, depth, 'o-')\nax.invert_yaxis()\nax.set(xlabel='Sound speed (m/s)', ylabel='Depth (m)', title='Input profile')\nax.grid(alpha=.25)\nwith open('summary.json', 'w') as f:\n    json.dump({'samples': len(rows), 'minimum_m_s': float(speed.min())}, f)\n# 未显式保存的 Matplotlib 图也会转为PNG结果。\n`,
 matlab:`% MATLAB源码可在本地完整工作台运行，或下载后在授权MATLAB中执行。\n% 浏览器Python环境不执行MATLAB或Acoustics Toolbox二进制。\ndepth_m = [0 50 100 200 500 1000];\nsound_speed_m_s = [1538.86 1535.49 1526.38 1510.76 1491.19 1483.83];\nfigure; plot(sound_speed_m_s, depth_m, 'o-');\nset(gca,'YDir','reverse'); grid on;\nxlabel('Sound speed (m/s)'); ylabel('Depth (m)');\ntitle('Input profile example');\nexportgraphics(gcf, 'profile.png');\n`,
};
async function defaultApi(path,options={}){const response=await fetch('/api'+path,{headers:{'Content-Type':'application/json'},...options});const value=await response.json();if(!response.ok)throw Error(typeof value.detail==='string'?value.detail:'代码工作区请求失败');return value;}
function asRecord(value){return value?.artifact||value;}
function download(name,content,mime='text/plain;charset=utf-8'){
 const blob=content instanceof Blob?content:new Blob([content],{type:mime}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function outputBytes(item){if(typeof item.text==='string')return new TextEncoder().encode(item.text);const raw=atob(item.data_base64||item.base64||'');return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function safeImage(item){const value=item.data_base64||item.base64;return item.mime==='image/png'&&typeof value==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(value)?'data:image/png;base64,'+value:null;}

export default function CodeWorkbench({api=defaultApi,publicMode=true,onAsk,onRunLocal,onOpenSimulation,onOpenSettings,initialArtifactId}){
 const [items,setItems]=useState([]),[record,setRecord]=useState(null),[title,setTitle]=useState('MATLAB 声速剖面示例'),[language,setLanguage]=useState('matlab');
 const [code,setCode]=useState(CODE_EXAMPLES.matlab),[csv,setCsv]=useState(''),[result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[stage,setStage]=useState(''),[stream,setStream]=useState({stdout:'',stderr:''}),[timeout,setTimeoutValue]=useState('20');
 const [executionMode,setExecutionMode]=useState(null);
 const runner=useRef(null),mounted=useRef(true),activeRequest=useRef(0),selected=useRef(null),fileInput=useRef(null);
 const dirty=!record||title!==record.title||language!==record.language||code!==record.code||csv!==(record.input_csv||'');
 async function refresh(){const response=await api(BASE);const rows=Array.isArray(response)?response:response.artifacts||response.items||[];if(mounted.current)setItems(rows);return rows;}
 function assign(value){const item=asRecord(value);selected.current=item.id;setRecord(item);setTitle(item.title||'代码草稿');setLanguage(item.language||'python');setCode(item.code||'');setCsv(item.input_csv||'');setResult(item.result||null);setError('');setStream({stdout:'',stderr:''});try{sessionStorage.setItem('ocean-code-selected',item.id)}catch{}}
 async function open(id){if(busy||saving)return;const request=++activeRequest.current;setError('');try{const value=await api(BASE+'/'+encodeURIComponent(id));if(mounted.current&&request===activeRequest.current)assign(value)}catch(e){if(mounted.current)setError(e.message)}}
 useEffect(()=>{mounted.current=true;let alive=true;
  refresh().then(rows=>{if(!alive)return;let preferred=initialArtifactId;try{preferred||=sessionStorage.getItem('ocean-code-selected')}catch{};if(preferred&&rows.some(item=>item.id===preferred))open(preferred)}).catch(e=>{if(alive)setError(e.message)});
  const update=()=>refresh().catch(()=>{});window.addEventListener('ocean-code-artifacts-changed',update);
  return()=>{alive=false;mounted.current=false;runner.current?.stop();window.removeEventListener('ocean-code-artifacts-changed',update)};
 },[]);
 function newDraft(){if(busy||saving)return;activeRequest.current++;selected.current=null;try{sessionStorage.removeItem('ocean-code-selected')}catch{}setRecord(null);setTitle('新代码草稿');setCode(CODE_EXAMPLES[language]);setCsv(language==='python'?CSV_EXAMPLE:'');setResult(null);setError('');setStream({stdout:'',stderr:''});setStage('');}
 async function save(){
  if(byteLength(code)>PYTHON_LIMITS.codeBytes)throw Error('代码超过50KB，请缩小后再保存');
  if(byteLength(csv)>PYTHON_LIMITS.csvBytes)throw Error('输入CSV超过100KB，请选择数据子集');
  if(!title.trim()||!code.trim())throw Error('标题和代码不能为空');
  setSaving(true);
  try{const value=await api(BASE+(record?.id?'/'+encodeURIComponent(record.id):''),{method:'POST',body:JSON.stringify({title:title.trim(),language,code,input_csv:csv,...(record?{expected_revision:record.revision}:{})})});const saved=asRecord(value);if(mounted.current){setRecord(saved);selected.current=saved.id;try{sessionStorage.setItem('ocean-code-selected',saved.id)}catch{}setResult(saved.result||null);await refresh()}return saved;}
  finally{if(mounted.current)setSaving(false)}
 }
 async function saveClick(){setError('');try{await save()}catch(e){setError(e.message)}}
 async function remove(){if(!record||busy||saving||!window.confirm('删除这份已保存的代码和结果？当前编辑器内容会保留为未保存草稿。'))return;setSaving(true);setError('');try{await api(BASE+'/'+encodeURIComponent(record.id),{method:'DELETE'});setRecord(null);selected.current=null;setResult(null);setStage('已删除保存记录；编辑器内容仍可另存');try{sessionStorage.removeItem('ocean-code-selected')}catch{}await refresh()}catch(e){setError(e.message)}finally{if(mounted.current)setSaving(false)}}
 async function run(){
  if(busy||saving)return;
  if(language!=='python'){setError('浏览器运行环境支持Python。MATLAB源码请使用本地运行或下载，在声场页面提交受支持的求解器。');return;}
  setExecutionMode('browser');setBusy(true);setError('');setResult(null);setStream({stdout:'',stderr:''});
  try{
   const saved=dirty?await save():record;
   const codeHash=await sha256(code),inputHash=await sha256(csv);
   runner.current=runPythonSandbox({code,input_csv:csv,timeoutMs:Number(timeout)*1000,onStatus:value=>{if(mounted.current)setStage(value)},onStream:value=>{if(mounted.current)setStream(value)}});
   const computed=await runner.current.promise;runner.current=null;
   if(!mounted.current)return;
   const value={...computed,code_sha256:codeHash,input_sha256:inputHash};setResult(value);setStage(value.status==='succeeded'?'浏览器计算完成':value.status==='cancelled'?'已停止':'本次运行未完成');
   try{const stored=asRecord(await api(BASE+'/'+encodeURIComponent(saved.id)+'/results',{method:'POST',body:JSON.stringify({expected_revision:saved.revision,result:value})}));if(mounted.current){setRecord(stored);setResult(stored.result||value);await refresh()}}
   catch(e){if(mounted.current)setError('结果仍可在当前页面下载，但保存未完成：'+e.message)}
  }catch(e){if(mounted.current)setError(e.message)}
  finally{if(mounted.current){setBusy(false);setExecutionMode(null)}}
 }
 async function runLocal(){if(publicMode||typeof onRunLocal!=='function'||busy||saving)return;setExecutionMode('local');setBusy(true);setError('');setResult(null);setStream({stdout:'',stderr:''});setStage('正在本机执行已保存代码，可在任务页查看进度或取消');try{const saved=dirty?await save():record;const run=await onRunLocal({artifact_id:saved.id,title,language,code,input_csv:csv,expected_revision:saved.revision});if(mounted.current){if(run?.artifact){setRecord(run.artifact);await refresh()}setStage('本地任务 '+(run?.job_id||'')+'：'+(run?.state||'请查看任务记录'));if(run?.artifact_linked===false)setError('执行记录未关联当前代码版本，请重新载入。'+(run.artifact_link_error||''))}}catch(e){if(mounted.current)setError(e.message)}finally{if(mounted.current){setBusy(false);setExecutionMode(null)}}}
 async function ask(){if(!onAsk||busy||saving)return;setError('');try{const saved=dirty?await save():record;onAsk('请读取我的代码草稿 '+saved.id+'（修订 '+saved.revision+'，'+language+'），检查输入、修改代码并解释适用条件。只有取得实际运行结果后才能称计算完成。')}catch(e){setError(e.message)}}
 async function loadCsv(event){const file=event.target.files?.[0];if(!file)return;try{if(file.size>PYTHON_LIMITS.csvBytes)throw Error('CSV最多100KB，请先选择数据子集');setCsv(await file.text());setResult(null);setError('')}catch(e){setError(e.message)}finally{event.target.value=''}}
 return <div className="code-workbench" aria-label="代码与分析工作台">
  <header className="code-heading"><div><span>MATLAB WORKSPACE</span><h1>MATLAB 编程与分析</h1><p>让模型协助编写与检查 MATLAB 脚本，结合 AT 完成声场仿真；Python 为可选的数据分析工具。</p></div><button onClick={newDraft} disabled={busy||saving}><Plus size={16}/>新建草稿</button></header>
  <aside className="code-execution-guide" aria-label="MATLAB 执行位置与检查入口">
   <div><strong>{publicMode?'公网 MATLAB：共享计算节点':'本地 MATLAB：运行此工作台的电脑'}</strong><p>{publicMode?'本页可让模型编写、保存和下载 .m 脚本。声场仿真通过已连接节点的 MATLAB / AT 运行；网页不会自动控制访问者电脑上的 MATLAB。':'已保存脚本会交给本机配置的 MATLAB 运行。先检查 MATLAB / AT 路径，再运行示例，并在“任务与结果”核对日志和输出图。'}</p></div>
   <div className="code-guide-actions">{onOpenSimulation&&<button onClick={onOpenSimulation}><Play size={16}/>打开 MATLAB 声场仿真</button>}{!publicMode&&onOpenSettings&&<button onClick={onOpenSettings}><FileCode2 size={16}/>检查本机 MATLAB 环境</button>}</div>
  </aside>
  {error&&<div className="code-error" role="alert">{error}</div>}
  <div className="code-layout"><aside className="code-library"><div className="code-library-heading"><strong>我的代码</strong><button aria-label="刷新代码列表" onClick={()=>refresh().catch(e=>setError(e.message))}><RefreshCw size={16}/></button></div>
   {items.length?items.map(item=><button key={item.id} className={record?.id===item.id?'selected':''} disabled={busy||saving} onClick={()=>open(item.id)}><FileCode2 size={16}/><span>{item.title}<small>{item.language} · 修订 {item.revision}</small></span></button>):<p>保存后会出现在这里，按当前个人空间隔离。</p>}
  </aside><section className="code-editor-panel">
   <div className="code-fields"><label>标题<input aria-label="代码标题" value={title} maxLength={120} disabled={busy||saving} onChange={e=>setTitle(e.target.value)}/></label><label>语言<select aria-label="代码语言" value={language} disabled={busy||saving} onChange={e=>{const next=e.target.value;if(!record&&code===CODE_EXAMPLES[language]){setCode(CODE_EXAMPLES[next]);setCsv(next==='python'?CSV_EXAMPLE:'');setTitle(next==='matlab'?'MATLAB 声速剖面示例':'Python 声速剖面分析')}setLanguage(next);setResult(null);setStage('')}}><option value="matlab">MATLAB · 主工作流</option><option value="python">Python · 辅助分析</option></select></label><span>{dirty?'未保存':'已保存'}{record?' · 修订 '+record.revision:''}</span></div>
   <textarea className="code-source" aria-label="源代码编辑器" spellCheck={false} value={code} disabled={busy||saving} onChange={e=>{setCode(e.target.value);setResult(null)}}/>
   <div className="code-byte-count">代码 {byteLength(code).toLocaleString()} / 50,000 字节 · CSV {byteLength(csv).toLocaleString()} / 100,000 字节</div>
   {!publicMode&&record?.last_local_run&&<p className="code-stage">最近本地任务：{record.last_local_run.job_id} · {record.last_local_run.state}（以任务页实际日志和文件为准）</p>}
   <details className="code-input"><summary>输入CSV · 仅载入明确选择的数据</summary><p>运行时提供 <code>input_csv</code> 字符串与虚拟文件 <code>input.csv</code>。数据会随草稿保存，不会交给运行依赖CDN。</p><input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" aria-label="载入CSV文件" disabled={busy||saving} onChange={loadCsv}/><textarea aria-label="输入CSV数据" spellCheck={false} value={csv} disabled={busy||saving} onChange={e=>{setCsv(e.target.value);setResult(null)}}/></details>
   <div className="code-actions"><button onClick={saveClick} disabled={busy||saving}><Save size={16}/>{saving?'保存中':'保存代码'}</button><button onClick={()=>{setCode(CODE_EXAMPLES[language]);setCsv(language==='python'?CSV_EXAMPLE:'');setResult(null)}} disabled={busy||saving}>载入示例</button><button onClick={()=>download((title||'code').replace(/[^\w\u4e00-\u9fff -]/g,'_')+(language==='python'?'.py':'.m'),code)} disabled={!code}><Download size={16}/>下载源码</button>{record&&<button onClick={remove} disabled={busy||saving}><Trash2 size={16}/>删除记录</button>}{onAsk&&<button onClick={ask} disabled={busy||saving}><MessageSquare size={16}/>让AI检查或修改</button>}
    {language==='python'&&<label>运行上限<select aria-label="Python运行时间上限" value={timeout} disabled={busy} onChange={e=>setTimeoutValue(e.target.value)}><option value="10">10秒</option><option value="20">20秒</option><option value="60">60秒</option></select></label>}
    {language==='python'&&(busy&&executionMode==='browser'?<button className="stop" onClick={()=>runner.current?.stop()} disabled={!runner.current}><Square size={16}/>停止浏览器运行</button>:<button className="primary" onClick={run} disabled={busy||saving||language!=='python'}><Play size={16}/>在浏览器运行 Python</button>)}
    {!publicMode&&typeof onRunLocal==='function'&&<button className={language==='matlab'?'primary':''} onClick={runLocal} disabled={busy||saving}><Play size={16}/>{busy&&executionMode==='local'?'本机运行中…':'在本机运行 '+(language==='matlab'?'MATLAB':'Python')}</button>}
   </div>
   {language==='python'&&<p className="code-runtime-note">Python 是辅助分析环境，首次校验约27MB固定依赖；支持标准库、NumPy与Matplotlib，计算占用当前设备的浏览器资源。它不能调用本机 MATLAB 或读取本机工程目录。</p>}
   {stage&&<p role="status" className="code-stage">{stage}</p>}
   {((busy&&executionMode==='browser')||result)&&<section className="code-output" aria-label="代码运行结果"><div className="code-result-heading"><h2>运行结果</h2><span>{result?.status||'运行中'}{result?.seconds!=null?' · '+result.seconds+' s':''}</span></div><p>浏览器返回的代码运行记录；不等于服务端独立验证或物理精度证明。</p>
    <pre aria-label="标准输出">{result?.stdout??stream.stdout??''}</pre>{(result?.stderr||stream.stderr)&&<pre className={result?.status==='succeeded'?'code-diagnostics':'code-stderr'} aria-label={result?.status==='succeeded'?'运行警告与诊断':'运行错误'}>{result?.stderr||stream.stderr}</pre>}
    {(result?.warnings||[]).map((item,index)=><p key={index}>{item}</p>)}
    <div className="code-artifacts">{(result?.artifacts||[]).map((item,index)=><article key={index}>{safeImage(item)&&<img alt={item.name} src={safeImage(item)}/>}<div><span>{item.name}</span><button onClick={()=>{try{download(item.name,outputBytes(item),item.mime)}catch{setError('该结果文件无法解码，请重新运行')}}}><Download size={15}/>下载</button></div></article>)}</div>
   </section>}
  </section></div>
 </div>;
}
