import React,{act,useState} from 'react';
import TestRenderer from 'react-test-renderer';
import assert from 'node:assert/strict';
import Workbench from '../src/DialogueWorkbench';
import {createKnowledgeDraft} from '../src/knowledgeSelection';

global.IS_REACT_ACT_ENVIRONMENT=true;
const original={fetch:global.fetch,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
const answer={role:'assistant',text:'RECOVERED_ACTUAL_SERVER_HISTORY'};
let renderer,timers,calls,storage,history,serverRun;
function setup(route=()=>{}){
 timers=new Map();calls=[];history=[];serverRun=null;
 storage=new Map([['ocean-cloud-research-v1-session','recovery-session'],['ocean-cloud-research-v2-rounds','0'],['ocean-cloud-research-v2-context-budget','unlimited']]);
 global.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 global.setTimeout=(callback,delay)=>{const id=Symbol();timers.set(id,{callback,delay});return id};global.clearTimeout=id=>timers.delete(id);
 global.fetch=async(url,init={})=>{
  const path=String(url).replace('/api/research/',''),body=init.body?JSON.parse(init.body):undefined;
  calls.push({path,body,signal:init.signal});const special=await route(path,body,init);if(special!==undefined)return special;
  if(path==='capabilities')return Response.json({api_configured:true,execution_mode:'poll_steps',max_rounds:1000,context_budgets:[4096,8192,32768,'unlimited']});
  if(path==='sessions')return Response.json([]);
  if(path.startsWith('active?'))return Response.json(null);
  if(path.startsWith('history?'))return Response.json(history);
  if(path==='runs/recovery-run')return Response.json(serverRun);
  if(path==='runs/recovery-run/step'){serverRun={id:'recovery-run',state:'done',backend:'api'};history.push(answer);return Response.json(serverRun)}
  throw Error('Unexpected fixture request '+path);
 };
}
function accept(body,state='done'){
 if(!serverRun){serverRun={id:'recovery-run',state,backend:'api'};history=[{role:'user',text:body.message},...(state==='done'?[answer]:[])]}
 return Response.json({id:serverRun.id,state:serverRun.state,reused:calls.filter(row=>row.path==='chat').length>1},{status:202});
}
const input=()=>renderer.root.findByProps({'aria-label':'输入问题'});
const send=()=>renderer.root.findByProps({'aria-label':'发送问题'});
const text=()=>JSON.stringify(renderer.toJSON());
const buttons=label=>renderer.root.findAll(node=>node.type==='button'&&node.children.some(value=>value===label));
const chats=()=>calls.filter(row=>row.path==='chat');
const steps=()=>calls.filter(row=>row.path.endsWith('/step'));
async function mount(Component=Workbench){await act(async()=>{renderer=TestRenderer.create(<Component/>,{createNodeMock:()=>({scrollTop:0,scrollHeight:100,clientHeight:100})})})}
async function enter(value){await act(async()=>input().props.onChange({target:{value}}))}
async function click(label){const matches=buttons(label);assert.equal(matches.length,1,label);assert(!matches[0].props.disabled,label+' must be enabled');await act(async()=>matches[0].props.onClick())}
async function submit(){assert(!send().props.disabled);await act(async()=>send().props.onClick())}
async function tick(delay){assert.equal(timers.size,1,'Exactly one non-overlapping poll or recovery may be scheduled');const [id,timer]=timers.entries().next().value;if(delay!==undefined)assert.equal(timer.delay,delay);timers.delete(id);await act(async()=>timer.callback())}
async function clean(){if(renderer){await act(async()=>renderer.unmount());renderer=null}assert.equal(timers.size,0)}
function assertPending(question){
 assert.equal(input().props.value,question);assert.equal(send().props.disabled,true);
 assert.equal(buttons('编辑上一问题').length,0,'Do not overwrite the unconfirmed question with older history');
 assert(text().includes('发送状态待确认'));assert.equal(buttons('确认并恢复发送').length,1);
 assert.equal(chats().length,1,'An uncertain creation must not silently resend');
 assert.equal(steps().length,0,'No paid scheduling before creation recovery');
}
async function lostAcknowledgement(){
 let count=0;
 setup((path,body)=>{if(path==='chat'){const reply=accept(body);if(++count===1)throw new TypeError('Failed to fetch');return reply}});
 await mount();await enter('什么是简正波');await submit();assertPending('什么是简正波');
 // Even a changed UI setting cannot alter the frozen request fingerprint.
 await act(async()=>renderer.root.findByProps({'aria-label':'研究上下文预算'}).props.onChange({target:{value:'8192'}}));
 await click('确认并恢复发送');
 assert.deepEqual(chats()[0].body,chats()[1].body,'Replay the complete original envelope and request ID');
 assert(text().includes(answer.text));assert.equal(history.length,2);assert.equal(steps().length,0,'A replay already done must read history, not advance');
 assert.equal(input().props.value,'');assert.equal(buttons('确认并恢复发送').length,0);
 assert(![...storage.keys()].some(key=>/pending|request_id/.test(key)),'Pending text/request identity must not leak into cross-identity persistence');
}
async function offlineBeforeAcceptance(){
 let count=0;setup((path,body)=>{if(path==='chat'){if(++count===1)throw new TypeError('Failed to fetch');return accept(body,'running')}});
 await mount();await enter('离线之前的问题');await submit();assertPending('离线之前的问题');assert.equal(serverRun,null);
 await click('确认并恢复发送');assert.deepEqual(chats()[0].body,chats()[1].body);assert.equal(history.length,2);assert.equal(steps().length,1,'One accepted request may explicitly start its normal first step');assert(text().includes(answer.text));
}
async function bodyOrGatewayFailure(html){
 let count=0;setup((path,body)=>{if(path==='chat'){const reply=accept(body);if(++count===1)return html?new Response('<html>gateway</html>',{status:502}):{ok:true,text:async()=>{throw new TypeError('body disconnected')}};return reply}});
 await mount();await enter('保留响应未读完的问题');await submit();assertPending('保留响应未读完的问题');await click('确认并恢复发送');assert.deepEqual(chats()[0].body,chats()[1].body);assert(text().includes(answer.text));assert.equal(steps().length,0);
}
async function acknowledgedThenReadFails(){
 let fail=true;setup((path,body)=>{if(path==='chat')return accept(body);if(path==='runs/recovery-run'&&fail){fail=false;throw new TypeError('status disconnected')}});
 await mount();await enter('已经保存的问题');await submit();assertPending('已经保存的问题');await click('确认并恢复发送');
 assert.equal(chats().length,1,'Known run ID is recovered with GET, not another creation');assert(text().includes(answer.text));assert.equal(steps().length,0);
}
async function graphAcknowledgementRecovery(){
 let count=0,setDraft;const consumed=[];
 setup((path,body)=>{if(path==='chat'){const reply=accept(body);if(++count===1)throw new TypeError('acknowledgement lost');return reply}});
 function Host(){const [draft,update]=useState(null);setDraft=update;return <Workbench draft={draft} onDraftConsumed={id=>{consumed.push(id);update(null)}}/>}
 await mount(Host);const draft=createKnowledgeDraft([{id:'munk_profile',label:'Munk 理想剖面'},{id:'sound_speed_profile',label:'声速剖面 SSP'}]);await act(async()=>setDraft(draft));await submit();
 assertPending(draft.text);assert.equal(consumed.length,0);assert(text().includes('Munk 理想剖面'));
 assert.equal(renderer.root.findByProps({'aria-label':'移除知识点 Munk 理想剖面'}).props.disabled,true,'Unconfirmed graph selection is retained and cannot mutate its request');
 await click('确认并恢复发送');assert.deepEqual(chats()[0].body,chats()[1].body);assert.deepEqual(chats()[1].body.knowledge_node_ids,['munk_profile','sound_speed_profile']);
 assert.deepEqual(consumed,[draft.id]);assert.equal(renderer.root.findAll(node=>node.type==='section'&&node.props['aria-label']==='本次问题的图谱上下文').length,0);assert.equal(steps().length,0);
}
async function pendingCannotSwitchSession(){
 let count=0;
 setup((path,body)=>{
  if(path==='sessions')return Response.json([{id:'recovery-session',title:'Current',count:2},{id:'other-session',title:'Other',count:1}]);
  if(path==='chat'){const reply=accept(body);if(++count===1)throw new TypeError('acknowledgement lost');return reply}
 });
 await mount();await enter('必须留在当前会话');await submit();assertPending('必须留在当前会话');
 const newButtons=buttons('＋ 新对话');assert.equal(newButtons.length,2);assert(newButtons.every(button=>button.props.disabled),'Every new-session entry must be visibly disabled while a send is uncertain');
 const other=renderer.root.findAll(node=>node.type==='div'&&node.props.className==='sessions-item').find(node=>node.findAll(child=>child.props.className==='sessions-title'&&child.children.includes('Other')).length);
 assert(other);assert.equal(other.props['aria-disabled'],true);await act(async()=>other.props.onClick());
 assert.equal(calls.filter(row=>row.path.includes('session=other-session')).length,0,'Do not load another conversation or lose the pending envelope');
 await click('确认并恢复发送');assert.deepEqual(chats()[0].body,chats()[1].body);assert.equal(chats()[1].body.session,'recovery-session');assert(text().includes(answer.text));
}
async function rejectedSendRetainsGraph(){
 setup(path=>path==='chat'?Response.json({detail:'所选资料无法完整放入预算',code:'CONTEXT_BUDGET_EXCEEDED'},{status:422}):undefined);
 let setDraft;const consumed=[];
 function Host(){const [draft,update]=useState(null);setDraft=update;return <Workbench draft={draft} onDraftConsumed={id=>consumed.push(id)}/>}
 await mount(Host);const draft=createKnowledgeDraft([{id:'munk_profile',label:'Munk 理想剖面'}]);await act(async()=>setDraft(draft));await submit();
 assert.equal(buttons('确认并恢复发送').length,0,'Definitive rejection must not masquerade as uncertain acceptance');assert.equal(send().props.disabled,false);assert(!consumed.includes(draft.id));assert(text().includes('Munk 理想剖面'));assert(text().includes('所选资料无法完整放入预算'));
 assert.equal(buttons('编辑上一问题').length,0);assert.equal(steps().length,0);
}
async function lostStepResponse(){
 setup((path,body)=>{if(path==='chat')return accept(body,'running');if(path==='runs/recovery-run/step'){serverRun={id:'recovery-run',state:'done',backend:'api'};history.push(answer);throw new TypeError('step acknowledgement lost')}});
 await mount();await enter('本轮不要自动重复付费');await submit();assert.equal(steps().length,1);assert.equal(timers.size,0);
 assert(text().includes(answer.text));assert(!text().includes('研究连接待恢复'),'A lost step acknowledgement is recovered by its durable terminal state');
}
async function activeLeaseIsReadOnly(){
 setup((path,body)=>{if(path==='chat'){const response=accept(body,'running');serverRun.step_busy=true;serverRun.lease_expires_at=Date.now()+240000;return response}});
 await mount();await enter('等待仍在运行的步骤');await submit();assert.equal(steps().length,0);
 await tick(1000);await tick(1000);assert.equal(steps().length,0,'An active server lease must never trigger another step POST');
 serverRun={...serverRun,state:'done',step_busy:false};history.push(answer);await tick(1000);
 assert(text().includes(answer.text));assert.equal(steps().length,0);assert.equal(timers.size,0);
}
async function disconnectBeforePostAcceptance(){
 let lost=false,reconcileFailed=false;
 setup((path,body)=>{
  if(path==='chat')return accept(body,'running');
  if(path==='runs/recovery-run/step'&&!lost){lost=true;throw new TypeError('not accepted')}
  if(path==='runs/recovery-run'&&lost&&!reconcileFailed){reconcileFailed=true;throw new TypeError('still offline')}
 });
 await mount();await enter('恢复未接收的步骤');await submit();assert.equal(steps().length,1);assert(text().includes('正在恢复研究连接'));
 await tick(2000);assert.equal(steps().length,1,'First recovery performs only GET');
 await tick(1000);assert.equal(steps().length,2,'A later normal poll may advance after durable GET confirmed no lease');assert(text().includes(answer.text));assert.equal(timers.size,0);
}
async function boundedOfflineRecovery(){
 let offline=false;
 setup((path,body)=>{if(path==='chat')return accept(body,'running');if(path==='runs/recovery-run/step'){offline=true;throw new TypeError('offline')}if(path==='runs/recovery-run'&&offline)throw new TypeError('offline')});
 await mount();await enter('持续断网');await submit();
 for(const delay of [2000,4000,8000,8000,8000,8000]){assert(text().includes('正在恢复研究连接'));await tick(delay)}
 assert.equal(timers.size,0);assert.equal(steps().length,1);assert(text().includes('研究连接待恢复'));assert.equal(buttons('检查研究状态并继续').length,1);
}
async function stopCancelsRecovery(){
 let offline=false;
 setup((path,body)=>{
  if(path==='chat')return accept(body,'running');
  if(path==='runs/recovery-run/step'){offline=true;throw new TypeError('offline')}
  if(path==='runs/recovery-run/stop'){offline=false;serverRun={...serverRun,state:'stopped'};return Response.json({stopped:true})}
  if(path==='runs/recovery-run'&&offline)throw new TypeError('offline');
 });
 await mount();await enter('停止时清除自动恢复');await submit();assert.equal(timers.size,1);
 await click('停止当前请求');assert.equal(timers.size,0);assert.equal(steps().length,1);assert(!text().includes('正在恢复研究连接'));assert(!text().includes('研究连接待恢复'));
}
async function unmountIgnoresLateStatus(){
 let reads=0,release,signal;
 setup((path,body,init)=>{
  if(path==='chat')return accept(body,'running');
  if(path==='runs/recovery-run'&&++reads===2){signal=init.signal;return new Promise(resolve=>{release=resolve})}
 });
 await mount();await enter('离开页面后的应答');await submit();assert(release);assert.equal(steps().length,0);
 await act(async()=>renderer.unmount());renderer=null;assert.equal(signal.aborted,true);
 await act(async()=>release(Response.json({id:'recovery-run',state:'running',step_busy:false})));
 assert.equal(steps().length,0,'A late snapshot after unmount cannot launch a paid step');assert.equal(timers.size,0);
}
async function terminalHistoryRetriesAlone(){
 let failed=false;
 setup((path,body)=>{
  if(path==='chat')return accept(body,'running');
  if(path.startsWith('history?')&&serverRun?.state==='done'&&!failed){failed=true;throw new TypeError('history unavailable')}
 });
 await mount();await enter('只补读完成后的记录');await submit();assert.equal(steps().length,1);assert(text().includes('正在恢复聊天记录'));
 const reads=calls.filter(row=>row.path==='runs/recovery-run').length;
 await tick(2000);assert(text().includes(answer.text));assert.equal(steps().length,1);assert.equal(calls.filter(row=>row.path==='runs/recovery-run').length,reads,'Known terminal recovery retries history only');assert.equal(timers.size,0);
}
async function sessionChangeIgnoresLateStatus(){
 let reads=0,release;
 setup((path,body)=>{
  if(path==='chat')return accept(body,'running');
  if(path==='runs/recovery-run'&&++reads===2)return new Promise(resolve=>{release=resolve});
  if(path==='runs/recovery-run/stop'){serverRun={...serverRun,state:'stopped'};return Response.json({stopped:true})}
  if(path.startsWith('history?')&&!path.endsWith('recovery-session'))return Response.json([]);
 });
 await mount();await enter('上一会话中的请求');await submit();assert(release);
 await click('停止当前请求');await act(async()=>buttons('＋ 新对话')[0].props.onClick());
 await act(async()=>release(Response.json({id:'recovery-run',state:'running',step_busy:false,partial:'STALE_OLD_SESSION'})));
 assert.equal(steps().length,0);assert.equal(timers.size,0);assert(!text().includes('STALE_OLD_SESSION'));assert(!text().includes('上一会话中的请求'));
}
async function outputLimitResumesOriginalResearch(){
 setup((path,body)=>{
  if(path==='chat'){const accepted=accept(body,'failed');serverRun={...serverRun,recoverable:true,error_code:'PROVIDER_OUTPUT_LIMIT',partial:'PARTIAL_ANSWER_SAVED',error:'本轮输出达到上限'};return accepted}
  if(path==='runs/recovery-run/resume'){serverRun={...serverRun,state:'running',recoverable:false,error_code:null,error:null};return Response.json(serverRun)}
 });
 await mount();await enter('不要重新运行已有仿真');await submit();
 assert(text().includes('PARTIAL_ANSWER_SAVED'));assert.equal(buttons('继续原研究').length,1);assert.equal(buttons('调整预算并继续').length,0);assert.equal(buttons('编辑上一问题').length,0);assert.equal(steps().length,0);
 await click('继续原研究');
 assert.equal(chats().length,1,'Output recovery must not create another research request');assert.equal(calls.filter(row=>row.path==='runs/recovery-run/resume').length,1);assert.equal(steps().length,1);assert(text().includes(answer.text));assert.equal(timers.size,0);
}
async function main(){
 const cases=[lostAcknowledgement,offlineBeforeAcceptance,()=>bodyOrGatewayFailure(false),()=>bodyOrGatewayFailure(true),acknowledgedThenReadFails,graphAcknowledgementRecovery,pendingCannotSwitchSession,rejectedSendRetainsGraph,lostStepResponse,activeLeaseIsReadOnly,disconnectBeforePostAcceptance,boundedOfflineRecovery,stopCancelsRecovery,unmountIgnoresLateStatus,terminalHistoryRetriesAlone,sessionChangeIgnoresLateStatus,outputLimitResumesOriginalResearch];
 try{for(const scenario of cases){try{await scenario()}finally{await clean()}}console.log('Public chat recovery: 17 scenarios passed')}
 finally{global.fetch=original.fetch;global.setTimeout=original.setTimeout;global.clearTimeout=original.clearTimeout}
}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1)});
