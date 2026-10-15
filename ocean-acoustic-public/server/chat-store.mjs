// Indexed conversation/message rows; all user text stays encrypted with AES-GCM.
// No schema mutation here: tables are managed by append-only D1 migrations.
const encoder=new TextEncoder();
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const problem=(detail,status=422,code='CHAT_STATE')=>Object.assign(new Error(detail),{status,code});
export function createChatStore(env,encrypt,decrypt){
 const one=(sql,...args)=>env.DB.prepare(sql).bind(...args).first();
 const run=(sql,...args)=>env.DB.prepare(sql).bind(...args).run();
 const all=async(sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results||[];
 const secret=env.GATEWAY_SECRET;
 async function owned(visitor,id){
  const row=await one('SELECT * FROM cloud_conversations WHERE id=? AND visitor_id=?',id,visitor);
  if(!row)throw problem('对话不存在或不属于当前访客',404,'CONVERSATION_NOT_FOUND');
  return row;
 }
 async function ensure(visitor,legacy=[]){
  const id='legacy_'+(await hash('conversation:'+visitor)).slice(0,32),now=Date.now();
  await run('INSERT INTO cloud_conversations(id,visitor_id,ciphertext,created,updated,migrated) VALUES(?,?,?,?,?,0) ON CONFLICT(id) DO NOTHING',id,visitor,await encrypt({title:legacy.length?'历史对话':'新对话'},secret),now,now);
  const row=await owned(visitor,id);
  if(!row.migrated){
   // Idempotent lazy migration: a failure leaves the legacy blob intact.
   const statements=[];
   for(let i=0;i<legacy.length;i++)statements.push(env.DB.prepare('INSERT INTO cloud_messages(id,visitor_id,conversation_id,run_id,ordinal,ciphertext,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id+':legacy:'+i,visitor,id,id+':legacy',i,await encrypt(legacy[i],secret),now));
   statements.push(env.DB.prepare('UPDATE cloud_conversations SET migrated=1 WHERE id=? AND visitor_id=?').bind(id,visitor));
   await env.DB.batch(statements);
  }
  return id;
 }
 async function list(visitor){
  const rows=await all('SELECT c.*,(SELECT COUNT(*) FROM cloud_messages m WHERE m.visitor_id=c.visitor_id AND m.conversation_id=c.id) AS message_count FROM cloud_conversations c WHERE visitor_id=? ORDER BY updated DESC LIMIT 100',visitor);
  return Promise.all(rows.map(async r=>({id:r.id,...await decrypt(r.ciphertext,secret),created_at:r.created,updated_at:r.updated,message_count:r.message_count})));
 }
 async function create(visitor,title='新对话'){
  if(typeof title!=='string'||!title.trim()||title.length>80)throw problem('对话标题须为1–80字符');
  const count=await one('SELECT COUNT(*) AS n FROM cloud_conversations WHERE visitor_id=?',visitor);
  if(count.n>=100)throw problem('当前访客最多保留100个对话，请使用已有课题',422,'CONVERSATION_LIMIT');
  const id=crypto.randomUUID(),now=Date.now();
  await run('INSERT INTO cloud_conversations(id,visitor_id,ciphertext,created,updated,migrated) VALUES(?,?,?,?,?,1)',id,visitor,await encrypt({title:title.trim()},secret),now,now);
  return {id,title:title.trim(),created_at:now,updated_at:now,message_count:0};
 }
 async function history(visitor,id,limit=200){
  await owned(visitor,id);
  const rows=await all('SELECT ciphertext FROM (SELECT * FROM cloud_messages WHERE visitor_id=? AND conversation_id=? ORDER BY created DESC,run_id DESC,ordinal DESC LIMIT ?) ORDER BY created,run_id,ordinal',visitor,id,limit);
  return Promise.all(rows.map(r=>decrypt(r.ciphertext,secret)));
 }
 async function begin(visitor,conversation,key,payload,exclusive=true){
  await owned(visitor,conversation);
  if(typeof key!=='string'||!key||key.length>128||!/^[A-Za-z0-9:_-]+$/.test(key))throw problem('请求标识不合法');
  const fingerprint=await hash(JSON.stringify(payload)),now=Date.now();
  const prior=await one('SELECT * FROM cloud_chat_runs WHERE visitor_id=? AND request_key=?',visitor,key);
  if(prior){
   if(prior.payload_hash!==fingerprint||prior.conversation_id!==conversation)throw problem('同一请求标识不能用于不同问题或对话',409,'IDEMPOTENCY_CONFLICT');
   if(prior.state==='done')return {replay:await decrypt(prior.ciphertext,secret)};
   if(prior.state==='running'&&now-prior.updated<180000)throw problem('这条请求仍在处理中，请稍后读取对话',409,'REQUEST_RUNNING');
   // Failed or cancelled requests are not silently charged again on retry.
   throw problem('上次请求已结束；重新发送将创建一次新请求',409,'REQUEST_ENDED');
  }
  await run("UPDATE cloud_chat_runs SET state='interrupted',updated=? WHERE visitor_id=? AND conversation_id=? AND state='running' AND updated<?",now,visitor,conversation,now-180000);
  const id=crypto.randomUUID();
  // One insert atomically checks the conversation's active-run lease.
  await run("INSERT INTO cloud_chat_runs(id,visitor_id,conversation_id,request_key,payload_hash,state,created,updated) SELECT ?,?,?,?,?,'running',?,? WHERE (?=0 OR NOT EXISTS(SELECT 1 FROM cloud_chat_runs WHERE visitor_id=? AND conversation_id=? AND state='running')) ON CONFLICT(visitor_id,request_key) DO NOTHING",id,visitor,conversation,key,fingerprint,now,now,exclusive?1:0,visitor,conversation);
  const inserted=await one('SELECT * FROM cloud_chat_runs WHERE id=? AND visitor_id=?',id,visitor);
  if(!inserted)throw problem('当前对话已有请求正在处理，请稍后重试',409,'CONVERSATION_BUSY');
  return {id,visitor,conversation,created:now};
 }
 async function finish(token,question,answer){
  const now=Date.now(),messages=[{role:'user',text:question},{role:'assistant',text:answer.reply,...Object.fromEntries(Object.entries(answer).filter(([k])=>k!=='reply'))}];
  const statements=[];
  for(let i=0;i<2;i++)statements.push(env.DB.prepare("INSERT INTO cloud_messages(id,visitor_id,conversation_id,run_id,ordinal,ciphertext,created) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cloud_chat_runs WHERE id=? AND visitor_id=? AND state='running') ON CONFLICT(id) DO NOTHING").bind(token.id+':'+i,token.visitor,token.conversation,token.id,i,await encrypt(messages[i],secret),token.created,token.id,token.visitor));
  statements.push(env.DB.prepare("UPDATE cloud_chat_runs SET state='done',ciphertext=?,updated=? WHERE id=? AND visitor_id=? AND state='running'").bind(await encrypt(answer,secret),now,token.id,token.visitor));
  statements.push(env.DB.prepare("UPDATE cloud_conversations SET updated=? WHERE id=? AND visitor_id=? AND EXISTS(SELECT 1 FROM cloud_chat_runs WHERE id=? AND state='done')").bind(now,token.conversation,token.visitor,token.id));
  // D1 batch is transactional: never expose half of a completed exchange.
  const results=await env.DB.batch(statements);
  if(!(results[2]?.meta?.changes??results[2]?.changes))throw problem('请求已停止，未保存为完成回答',409,'CANCELLED');
 }
 async function abandon(token,state='failed'){
  if(token?.id)await run("UPDATE cloud_chat_runs SET state=?,updated=? WHERE id=? AND visitor_id=? AND state='running'",state,Date.now(),token.id,token.visitor);
 }
 return {ensure,owned,list,create,history,begin,finish,abandon};
}
