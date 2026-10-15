// Trusted platform identity enters through session.account, never request JSON.
// Explicitly submitted notes and links only: no profile/key/attachment copying.
const encoder=new TextEncoder();
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const fault=(detail,status=422,code='WORKSPACE_INPUT')=>Object.assign(new Error(detail),{status,code,workspaceProblem:true});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const token=()=> 'ws_'+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const noKeys=value=>{
 if(/\bsk-[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9_.-]{12,}\b|\b(?:api[_ -]?key|access_token|api_token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_.-]{16,}/i.test(value))throw fault('研究笔记不接受模型密钥或登录令牌，请移除敏感配置。');
 return value;
};
function text(value,label,maximum,{optional=false,trim=true}={}){
 if(value===undefined&&optional)return '';
 if(typeof value!=='string'||value.length>maximum||(!optional&&!value.trim())||value.includes('\0'))throw fault(`${label}须为${optional?'0':'1'}–${maximum}字符文本。`);
 return noKeys(trim?value.trim():value);
}
function sourceUrl(value){
 const raw=text(value,'来源链接',2048,{optional:true});if(!raw)return null;
 let url;try{url=new URL(raw)}catch{throw fault('来源链接须为完整 HTTP 或 HTTPS 地址。')}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fault('来源链接仅接受不含登录信息的 HTTP/HTTPS 地址。');
 if([...url.searchParams.keys()].some(key=>/^(?:api[_-]?key|key|access[_-]?token|token|secret|password|authorization)$/i.test(key)))throw fault('来源链接不能包含密钥或访问令牌参数。');
 return url.toString();
}
async function body(request,allowed){
 if(Number(request.headers.get('content-length')||0)>131072)throw fault('请求正文过长。',413);
 let size=0,raw='';const reader=request.body?.getReader(),decoder=new TextDecoder();
 if(reader){try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>131072){await reader.cancel();throw fault('请求正文过长。',413)}raw+=decoder.decode(chunk.value,{stream:true})}raw+=decoder.decode()}finally{reader.releaseLock()}}
 let value;try{value=raw.trim()?JSON.parse(raw):{}}catch{throw fault('请求须为有效 JSON 对象。')}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw fault('请求包含不支持的字段；只接收课题或笔记内容，不接收模型配置与附件。');
 return value;
}

