import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './test-support.mjs';
import {resolveVisitorIdentity} from '../server/identity.mjs';

async function signed(s,user,path,method='GET',body,cookie=''){
 const url=new URL(path,'https://course.test'),headers={origin:url.origin,'content-type':'application/json','oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test',cookie};
 const response=await s.handler(new Request(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),s.env,s.ctx,url);
 return {response,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]||cookie};
}
test('a platform account has the same conversations on another device and another account cannot read them',async()=>{
 const s=setup();try{
  const first=await signed(s,'student-a','/api/account');assert.equal(first.data.authenticated,true);assert(!JSON.stringify(first.data).includes('@example.test'));
  await signed(s,'student-a','/api/chat','POST',{message:'Munk 声速剖面'},first.cookie);
  const secondDevice=await signed(s,'student-a','/api/chat/history');assert.equal(secondDevice.data.length,2);
  const different=await signed(s,'student-b','/api/chat/history','GET',undefined,first.cookie);assert.deepEqual(different.data,[]);
 }finally{s.sqlite.close()}
});
test('signing in never automatically copies an anonymous visitor API key into an account',async()=>{
 const s=setup();try{
  const anon=await s.call('/api/config');await s.call('/api/config','PUT',{api_key:'TEST-ONLY-ANONYMOUS'},anon.cookie);
  const account=await signed(s,'new-account','/api/config','GET',undefined,anon.cookie);assert.equal(account.data.api_key_set,false);
  assert.equal((await s.call('/api/config','GET',undefined,anon.cookie)).data.api_key_set,true);
 }finally{s.sqlite.close()}
});
test('public account IDs and application JSON cannot act as signed-in credentials',async()=>{
 const s=setup();try{
  const identity=await resolveVisitorIdentity(new Request('https://course.test',{headers:{'oai-authenticated-user-id':'a','oai-authenticated-user-email':'a@example.test'}}),s.env);
  assert(identity.id.startsWith('account:'));assert.match(identity.node_id,/^[a-f0-9]{64}$/);assert.notEqual(identity.id,identity.node_id);
  const anon=await s.call('/api/account','GET',undefined,'ocean_visitor='+identity.id);assert.equal(anon.data.authenticated,false);
  const missingEmail=await s.handler(new Request('https://course.test/api/account',{headers:{'oai-authenticated-user-id':'a'}}),s.env,s.ctx,new URL('https://course.test/api/account'));assert.equal((await missingEmail.json()).authenticated,false);
 }finally{s.sqlite.close()}
});
