import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
import {createCourseRetriever} from '../server/course-retrieval.mjs';import {createCloudModels,providerFetch} from '../server/cloud-models.mjs';
const graph=JSON.parse(fs.readFileSync(new URL('../data/graph.json',import.meta.url),'utf8')),catalog=JSON.parse(fs.readFileSync(new URL('../data/models.json',import.meta.url),'utf8'));
export const retrieve=createCourseRetriever(graph);
async function cryptoKey(secret){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),'AES-GCM',false,['encrypt','decrypt'])}
export const encrypt=async(value,secret)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await cryptoKey(secret),new TextEncoder().encode(JSON.stringify(value))));return Buffer.concat([Buffer.from(iv),Buffer.from(data)]).toString('base64')};
export const decrypt=async(value,secret)=>{const bytes=Buffer.from(value,'base64');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12)},await cryptoKey(secret),bytes.subarray(12))))};
export function setup(fetcher=async()=>{throw Error('Network calls forbidden')},overrides={}){
 const sqlite=new DatabaseSync(':memory:');for(const name of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(s=>s.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}}}}},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 const env={DB,GATEWAY_SECRET:'TEST-ONLY-CLOUD-ENCRYPTION-KEY'},ctx={waitUntil(){}};
 const handler=createCloudModels({catalog,retrieve,encrypt,decrypt,heartbeat:async()=>false,proxy:async()=>{throw Error('Node should be offline')},template:'% audited example',fetcher,...overrides});
 async function call(path,method='GET',body, cookie=''){
  const url=new URL(path,'https://course.test'),headers={'content-type':'application/json',origin:url.origin,...(cookie?{cookie}:{})};const r=await handler(new Request(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx,url);return {r,data:await r.clone().json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||cookie};
 }
 return {call,sqlite,env,handler,ctx};
}
