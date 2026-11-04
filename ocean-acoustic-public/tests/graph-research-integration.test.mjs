import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {setup,decrypt} from './test-support.mjs';

const graph=JSON.parse(readFileSync(new URL('../data/graph.json',import.meta.url),'utf8'));
const assets=JSON.parse(readFileSync(new URL('../data/research-assets.json',import.meta.url),'utf8'));
const cfg={provider:'DeepSeek',base_url:'https://api.deepseek.com',model:'deepseek-flash',api_key:'TEST-GRAPH-INTEGRATION-KEY'};
const call=(name,args={})=>({id:'call-'+name,type:'function',function:{name,arguments:JSON.stringify(args)}});
const response=(calls=[])=>Response.json({model:'graph-fixture-model',choices:[{finish_reason:calls.length?'tool_calls':'stop',message:{content:calls.length?'正在读取图谱':'已读取真实图谱。',...(calls.length?{tool_calls:calls,reasoning_content:'Private provider continuity'}:{})}}]});
const body=(extra={})=>({session:'graph-session-0001',request_id:'graph-request-0001',message:'请解释我所选的知识点及连接',backend:'api',rounds:20,context_budget:'unlimited',...extra});
function fixture(replies=[]){
 const requests=[],s=setup(async(_url,init)=>{requests.push(JSON.parse(init.body));assert(replies.length,'Unexpected model call');return response(replies.shift())},{researchAssets:assets});
 return {...s,requests};
}
async function visitor(s,key=true){const a=await s.call('/api/config');if(key)assert.equal((await s.call('/api/config','PUT',cfg,a.cookie)).r.status,200);return a.cookie}
const step=(s,cookie,id)=>s.call('/api/research/runs/'+id+'/step','POST',{},cookie);
async function saved(s,id){const row=s.sqlite.prepare('SELECT ciphertext FROM cloud_research_runs WHERE id=?').get(id);return decrypt(row.ciphertext,s.env.GATEWAY_SECRET)}

test('all five graph tools really dispatch and selected cards use only canonical source claim ids',async()=>{
 const edge=graph.edges.find(edge=>edge.group==='related'&&[edge.source,edge.target].every(id=>graph.nodes.find(node=>node.id===id)?.kind==='knowledge'));
 const tools=[call('search_graph_nodes',{query:'Munk',limit:1}),call('read_graph_node',{id:'munk_profile'}),call('read_graph_relations',{node_id:edge.source,groups:['related'],direction:'outgoing',limit:1}),call('find_graph_path',{source:edge.target,target:edge.source,groups:['related'],direction:'both'}),call('select_graph_nodes',{node_ids:[edge.source,edge.target]})];
 const s=fixture([tools,[]]);
 try{
  const cookie=await visitor(s),start=await s.call('/api/research/chat','POST',body({knowledge_node_ids:['munk_profile','sound_speed_profile']}),cookie);
  assert.equal(start.r.status,202,JSON.stringify(start.data));
  const initial=await saved(s,start.data.id),system=initial.messages[0].content;
  for(const id of initial.knowledge_node_ids){const node=graph.nodes.find(node=>node.id===id);assert(system.includes(node.source_claim_ids[0]));assert(system.includes(node.overview))}
  assert.match(system,/物理因果或证明须有相应证据/);
  assert.equal((await step(s,cookie,start.data.id)).data.state,'running');
  assert(tools.every(tool=>s.requests[0].tools.some(spec=>spec.function.name===tool.function.name)));
  const current=await saved(s,start.data.id),results=current.messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
  assert.equal(results.length,5);assert.equal(results[0].items.length,1);assert.equal(results[1].id,'munk_profile');
  assert.equal(results[2].direction,'outgoing');assert.equal(results[3].found,true);assert(results[3].edges[0].traversed_reverse);
  assert.deepEqual(current.knowledge_node_ids,['munk_profile','sound_speed_profile']);
  assert.deepEqual(current.graph_selection.node_ids,[edge.source,edge.target]);
  assert.equal(current.graph_selection.selection_scope,'current_run');
  for(const evidence of results[4].evidence){assert(graph.nodes.find(node=>node.id===evidence.node_id).source_claim_ids.includes(evidence.id));assert.equal(evidence.citation.claim_support_verified,false)}
  assert.equal((await step(s,cookie,start.data.id)).data.state,'done');
 }finally{s.sqlite.close()}
});

