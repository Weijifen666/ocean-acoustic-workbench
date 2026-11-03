import React,{act,useState} from 'react';
import TestRenderer from 'react-test-renderer';
import assert from 'node:assert/strict';
import Workbench from '@workbench-under-test';
import {createKnowledgeDraft} from '@knowledge-selection-under-test';

const isPublic=__PUBLIC_WORKBENCH__,variant=isPublic?'public':'local';
global.IS_REACT_ACT_ENVIRONMENT=true;
const original={fetch:global.fetch,setInterval:global.setInterval,clearInterval:global.clearInterval};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const user={role:'user',text:'fixture question'};
const answer={role:'assistant',text:'FINAL_ANSWER_WITHOUT_NAVIGATION'};
const ok=value=>({ok:true,json:async()=>value});
let timers,historyCalls,chatPayloads,stepCalls,renderer;

function setup(route,{session='fixture-session'}={}){
 timers=new Map();historyCalls=0;chatPayloads=[];stepCalls=0;
 const storage=new Map([
  ['ocean-research-v07-session',session],['ocean-research-v07-backend','api'],['ocean-research-v07-rounds','0'],
  ['ocean-cloud-research-v1-session',session],['ocean-cloud-research-v2-rounds','0'],['ocean-cloud-research-v2-context-budget','unlimited'],
 ]);
 global.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 global.setInterval=callback=>{const id=Symbol();timers.set(id,callback);return id};
 global.clearInterval=id=>timers.delete(id);
 global.fetch=async(url,init={})=>{
  const path=String(url).replace('/api/research/','');
  if(path.startsWith('history?'))historyCalls++;
  if(path==='chat')chatPayloads.push(JSON.parse(init.body));
  if(path.endsWith('/step'))stepCalls++;
  const value=await route(path,init);
  if(value!==undefined)return ok(value);
  if(path==='capabilities')return ok({ocean_data_available:true,api_configured:true,public_mode:isPublic,
   execution_mode:isPublic?'poll_steps':'local',max_rounds:1000,context_budgets:[4096,8192,32768,'unlimited']});
  if(path==='sessions')return ok([]);
  if(path.endsWith('/status'))return ok({message:'fixture ready'});
  if(path.endsWith('/step'))return ok({state:'done'});
  throw Error('Unexpected test request: '+path);
 };
}
const logText=()=>JSON.stringify(renderer.toJSON());
const assistantCount=()=>renderer.root.findAll(node=>node.type==='article'&&node.props.className==='dialogue-message assistant').length;
const selectedContext=()=>renderer.root.findAll(node=>node.type==='section'&&node.props['aria-label']==='本次问题的图谱上下文');
const sendButton=()=>renderer.root.findByProps({'aria-label':'发送问题'});
async function mount(Component=Workbench){await act(async()=>{renderer=TestRenderer.create(<Component/>,{createNodeMock:()=>({scrollTop:0,scrollHeight:1000,clientHeight:300})})})}
async function cleanup(){if(renderer){const current=renderer;renderer=null;await act(async()=>current.unmount())}assert.equal(timers.size,0,'Polling must stop after unmount')}
async function tick(){await act(async()=>{await Promise.all([...timers.values()].map(callback=>callback()))})}
async function enter(text){await act(async()=>renderer.root.findByProps({'aria-label':'输入问题'}).props.onChange({target:{value:text}}))}
async function send(){assert.equal(sendButton().props.disabled,false,'The accepted next question must be sendable');await act(async()=>sendButton().props.onClick())}

async function delayedCompletion(state){
 const history=deferred();
 setup(path=>{
  if(path.startsWith('active?'))return {id:'fixture-run',state:'running',backend:'api'};
  if(path==='runs/fixture-run')return {id:'fixture-run',state,backend:'api',partial:answer.text,reply:answer.text,...(state==='failed'?{error:'fixture failure'}:{})};
  if(path.startsWith('history?'))return historyCalls===1?[user]:history.promise;
 });
 await mount();assert.equal(historyCalls,2,'Completion must load its final history');
 await act(async()=>{history.resolve([user,answer])});
 assert(logText().includes(answer.text),state+': final answer must appear without remount, navigation or refresh');
 assert.equal(assistantCount(),1,'The final answer must appear once');
 assert.equal(timers.size,0,'Apply terminal history before polling stops');
 if(state==='failed')assert(renderer.root.findByProps({role:'alert'}).children.includes('fixture failure'));
 assert.equal(chatPayloads.length,0,'Completion refresh must not resubmit research');
}

async function retryHistory(){
 let fail=true;
 setup(path=>{
  if(path.startsWith('active?'))return {id:'fixture-run',state:'running',backend:'api'};
  if(path==='runs/fixture-run')return {id:'fixture-run',state:'done',backend:'api',reply:answer.text};
  if(path.startsWith('history?')){if(historyCalls===1)return [user];if(fail){fail=false;throw Error('temporary history disconnect')}return [user,answer]}
 });
 await mount();assert.equal(timers.size,1,'A final-history failure must keep retrying');
 const stepsAtCompletion=stepCalls;
 if(isPublic)assert.equal(stepsAtCompletion,1,'Public fixture must exercise a real step request');
 await tick();
 assert(logText().includes(answer.text),'Final history must recover without navigation');
 assert.equal(assistantCount(),1);assert.equal(timers.size,0);assert.equal(chatPayloads.length,0);
 assert.equal(stepCalls,stepsAtCompletion,'History retry must not POST another advance step after terminal state');
}

