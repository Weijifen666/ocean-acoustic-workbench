import React,{useEffect,useRef,useState} from 'react';
import {Waves,ArrowUp,BookOpen,Download,Trash2,Undo2,Loader2,Square,Settings2,FlaskConical,X} from 'lucide-react';
import DialogueMessage from '../../ocean-acoustic-workbench/src/DialogueMessage';
import ChatMessage from './ChatMessage';
import JobExports from './JobExports';
import GraphSelection from './GraphSelection';
import {normalizeKnowledgeSelection,knowledgeRequestIds} from './knowledgeSelection';
import ModelSkillPicker from './ModelSkillPicker';
import QuestionSuggestions from './QuestionSuggestions';
import {serializeChat} from './chatExport';
import './dialogue-workbench.css';
import '../../ocean-acoustic-workbench/src/dialogue-bubbles.css';
import {researchRounds,contextBudgetChoices,normalizeResearchBudget,estimateVisibleResearchInput,researchContextNotes} from './cloudWorkbench';
import {researchApi as api} from './researchTransport';

export async function advanceResearchRun(identity,executionMode,options={}){
 const current=await api('runs/'+identity,undefined,undefined,options);
 if(current.state!=='running'||current.step_busy===true)return current;
 if(executionMode==='poll_steps'){
  try{return await api('runs/'+identity+'/step',{},undefined,options)}
  catch(error){
   // A lost acknowledgement may already have completed the paid round. Only
   // inspect its durable state here; scheduling resumes on a later poll.
   if(error.code!=='CONTEXT_BUDGET_EXCEEDED'&&!error.requestUnconfirmed)throw error;
   return api('runs/'+identity,undefined,undefined,options);
  }
 }
 return current;
}
export const RESEARCH_RECOVERY_DELAYS=[2000,4000,8000,8000,8000,8000];
export async function resumeResearchRun(identity,contextBudget,advertised){
 return api('runs/'+identity+'/resume',{context_budget:normalizeResearchBudget(contextBudget,advertised)});
}
export function researchRequest({session,request_id,message,rounds,contextBudget,knowledgeNodes=[]},capabilities){
 const ids=knowledgeRequestIds(knowledgeNodes);
 return {session,request_id,message,backend:'api',rounds:researchRounds(rounds,capabilities?.max_rounds),context_budget:normalizeResearchBudget(contextBudget,capabilities?.context_budgets),...(ids.length?{knowledge_node_ids:ids}:{})};
}
export async function startResearchRun(values,capabilities){
 return api('chat',researchRequest(values,capabilities));
}
export function ResearchContextStatus({context}){
 if(!context)return null;
 const notes=researchContextNotes(context);
 const unlimited=context.budget_limited===false&&context.budget_tokens===null;
 return <div className="dialogue-toolbar" role="status" aria-label="研究上下文用量"><div>服务端输入估算：{Number.isFinite(context.estimated_input_tokens)?context.estimated_input_tokens.toLocaleString():'尚未提供'} tokens / {unlimited?'应用预算不限':<>预算 {Number.isFinite(context.budget_tokens)?context.budget_tokens.toLocaleString():'尚未提供'} tokens</>}<br/><small>按 UTF-8 字节保守估算。{unlimited&&'实际输入与输出上限由所选模型决定。'}{notes.length?notes.join('；')+'。':''}</small></div></div>;
}
export function ResearchBudgetRecovery({run,busy,onResume}){
 if(!run?.id||run.recoverable!==true||run.error_code!=='CONTEXT_BUDGET_EXCEEDED')return null;
 return <div className="dialogue-error" role="status"><p>上下文预算不足。请在“研究设置”中调大预算，再继续当前研究。</p><button className="button primary" disabled={busy} onClick={onResume}>调整预算并继续</button></div>;
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
 const [pendingSend,setPendingSend]=useState(null),[stepPaused,setStepPaused]=useState(false),[connectionRecovery,setConnectionRecovery]=useState(null);
 // This pending envelope lives only in this mounted personal workspace. It
 // contains no Key and is never persisted or copied into another identity.
 const pendingRef=useRef(null),lastDraft=useRef(null),scroll=useRef(null),follow=useRef(true),sending=useRef(false),currentSession=useRef(session),pollControl=useRef(null),recoveryControl=useRef(null);
 currentSession.current=session;
 const budgetPaused=run?.recoverable===true&&run.error_code==='CONTEXT_BUDGET_EXCEEDED';
 const busy=submitting||(run?.state==='running'&&!budgetPaused);
 function chooseBackend(value){setBackend(value);localStorage.setItem('ocean-cloud-research-v1-backend',value)}
 const loadSessions=()=>api('sessions').then(rows=>setSessions(Array.isArray(rows)?rows:[])).catch(()=>{});
 useEffect(()=>{loadSessions()},[]);
 useEffect(()=>{let alive=true;setLoading(true);setRun(null);setMessages([]);setError('');setKnowledgeNodes([]);setStepPaused(false);setConnectionRecovery(null);
  const load=async()=>{
   const [current,capabilities]=await Promise.all([api('active?session='+encodeURIComponent(session)),api('capabilities')]);
   if(!alive)return;
   // A terminal snapshot must be paired with history read after that snapshot.
   const rows=await api('history?session='+encodeURIComponent(session));
   if(!alive)return;setMessages(rows);setRun(current);setError(current?.error||'');setCap(capabilities);setContextBudget(old=>String(normalizeResearchBudget(old,capabilities.context_budgets)));setRounds(old=>String(researchRounds(old,capabilities.max_rounds)));if(current?.state==='running'&&current.backend==='api')chooseBackend('api')
  };
  load().catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false;recoveryControl.current?.abort()}
 },[session]);
 useEffect(()=>{let alive=true;setStatus(null);if(backend!=='api')api(backend+'/status').then(value=>{if(alive)setStatus(value)}).catch(e=>{if(alive)setStatus({message:e.message})});return()=>{alive=false}},[backend]);
 useEffect(()=>{if(draft&&draft.id!==lastDraft.current){lastDraft.current=draft.id;setText(draft.text);try{setKnowledgeNodes(normalizeKnowledgeSelection(draft.knowledge_nodes||[]))}catch(error){setError(error.message)}follow.current=true}},[draft]);
 useEffect(()=>{if(run?.state!=='running'||budgetPaused||stepPaused)return;
  let alive=true,timer=null,terminal=null,reconciling=false,failures=0;
  const controller=new AbortController(),options={signal:controller.signal};pollControl.current=controller;
  const active=()=>alive&&!controller.signal.aborted&&currentSession.current===session;
  const schedule=delay=>{if(active())timer=setTimeout(poll,delay)};
  const poll=async()=>{if(!active())return;try{
   const current=terminal||(reconciling?await api('runs/'+run.id,undefined,undefined,options):await advanceResearchRun(run.id,cap?.execution_mode,options));if(!active())return;
   if(current.state!=='running'){
    // Once finished, a failed history read retries only history. It must not
    // advance another paid model/tool step while waiting to display the answer.
    terminal=current;
    const rows=await api('history?session='+encodeURIComponent(session),undefined,undefined,options);if(!active())return;
    setMessages(rows);loadSessions()
   }
   setError(current.error||'');setRun(current);setConnectionRecovery(null);failures=0;reconciling=false;
   if(current.state==='running')schedule(1000);
  }catch(e){if(!active())return;
   reconciling=true;
   if(!e.requestUnconfirmed||failures>=RESEARCH_RECOVERY_DELAYS.length){setConnectionRecovery(null);setStepPaused(true);setError(terminal?'研究已结束，聊天记录读取失败。请检查连接后恢复。':'连接暂未恢复，请手动检查研究状态。');return}
   const delay=RESEARCH_RECOVERY_DELAYS[failures++];setError('');setConnectionRecovery({attempt:failures,total:RESEARCH_RECOVERY_DELAYS.length,history:!!terminal});schedule(delay);
  }};
  poll();return()=>{alive=false;clearTimeout(timer);controller.abort();if(pollControl.current===controller)pollControl.current=null}
 },[run?.id,run?.state,session,cap?.execution_mode,budgetPaused,stepPaused]);
 useEffect(()=>{if(!scroll.current||!follow.current)return;if(!messages.length&&!run?.partial&&!run?.exports?.length)return;scroll.current.scrollTop=scroll.current.scrollHeight},[messages,run?.partial,run?.exports?.length]);
 async function submitPending(entry){
  if(sending.current||entry.payload.session!==currentSession.current)return;
  sending.current=true;setSubmitting(true);setError('');follow.current=true;
  try{
   // Replaying exactly this envelope finds an accepted request even when its
   // first acknowledgement was lost. Creation/replay never advances a step.
   if(!entry.runId){const accepted=await api('chat',entry.payload);if(typeof accepted?.id!=='string'||!accepted.id)throw Object.assign(new Error('工作台没有返回可确认的请求标识，请恢复本次发送。'),{code:'WORKBENCH_ACK_FORMAT',requestUnconfirmed:true});entry.runId=accepted.id;}
   const current=await api('runs/'+entry.runId);
   const rows=await api('history?session='+encodeURIComponent(entry.payload.session));
   if(entry.payload.session!==currentSession.current)return;
   setMessages(rows);setRun(current);setError(current?.error||'');setStepPaused(false);
   setText(value=>value===entry.payload.message?'':value);setKnowledgeNodes([]);onDraftConsumed?.(entry.draftId);
   pendingRef.current=null;setPendingSend(null);localStorage.removeItem('ocean-cloud-research-v1-previous');setPrevious('');
  }catch(e){
   if(entry.payload.session===currentSession.current){
    setError(e.message);
    // An acknowledged run must still be recovered if a later GET failed.
    if(!entry.runId&&!e.requestUnconfirmed){pendingRef.current=null;setPendingSend(null);}
   }
  }finally{sending.current=false;setSubmitting(false);loadSessions()}
 }
 async function send(){if(sending.current||pendingRef.current||busy||loading||!text.trim()||!cap?.api_configured)return;
  if(backend==='api'&&(!Number.isInteger(Number(rounds))||Number(rounds)<0||Number(rounds)>(cap?.max_rounds||1000)||rounds==='')){setError('工具轮数请填 0–'+(cap?.max_rounds||1000)+' 的整数，0 表示不限');return}
  const entry={payload:researchRequest({session,request_id:crypto.randomUUID(),message:text,rounds,contextBudget,knowledgeNodes},cap),draftId:draft?.id,runId:null};
  pendingRef.current=entry;setPendingSend(entry);await submitPending(entry);
 }
 async function recoverSend(){if(pendingRef.current)await submitPending(pendingRef.current)}
 async function recoverStep(){
  if(sending.current||!run?.id)return;sending.current=true;setSubmitting(true);setError('');
  const target=session,controller=new AbortController();recoveryControl.current=controller;
  try{
   // A recovery always reads durable status before the user explicitly allows
   // normal scheduling to continue. No failed step POST is blindly replayed.
   const current=await api('runs/'+run.id,undefined,undefined,{signal:controller.signal});
   const rows=current.state!=='running'?await api('history?session='+encodeURIComponent(target),undefined,undefined,{signal:controller.signal}):null;
   if(controller.signal.aborted||currentSession.current!==target)return;
   if(rows)setMessages(rows);
   setRun(current);setError(current.error||'');setStepPaused(false);
  }catch(e){if(!controller.signal.aborted&&currentSession.current===target)setError(e.message)}finally{sending.current=false;if(!controller.signal.aborted&&currentSession.current===target)setSubmitting(false);if(recoveryControl.current===controller)recoveryControl.current=null}
 }
 async function stop(){
  const target=session,id=run?.id;if(!id)return;
  pollControl.current?.abort();setConnectionRecovery(null);setStepPaused(true);
  const controller=new AbortController();recoveryControl.current=controller;
  try{await api('runs/'+id+'/stop',{},undefined,{signal:controller.signal});const current=await api('runs/'+id,undefined,undefined,{signal:controller.signal});if(controller.signal.aborted||currentSession.current!==target)return;setRun(current);setStepPaused(current.state==='running');setError(current.error||'');notify('正在停止 Agent；已启动的计算可在任务页取消')}
  catch(e){if(!controller.signal.aborted&&currentSession.current===target)setError(e.message)}
  finally{if(recoveryControl.current===controller)recoveryControl.current=null}
 }
 async function resume(){if(sending.current||pendingRef.current||busy||loading||!run?.recoverable)return;sending.current=true;setSubmitting(true);setError('');try{const result=await resumeResearchRun(run.id,contextBudget,cap?.context_budgets);setRun(old=>({...old,...result,id:old.id,state:result.state||'running',recoverable:result.recoverable===true,error:result.error||'',error_code:result.error_code||null}));follow.current=true}catch(e){setError(e.message);if(e.context)setRun(old=>({...old,context:e.context,error_code:e.code||old.error_code,recoverable:e.recoverable??old.recoverable}))}finally{sending.current=false;setSubmitting(false)}}
 function switchSession(next){if(pendingRef.current)return;pollControl.current?.abort();recoveryControl.current?.abort();currentSession.current=next;onDraftConsumed?.(draft?.id);localStorage.setItem('ocean-cloud-research-v1-session',next);setSession(next)}
 function newSession(){if(busy||pendingRef.current)return;switchSession(crypto.randomUUID());loadSessions()}
 async function renameSession(item){if(pendingRef.current)return;const title=window.prompt('会话名称',item.title||'');if(title==null)return;const value=title.trim();if(!value)return;try{await api('sessions/'+encodeURIComponent(item.id),{title:value},'PATCH');loadSessions()}catch(e){setError(e.message)}}
 async function removeSession(item){if(busy||pendingRef.current)return;if(!window.confirm('删除会话「'+(item.title||'未命名')+'」？该会话的聊天记录会从本人云端空间删除，任务与计算结果不受影响。'))return;try{await api('sessions/'+encodeURIComponent(item.id),null,'DELETE');const next=item.id===session?crypto.randomUUID():session;switchSession(next);loadSessions()}catch(e){setError(e.message)}}
 function clear(){if(busy||pendingRef.current||loading||!messages.length)return;localStorage.setItem('ocean-cloud-research-v1-previous',session);setPrevious(session);switchSession(crypto.randomUUID());loadSessions()}
 function undo(){if(!previous||busy||pendingRef.current)return;const target=previous;setPrevious('');localStorage.removeItem('ocean-cloud-research-v1-previous');switchSession(target)}
 function exportChat(){const mime=format==='json'?'application/json':format==='md'?'text/markdown':'text/plain';const url=URL.createObjectURL(new Blob(['\ufeff',serializeChat(messages,format)],{type:mime+';charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='海洋声学对话-'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+format;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 async function copy(text){try{await navigator.clipboard.writeText(text);notify('消息已复制')}catch{notify('复制失败，请手动选择文字复制')}}
 return <div className="dialogue-workbench">
  <div className="dialogue-title"><div><h1>对话工作台</h1><p>加载技能、查询实际数据，按可用工具开展研究。</p></div></div>
  <div className={'dialogue-layout'+(sidebarShown?' has-context':'')}><section className="panel dialogue-panel" aria-label="对话工作台">
   <div className="dialogue-primary-toolbar">
    <span className="dialogue-message-count">{loading?'载入聊天…':`${messages.length} 条消息`}</span>
    <span className="dialogue-connection-status" role="status">{loading?'正在读取配置':cap?.api_configured?'模型已配置':'待配置模型'}</span>
    <div className="dialogue-primary-actions"><button className="button" disabled={busy||!!pendingSend} onClick={newSession}>＋ 新对话</button><button className="button" aria-expanded={sidebarShown} aria-controls="dialogue-context-panel" onClick={()=>setSidebarShown(shown=>!shown)}>会话与资料</button></div>
   </div>
   <div className="dialogue-auxiliary">
    <details className="dialogue-options"><summary>研究设置 <small>{rounds==='0'?'轮数不限':`${rounds} 轮`} · {contextBudget==='auto'?'自动 32K':contextBudget==='unlimited'?'应用预算不限':`${Number(contextBudget)/1024}K`}</small></summary>
   <div className="dialogue-toolbar"><label>对话后端 <select aria-label="对话后端" disabled={busy||!!pendingSend} value={backend} onChange={e=>chooseBackend(e.target.value)}><option value="api">模型 API · 云端研究 Agent</option><option value="dsh" disabled>DSH · 需要专属节点</option><option value="codex" disabled>Codex · 需要专属节点</option></select></label><span role="status">{backend==='api'?(cap?.api_configured?'模型接口已配置':'请先配置模型 API Key'):status?.message||'正在检查本机 Agent…'}</span></div>
   {backend==='api'&&<div className="dialogue-toolbar"><label>工具轮数 <input aria-label="Agent工具轮数" type="number" min="0" max={cap?.max_rounds||1000} disabled={busy||!!pendingSend} value={rounds} onChange={e=>{setRounds(e.target.value);localStorage.setItem('ocean-cloud-research-v2-rounds',e.target.value)}}/></label><span>默认 {(cap?.default_rounds??0)===0?'不限（0）':`${cap.default_rounds} 轮`}；可自定轮数，0 表示不限，达到设定轮数后汇总已有结果</span></div>}
   <div className="dialogue-toolbar"><label>上下文预算 <select aria-label="研究上下文预算" disabled={busy||!!pendingSend} value={contextBudget} onChange={e=>{setContextBudget(e.target.value);localStorage.setItem('ocean-cloud-research-v2-context-budget',e.target.value)}}>{contextBudgetChoices(cap?.context_budgets).map(value=><option value={value} key={value}>{value==='auto'?'自动 · 32K':value==='unlimited'?'不限 · 由模型接口限制':`${value/1024}K`}</option>)}</select></label><span>可见文字 UTF-8 保守估算 {estimateVisibleResearchInput(messages,text).toLocaleString()}；完整输入还含系统、资料和工具结果。</span></div>
   <ResearchContextStatus context={run?.context}/>
    </details>
    <details className="dialogue-chat-management"><summary>聊天管理</summary>
   <div className="dialogue-toolbar"><div className="dialogue-actions"><select aria-label="聊天导出格式" value={format} onChange={e=>setFormat(e.target.value)}><option value="md">Markdown</option><option value="txt">TXT</option><option value="json">JSON</option></select><button className="button" disabled={busy||loading||!messages.length} onClick={exportChat}><Download size={14}/>导出聊天</button><button className="button" disabled={busy||loading||!messages.length} onClick={clear}><Trash2 size={14}/>清空聊天</button>{previous&&<button className="button" disabled={busy||loading} onClick={undo}><Undo2 size={14}/>撤销清空</button>}</div></div>
    </details>
   <ModelSkillPicker disabled={busy||!!pendingSend} onSelect={value=>{if(!pendingRef.current)setText(value)}}/>
   {!!messages.length&&<details className="dialogue-question-picker"><summary>从问题库选择问题</summary><QuestionSuggestions mode="agent" onSelect={value=>{if(!pendingRef.current)setText(value)}}/></details>}
   </div>
   <ResearchBudgetRecovery run={run} busy={busy||!!pendingSend} onResume={resume}/>
   {pendingSend&&<div className="dialogue-error" role="status" aria-label="发送状态待确认"><p>{submitting?'正在确认这一次发送…':'发送状态待确认。问题和图谱已保留，恢复时会核对同一个请求。'}</p><button className="button" disabled={submitting} onClick={recoverSend}>确认并恢复发送</button></div>}
   {connectionRecovery&&<div className="dialogue-runtime" role="status" aria-label="正在恢复研究连接"><Loader2 size={16} className="spin"/>{connectionRecovery.history?'正在恢复聊天记录':'正在恢复连接并核对研究状态'} · {connectionRecovery.attempt}/{connectionRecovery.total}</div>}
   {stepPaused&&<div className="dialogue-error" role="status" aria-label="研究连接待恢复"><p>研究已暂停。读取服务器保存的状态后，可继续当前研究。</p><button className="button" disabled={submitting} onClick={recoverStep}>检查研究状态并继续</button></div>}
   <GraphSelection nodes={knowledgeNodes} disabled={busy||!!pendingSend} onRemove={id=>{setKnowledgeNodes(rows=>rows.filter(row=>row.id!==id));onDraftConsumed?.(draft?.id)}} onClear={()=>{setKnowledgeNodes([]);onDraftConsumed?.(draft?.id)}}/>
   <div className="dialogue-messages" role="log" aria-label="聊天记录" ref={scroll} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100}}>
    {!loading&&!messages.length&&<div className="dialogue-welcome"><Waves size={36}/><h2>从一个声学问题开始</h2><p>查阅课程资料、查询海洋环境数据，开展声学研究。</p><QuestionSuggestions mode="agent" onSelect={value=>{if(!pendingRef.current)setText(value)}}/></div>}
    {messages.map((row,i)=><DialogueMessage key={row.id||i} role={row.role} text={row.text} index={i} onCopy={copy} renderAnswer={value=><ChatMessage text={value}/>}>{row.role!=='user'&&row.exports?.length>0?<JobExports items={row.exports}/>:null}</DialogueMessage>)}
    {busy&&<DialogueMessage role="assistant" text={run?.partial||''} streaming backend={run?.backend||backend} renderAnswer={value=><ChatMessage text={value}/>}>{run?.exports?.length>0?<JobExports items={run.exports}/>:null}</DialogueMessage>}
    {!busy&&run?.state!=='done'&&run?.exports?.length>0&&<DialogueMessage role="assistant"><JobExports items={run.exports}/></DialogueMessage>}
   </div>
   {run?.trace?.length>0&&<details className="dialogue-trace"><summary>实际工具调用 · {run.trace.length} 次</summary><div>{run.trace.map((item,i)=><details key={i}><summary>{i+1}. {item.tool} · {item.status}</summary><pre>{JSON.stringify(item.arguments,null,2)}</pre></details>)}</div></details>}
   {busy&&<div className="dialogue-runtime" role="status"><Loader2 size={16} className="spin"/>{labels[run?.backend||backend]} · {run?.stage||'正在提交'}{run?.elapsed_seconds!=null&&` · ${run.elapsed_seconds} 秒`}{run?.model&&` · ${run.model}`}<button className="button" disabled={!run?.id} onClick={stop}><Square size={13}/>停止当前请求</button></div>}
   {error&&<div className="dialogue-error" role="alert">{error}{!pendingSend&&!stepPaused&&!text.trim()&&<button className="button" disabled={busy||!!pendingSend} onClick={()=>setText([...messages].reverse().find(row=>row.role==='user')?.text||'')}>编辑上一问题</button>}</div>}
   <div className="dialogue-composer"><textarea aria-label="输入问题" placeholder="描述你的研究目标、环境来源与希望得到的结果…" value={text} disabled={!!pendingSend} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}/><div><span><BookOpen size={13}/>技能 · 资料 · 在线环境数据</span><button className="button primary" aria-label="发送问题" disabled={busy||loading||!!pendingSend||!text.trim()||!cap?.api_configured} onClick={send}><ArrowUp size={18}/></button></div></div>
  </section><aside id="dialogue-context-panel" className={'panel dialogue-context'+(sidebarShown?'':' is-collapsed')} hidden={!sidebarShown}><div className="sessions-block"><div className="sessions-head"><h3>对话</h3><button className="button dialogue-context-close" aria-label="收起会话与资料" title="收起会话与资料" onClick={()=>setSidebarShown(false)}><X size={15}/></button><button className="button" disabled={busy||!!pendingSend} onClick={newSession}>＋ 新对话</button></div><div className="sessions-list">{!sessions.length&&<p className="sessions-empty">还没有会话，发一条消息就会自动建一个。</p>}{sessions.map(item=><div key={item.id} className={'sessions-item'+(item.id===session?' active':'')} aria-disabled={busy||!!pendingSend} onClick={()=>{if(!busy&&!pendingSend&&item.id!==session)switchSession(item.id)}}><div className="sessions-title">{item.title||'未命名会话'}</div><div className="sessions-meta">{item.count} 条 · {(item.updated||'').replace('T',' ').slice(0,16)}</div><div className="sessions-actions"><button disabled={busy||!!pendingSend} onClick={e=>{e.stopPropagation();renameSession(item)}}>改名</button><button disabled={busy||!!pendingSend} onClick={e=>{e.stopPropagation();removeSession(item)}}>删除</button></div></div>)}</div></div><details className="dialogue-context-notes"><summary>资料与使用说明</summary><h3>当前工作上下文</h3><p><BookOpen size={18}/>课程知识与教材原页</p><p><FlaskConical size={18}/>模型 Skill 与研究记录</p><p><Waves size={18}/>WOA18 温盐声速剖面{cap&&!cap.ocean_data_available&&<small>在线数据暂不可用</small>}</p><div className="dialogue-note">使用本人配置的模型 API，结合课程资料、Skill 和环境数据开展研究。DSH / Codex 可在本地完整工作台使用。{cap?.script_execution===true?' 已连接脚本执行器。':' MATLAB 仿真使用共享计算节点。'}</div><p className="dialogue-note">清空聊天会创建新会话，可撤销。计算结果见“任务与结果”。</p><button className="button" onClick={openSettings}><Settings2 size={15}/>模型与环境设置</button></details></aside></div>
 </div>;
}
