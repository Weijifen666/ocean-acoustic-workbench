import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createCoursePageHandler} from '../server/course-images.mjs';

const graph=JSON.parse(fs.readFileSync(new URL('../data/graph.json',import.meta.url),'utf8'));
const req=path=>new Request('https://course.example'+path);

test('all 69 knowledge nodes keep source references and have a real authored first image in both distributions',()=>{
 const nodes=graph.nodes.filter(n=>n.kind==='knowledge');assert.equal(nodes.length,69);
 for(const node of nodes){
  assert.equal(node.images[0].kind,'authored_diagram',node.id);
  for(const folder of ['../public/','../../ocean-acoustic-workbench/public/']){
   const content=fs.readFileSync(new URL(folder+node.images[0].url.slice(1),import.meta.url),'utf8');
   assert.match(content,/<svg\b/);assert.match(content,/(非.*结果|不作为求解器计算结果)/);
  }
  for(const ref of node.references.filter(ref=>ref.pdf_page))assert.ok(node.images.some(im=>im.url===`/api/source/${ref.source_id}/page/${ref.pdf_page}`),node.id);
 }
 const wave=nodes.find(n=>n.id==='wave_equation');
 assert.deepEqual(wave.references.map(ref=>ref.source_id),['S21','S21']);
 assert.ok(wave.images.some(im=>im.kind==='supplementary_source_page'&&im.url==='/api/source/S17/page/86'));
 assert.ok(wave.images.some(im=>im.url==='/api/source/S21/page/2'));
});

test('cached textbook page remains available without contacting an offline node',async()=>{
 let calls=0;const handler=createCoursePageHandler(graph,async()=>{calls++;throw Error('node offline');});
 const png=new Uint8Array([137,80,78,71,13,10,26,10]);
 const response=await handler(req('/api/source/S17/page/86'),{BUCKET:{get:async()=>({body:png})}},{});
 assert.equal(response.status,200);assert.equal(response.headers.get('x-ocean-resource-cache'),'cloud');
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),png);assert.equal(calls,0);
});

test('missing original page is an explicit 404 and never creates a fake image cache',async()=>{
 let puts=0;const handler=createCoursePageHandler(graph,async()=>Response.json({detail:'Not Found'},{status:404}));
 const response=await handler(req('/api/source/S21/page/2'),{BUCKET:{get:async()=>null,put:async()=>{puts++;}}},{waitUntil:()=>assert.fail('404 must not be cached')});
 assert.equal(response.status,404);assert.match((await response.json()).detail,/尚未接入/);assert.equal(puts,0);
});

test('actual PNG from the node is cached with provenance while non-image responses are not',async()=>{
 const pending=[],saved=[];let response=new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}});
 const handler=createCoursePageHandler(graph,async()=>response),env={BUCKET:{get:async()=>null,put:async(...args)=>saved.push(args)}};
 const out=await handler(req('/api/source/S17/page/86'),env,{waitUntil:p=>pending.push(p)});
 assert.equal(out.headers.get('x-ocean-resource-cache'),'node');await Promise.all(pending);assert.equal(saved.length,1);
 assert.equal(saved[0][0],'course-pages/api/source/S17/page/86');assert.equal(saved[0][2].httpMetadata.contentType,'image/png');
 response=Response.json({detail:'not an image'});await handler(req('/api/source/S17/page/86'),env,{waitUntil:()=>assert.fail('JSON must not be cached')});assert.equal(saved.length,1);
});

test('unregistered pages and source-file downloads are not promoted to shared cache',async()=>{
 const handler=createCoursePageHandler(graph,async()=>assert.fail('unregistered URL'));
 for(const path of ['/api/source/S17','/api/source/S99/page/1','/api/source/S21/page/0'])assert.equal(await handler(req(path),{},{}),null);
});
