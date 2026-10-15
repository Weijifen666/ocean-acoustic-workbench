/** No-key/offline evaluation of the exact public retrievers. No answer calls. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createCourseRetriever} from '../server/course-retrieval.mjs';
import {createPublicOceanKnowledge} from '../server/open-ocean-retrieval.mjs';
import {assessEvidence} from '../server/evidence-policy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
export function evaluatePublicKnowledge(k=8){
 const benchmark=read('docs/benchmarks/knowledge-60.json'),graph=read('ocean-acoustic-workbench/backend/data/course_graph.json');
 const course=createCourseRetriever(graph),ocean=createPublicOceanKnowledge({sources:read('ocean-acoustic-public/data/open-ocean-sources.json'),chunks:read('ocean-acoustic-public/data/open-ocean-chunks.json')});
 const results=benchmark.cases.map(item=>{
  const cards=course(item.question,k),publicRows=ocean.retrievePublicOcean(item.question,k),focus=cards.some(row=>row.retrieval?.focus),evidence=(focus?[...cards,...publicRows]:[...publicRows.slice(0,4),...cards,...publicRows.slice(4)]).slice(0,k);
  const expected=new Set(item.expected_node_ids),sources=new Set(item.expected_any_source_ids),nodes=new Set(evidence.map(row=>row.node_id));
  const positions=evidence.flatMap((row,i)=>expected.has(row.node_id)||sources.has(row.source_id)?[i+1]:[]),assessment=assessEvidence(item.question,evidence);
  const locator=ref=>JSON.stringify([ref.source_id,ref.pdf_page||null,ref.pdf_page?'':ref.url||ref.locator||'']),wanted=new Set(item.source_references.map(locator)),actual=evidence.flatMap(row=>(row.all_references||[row]).map(locator));
  return {id:item.id,category:item.category,hit_at_k:item.retrieval_expected?positions.length>0:null,source_locator_hit_at_k:item.retrieval_expected?actual.some(ref=>wanted.has(ref)):null,node_recall_at_k:expected.size?[...expected].filter(id=>nodes.has(id)).length/expected.size:null,reciprocal_rank:positions.length?1/positions[0]:0,empty:evidence.length===0,gate_status:assessment.status,gate_correct:assessment.status===item.expected_gate_status,returned_node_ids:evidence.map(row=>row.node_id||null),returned_source_ids:[...new Set(evidence.map(row=>row.source_id))]};
 });
 const positive=results.filter(row=>row.hit_at_k!==null),recalls=results.filter(row=>row.node_recall_at_k!==null),gates=results.filter(row=>row.category==='numeric_gate'),unknown=results.filter(row=>row.category==='unknown'),mean=rows=>rows.length?Number((rows.reduce((a,b)=>a+Number(b),0)/rows.length).toFixed(6)):null;
 return {benchmark:'knowledge-60',benchmark_sha256:createHash('sha256').update(fs.readFileSync(path.join(root,'docs/benchmarks/knowledge-60.json'))).digest('hex'),benchmark_cases:results.length,k,run_at:new Date().toISOString(),model_calls:0,network_calls:0,private_index_included:false,metrics:{positive_questions:positive.length,hit_at_k:mean(positive.map(row=>row.hit_at_k)),source_locator_hit_at_k:mean(positive.map(row=>row.source_locator_hit_at_k)),node_recall_at_k:mean(recalls.map(row=>row.node_recall_at_k)),mrr_at_k:mean(positive.map(row=>row.reciprocal_rank)),numeric_gate_correct:gates.filter(row=>row.gate_correct).length,numeric_gate_cases:gates.length,unknown_empty_correct:unknown.filter(row=>row.empty).length,unknown_cases:unknown.length,all_gate_correct:results.filter(row=>row.gate_correct).length},interpretation:'开发者固定题集候选召回与缺证据门控；不是独立盲测，不代表生成答案正确率或引用支持率。',results};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const report=evaluatePublicKnowledge(),output=path.join(root,'ocean-acoustic-public/.local/kb/evaluation-60-public.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');const {results,...summary}=report;console.log(JSON.stringify(summary,null,2));
}
