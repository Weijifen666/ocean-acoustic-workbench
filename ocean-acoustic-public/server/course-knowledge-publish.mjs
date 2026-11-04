// Authenticated import of a private course index. Query routes expose selected
// excerpts; this module deliberately provides no raw-index download endpoint.
import {validateCourseDocumentPayload} from './course-document-index.mjs';

const MIB=1024*1024;
const LIMITS={request:8*MIB,compressed:6*MIB,expanded:16*MIB};
const encoder=new TextEncoder();
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const failure=(message,status=422)=>Object.assign(new Error(message),{status});
const digest=async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
const hex=bytes=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
const sha=async bytes=>hex(await digest(bytes));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;

async function authorized(request,env){
 const expected=env.COURSE_KNOWLEDGE_PUBLISH_TOKEN;
 if(typeof expected!=='string'||!expected)return false;
 const match=/^Bearer ([^\s]{1,4096})$/.exec(request.headers.get('Authorization')||'');
 if(!match)return false;
 // Fixed-size hashes make the comparison independent of the secret's length.
 const [actualHash,expectedHash]=await Promise.all([digest(encoder.encode(match[1])),digest(encoder.encode(expected))]);
 let difference=0;for(let index=0;index<32;index++)difference|=actualHash[index]^expectedHash[index];
 return difference===0;
}

async function boundedRead(stream,maximum){
 if(!stream)throw failure('上传内容为空');
 const reader=stream.getReader(),parts=[];let size=0;
 try{
  while(true){
   const next=await reader.read();if(next.done)break;
   size+=next.value.byteLength;
   if(size>maximum){await reader.cancel().catch(()=>{});throw failure('上传或展开后的索引超过体积限制',413)}
   parts.push(next.value);
  }
 }finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;
 for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
 return bytes;
}

function decodeBody(value){
 if(typeof value!=='string'||!value.length||value.length%4||/[^A-Za-z0-9+/=]/.test(value)||!/^[^=]*={0,2}$/.test(value))throw failure('索引须使用标准 Base64 编码');
 if(value.length>4*Math.ceil(LIMITS.compressed/3))throw failure('压缩索引超过体积限制',413);
 let binary;try{binary=atob(value)}catch{throw failure('索引 Base64 编码无效')}
 if(binary.length>LIMITS.compressed)throw failure('压缩索引超过体积限制',413);
 const bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
 return bytes;
}

async function expand(bytes){
 if(bytes.length<18||bytes[0]!==0x1f||bytes[1]!==0x8b||bytes[2]!==8||(bytes[3]&0xe0))throw failure('索引 Gzip 文件无效');
 let expanded;
 try{expanded=await boundedRead(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),LIMITS.expanded)}
 catch(error){if(error.status===413)throw error;throw failure('索引 Gzip 不完整或校验失败')}
 const declared=new DataView(bytes.buffer,bytes.byteOffset+bytes.byteLength-4,4).getUint32(0,true);
 if(declared!==expanded.byteLength)throw failure('索引 Gzip 完整性校验失败');
 return expanded;
}

async function immutable(bucket,key,bytes,hash,contentType){
 const stored=await bucket.put(key,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:hash,customMetadata:{sha256:hash},httpMetadata:{contentType}});
 if(stored)return false;
 const existing=await bucket.get(key);
 if(!existing||existing.size!==bytes.byteLength)throw failure('该版本已有不同内容，请使用新版本标识',409);
 // Inspect actual stored bytes as well as metadata, so a corrupt object cannot
 // be accepted merely because its customMetadata still contains an old hash.
 const previous=existing.body?await boundedRead(existing.body,bytes.byteLength):new Uint8Array(await existing.arrayBuffer());
 if(previous.byteLength!==bytes.byteLength||await sha(previous)!==hash)throw failure('该版本已有不同内容，请使用新版本标识',409);
 return true;
}

