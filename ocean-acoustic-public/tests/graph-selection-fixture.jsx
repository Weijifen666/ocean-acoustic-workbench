import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import GraphSelection from '../src/GraphSelection';
import {toggleKnowledgeSelection,createKnowledgeDraft,knowledgeRequestIds} from '../src/knowledgeSelection';
import {startResearchRun} from '../src/DialogueWorkbench';

async function verify(){
const munk={id:'munk_profile',label:'Munk 理想剖面'},ssp={id:'sound_speed_profile',label:'声速剖面 SSP'};
let selected=toggleKnowledgeSelection([],munk);
selected=toggleKnowledgeSelection(selected,ssp);
const draft=createKnowledgeDraft(selected);
assert.deepEqual(knowledgeRequestIds(draft.knowledge_nodes),['munk_profile','sound_speed_profile']);
assert.match(draft.text,/关联路径不等于物理因果/);
const markup=renderToStaticMarkup(<GraphSelection nodes={selected} onRemove={()=>{}} onClear={()=>{}}/>);
assert.match(markup,/本次问题的图谱上下文/);assert.match(markup,/移除知识点 Munk 理想剖面/);assert.match(markup,/清除选取/);
assert.equal(renderToStaticMarkup(<GraphSelection nodes={[]}/>),'');
const payloads=[];
globalThis.fetch=async(url,options)=>{payloads.push(JSON.parse(options.body));return Response.json({id:'test-only-graph-request'});};
await startResearchRun({session:'session-a',request_id:'request-a',message:draft.text,rounds:0,contextBudget:'unlimited',knowledgeNodes:selected},{max_rounds:1000,context_budgets:['unlimited']});
assert.deepEqual(payloads[0].knowledge_node_ids,['munk_profile','sound_speed_profile']);
assert.equal(JSON.stringify(payloads[0]).includes('knowledge_nodes'),false,'Client node text is not sent as trusted evidence');
selected=toggleKnowledgeSelection(selected,munk);
assert.deepEqual(knowledgeRequestIds(selected),['sound_speed_profile']);
selected=[];
await startResearchRun({session:'session-b',request_id:'request-b',message:'新问题',rounds:0,contextBudget:'unlimited',knowledgeNodes:selected},{max_rounds:1000,context_budgets:['unlimited']});
assert.equal(payloads[1].knowledge_node_ids,undefined,'Cleared/new-session selection does not leak to another request');
assert.throws(()=>createKnowledgeDraft([]));
assert.throws(()=>createKnowledgeDraft(Array.from({length:9},(_,i)=>({id:'n'+i,label:'node'}))));
console.log('Graph selection display, removal, clear and request context passed');
}
verify().catch(error=>{console.error(error);process.exitCode=1});
