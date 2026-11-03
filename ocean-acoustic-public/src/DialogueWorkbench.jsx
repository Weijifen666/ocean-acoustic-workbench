import React,{useEffect,useRef,useState} from 'react';
import {Waves,ArrowUp,BookOpen,Download,Trash2,Undo2,Copy,Loader2,Square,Settings2,FlaskConical,X} from 'lucide-react';
import ChatMessage from './ChatMessage';
import JobExports from './JobExports';
import GraphSelection from './GraphSelection';
import {normalizeKnowledgeSelection,knowledgeRequestIds} from './knowledgeSelection';
import ModelSkillPicker from './ModelSkillPicker';
import QuestionSuggestions from './QuestionSuggestions';
import {serializeChat} from './chatExport';
import './dialogue-workbench.css';
import {researchRounds,contextBudgetChoices,normalizeResearchBudget,estimateVisibleResearchInput,researchContextNotes} from './cloudWorkbench';

async function api(path,body,method){
 const response=await fetch('/api/research/'+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw Object.assign(Error(typeof value.detail==='string'?value.detail:'请求失败，请检查服务连接'),{code:value.error_code||value.code,context:value.context,recoverable:value.recoverable});return value;
}
export async function advanceResearchRun(identity,executionMode){
 if(executionMode==='poll_steps'){
  try{await api('runs/'+identity+'/step',{})}
  catch(error){if(error.code!=='CONTEXT_BUDGET_EXCEEDED')throw error}
 }
 return api('runs/'+identity);
}
export async function resumeResearchRun(identity,contextBudget,advertised){
 return api('runs/'+identity+'/resume',{context_budget:normalizeResearchBudget(contextBudget,advertised)});
}
export async function startResearchRun({session,request_id,message,rounds,contextBudget,knowledgeNodes=[]},capabilities){
 const ids=knowledgeRequestIds(knowledgeNodes);
 return api('chat',{session,request_id,message,backend:'api',rounds:researchRounds(rounds,capabilities?.max_rounds),context_budget:normalizeResearchBudget(contextBudget,capabilities?.context_budgets),...(ids.length?{knowledge_node_ids:ids}:{})});
}
export function ResearchContextStatus({context}){
 if(!context)return null;
 const notes=researchContextNotes(context);
 const unlimited=context.budget_limited===false&&context.budget_tokens===null;
 return <div className="dialogue-toolbar" role="status" aria-label="研究上下文用量"><div>服务端输入估算：{Number.isFinite(context.estimated_input_tokens)?context.estimated_input_tokens.toLocaleString():'尚未提供'} tokens / {unlimited?'应用预算不限':<>预算 {Number.isFinite(context.budget_tokens)?context.budget_tokens.toLocaleString():'尚未提供'} tokens</>}<br/><small>UTF-8 字节保守估算，不等于供应商实际 token 或模型原生窗口。{unlimited&&'模型接口仍有自身的上下文与输出限制。'}{notes.length?notes.join('；')+'。':'工具历史的保留与省略以服务端记录为准。'}</small></div></div>;
}
export function ResearchBudgetRecovery({run,busy,onResume}){
 if(!run?.id||run.recoverable!==true||run.error_code!=='CONTEXT_BUDGET_EXCEEDED')return null;
 return <div className="dialogue-error" role="status"><p>本次请求因上下文预算不足暂停。展开“研究设置”并调整上下文预算后，可继续同一个研究请求与已提交任务；历史保留情况见设置内说明，不会重新发送问题。</p><button className="button primary" disabled={busy} onClick={onResume}>调整预算并继续</button></div>;
}
const labels={dsh:'DSH',codex:'Codex',api:'模型接口'};
export default function DialogueWorkbench({draft,onDraftConsumed,notify=()=>{},openSettings}){
 const [knowledgeNodes,setKnowledgeNodes]=useState([]);
 const [session,setSession]=useState(()=>{let value=localStorage.getItem('ocean-cloud-research-v1-session');if(!value){value=crypto.randomUUID();localStorage.setItem('ocean-cloud-research-v1-session',value)}return value});
 const [previous,setPrevious]=useState(()=>localStorage.getItem('ocean-cloud-research-v1-previous')||'');
 const [backend,setBackend]=useState('api');
 const [rounds,setRounds]=useState(()=>String(researchRounds(localStorage.getItem('ocean-cloud-research-v2-rounds'))));
 const [sidebarShown,setSidebarShown]=useState(false);
 const [contextBudget,setContextBudget]=useState(()=>String(normalizeResearchBudget(localStorage.getItem('ocean-cloud-research-v2-context-budget'))));
 const [text,setText]=useState(''),[messages,setMessages]=useState([]),[run,setRun]=useState(null),[loading,setLoading]=useState(true),[submitting,setSubmitting]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(null),[format,setFormat]=useState('md'),[cap,setCap]=useState(null),[sessions,setSessions]=useState([]);
 const lastDraft=useRef(null),scroll=useRef(null),follow=useRef(true),sending=useRef(false);
 const budgetPaused=run?.recoverable===true&&run.error_code==='CONTEXT_BUDGET_EXCEEDED';
 const busy=submitting||(run?.state==='running'&&!budgetPaused);
 function chooseBackend(value){setBackend(value);localStorage.setItem('ocean-cloud-research-v1-backend',value)}
 const loadSessions=()=>api('sessions').then(rows=>setSessions(Array.isArray(rows)?rows:[])).catch(()=>{});
 useEffect(()=>{loadSessions()},[]);
 useEffect(()=>{let alive=true;setLoading(true);setRun(null);setMessages([]);setError('');setKnowledgeNodes([]);
  Promise.all([api('history?session='+encodeURIComponent(session)),api('active?session='+encodeURIComponent(session)),api('capabilities')]).then(([rows,current,capabilities])=>{if(!alive)return;setMessages(rows);setRun(current);setError(current?.error||'');setCap(capabilities);setContextBudget(old=>String(normalizeResearchBudget(old,capabilities.context_budgets)));setRounds(old=>String(researchRounds(old,capabilities.max_rounds)));if(current?.state==='running'&&current.backend==='api')chooseBackend('api')}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}
 },[session]);
 useEffect(()=>{let alive=true;setStatus(null);if(backend!=='api')api(backend+'/status').then(value=>{if(alive)setStatus(value)}).catch(e=>{if(alive)setStatus({message:e.message})});return()=>{alive=false}},[backend]);
 useEffect(()=>{if(draft&&draft.id!==lastDraft.current){lastDraft.current=draft.id;setText(draft.text);try{setKnowledgeNodes(normalizeKnowledgeSelection(draft.knowledge_nodes||[]))}catch(error){setError(error.message)}follow.current=true}},[draft]);
 useEffect(()=>{if(run?.state!=='running'||budgetPaused)return;let alive=true,pending=false;
  const poll=async()=>{if(pending)return;pending=true;try{const current=await advanceResearchRun(run.id,cap?.execution_mode);if(!alive)return;setRun(current);setError(current.error||'');if(current.state!=='running'){const rows=await api('history?session='+encodeURIComponent(session));if(alive){setMessages(rows);loadSessions()}}}catch(e){if(alive)setError('连接暂时中断，将继续重连：'+e.message)}finally{pending=false}};
  const timer=setInterval(poll,1000);poll();return()=>{alive=false;clearInterval(timer)}
 },[run?.id,run?.state,session,cap?.execution_mode,budgetPaused]);
 useEffect(()=>{if(!scroll.current||!follow.current)return;if(!messages.length&&!run?.partial&&!run?.exports?.length)return;scroll.current.scrollTop=scroll.current.scrollHeight},[messages,run?.partial,run?.exports?.length]);
 async function send(){if(sending.current||busy||loading||!text.trim()||!cap?.api_configured)return;
  if(backend==='api'&&(!Number.isInteger(Number(rounds))||Number(rounds)<0||Number(rounds)>(cap?.max_rounds||1000)||rounds==='')){setError('工具轮数请填 0–'+(cap?.max_rounds||1000)+' 的整数，0 表示不限');return}
  sending.current=true;setSubmitting(true);setError('');follow.current=true;
  const message=text;
  try{const result=await startResearchRun({session,request_id:crypto.randomUUID(),message,rounds,contextBudget,knowledgeNodes},cap);setRun({...result,id:result.id,state:'running',backend,stage:'准备请求',trace:[]});setMessages(rows=>[...rows,{role:'user',text:message}]);setText('');onDraftConsumed?.(draft?.id);localStorage.removeItem('ocean-cloud-research-v1-previous');setPrevious('')}
  catch(e){setError(e.message)}finally{sending.current=false;setSubmitting(false)}
  loadSessions();
 }
 async function stop(){try{await api('runs/'+run.id+'/stop',{});notify('正在停止 Agent；已启动的计算可在任务页取消')}catch(e){setError(e.message)}}
 async function resume(){if(sending.current||busy||loading||!run?.recoverable)return;sending.current=true;setSubmitting(true);setError('');try{const result=await resumeResearchRun(run.id,contextBudget,cap?.context_budgets);setRun(old=>({...old,...result,id:old.id,state:result.state||'running',recoverable:result.recoverable===true,error:result.error||'',error_code:result.error_code||null}));follow.current=true}catch(e){setError(e.message);if(e.context)setRun(old=>({...old,context:e.context,error_code:e.code||old.error_code,recoverable:e.recoverable??old.recoverable}))}finally{sending.current=false;setSubmitting(false)}}
 function switchSession(next){onDraftConsumed?.(draft?.id);localStorage.setItem('ocean-cloud-research-v1-session',next);setSession(next)}
 function newSession(){if(busy)return;switchSession(crypto.randomUUID());loadSessions()}
 async function renameSession(item){const title=window.prompt('会话名称',item.title||'');if(title==null)return;const value=title.trim();if(!value)return;try{await api('sessions/'+encodeURIComponent(item.id),{title:value},'PATCH');loadSessions()}catch(e){setError(e.message)}}
 async function removeSession(item){if(busy)return;if(!window.confirm('删除会话「'+(item.title||'未命名')+'」？该会话的聊天记录会从本人云端空间删除，任务与计算结果不受影响。'))return;try{await api('sessions/'+encodeURIComponent(item.id),null,'DELETE');const next=item.id===session?crypto.randomUUID():session;switchSession(next);loadSessions()}catch(e){setError(e.message)}}
 function clear(){if(busy||loading||!messages.length)return;localStorage.setItem('ocean-cloud-research-v1-previous',session);setPrevious(session);switchSession(crypto.randomUUID());loadSessions()}
 function undo(){if(!previous||busy)return;const target=previous;setPrevious('');localStorage.removeItem('ocean-cloud-research-v1-previous');switchSession(target)}
 function exportChat(){const mime=format==='json'?'application/json':format==='md'?'text/markdown':'text/plain';const url=URL.createObjectURL(new Blob(['\ufeff',serializeChat(messages,format)],{type:mime+';charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='海洋声学对话-'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+format;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 async function copy(text){try{await navigator.clipboard.writeText(text);notify('消息已复制')}catch{notify('复制失败，请手动选择文字复制')}}
 return <div className="dialogue-workbench">
  <div className="dialogue-title"><div><h1>对话工作台</h1><p>加载技能、查询实际数据，按可用工具开展研究。</p></div></div>
  <div className={'dialogue-layout'+(sidebarShown?' has-context':'')}><section className="panel dialogue-panel" aria-label="对话工作台">
   <div className="dialogue-primary-toolbar">
    <span className="dialogue-message-count">{loading?'载入聊天…':`${messages.length} 条消息`}</span>
    <span className="dialogue-connection-status" role="status">{loading?'正在读取配置':cap?.api_configured?'模型已配置':'待配置模型'}</span>
    <div className="dialogue-primary-actions"><button className="button" disabled={busy} onClick={newSession}>＋ 新对话</button><button className="button" aria-expanded={sidebarShown} aria-controls="dialogue-context-panel" onClick={()=>setSidebarShown(shown=>!shown)}>会话与资料</button></div>
   </div>
   <div className="dialogue-auxiliary">
    <details className="dialogue-options"><summary>研究设置 <small>{rounds==='0'?'轮数不限':`${rounds} 轮`} · {contextBudget==='auto'?'自动 32K':contextBudget==='unlimited'?'应用预算不限':`${Number(contextBudget)/1024}K`}</small></summary>
   <div className="dialogue-toolbar"><label>对话后端 <select aria-label="对话后端" disabled={busy} value={backend} onChange={e=>chooseBackend(e.target.value)}><option value="api">模型 API · 云端研究 Agent</option><option value="dsh" disabled>DSH · 需要专属节点</option><option value="codex" disabled>Codex · 需要专属节点</option></select></label><span role="status">{backend==='api'?(cap?.api_configured?'模型接口已配置':'请先配置模型 API Key'):status?.message||'正在检查本机 Agent…'}</span></div>
   {backend==='api'&&<div className="dialogue-toolbar"><label>工具轮数 <input aria-label="Agent工具轮数" type="number" min="0" max={cap?.max_rounds||1000} disabled={busy} value={rounds} onChange={e=>{setRounds(e.target.value);localStorage.setItem('ocean-cloud-research-v2-rounds',e.target.value)}}/></label><span>默认 {(cap?.default_rounds??0)===0?'不限（0）':`${cap.default_rounds} 轮`}；可自定轮数，0 表示不限，达到设定轮数后汇总已有结果</span></div>}
   <div className="dialogue-toolbar"><label>上下文预算 <select aria-label="研究上下文预算" disabled={busy} value={contextBudget} onChange={e=>{setContextBudget(e.target.value);localStorage.setItem('ocean-cloud-research-v2-context-budget',e.target.value)}}>{contextBudgetChoices(cap?.context_budgets).map(value=><option value={value} key={value}>{value==='auto'?'自动 · 32K':value==='unlimited'?'不限 · 由模型接口限制':`${value/1024}K`}</option>)}</select></label><span>可见文字 UTF-8 保守估算 {estimateVisibleResearchInput(messages,text).toLocaleString()}；完整输入还含系统、资料和工具结果。</span></div>
   <ResearchContextStatus context={run?.context}/>
    </details>
    <details className="dialogue-chat-management"><summary>聊天管理</summary>
   <div className="dialogue-toolbar"><div className="dialogue-actions"><select aria-label="聊天导出格式" value={format} onChange={e=>setFormat(e.target.value)}><option value="md">Markdown</option><option value="txt">TXT</option><option value="json">JSON</option></select><button className="button" disabled={busy||loading||!messages.length} onClick={exportChat}><Download size={14}/>导出聊天</button><button className="button" disabled={busy||loading||!messages.length} onClick={clear}><Trash2 size={14}/>清空聊天</button>{previous&&<button className="button" disabled={busy||loading} onClick={undo}><Undo2 size={14}/>撤销清空</button>}</div></div>
    </details>
   <ModelSkillPicker disabled={busy} onSelect={setText}/>
   {!!messages.length&&<details className="dialogue-question-picker"><summary>从问题库选择问题</summary><QuestionSuggestions mode="agent" onSelect={setText}/></details>}
   </div>
   <ResearchBudgetRecovery run={run} busy={busy} onResume={resume}/>
   <GraphSelection nodes={knowledgeNodes} disabled={busy} onRemove={id=>{setKnowledgeNodes(rows=>rows.filter(row=>row.id!==id));onDraftConsumed?.(draft?.id)}} onClear={()=>{setKnowledgeNodes([]);onDraftConsumed?.(draft?.id)}}/>
   <div className="dialogue-messages" role="log" aria-label="聊天记录" ref={scroll} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100}}>
    {!loading&&!messages.length&&<div className="dialogue-welcome"><Waves size={36}/><h2>从一个声学问题开始</h2><p>从资料与真实环境数据开始，区分研究计划、已执行工具和待验证结论。</p><QuestionSuggestions mode="agent" onSelect={setText}/></div>}
    {messages.map((row,i)=><article className={'dialogue-message '+row.role} key={row.id||i}><div className="dialogue-avatar">{row.role==='user'?'我':<Waves size={17}/>}</div><div className="dialogue-content"><div className="dialogue-message-label">{row.role==='user'?'你':'海洋声学 Agent'}<button aria-label={'复制第'+(i+1)+'条消息'} title="复制消息" onClick={()=>copy(row.text)}><Copy size={14}/></button></div>{row.role==='user'?<div className="dialogue-user-text">{row.text}</div>:<><ChatMessage text={row.text}/><JobExports items={row.exports}/></>}</div></article>)}
    {busy&&run?.partial&&<article className="dialogue-message"><div className="dialogue-avatar"><Waves size={17}/></div><div className="dialogue-content"><div className="dialogue-message-label">{labels[run.backend||backend]} · 正在回答</div><ChatMessage text={run.partial}/></div></article>}
    {run?.state!=='done'&&run?.exports?.length>0&&<JobExports items={run.exports}/>}
   </div>
   {run?.trace?.length>0&&<details className="dialogue-trace"><summary>实际工具调用 · {run.trace.length} 次</summary><div>{run.trace.map((item,i)=><details key={i}><summary>{i+1}. {item.tool} · {item.status}</summary><pre>{JSON.stringify(item.arguments,null,2)}</pre></details>)}</div></details>}
   {busy&&<div className="dialogue-runtime" role="status"><Loader2 size={16} className="spin"/>{labels[run?.backend||backend]} · {run?.stage||'正在提交'}{run?.elapsed_seconds!=null&&` · ${run.elapsed_seconds} 秒`}{run?.model&&` · ${run.model}`}<button className="button" disabled={!run?.id} onClick={stop}><Square size={13}/>停止当前请求</button></div>}
   {error&&<div className="dialogue-error" role="alert">{error}<button className="button" disabled={busy} onClick={()=>setText([...messages].reverse().find(row=>row.role==='user')?.text||'')}>编辑上一问题</button></div>}
   <div className="dialogue-composer"><textarea aria-label="输入问题" placeholder="描述你的研究目标、环境来源与希望得到的结果…" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}/><div><span><BookOpen size={13}/>技能 · 资料 · 在线环境数据</span><button className="button primary" aria-label="发送问题" disabled={busy||loading||!text.trim()||!cap?.api_configured} onClick={send}><ArrowUp size={18}/></button></div></div>
  </section><aside id="dialogue-context-panel" className={'panel dialogue-context'+(sidebarShown?'':' is-collapsed')} hidden={!sidebarShown}><div className="sessions-block"><div className="sessions-head"><h3>对话</h3><button className="button dialogue-context-close" aria-label="收起会话与资料" title="收起会话与资料" onClick={()=>setSidebarShown(false)}><X size={15}/></button><button className="button" disabled={busy} onClick={newSession}>＋ 新对话</button></div><div className="sessions-list">{!sessions.length&&<p className="sessions-empty">还没有会话，发一条消息就会自动建一个。</p>}{sessions.map(item=><div key={item.id} className={'sessions-item'+(item.id===session?' active':'')} onClick={()=>{if(!busy&&item.id!==session)switchSession(item.id)}}><div className="sessions-title">{item.title||'未命名会话'}</div><div className="sessions-meta">{item.count} 条 · {(item.updated||'').replace('T',' ').slice(0,16)}</div><div className="sessions-actions"><button disabled={busy} onClick={e=>{e.stopPropagation();renameSession(item)}}>改名</button><button disabled={busy} onClick={e=>{e.stopPropagation();removeSession(item)}}>删除</button></div></div>)}</div></div><details className="dialogue-context-notes"><summary>资料与使用说明</summary><h3>当前工作上下文</h3><p><BookOpen size={18}/>课程知识与教材原页</p><p><FlaskConical size={18}/>模型 Skill 与研究记录</p><p><Waves size={18}/>WOA18 温盐声速剖面{cap&&!cap.ocean_data_available&&<small>在线数据暂不可用</small>}</p><div className="dialogue-note">使用本人配置的模型 API，加载 Skill 并调用已开放的资料与数据工具。DSH / Codex 需要专属执行节点，当前公共站不可选择。{cap?.script_execution===true?' 已连接受控脚本执行器。':' 当前公共站不执行任意 Python / MATLAB 脚本；需要时会给出待执行步骤。'}</div><p className="dialogue-note">清空聊天会创建新会话，可撤销；计算结果保存在“任务与计算结果”。执行成功、数值收敛与物理精度分别判断。</p><button className="button" onClick={openSettings}><Settings2 size={15}/>模型与环境设置</button></details></aside></div>
 </div>;
}
