import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createGraphTools,GRAPH_TOOL_SPECS,executeGraphTool} from '../server/graph-tools.mjs';

const graph=JSON.parse(fs.readFileSync(new URL('../data/graph.json',import.meta.url),'utf8'));
const toy={chapters:[{id:'unit'}],nodes:['a','b','c','d'].map(id=>({id,label:id,kind:'knowledge',chapter:'unit',overview:'example',references:[]})),edges:[
 {id:'e1',source:'a',target:'b',group:'prerequisite',label:'先学'},
 {id:'e2',source:'b',target:'c',group:'related',label:'关联'},
]};

test('real graph search and pagination cover all 69 knowledge nodes without mutation',()=>{
 const api=createGraphTools(graph),ids=[];let offset=0;
 do{const page=api.listNodes({offset,limit:13});ids.push(...page.items.map(n=>n.id));offset=page.next_offset;}while(offset!==null);
 assert.equal(ids.length,69);assert.equal(new Set(ids).size,69);
 assert.equal(api.listNodes({query:'Munk 理想剖面'}).items[0].id,'munk_profile');
 assert.equal(api.listNodes({query:'normal modes'}).items[0].id,'normal_mode_field');
 assert(api.listNodes({chapter:'environment'}).items.every(n=>n.chapter==='environment'));
 const row=api.readNode('munk_profile');assert(row.references.length);row.label='changed';
 assert.notEqual(api.readNode('munk_profile').label,'changed');
 assert.throws(()=>api.listNodes({offset:-1}),e=>e.status===422);
 assert.throws(()=>api.listNodes({chapter:'../../secret'}),e=>e.status===404);
});

test('typed graph paths preserve original direction and mark reverse traversal',()=>{
 const api=createGraphTools(toy);
 assert.equal(api.findPath({source:'a',target:'c'}).found,false);
 const forward=api.findPath({source:'a',target:'c',groups:['prerequisite','related'],direction:'outgoing'});
 assert.equal(forward.found,true);assert.deepEqual(forward.nodes.map(n=>n.id),['a','b','c']);
 assert(forward.edges.every(e=>!e.traversed_reverse));
 assert.equal(api.findPath({source:'c',target:'a',groups:['prerequisite','related'],direction:'outgoing'}).found,false);
 const reverse=api.findPath({source:'c',target:'a',groups:['prerequisite','related']});
 assert(reverse.edges.every(e=>e.traversed_reverse));assert.match(reverse.relation_note,/不等于物理因果/);
 assert.equal(api.findPath({source:'a',target:'c',groups:['prerequisite','related'],max_depth:1}).found,false);
 assert.equal(api.findPath({source:'a',target:'a'}).edges.length,0);
 assert.equal(api.readRelations({node_id:'b',groups:['prerequisite'],direction:'incoming'}).items[0].id,'e1');
 assert.throws(()=>api.findPath({source:'a',target:'unknown'}),e=>e.status===404);
 assert.throws(()=>api.findPath({source:'a',target:'c',groups:['causes']}),e=>e.status===422);
});

test('explicit selection is validated and never retained between callers',()=>{
 const api=createGraphTools(graph),selected=api.selection(['munk_profile','sound_speed_profile','munk_profile']);
 assert.deepEqual(selected.node_ids,['munk_profile','sound_speed_profile']);
 assert.equal(selected.selection_scope,'current_request');assert.equal(selected.read_only,true);
 selected.nodes[0].overview='forged';selected.node_ids.push('forged');
 assert.deepEqual(api.selection().node_ids,[]);
 assert.notEqual(api.selection(['munk_profile']).nodes[0].overview,'forged');
 assert.deepEqual(createGraphTools(graph).selection().nodes,[]);
 assert.throws(()=>api.selection(['course']),e=>e.status===422);
 assert.throws(()=>api.selection(['not-existing']),e=>e.status===404);
 assert.throws(()=>api.selection(Array(9).fill('munk_profile')),e=>e.status===422);
 assert.equal(executeGraphTool(api,'read_graph_node',{id:'munk_profile'}).id,'munk_profile');
 assert.equal(new Set(GRAPH_TOOL_SPECS.map(t=>t.function.name)).size,5);
});
