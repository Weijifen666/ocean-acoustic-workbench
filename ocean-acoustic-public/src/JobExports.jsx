import React from 'react';
import {Download,FileText} from 'lucide-react';

const states={QUEUED:'排队中',RUNNING:'计算中',SUCCEEDED:'已完成',FAILED:'失败',CANCELLED:'已取消',INTERRUPTED:'执行中断'};
const safeName=name=>typeof name==='string'&&/^[A-Za-z0-9_.-]{1,180}$/.test(name)&&!name.includes('..')&&name!=='.';

export function safeJobExport(item){
 if(!item||typeof item!=='object'||typeof item.id!=='string'||!/^[a-f0-9]{12}$/.test(item.id))return null;
 const base='/api/jobs/'+item.id,seen=new Set();
 const artifacts=(Array.isArray(item.artifacts)?item.artifacts:[]).filter(file=>{
  if(!file||!safeName(file.name)||file.url!==base+'/artifact/'+file.name||seen.has(file.name))return false;
  seen.add(file.name);return true;
 }).map(file=>({name:file.name,url:file.url}));
 const download=item.download?.url===base+'/download'?{url:base+'/download',filename:'ocean-'+item.id+'.zip'}:null;
 if(!download&&!artifacts.length)return null;
 const artifact_count=Number.isSafeInteger(item.artifact_count)&&item.artifact_count>=artifacts.length?item.artifact_count:artifacts.length;
 return {id:item.id,state:Object.hasOwn(states,item.state)?item.state:null,artifact_count,artifacts,download,partial:item.partial===true||['QUEUED','RUNNING'].includes(item.state),more:artifact_count>artifacts.length||Number.isSafeInteger(item.next_offset)};
}

export default function JobExports({items}){
 if(!Array.isArray(items))return null;
 const records=new Map();
 for(const item of items){const record=safeJobExport(item);if(record)records.set(record.id,record);}
 if(!records.size)return null;
 return <div className="job-exports" aria-label="任务结果附件">{[...records.values()].map(item=><section className="job-export-card" key={item.id} aria-label={'任务 '+item.id+' 输出附件'}>
  <div className="job-export-heading"><strong>任务 {item.id}</strong><span>{states[item.state]||'状态待核实'}</span></div>
  {item.download&&<a className="job-export-download" href={item.download.url} download={item.download.filename} rel="noopener noreferrer"><Download size={15}/>下载任务与结果包</a>}
  <p className="job-export-note">{item.download?'点击时打包当前任务文件。':'下载下面列出的任务文件。'}{item.partial?'任务尚未结束，当前产物可能不完整。':'文件以下载时实际可用内容为准。'}</p>
  <details className="job-export-files"><summary>输出文件（{item.artifact_count}）</summary><ul>{item.artifacts.map(file=><li key={file.name}><a href={file.url} download={file.name} rel="noopener noreferrer"><FileText size={14}/><span>{file.name}</span></a></li>)}</ul>{!item.artifacts.length&&<p>当前未列出可下载的单个文件。</p>}{item.more&&<p>当前列出 {item.artifacts.length} 个文件，其余可用文件可从结果包获取。</p>}</details>
 </section>)}</div>;
}