async function initialSnapshot(){
 const active=deferred();let activeDelivered=false;
 setup(async path=>{
  if(path.startsWith('active?')){const result=await active.promise;activeDelivered=true;return result}
  if(path.startsWith('history?'))return activeDelivered?[user,answer]:[user];
 });
 await mount();
 await act(async()=>{active.resolve({id:'fixture-run',state:'done',backend:'api',reply:answer.text})});
 assert(logText().includes(answer.text),'Completion during initial loading must include its committed answer');
 assert.equal(assistantCount(),1);assert.equal(timers.size,0);assert.equal(stepCalls,0);
}

async function switchSessionDuringLoad(){
 const previousHistory=deferred();
 setup(path=>{
  if(path==='sessions')return [{id:'session-a',title:'Session A',count:1},{id:'session-b',title:'Session B',count:1}];
  if(path.startsWith('active?'))return null;
  if(path.startsWith('history?'))return new URL('https://fixture.test/?'+path.split('?')[1]).searchParams.get('session')==='session-a'?previousHistory.promise:[{role:'user',text:'OTHER_SESSION'}];
 },{session:'session-a'});
 await mount();
 const second=renderer.root.findAll(node=>typeof node.props.className==='string'&&node.props.className.split(' ').includes('sessions-item'))
  .find(node=>node.findAll(child=>child.props.className==='sessions-title').some(child=>child.children.join('')==='Session B'));
 assert(second,'Use the real session selection control');
 await act(async()=>second.props.onClick());
 assert(logText().includes('OTHER_SESSION'));
 await act(async()=>previousHistory.resolve([user,answer]));
 assert(logText().includes('OTHER_SESSION'));assert(!logText().includes(answer.text),'A late history response must not overwrite a different session');
}

async function graphDraftIsConsumedPerQuestion(){
 let updateDraft;const consumed=[],serverHistory=[],completed=new Set();
 setup((path,init)=>{
  if(path.startsWith('active?'))return null;
  if(path.startsWith('history?'))return [...serverHistory];
  if(path==='chat'){const body=JSON.parse(init.body);serverHistory.push({role:'user',text:body.message});return {id:'graph-run-'+chatPayloads.length,state:'running'}}
  if(/^runs\/graph-run-\d+$/.test(path)){if(!completed.has(path)){completed.add(path);serverHistory.push({role:'assistant',text:'Actual fixture answer '+completed.size})}return {id:path.slice(5),state:'done',backend:'api'}}
 });
 function Host(){const [draft,setDraft]=useState(null);updateDraft=setDraft;return <Workbench draft={draft} onDraftConsumed={id=>{consumed.push(id);setDraft(current=>current?.id===id?null:current)}}/>}
 await mount(Host);
 const draft=createKnowledgeDraft([{id:'munk_profile',label:'Munk 理想剖面'},{id:'sound_speed_profile',label:'声速剖面 SSP'}]);
 await act(async()=>updateDraft(draft));
 assert.equal(selectedContext().length,1,'GraphSelection must actually render the injected draft');
 await act(async()=>renderer.root.findByProps({'aria-label':'移除知识点 声速剖面 SSP'}).props.onClick());
 await send();
 assert.deepEqual(chatPayloads[0].knowledge_node_ids,['munk_profile'],'Send canonical IDs from the actual edited GraphSelection');
 assert(!Object.hasOwn(chatPayloads[0],'knowledge_nodes'),'Client card text is not sent as trusted evidence');
 assert(consumed.includes(draft.id),'Accepted send must notify onDraftConsumed with the real draft ID');
 assert.equal(selectedContext().length,0,'The accepted question must consume its GraphSelection');
 await enter('A fresh follow-up without selected graph nodes');await send();
 assert.equal(chatPayloads.length,2);assert.equal(chatPayloads[1].knowledge_node_ids,undefined,'A later question must not inherit graph selection implicitly');
}

async function rejectedGraphSendRetainsDraft(){
 const consumed=[];let updateDraft;
 setup(path=>{if(path.startsWith('active?'))return null;if(path.startsWith('history?'))return [];if(path==='chat')throw Error('fixture send rejected')});
 function Host(){const [draft,setDraft]=useState(null);updateDraft=setDraft;return <Workbench draft={draft} onDraftConsumed={id=>consumed.push(id)}/>}
 await mount(Host);const draft=createKnowledgeDraft([{id:'munk_profile',label:'Munk 理想剖面'}]);
 await act(async()=>updateDraft(draft));await send();
 assert(!consumed.includes(draft.id),'A rejected send must not consume the draft');assert.equal(selectedContext().length,1,'Keep the selected context for an explicit retry');
}

async function main(){
 let failures=0;
 const cases=[...['done','stopped','failed'].map(state=>['delayed '+state+' history',()=>delayedCompletion(state)]),
  ['final-history retry never advances another step',retryHistory],['initial completion snapshot',initialSnapshot],
  ['session switch ignores late history',switchSessionDuringLoad],['graph draft sends IDs then clears for follow-up',graphDraftIsConsumedPerQuestion],
  ['rejected graph send retains draft',rejectedGraphSendRetainsDraft]];
 try{for(const [name,scenario] of cases){try{await scenario();console.log('PASS ['+variant+']: '+name)}catch(error){failures++;console.error('FAIL ['+variant+']: '+name+'\n'+error.stack)}finally{try{await cleanup()}catch(error){failures++;console.error(error.stack)}}}}
 finally{global.fetch=original.fetch;global.setInterval=original.setInterval;global.clearInterval=original.clearInterval}
 return failures;
}
main().then(failures=>process.exit(failures?1:0),error=>{console.error(error);process.exit(1)});