export function createWorkspaceApi({encrypt,decrypt}){
 return async function workspaceApi(request,env,ctx,url,session){
  const path=url.pathname;if(path!=='/api/workspaces'&&!path.startsWith('/api/workspaces/'))return null;
  try{
   const account=session?.account;
   if(account?.authenticated!==true||typeof account.id!=='string'||!account.id||account.id.length>160)throw fault('请先通过平台登录，再创建或加入小组课题。',401,'AUTH_REQUIRED');
   if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==url.origin)throw fault('请求来源不匹配。',403,'INVALID_ORIGIN');
   if(!env.DB||!env.GATEWAY_SECRET)throw fault('共享课题存储尚未配置。',503,'WORKSPACE_UNAVAILABLE');
   const actor=account.id,name=typeof account.display_name==='string'?account.display_name.slice(0,80):'小组成员',secret=env.GATEWAY_SECRET;
   const one=(sql,...args)=>env.DB.prepare(sql).bind(...args).first();
   const all=async(sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results||[];
   const run=(sql,...args)=>env.DB.prepare(sql).bind(...args).run();
   const statement=(sql,...args)=>env.DB.prepare(sql).bind(...args);
   async function member(id,ownerOnly=false){
    const row=await one('SELECT w.*,m.role FROM research_workspaces w JOIN research_workspace_members m ON m.workspace_id=w.id WHERE w.id=? AND m.account_id=?',id,actor);
    if(!row)throw fault('课题不存在或你不是成员。',404,'WORKSPACE_NOT_FOUND');
    if(ownerOnly&&(row.role!=='owner'||row.owner_id!==actor))throw fault('只有课题创建者可以管理邀请。',403,'OWNER_REQUIRED');
    return row;
   }
   const publicWorkspace=async row=>({id:row.id,...await decrypt(row.ciphertext,secret),role:row.role,created_at:row.created,updated_at:row.updated,...(row.member_count===undefined?{}:{member_count:row.member_count,artifact_count:row.artifact_count})});
   async function detail(id){
    const row=await member(id),members=await all('SELECT * FROM research_workspace_members WHERE workspace_id=? ORDER BY joined,id',id),artifacts=await all('SELECT * FROM research_workspace_artifacts WHERE workspace_id=? ORDER BY created,id LIMIT 500',id);
    const result={workspace:{...await publicWorkspace(row),member_count:members.length,artifact_count:artifacts.length},members:await Promise.all(members.map(async item=>({account_id:item.account_id,...await decrypt(item.ciphertext,secret),role:item.role,joined_at:item.joined}))),artifacts:await Promise.all(artifacts.map(async item=>({id:item.id,...await decrypt(item.ciphertext,secret),author_id:item.author_id,created_at:item.created,updated_at:item.updated}))),artifact_scope:'explicit_research_notes_and_source_links_only'};
    if(row.role==='owner')result.invites=(await all('SELECT id,created,expires,revoked,used_at FROM research_workspace_invites WHERE workspace_id=? ORDER BY created DESC LIMIT 50',id)).map(item=>({id:item.id,created_at:item.created,expires_at:item.expires,revoked:!!item.revoked,used:item.used_at!==null}));
    return result;
   }
   if(path==='/api/workspaces'){
    if(request.method==='GET'){
     const rows=await all('SELECT w.*,m.role,(SELECT COUNT(*) FROM research_workspace_members x WHERE x.workspace_id=w.id) AS member_count,(SELECT COUNT(*) FROM research_workspace_artifacts x WHERE x.workspace_id=w.id) AS artifact_count FROM research_workspaces w JOIN research_workspace_members m ON m.workspace_id=w.id WHERE m.account_id=? ORDER BY w.updated DESC,w.id LIMIT 100',actor);
     return response({workspaces:await Promise.all(rows.map(publicWorkspace))});
    }
    if(request.method!=='POST')throw fault('请求方法不匹配。',405);
    const input=await body(request,['title','description']),value={title:text(input.title,'课题标题',120),description:text(input.description,'课题说明',2000,{optional:true})},id=crypto.randomUUID(),created=Date.now();
    await env.DB.batch([
     statement('INSERT INTO research_workspaces(id,owner_id,ciphertext,created,updated) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM research_workspaces WHERE owner_id=?)<20',id,actor,await encrypt(value,secret),created,created,actor),
     statement("INSERT INTO research_workspace_members(id,workspace_id,account_id,role,ciphertext,joined) SELECT ?,?,?,'owner',?,? WHERE EXISTS(SELECT 1 FROM research_workspaces WHERE id=? AND owner_id=?)",crypto.randomUUID(),id,actor,await encrypt({display_name:name},secret),created,id,actor)
    ]);
    if(!await one('SELECT id FROM research_workspaces WHERE id=?',id))throw fault('每个账户最多创建20个课题。',429,'WORKSPACE_LIMIT');
    return response(await detail(id),201);
   }
   if(path==='/api/workspaces/join'){
    if(request.method!=='POST')throw fault('请求方法不匹配。',405);
    const input=await body(request,['token']);if(typeof input.token!=='string'||!/^ws_[A-Za-z0-9_-]{43}$/.test(input.token))throw fault('邀请不存在、已被使用、撤销或过期。',409,'INVITE_UNAVAILABLE');
    const digest=await hash(input.token),invite=await one('SELECT * FROM research_workspace_invites WHERE token_hash=?',digest),created=Date.now(),memberId=crypto.randomUUID();
    if(!invite||invite.revoked||invite.used_by!==null||invite.expires<=created)throw fault('邀请不存在、已被使用、撤销或过期。',409,'INVITE_UNAVAILABLE');
    if(await one('SELECT id FROM research_workspace_members WHERE workspace_id=? AND account_id=?',invite.workspace_id,actor))throw fault('你已经是该课题成员，无需消耗邀请。',409,'ALREADY_MEMBER');
    await env.DB.batch([
     statement("INSERT INTO research_workspace_members(id,workspace_id,account_id,role,ciphertext,joined_via_invite,joined) SELECT ?,?,?,'member',?,?,? WHERE EXISTS(SELECT 1 FROM research_workspace_invites i JOIN research_workspaces w ON w.id=i.workspace_id WHERE i.id=? AND i.token_hash=? AND i.revoked=0 AND i.used_by IS NULL AND i.expires>?) AND (SELECT COUNT(*) FROM research_workspace_members WHERE workspace_id=?)<16 ON CONFLICT(workspace_id,account_id) DO NOTHING",memberId,invite.workspace_id,actor,await encrypt({display_name:name},secret),invite.id,created,invite.id,digest,created,invite.workspace_id),
     statement('UPDATE research_workspace_invites SET used_by=?,used_at=? WHERE id=? AND used_by IS NULL AND revoked=0 AND expires>? AND EXISTS(SELECT 1 FROM research_workspace_members WHERE id=? AND joined_via_invite=?)',actor,created,invite.id,created,memberId,invite.id),
     statement('UPDATE research_workspaces SET updated=? WHERE id=? AND EXISTS(SELECT 1 FROM research_workspace_members WHERE id=?)',created,invite.workspace_id,memberId)
    ]);
    const accepted=await one('SELECT id FROM research_workspace_members WHERE id=? AND account_id=?',memberId,actor);
    if(!accepted)throw fault('邀请已失效或成员已满，未加入课题。',409,'INVITE_UNAVAILABLE');
    return response(await detail(invite.workspace_id));
   }
   const route=path.match(/^\/api\/workspaces\/([^/]+)(?:\/(invites|artifacts)(?:\/([^/]+))?)?$/);
   if(!route||!validId(route[1]))throw fault('课题不存在。',404,'WORKSPACE_NOT_FOUND');
   const [,id,operation,itemId]=route;
   if(!operation){if(request.method!=='GET')throw fault('请求方法不匹配。',405);return response(await detail(id))}
   if(operation==='invites'){
    await member(id,true);
    if(itemId){
     if(request.method!=='DELETE'||!validId(itemId))throw fault('请求方法或邀请标识不匹配。',405);
     const result=await run('UPDATE research_workspace_invites SET revoked=1 WHERE id=? AND workspace_id=? AND creator_id=?',itemId,id,actor);
     if(!result.meta?.changes)throw fault('邀请不存在。',404);
     return response({revoked:true});
    }
    if(request.method!=='POST')throw fault('请求方法不匹配。',405);
    await body(request,[]);const created=Date.now(),expires=created+86400000,inviteId=crypto.randomUUID(),plain=token();
    await run('INSERT INTO research_workspace_invites(id,workspace_id,creator_id,token_hash,created,expires,revoked) SELECT ?,?,?,?,?,?,0 WHERE (SELECT COUNT(*) FROM research_workspace_invites WHERE workspace_id=? AND revoked=0 AND used_by IS NULL AND expires>?)<20',inviteId,id,actor,await hash(plain),created,expires,id,created);
    if(!await one('SELECT id FROM research_workspace_invites WHERE id=?',inviteId))throw fault('有效邀请过多，请撤销旧邀请或等待过期。',429,'INVITE_LIMIT');
    return response({invite:{id:inviteId,token:plain,expires_at:expires,uses_remaining:1}},201);
   }
   if(operation==='artifacts'){
    if(request.method!=='POST'||itemId)throw fault('请求方法不匹配。',405);
    await member(id);const input=await body(request,['title','body','source_url','source_note']);
    const value={kind:'research_note',title:text(input.title,'笔记标题',120),body:text(input.body,'笔记正文',20000,{trim:false}),source_url:sourceUrl(input.source_url),source_note:text(input.source_note,'来源说明',2000,{optional:true}),author_name:name};
    const artifactId=crypto.randomUUID(),created=Date.now();
    await env.DB.batch([
     statement('INSERT INTO research_workspace_artifacts(id,workspace_id,author_id,ciphertext,created,updated) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM research_workspace_members WHERE workspace_id=? AND account_id=?) AND (SELECT COUNT(*) FROM research_workspace_artifacts WHERE workspace_id=?)<500',artifactId,id,actor,await encrypt(value,secret),created,created,id,actor,id),
     statement('UPDATE research_workspaces SET updated=? WHERE id=? AND EXISTS(SELECT 1 FROM research_workspace_artifacts WHERE id=?)',created,id,artifactId)
    ]);
    if(!await one('SELECT id FROM research_workspace_artifacts WHERE id=?',artifactId))throw fault('课题笔记已达到500条上限，未保存新内容。',429,'ARTIFACT_LIMIT');
    return response({artifact:{id:artifactId,...value,author_id:actor,created_at:created,updated_at:created}},201);
   }
  }catch(error){
   return response(error.workspaceProblem?{detail:error.message,code:error.code}:{detail:'共享课题暂不可用，请稍后重试；没有返回私有配置。',code:'WORKSPACE_UNAVAILABLE'},error.workspaceProblem?error.status:503);
  }
 };
}
