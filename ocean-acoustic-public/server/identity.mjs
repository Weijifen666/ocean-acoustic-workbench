// Sites dispatch supplies and protects these identity headers. Never accept an
// identity from JSON, query parameters, an application cookie, or the browser.
const encoder=new TextEncoder();
const hex=buffer=>[...new Uint8Array(buffer)].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function resolveVisitorIdentity(request,env){
 let cookie_id=(request.headers.get('cookie')||'').match(/(?:^|;\s*)ocean_visitor=([A-Za-z0-9_-]{40,86})(?:;|$)/)?.[1],fresh=!cookie_id;
 if(!cookie_id)cookie_id=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(!userId||!email)return {id:cookie_id,node_id:cookie_id,cookie_id,fresh,account:{authenticated:false,display_name:'访客'}};
 const key=await crypto.subtle.importKey('raw',encoder.encode(env.GATEWAY_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=hex(await crypto.subtle.sign('HMAC',key,encoder.encode(new URL(request.url).origin+'\0'+userId)));
 const id='account:'+digest,node_id=hex(await crypto.subtle.sign('HMAC',key,encoder.encode('node\0'+digest)));
 let display_name='成员 '+digest.slice(0,6);
 if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8')try{display_name=decodeURIComponent(request.headers.get('oai-authenticated-user-full-name')||'').trim().slice(0,80)||display_name}catch{}
 return {id,node_id,cookie_id,fresh,account:{authenticated:true,id,display_name}};
}
export const visitorCookie=id=>`ocean_visitor=${id}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;
