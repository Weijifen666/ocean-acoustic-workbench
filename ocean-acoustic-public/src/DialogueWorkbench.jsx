import React,{useEffect,useRef,useState} from 'react';
import {Waves,ArrowUp,BookOpen,Download,Trash2,Undo2,Copy,Loader2,Square,Settings2,FlaskConical} from 'lucide-react';
import ChatMessage from './ChatMessage';
import ModelSkillPicker from './ModelSkillPicker';
import QuestionSuggestions from './QuestionSuggestions';
import {serializeChat} from './chatExport';
import './dialogue-workbench.css';
import {researchRounds} from './cloudWorkbench';

async function api(path,body,method){
 const response=await fetch('/api/research/'+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw Error(typeof value.detail==='string'?value.detail:'请求失败，请检查服务连接');return value;
}
export async function advanceResearchRun(identity,executionMode){
 if(executionMode==='poll_steps')await api('runs/'+identity+'/step',{});
 return api('runs/'+identity);
}
const labels={dsh:'DSH',codex:'Codex',api:'模型接口'};
export default function DialogueWorkbench({draft,notify=()=>{},openSettings}){
 const [session,setSession]=useState(()=>{let value=localStorage.getItem('ocean-cloud-research-v1-session');if(!value){value=crypto.randomUUID();localStorage.setItem('ocean-cloud-research-v1-session',value)}return value});
 const [previous,setPrevious]=useState(()=>localStorage.getItem('ocean-cloud-research-v1-previous')||'');
 const [backend,setBackend]=useState('api');
 const [rounds,setRounds]=useState('40');
 const [text,setText]=useState(''),[messages,setMessages]=useState([]),[run,setRun]=useState(null),[loading,setLoading]=useState(true),[submitting,setSubmitting]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(null),[format,setFormat]=useState('md'),[cap,setCap]=useState(null),[sessions,setSessions]=useState([]);
 const lastDraft=useRef(null),scroll=useRef(null),follow=useRef(true),sending=useRef(false);
 const busy=submitting||run?.state==='running';
 function chooseBackend(value){setBackend(value);localStorage.setItem('ocean-cloud-research-v1-backend',value)}
 const loadSessions=()=>api('sessions').then(rows=>setSessions(Array.isArray(rows)?rows:[])).catch(()=>{});
 useEffect(()=>{loadSessions()},[]);
 useEffect(()=>{let alive=true;setLoading(true);setRun(null);setMessages([]);setError('');
  Promise.all([api('history?session='+encodeURIComponent(session)),api('active?session='+encodeURIComponent(session)),api('capabilities')]).then(([rows,current,capabilities])=>{if(!alive)return;setMessages(rows);setRun(current);setCap(capabilities);setRounds(old=>String(researchRounds(old,capabilities.max_rounds)));if(current?.state==='running'&&current.backend==='api')chooseBackend('api')}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}
 },[session]);
 useEffect(()=>{let alive=true;setStatus(null);if(backend!=='api')api(backend+'/status').then(value=>{if(alive)setStatus(value)}).catch(e=>{if(alive)setStatus({message:e.message})});return()=>{alive=false}},[backend]);
 useEffect(()=>{if(draft&&draft.id!==lastDraft.current){lastDraft.current=draft.id;setText(draft.text);follow.current=true}},[draft]);
 useEffect(()=>{if(run?.state!=='running')return;let alive=true,pending=false;
  const poll=async()=>{if(pending)return;pending=true;try{const current=await advanceResearchRun(run.id,cap?.execution_mode);if(!alive)return;setRun(current);setError(current.error||'');if(current.state!=='running'){const rows=await api('history?session='+encodeURIComponent(session));if(alive){setMessages(rows);loadSessions()}}}catch(e){if(alive)setError('连接暂时中断，将继续重连：'+e.message)}finally{pending=false}};
  const timer=setInterval(poll,1000);poll();return()=>{alive=false;clearInterval(timer)}
 },[run?.id,run?.state,session,cap?.execution_mode]);
 useEffect(()=>{if(!scroll.current||!follow.current)return;if(!messages.length&&!run?.partial)return;scroll.current.scrollTop=scroll.current.scrollHeight},[messages,run?.partial]);
 async function send(){if(sending.current||busy||loading||!text.trim()||!cap?.api_configured)return;
  if(backend==='api'&&(!Number.isInteger(Number(rounds))||Number(rounds)<0||Number(rounds)>(cap?.max_rounds||1000)||rounds==='')){setError('工具轮数请填 0–'+(cap?.max_rounds||1000)+' 的整数，0 表示不限');return}
  sending.current=true;setSubmitting(true);setError('');follow.current=true;
  const message=text;
  try{const result=await api('chat',{session,request_id:crypto.randomUUID(),message,backend:'api',rounds:researchRounds(rounds,cap?.max_rounds)});setRun({id:result.id,state:'running',backend,stage:'准备请求',trace:[]});setMessages(rows=>[...rows,{role:'user',text:message}]);setText('');localStorage.removeItem('ocean-cloud-research-v1-previous');setPrevious('')}
  catch(e){setError(e.message)}finally{sending.current=false;setSubmitting(false)}
  loadSessions();
 }
 async function stop(){try{await api('runs/'+run.id+'/stop',{});notify('正在停止 Agent；已启动的计算可在任务页取消')}catch(e){setError(e.message)}}
 function switchSession(next){localStorage.setItem('ocean-cloud-research-v1-session',next);setSession(next)}
 function newSession(){if(busy)return;switchSession(crypto.randomUUID());loadSessions()}
 async function renameSession(item){const title=window.prompt('会话名称',item.title||'');if(title==null)return;const value=title.trim();if(!value)return;try{await api('sessions/'+encodeURIComponent(item.id),{title:value},'PATCH');loadSessions()}catch(e){setError(e.message)}}
 async function removeSession(item){if(busy)return;if(!window.confirm('删除会话「'+(item.title||'未命名')+'」？该会话的聊天记录会从本人云端空间删除，任务与计算结果不受影响。'))return;try{await api('sessions/'+encodeURIComponent(item.id),null,'DELETE');const next=item.id===session?crypto.randomUUID():session;switchSession(next);loadSessions()}catch(e){setError(e.message)}}
 function clear(){if(busy||loading||!messages.length)return;localStorage.setItem('ocean-cloud-research-v1-previous',session);setPrevious(session);switchSession(crypto.randomUUID());loadSessions()}
 function undo(){if(!previous||busy)return;const target=previous;setPrevious('');localStorage.removeItem('ocean-cloud-research-v1-previous');switchSession(target)}
 function exportChat(){const mime=format==='json'?'application/json':format==='md'?'text/markdown':'text/plain';const url=URL.createObjectURL(new Blob(['\ufeff',serializeChat(messages,format)],{type:mime+';charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='海洋声学对话-'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+format;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 async function copy(text){try{await navigator.clipboard.writeText(text);notify('消息已复制')}catch{notify('复制失败，请手动选择文字复制')}}
 return <div className="dialogue-workbench">
  <div className="dialogue-title"><div><span className="eyebrow">RESEARCH AGENT</span><h1>对话工作台</h1><p>围绕研究目标，加载技能、查阅资料，按当前可用工具分析与核验。</p></div><span className="tag">Agent · 技能与研究</span></div>
  <div className="dialogue-layout"><section className="panel dialogue-panel" aria-label="对话工作台">
   <div className="dialogue-toolbar"><label>对话后端 <select aria-label="对话后端" disabled={busy} value={backend} onChange={e=>chooseBackend(e.target.value)}><option value="api">模型 API · 云端研究 Agent</option><option value="dsh" disabled>DSH · 需要专属节点</option><option value="codex" disabled>Codex · 需要专属节点</option></select></label><span role="status">{backend==='api'?(cap?.api_configured?'模型接口已配置':'请先配置模型 API Key'):status?.message||'正在检查本机 Agent…'}</span></div>
   {backend==='api'&&<div className="dialogue-toolbar"><label>工具轮数 <input aria-label="Agent工具轮数" type="number" min="0" max={cap?.max_rounds||1000} disabled={busy} value={rounds} onChange={e=>{setRounds(e.target.value);localStorage.setItem('ocean-cloud-research-v1-rounds',e.target.value)}}/></label><span>默认 {cap?.default_rounds||40} 轮；0 表示不限，达到设定轮数后汇总已有结果</span></div>}
   <div className="dialogue-toolbar"><span>{loading?'载入聊天…':`${messages.length} 条消息`}</span><div className="dialogue-actions"><select aria-label="聊天导出格式" value={format} onChange={e=>setFormat(e.target.value)}><option value="md">Markdown</option><option value="txt">TXT</option><option value="json">JSON</option></select><button className="button" disabled={busy||loading||!messages.length} onClick={exportChat}><Download size={14}/>导出聊天</button><button className="button" disabled={busy||loading||!messages.length} onClick={clear}><Trash2 size={14}/>清空聊天</button>{previous&&<button className="button" disabled={busy||loading} onClick={undo}><Undo2 size={14}/>撤销清空</button>}</div></div>
   <ModelSkillPicker disabled={busy} onSelect={setText}/>
   <div className="dialogue-messages" role="log" aria-label="聊天记录" ref={scroll} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100}}>
    {!loading&&!messages.length&&<div className="dialogue-welcome"><Waves size={36}/><h2>从一个声学问题开始</h2><p>从资料与真实环境数据开始，区分研究计划、已执行工具和待验证结论。</p><QuestionSuggestions mode="agent" onSelect={setText}/></div>}
    {messages.map((row,i)=><article className={'dialogue-message '+row.role} key={row.id||i}><div className="dialogue-avatar">{row.role==='user'?'我':<Waves size={17}/>}</div><div className="dialogue-content"><div className="dialogue-message-label">{row.role==='user'?'你':'海洋声学 Agent'}<button aria-label={'复制第'+(i+1)+'条消息'} title="复制消息" onClick={()=>copy(row.text)}><Copy size={14}/></button></div>{row.role==='user'?<div className="dialogue-user-text">{row.text}</div>:<ChatMessage text={row.text}/>}</div></article>)}
    {busy&&run?.partial&&<article className="dialogue-message"><div className="dialogue-avatar"><Waves size={17}/></div><div className="dialogue-content"><div className="dialogue-message-label">{labels[run.backend||backend]} · 正在回答</div><ChatMessage text={run.partial}/></div></article>}
   </div>
   {run?.trace?.length>0&&<details className="dialogue-trace"><summary>实际工具调用 · {run.trace.length} 次</summary><div>{run.trace.map((item,i)=><details key={i}><summary>{i+1}. {item.tool} · {item.status}</summary><pre>{JSON.stringify(item.arguments,null,2)}</pre></details>)}</div></details>}
   {busy&&<div className="dialogue-runtime" role="status"><Loader2 size={16} className="spin"/>{labels[run?.backend||backend]} · {run?.stage||'正在提交'}{run?.elapsed_seconds!=null&&` · ${run.elapsed_seconds} 秒`}{run?.model&&` · ${run.model}`}<button className="button" disabled={!run?.id} onClick={stop}><Square size={13}/>停止当前请求</button></div>}
   {error&&<div className="dialogue-error" role="alert">{error}<button className="button" disabled={busy} onClick={()=>setText([...messages].reverse().find(row=>row.role==='user')?.text||'')}>编辑上一问题</button></div>}
   <div className="dialogue-composer">{!!messages.length&&<details><summary>从问题库选择问题</summary><QuestionSuggestions mode="agent" onSelect={setText}/></details>}<textarea aria-label="输入问题" placeholder="描述你的研究目标、环境来源与希望得到的结果…" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}/><div><span><BookOpen size={13}/>技能 · 资料 · 在线环境数据</span><button className="button primary" aria-label="发送问题" disabled={busy||loading||!text.trim()||!cap?.api_configured} onClick={send}><ArrowUp size={18}/></button></div></div>
  </section><aside className="panel dialogue-context"><div className="sessions-block"><div className="sessions-head"><h3>对话</h3><button className="button" disabled={busy} onClick={newSession}>＋ 新对话</button></div><div className="sessions-list">{!sessions.length&&<p className="sessions-empty">还没有会话，发一条消息就会自动建一个。</p>}{sessions.map(item=><div key={item.id} className={'sessions-item'+(item.id===session?' active':'')} onClick={()=>{if(!busy&&item.id!==session)switchSession(item.id)}}><div className="sessions-title">{item.title||'未命名会话'}</div><div className="sessions-meta">{item.count} 条 · {(item.updated||'').replace('T',' ').slice(0,16)}</div><div className="sessions-actions"><button disabled={busy} onClick={e=>{e.stopPropagation();renameSession(item)}}>改名</button><button disabled={busy} onClick={e=>{e.stopPropagation();removeSession(item)}}>删除</button></div></div>)}</div></div><h3>当前工作上下文</h3><p><BookOpen size={18}/>课程知识与教材原页</p><p><FlaskConical size={18}/>模型 Skill 与研究记录</p><p><Waves size={18}/>WOA18 温盐声速剖面{cap&&!cap.ocean_data_available&&<small>在线数据暂不可用</small>}</p><div className="dialogue-note">使用本人配置的模型 API，加载 Skill 并调用已开放的资料与数据工具。DSH / Codex 需要专属执行节点，当前公共站不可选择。{cap?.script_execution===true?' 已连接受控脚本执行器。':' 当前公共站不执行任意 Python / MATLAB 脚本；需要时会给出待执行步骤。'}</div><p className="dialogue-note">清空聊天会创建新会话，可撤销；计算结果保存在“任务与计算结果”。执行成功、数值收敛与物理精度分别判断。</p><button className="button" onClick={openSettings}><Settings2 size={15}/>模型与环境设置</button></aside></div>
 </div>;
}
