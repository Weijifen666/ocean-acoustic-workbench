// Authorized course-page fragments stay in the private node / cloud page
// cache. They are never embedded as textbook files in the GitHub bundle.
export function createCoursePageHandler(graph,proxy) {
 const pages=new Set(graph.nodes.flatMap(node=>(node.images||[]).map(image=>image.url)).filter(url=>/^\/api\/source\/S\d{2,4}\/page\/[1-9]\d*$/.test(url)));
 return async function coursePage(request,env,ctx) {
  const url=new URL(request.url);
  if(request.method!=='GET'||!pages.has(url.pathname))return null;
  const key='course-pages'+url.pathname,cached=await env.BUCKET.get(key);
  if(cached)return new Response(cached.body,{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff','X-Ocean-Resource-Kind':'source-page','X-Ocean-Resource-Cache':'cloud'}});
  const response=await proxy(request,env,ctx,url);
  if(response.status===404)return Response.json({detail:'此教材原页尚未接入资料节点；原课件未随项目分发。可先查看原理示意和补充教材页。'},{status:404,headers:{'Cache-Control':'no-store','X-Ocean-Resource-Kind':'source-page'}});
  if(response.status===200&&response.headers.get('Content-Type')?.startsWith('image/png')) {
   ctx.waitUntil(env.BUCKET.put(key,response.clone().body,{httpMetadata:{contentType:'image/png'}}));
   const headers=new Headers(response.headers);headers.set('X-Ocean-Resource-Kind','source-page');headers.set('X-Ocean-Resource-Cache','node');
   return new Response(response.body,{status:response.status,headers});
  }
  return response;
 };
}