test('invalid selections are rejected before any paid call and selection changes conflict with idempotency',async()=>{
 const s=fixture();
 try{
  const cookie=await visitor(s);
  for(const [ids,status] of [[null,422],[['missing-node'],404],[['course'],422],[Array(9).fill('munk_profile'),422],[[1],422]]){
   const result=await s.call('/api/research/chat','POST',body({knowledge_node_ids:ids}),cookie);assert.equal(result.r.status,status,JSON.stringify(result.data));
  }
  assert.equal(s.requests.length,0);assert.equal(s.sqlite.prepare('SELECT COUNT(*) n FROM cloud_research_runs').get().n,0);
  const first=await s.call('/api/research/chat','POST',body({knowledge_node_ids:['munk_profile','munk_profile']}),cookie);assert.equal(first.r.status,202);
  const replay=await s.call('/api/research/chat','POST',body({knowledge_node_ids:['munk_profile']}),cookie);assert.equal(replay.data.id,first.data.id);assert.equal(replay.data.reused,true);
  assert.equal((await s.call('/api/research/chat','POST',body({knowledge_node_ids:['sound_speed_profile']}),cookie)).r.status,409);
  assert.equal((await s.call('/api/research/chat','POST',body({knowledge_node_ids:[]}),cookie)).r.status,409);
 }finally{s.sqlite.close()}
});

test('selection clear and new sessions or visitors never inherit another run selection',async()=>{
 const s=fixture([[],[],[]]);
 try{
  const a=await visitor(s),b=await visitor(s);
  const first=await s.call('/api/research/chat','POST',body({knowledge_node_ids:['munk_profile']}),a);await step(s,a,first.data.id);
  const foreign=await s.call('/api/research/runs/'+first.data.id,'GET',undefined,b);assert.equal(foreign.r.status,404);
  const cleared=await s.call('/api/research/chat','POST',body({request_id:'graph-request-clear',knowledge_node_ids:[]}),a);await step(s,a,cleared.data.id);
  const sameSession=await saved(s,cleared.data.id);assert.deepEqual(sameSession.knowledge_node_ids,[]);assert.deepEqual(sameSession.graph_selection.node_ids,[]);
  assert.match(s.requests[1].messages[0].content,/EXPLICIT-GRAPH-SELECTION[^\n]*"node_ids":\[\]/);
  const second=await s.call('/api/research/chat','POST',body({session:'graph-session-other',request_id:'graph-request-other'}),b);await step(s,b,second.data.id);
  assert.deepEqual((await saved(s,second.data.id)).graph_selection.node_ids,[]);
  assert(!s.requests[2].messages[0].content.includes('explicit_graph_selection'));
 }finally{s.sqlite.close()}
});

test('ordinary chat binds canonical selected context into its request fingerprint and clears it next call',async()=>{
 const s=fixture([[],[]]);
 try{
  const cookie=await visitor(s),requestKey='ordinary-graph-key';
  async function chat(ids){const url=new URL('https://course.test/api/chat');const r=await s.handler(new Request(url,{method:'POST',headers:{origin:url.origin,cookie,'content-type':'application/json','idempotency-key':requestKey},body:JSON.stringify({message:'解释所选知识点',knowledge_node_ids:ids})}),s.env,s.ctx,url);return {r,data:await r.json()}}
  const first=await chat(['munk_profile']);assert.equal(first.r.status,200);assert.deepEqual(first.data.knowledge_node_ids,['munk_profile']);
  assert(first.data.evidence.some(row=>row.node_id==='munk_profile'&&row.retrieval.role==='explicit_graph_selection'));
  assert.equal((await chat(['sound_speed_profile'])).r.status,409);assert.equal(s.requests.length,1);
  const other=await s.call('/api/conversations','POST',{title:'另一会话'},cookie);
  const cleared=await s.call('/api/chat','POST',{message:'Munk 声速剖面',conversation_id:other.data.id,knowledge_node_ids:[]},cookie);
  assert.equal(cleared.r.status,200);assert.deepEqual(cleared.data.graph_selection.node_ids,[]);
  assert.match(s.requests[1].messages[0].content,/EXPLICIT-GRAPH-SELECTION[^\n]*"node_ids":\[\]/);
 }finally{s.sqlite.close()}
});

test('research code document tools really save and read a draft without creating a run result',async()=>{
 const source={title:'声速计算示例',language:'python',code:'print(1500)\n',input_csv:'depth,speed\n0,1500'};
 const s=fixture([[call('write_code_artifact',source)],[]]);
 try{
  const cookie=await visitor(s),first=await s.call('/api/research/chat','POST',body(),cookie);await step(s,cookie,first.data.id);
  const data=await saved(s,first.data.id),result=JSON.parse(data.messages.find(message=>message.role==='tool').content);
  assert.equal(result.executed,false);assert.match(result.workspace_url,/^\/#code\//);
  const value=await s.call('/api/research/code/artifacts/'+result.id,'GET',undefined,cookie);assert.equal(value.data.code,source.code);assert.equal(value.data.result,null);
  const foreign=await visitor(s,false);assert.equal((await s.call('/api/research/code/artifacts/'+result.id,'GET',undefined,foreign)).r.status,404);
 }finally{s.sqlite.close()}
});