export async function handleCourseKnowledgePublish(request,env){
 if(new URL(request.url).pathname!=='/_knowledge-admin/import')return null;
 if(request.method!=='POST')return reply({detail:'仅支持 POST'},405);
 if(!await authorized(request,env))return reply({detail:'不可访问'},403);
 if(!env.BUCKET)return reply({detail:'课程索引存储未连接'},503);
 try{
  const declared=Number(request.headers.get('content-length')||0);
  if(declared>LIMITS.request)throw failure('上传请求超过体积限制',413);
  const raw=await boundedRead(request.body,LIMITS.request);
  let input;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))}catch{throw failure('上传内容须为 UTF-8 JSON')}
  if(!object(input)||Object.keys(input).some(key=>!['manifest','body'].includes(key))||!object(input.manifest))throw failure('上传格式须为 manifest 与 body');
  const manifest=input.manifest;
  if(manifest.schema_version!==1||typeof manifest.version!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(manifest.version)||manifest.chunks_key!=='chunks.json.gz'||!/^[a-f0-9]{64}$/.test(manifest.chunks_sha256||''))throw failure('课程索引清单格式无效');
  if(!Number.isSafeInteger(manifest.compressed_bytes)||manifest.compressed_bytes<18||!Number.isSafeInteger(manifest.uncompressed_bytes)||manifest.uncompressed_bytes<1)throw failure('课程索引体积记录无效');
  if(manifest.compressed_bytes>LIMITS.compressed||manifest.uncompressed_bytes>LIMITS.expanded)throw failure('压缩或展开后的索引超过体积限制',413);
  const compressed=decodeBody(input.body);
  if(compressed.byteLength!==manifest.compressed_bytes||await sha(compressed)!==manifest.chunks_sha256)throw failure('课程索引大小或 SHA-256 校验失败');
  const expanded=await expand(compressed);
  if(expanded.byteLength!==manifest.uncompressed_bytes)throw failure('课程索引展开大小与清单不一致');
  let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(expanded))}catch{throw failure('课程索引须为完整的 UTF-8 JSON')}
  const statistics=validateCourseDocumentPayload(manifest,payload);
  const prefix='course-knowledge/'+manifest.version+'/',manifestBytes=encoder.encode(JSON.stringify(canonical(manifest))),manifestHash=await sha(manifestBytes);
  const chunksReused=await immutable(env.BUCKET,prefix+'chunks.json.gz',compressed,manifest.chunks_sha256,'application/gzip');
  const manifestReused=await immutable(env.BUCKET,prefix+'manifest.json',manifestBytes,manifestHash,'application/json');
  const previous=await env.BUCKET.get('course-knowledge/current.json');let current;
  if(previous){try{current=await previous.json()}catch{try{current=JSON.parse(await previous.text())}catch{/* Replace an unreadable pointer only after fully verified immutable objects. */}}}
  const reused=current?.schema_version===1&&current.version===manifest.version&&current.manifest_key===prefix+'manifest.json'&&current.manifest_sha256===manifestHash;
  if(!reused){
   current={schema_version:1,version:manifest.version,manifest_key:prefix+'manifest.json',manifest_sha256:manifestHash,activated_at:new Date().toISOString()};
   const pointer=encoder.encode(JSON.stringify(current));
   // A single R2 object write atomically switches readers after every immutable
   // object and all content/coverage checks have completed successfully.
   await env.BUCKET.put('course-knowledge/current.json',pointer,{sha256:await sha(pointer),httpMetadata:{contentType:'application/json'}});
  }
  return reply({ok:true,...current,chunks:statistics.chunks,indexed_sources:statistics.indexed_sources,indexed_pages:statistics.indexed_pages,compressed_bytes:compressed.byteLength,uncompressed_bytes:expanded.byteLength,reused:reused&&chunksReused&&manifestReused});
 }catch(error){
  const status=[409,413,422].includes(error.status)?error.status:503;
  return reply({detail:status===503?'课程索引发布暂未完成，请用同一版本重试。':error.message},status);
 }
}
