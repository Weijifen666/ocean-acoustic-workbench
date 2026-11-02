import React from 'react';
import {AnswerMarkdown} from './RichMessage';
const numericLabels={not_checked:'尚无程序数值检查',checked:'已运行所列数值检查',not_stable:'指定区域尚未稳定',inconclusive:'数值证据不足',stale:'检查依据已变化，需重新检查'};
const receiptLabels={stable:'指定区域两级差异满足所选阈值',not_stable:'指定区域两级差异超出所选阈值',inconclusive:'证据不足',computed:'已按固定方法计算'};
const number=value=>Number.isFinite(value)?value.toFixed(3):'—';
function Validation({report}){
 const validation=report.scientific_validation,execution=report.execution_validation;
 return <><h3>执行与科学检查</h3><p>{report.validation_scope||'归档完成表示执行结束；科学证据另行核对。'}</p>
  <p><strong>执行与文件：</strong>{execution?.status==='consistent'?'当前版本一致':execution?.status==='incomplete'?'发现不一致':'历史记录，尚未由当前程序核对'}</p>
  {execution?.dependency_scope==='legacy_or_undeclared'&&<p>部分输入依赖未声明，当前版本核对不覆盖这些依赖。</p>}
  {execution?.issues?.map((issue,i)=><p key={i}>{issue}</p>)}
  <p><strong>程序数值检查：</strong>{numericLabels[validation?.numerical_status]||numericLabels.not_checked}</p>
  <p><strong>物理精度：</strong>尚未确立。数值差异、模型适用性和观测验证需要分别评估。</p>
  {(validation?.checks||[]).map(receipt=>{const result=receipt.result||{},roi=result.roi,diff=result.abs_difference;return <section key={receipt.id}>
   <strong>{receipt.kind==='layer_diagnostics'?'剖面诊断':'声场区域检查'} · {receipt.current===false?'依据已变化':receiptLabels[result.status||'computed']||result.status}</strong>
   {roi&&<p>深度 {roi.depth_min_m}—{roi.depth_max_m} m，距离 {roi.range_min_km}—{roi.range_max_km} km；共同有效覆盖 {number((result.coverage?.common_valid_ratio??0)*100)}%。</p>}
   {diff&&<p>绝对差异：中位数 {number(diff.median_db)} dB，P95 {number(diff.p95_db)} dB，P99 {number(diff.p99_db)} dB；所选阈值 {diff.threshold_db} dB。</p>}
   {result.method_id&&<p>{result.profile_count} 个剖面 · 方法 {result.method_id} {result.method_version} · 参考深度 {result.parameters?.reference_depth_m} m</p>}
   {result.reasons?.map((reason,i)=><p key={i}>{reason}</p>)}
   {receipt.stale_sources?.length>0&&<p>需要重新检查：{receipt.stale_sources.join('、')}</p>}
   <details><summary>检查来源与适用范围</summary><p>记录 {receipt.id} · {receipt.created}</p><p>{validation.scope}</p>{Object.entries(receipt.input_sha256||{}).map(([file,hash])=><p key={file}>{file} · SHA256 {hash}</p>)}</details>
  </section>})}
  <details><summary>执行明细（{report.executions?.length||0}）</summary>{(report.executions||[]).map((r,i)=><p key={i}>{r.file} · 退出码 {r.exit_code} · {r.seconds} 秒</p>)}</details>
  <details><summary>Agent 自评（{report.checks?.length||0}，未经程序逐项证明）</summary>{(report.checks||[]).map((c,i)=><section key={i}><strong>{c.passed===true?'Agent 自评认为通过':c.passed===false?'Agent 自评认为未通过':'尚未验证'} · {c.name}</strong><AnswerMarkdown text={c.evidence}/></section>)}</details>
 </>;
}
export default function ResearchResult({detail,setImage}){
 const report=detail.summary,base=`/api/jobs/${detail.id}/artifact/`;
 return <div className="result-body"><h3>研究目标</h3><AnswerMarkdown text={detail.plan.objective}/>{!report?<p>{detail.error||'研究中，可查看日志和已有文件。'}</p>:<><h3>方法与假设</h3><AnswerMarkdown text={report.method}/>{report.assumptions.map((s,i)=><p key={i}>{s}</p>)}<Validation report={report}/><h3>图表与数据</h3>{report.outputs.map(output=><figure key={output.file}>{/\.(png|jpe?g|svg)$/i.test(output.file)&&<button className="result-image" onClick={()=>setImage({url:base+encodeURIComponent(output.file),caption:output.caption||output.file})}><img src={base+encodeURIComponent(output.file)} alt={output.caption||output.file}/></button>}<figcaption><a href={base+encodeURIComponent(output.file)} target="_blank" rel="noreferrer">{output.caption||output.file}</a> · {output.bytes} 字节</figcaption></figure>)}<h3>结论</h3><AnswerMarkdown text={report.conclusion}/><h3>局限</h3>{report.limitations.map((s,i)=><p key={i}>{s}</p>)}<h3>输入与来源</h3>{[...report.inputs,...report.sources].map((s,i)=><p key={i}>{s}</p>)}</>}</div>;
}
