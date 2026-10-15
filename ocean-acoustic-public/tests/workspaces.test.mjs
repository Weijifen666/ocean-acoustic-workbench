import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorkspaceApi} from '../server/workspaces.mjs';
import {setup,encrypt,decrypt} from './test-support.mjs';

function fixture(){
 const state=setup(),handler=createWorkspaceApi({encrypt,decrypt});
 // Real D1 batches are serialized transactions; the in-memory adapter's async
 // statements need the same scheduling for explicit concurrent-join checks.
 const original=state.env.DB.batch.bind(state.env.DB);let tail=Promise.resolve();
 state.env.DB.batch=statements=>{const pending=tail.then(()=>original(statements));tail=pending.catch(()=>{});return pending};
 const users=Object.fromEntries(['a','b','c','d'].map(name=>[name,{id:'account:'+name,account:{authenticated:true,id:'account:'+name,display_name:'成员'+name},data:{selected:{api_key:'TEST-ONLY-PRIVATE-MODEL-KEY-'+name}}}]));
 async function call(actor,path,method='GET',body,headers={}){
  const url=new URL(path,'https://course.test'),request=new Request(url,{method,headers:{origin:url.origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const r=await handler(request,state.env,state.ctx,url,typeof actor==='string'?users[actor]:actor);
  return r?{r,data:await r.clone().json()}:null;
 }
 const create=async()=>{const result=await call('a','/api/workspaces','POST',{title:'声源深度对照课题',description:'课程小组研究笔记'});assert.equal(result.r.status,201,JSON.stringify(result.data));return result.data.workspace.id};
 const invite=async id=>{const result=await call('a',`/api/workspaces/${id}/invites`,'POST',{});assert.equal(result.r.status,201,JSON.stringify(result.data));return result.data.invite};
 return {...state,call,create,invite,users};
}

test('only workspace paths are intercepted and trusted platform login is mandatory',async()=>{
 const s=fixture();try{
  assert.equal(await s.call('a','/api/unrelated'),null);
  for(const actor of [undefined,{account:{authenticated:false,id:'account:a'}},{account:{authenticated:true,id:''}}]){
   const result=await s.call(actor,'/api/workspaces');assert.equal(result.r.status,401);assert.equal(result.data.code,'AUTH_REQUIRED');
  }
  const forged=await s.call({account:{authenticated:false}},'/api/workspaces','POST',{title:'forged',account_id:'account:a'},{'oai-authenticated-user-id':'forged-by-client'});assert.equal(forged.r.status,401);
 }finally{s.sqlite.close()}
});
test('four authenticated accounts explicitly join and share notes; nonmembers remain isolated',async()=>{
 const s=fixture();try{
  const id=await s.create();assert.equal((await s.call('d',`/api/workspaces/${id}`)).r.status,404);
  assert.deepEqual((await s.call('b','/api/workspaces')).data.workspaces,[]);
  for(const actor of ['b','c','d']){const invite=await s.invite(id);const joined=await s.call(actor,'/api/workspaces/join','POST',{token:invite.token});assert.equal(joined.r.status,200);assert.equal(joined.data.workspace.role,'member')}
  const saved=await s.call('c',`/api/workspaces/${id}/artifacts`,'POST',{title:'频率对照假设',body:'保持相同网格，先核查归一化和有效样本。',source_url:'https://example.org/course?chapter=2',source_note:'测试来源链接，仅记录，不抓取。'});assert.equal(saved.r.status,201);
  const view=await s.call('d',`/api/workspaces/${id}`);assert.equal(view.data.members.length,4);assert.equal(view.data.artifacts.length,1);assert.equal(view.data.artifacts[0].author_name,'成员c');assert.equal(view.data.artifacts[0].kind,'research_note');
  assert.equal((await s.call('b','/api/workspaces')).data.workspaces[0].artifact_count,1);
  const outsider={account:{authenticated:true,id:'account:outsider',display_name:'外部账户'}};
  assert.equal((await s.call(outsider,`/api/workspaces/${id}`)).r.status,404);assert.equal((await s.call(outsider,`/api/workspaces/${id}/artifacts`,'POST',{title:'x',body:'y'})).r.status,404);
 }finally{s.sqlite.close()}
});
test('an invitation has one use, a 24-hour expiry, and no plaintext in lists or database',async()=>{
 const s=fixture();try{
  const id=await s.create(),invite=await s.invite(id),row=s.sqlite.prepare('SELECT * FROM research_workspace_invites WHERE id=?').get(invite.id);
  assert.equal(row.expires-row.created,86400000);assert.equal(row.token_hash.length,64);assert(!JSON.stringify(row).includes(invite.token));
  assert.equal((await s.call('b','/api/workspaces/join','POST',{token:invite.token})).r.status,200);
  const replay=await s.call('c','/api/workspaces/join','POST',{token:invite.token});assert.equal(replay.r.status,409);
  const view=(await s.call('a',`/api/workspaces/${id}`)).data;assert.equal(view.members.length,2);assert(!JSON.stringify(view).includes(invite.token));assert.equal(view.invites[0].used,true);
  const memberView=(await s.call('b',`/api/workspaces/${id}`)).data;assert.equal(memberView.invites,undefined);
 }finally{s.sqlite.close()}
});
test('concurrent accounts cannot both consume the same invitation',async()=>{
 const s=fixture();try{
  const id=await s.create(),invite=await s.invite(id);
  const results=await Promise.all(['b','c'].map(actor=>s.call(actor,'/api/workspaces/join','POST',{token:invite.token})));
  assert.deepEqual(results.map(item=>item.r.status).sort(),[200,409]);assert.equal((await s.call('a',`/api/workspaces/${id}`)).data.members.length,2);
 }finally{s.sqlite.close()}
});
test('expired and revoked invitations cannot create membership',async()=>{
 const s=fixture();try{
  const id=await s.create(),expired=await s.invite(id);s.sqlite.prepare('UPDATE research_workspace_invites SET expires=? WHERE id=?').run(Date.now()-1,expired.id);
  assert.equal((await s.call('b','/api/workspaces/join','POST',{token:expired.token})).r.status,409);
  const revoked=await s.invite(id);assert.equal((await s.call('a',`/api/workspaces/${id}/invites/${revoked.id}`,'DELETE')).r.status,200);
  assert.equal((await s.call('b','/api/workspaces/join','POST',{token:revoked.token})).r.status,409);assert.equal((await s.call('a',`/api/workspaces/${id}`)).data.members.length,1);
 }finally{s.sqlite.close()}
});
test('members cannot manage invitations or impersonate authors and owners',async()=>{
 const s=fixture();try{
  const id=await s.create(),invite=await s.invite(id);await s.call('b','/api/workspaces/join','POST',{token:invite.token});
  assert.equal((await s.call('b',`/api/workspaces/${id}/invites`,'POST',{})).r.status,403);
  assert.equal((await s.call('b',`/api/workspaces/${id}/invites/${invite.id}`,'DELETE')).r.status,403);
  assert.equal((await s.call('b',`/api/workspaces/${id}/artifacts`,'POST',{title:'x',body:'y',author_id:'account:a'})).r.status,422);
  assert.equal((await s.call('a','/api/workspaces','POST',{title:'x',owner_id:'account:b'})).r.status,422);
 }finally{s.sqlite.close()}
});
test('workspace, member names and note content are encrypted and profiles never enter shared data',async()=>{
 const s=fixture();try{
  const id=await s.create();Object.defineProperty(s.users.a,'data',{get(){throw Error('Private model profile must not be read')}});
  const note=await s.call('a',`/api/workspaces/${id}/artifacts`,'POST',{title:'私有研究标题',body:'  保留笔记缩进\n仅合成测试文本  '});assert.equal(note.r.status,201);
  const rows=['research_workspaces','research_workspace_members','research_workspace_artifacts'].flatMap(table=>s.sqlite.prepare(`SELECT * FROM ${table}`).all()),dump=JSON.stringify(rows);
  for(const text of ['声源深度对照课题','课程小组研究笔记','私有研究标题','仅合成测试文本','成员a','TEST-ONLY-PRIVATE-MODEL-KEY'])assert(!dump.includes(text));
  const row=s.sqlite.prepare('SELECT ciphertext FROM research_workspace_artifacts WHERE workspace_id=?').get(id),value=await decrypt(row.ciphertext,s.env.GATEWAY_SECRET);
  assert.equal(value.body,'  保留笔记缩进\n仅合成测试文本  ');assert.equal(value.api_key,undefined);assert.equal(value.selected,undefined);
  assert(!JSON.stringify((await s.call('a',`/api/workspaces/${id}`)).data).includes('TEST-ONLY-PRIVATE-MODEL-KEY'));
 }finally{s.sqlite.close()}
});
test('only explicit notes and HTTP(S) source records are accepted; URLs are never fetched',async t=>{
 const s=fixture();t.mock.method(globalThis,'fetch',()=>{throw Error('External fetch forbidden')});try{
  const id=await s.create(),path=`/api/workspaces/${id}/artifacts`;
  assert.equal((await s.call('a',path,'POST',{title:'source',body:'No external request',source_url:'http://example.org/source'})).r.status,201);
  for(const url of ['javascript:alert(1)','data:text/plain,hello','file:///private','https://user:secret@example.org','https://example.org/?api_key=secret'])assert.equal((await s.call('a',path,'POST',{title:'bad',body:'note',source_url:url})).r.status,422,url);
  for(const extra of [{api_key:'TEST-ONLY-KEY'},{attachment:'base64-not-a-shared-document'},{model_config:{api_key:'TEST-ONLY-KEY'}}])assert.equal((await s.call('a',path,'POST',{title:'bad',body:'note',...extra})).r.status,422);
  assert.equal((await s.call('a',path,'POST',{title:'bad',body:'api_key=sk-123456789012345678901234567890'})).r.status,422);
  assert.equal((await s.call('a',`/api/workspaces/${id}`)).data.artifacts.length,1);
 }finally{s.sqlite.close()}
});
test('body limits, route methods and cross-origin writes fail without partial records',async()=>{
 const s=fixture();try{
  const id=await s.create(),path=`/api/workspaces/${id}/artifacts`;
  assert.equal((await s.call('a',path,'POST',{title:'20k limit',body:'海'.repeat(20000)})).r.status,201);
  assert.equal((await s.call('a',path,'POST',{title:'too long',body:'x'.repeat(20001)})).r.status,422);
  assert.equal((await s.call('a',path,'POST',{title:'wrong origin',body:'note'},{origin:'https://attacker.test'})).r.status,403);
  assert.equal((await s.call('a','/api/workspaces','DELETE')).r.status,405);assert.equal((await s.call('a','/api/workspaces/not-a-real-id')).r.status,404);
  assert.equal((await s.call('a',path,'POST',{title:'oversized transport',body:'x'.repeat(140000)})).r.status,413);
  assert.equal((await s.call('a',`/api/workspaces/${id}`)).data.artifacts.length,1);
 }finally{s.sqlite.close()}
});
test('unexpected encryption failures do not echo secrets in API errors',async()=>{
 const s=fixture();try{
  const bad=createWorkspaceApi({encrypt:async()=>{throw Error('Authorization Bearer TEST-ONLY-SECRET')},decrypt}),url=new URL('https://course.test/api/workspaces');
  const r=await bad(new Request(url,{method:'POST',headers:{origin:url.origin},body:JSON.stringify({title:'test'})}),s.env,s.ctx,url,s.users.a),value=await r.json();
  assert.equal(r.status,503);assert(!JSON.stringify(value).includes('TEST-ONLY-SECRET'));assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM research_workspaces').get().n,0);
 }finally{s.sqlite.close()}
});
