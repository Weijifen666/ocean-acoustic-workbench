import React,{act,useState} from 'react';
import TestRenderer from 'react-test-renderer';
import assert from 'node:assert/strict';
import Workbench from '../src/DialogueWorkbench';
import {createKnowledgeDraft} from '../src/knowledgeSelection';

global.IS_REACT_ACT_ENVIRONMENT=true;
const original={fetch:global.fetch,setInterval:global.setInterval,clearInterval:global.clearInterval};
const answer={role:'assistant',text:'RECOVERED_ACTUAL_SERVER_HISTORY'};
let renderer,timers,calls,storage,history,serverRun;
function setup(route=()=>{}){
 timers=new Map();calls=[];history=[];serverRun=null;
 storage=new Map([['ocean-cloud-research-v1-session','recovery-session'],['ocean-cloud-research-v2-rounds','0'],['ocean-cloud-research-v2-context-budget','unlimited']]);
 global.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 global.setInterval=callback=>{const id=Symbol();timers.set(id,callback);return id};global.clearInterval=id=>timers.delete(id);
 global.fetch=async(url,init={})=>{
  const path=String(url).replace('/api/research/',''),body=init.body?JSON.parse(init.body):undefined;
  calls.push({path,body});const special=await route(path,body);if(special!==undefined)return special;
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
 await mount();await enter('本轮不要自动重复付费');await submit();assert.equal(steps().length,1);assert.equal(timers.size,0,'Stop automatic step POST retries after transport loss');
 assert(text().includes('研究连接待恢复'));await click('检查研究状态并继续');assert.equal(steps().length,1,'A finished durable run must only read history on recovery');assert(text().includes(answer.text));
}
async function main(){
 const cases=[lostAcknowledgement,offlineBeforeAcceptance,()=>bodyOrGatewayFailure(false),()=>bodyOrGatewayFailure(true),acknowledgedThenReadFails,graphAcknowledgementRecovery,pendingCannotSwitchSession,rejectedSendRetainsGraph,lostStepResponse];
 try{for(const scenario of cases){try{await scenario()}finally{await clean()}}console.log('Public chat recovery: 9 scenarios passed')}
 finally{global.fetch=original.fetch;global.setInterval=original.setInterval;global.clearInterval=original.clearInterval}
}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1)});
