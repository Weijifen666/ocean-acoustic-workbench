import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {createCourseRetriever,focusEvidenceGate,noModelAnswer} from '../server/course-retrieval.mjs';
import {createPublicOceanKnowledge} from '../server/open-ocean-retrieval.mjs';
import {planQuery} from '../server/query-planning.mjs';
import {assessEvidence,validateCitationIds,observationRequirements} from '../server/evidence-policy.mjs';
import {answerPolicy} from '../server/knowledge-policy.mjs';
import {evaluatePublicKnowledge} from '../scripts/evaluate-knowledge.mjs';
import {setup} from './test-support.mjs';

const read=relative=>JSON.parse(fs.readFileSync(new URL(relative,import.meta.url),'utf8'));
const course=createCourseRetriever(read('../../ocean-acoustic-workbench/backend/data/course_graph.json'));
const publicOcean=createPublicOceanKnowledge({sources:read('../data/open-ocean-sources.json'),chunks:read('../data/open-ocean-chunks.json')});

test('colloquial course queries fuse maintained subquestions while preserving candidates',()=>{
 for(const [question,expected] of [['把声源放到声道轴附近为什么可能更有效',['source_depth','mode_excitation','deep_sound_channel']],['为什么接收位置平移一点会突然几乎听不到',['modal_sum','coherent_modal_sum','near_zero_pressure']],['盐多一点声音会不会跑得快一些',['temperature_salinity']]]){
  const rows=course(question),nodes=new Set(rows.map(row=>row.node_id));for(const id of expected)assert(nodes.has(id),question+' -> '+id);
  assert(rows.some(row=>row.retrieval.methods.includes('RRF')));assert(rows.every(row=>row.support_status==='candidate_only'&&row.claim_support_verified===false));
 }
 assert.equal(course('Munk 声速剖面')[0].node_id,'munk_profile');assert.deepEqual(course('海洋里的世界杯足球冠军是哪个队'),[]);
});
test('new public Chinese paraphrases find actual source IDs rather than generic marine cards',()=>{
 for(const [question,source] of [['海水变酸后贝壳为什么难长大','O-NOAA-ACIDIFICATION'],['漂在海上的仪器怎么测水流','O-NOAA-CURRENTMON'],['海底那层氧气不够了会怎么样','O-NOAA-DEADZONE'],['为什么潮水有时高有时低','O-NOAA-TIDES']]){
  const rows=publicOcean.retrievePublicOcean(question);assert(rows.some(row=>row.source_id===source),question);assert(rows.every(row=>row.citation.claim_support_verified===false));
 }
 assert.deepEqual(publicOcean.retrievePublicOcean('世界杯足球冠军'),[]);assert.deepEqual(publicOcean.retrievePublicOcean('海洋里的世界杯足球冠军'),[]);
});
test('query rewrite rules are contextual and bounded and do not invoke a model',()=>{
 assert.deepEqual(planQuery('盐多放了一点').rule_ids,[]);assert.deepEqual(planQuery('TEOS-10 与温盐压输入有什么关系').rule_ids,[]);
 const plan=planQuery('把声源放到声道轴附近为什么可能更有效');assert(plan.rule_ids.includes('source_near_axis'));assert(plan.queries.length<=4);assert.equal(plan.model_called,false);
});
test('snapshot timestamps and nonempty evidence cannot supply a current observation value',()=>{
 const question='今天东海一千米深海水声速是多少',rows=publicOcean.retrievePublicOcean(question);
 const assessment=assessEvidence(question,rows);assert.equal(assessment.status,'missing_observation_data');assert.equal(assessment.observation_requirements.depth_m,1000);assert.equal(assessment.claim_support_verified,false);
 for(const scope of ['course','general']){const policy=answerPolicy(rows,scope,'chat',question);assert.equal(policy.can_generate,false);assert.equal(policy.coverage_status,'missing_observation_data')}
 assert.equal(answerPolicy(rows,'general','chat','温度如何影响声速').can_generate,true);
 assert.equal(observationRequirements('ASIAEX 2001 实验有 CTD 吗').requires_observation,false);
 for(const terse of ['今天东海海水声速','东海1000米声速','today temperature in East China Sea'])assert.equal(assessEvidence(terse,rows).status,'missing_observation_data');
 assert.equal(observationRequirements('最新海平面研究有哪些机制').requires_observation,false);
 assert.equal(observationRequirements('What is ocean current speed?').requires_observation,false);
});
test('future structured observations must match time depth QC region and every comparison side',()=>{
 const now=Date.parse('2026-10-15T08:00:00Z'),row={id:'OBS',source_id:'AUTHORED',url:'https://example.org/authored-fixture',evidence_type:'structured_observation',verification_status:'trusted_observation_adapter',observation:{variable:'sound_speed',value:1500,units:'m/s',quality_control:'accepted',location:'东海',depth_m:1000,observed_at:'2026-10-15T07:00:00Z'}},question='今天东海1000米深海水声速是多少';
 assert.equal(assessEvidence(question,[row],now).status,'structured_observation_available');
 for(const changes of [{observed_at:'2026-10-12T07:00:00Z'},{depth_m:50},{quality_control:'not_checked'},{location:'南海'},{value:NaN}])assert.equal(assessEvidence(question,[{...row,observation:{...row.observation,...changes}}],now).status,'missing_observation_data');
 assert.equal(assessEvidence('今天东海和南海1000米深海水声速哪个更快',[row],now).status,'missing_observation_data');
 assert.equal(assessEvidence(question,[{...row,verification_status:'source_text_unreviewed'}],now).can_answer_requested_numeric,false);
});
test('source ID and PDF locator membership checks never claim semantic support',()=>{
 const rows=[{id:'C-ONE',source_id:'S17',pdf_page:359,all_references:[{source_id:'S17',pdf_page:359}]}];
 const check=validateCitationIds('A[C-ONE] B[C-FAKE] C[S17,359] D[S17,999]',rows);
 assert.deepEqual(check.unknown_ids,['C-FAKE']);assert.deepEqual(check.unknown_source_locators,[{source_id:'S17',pdf_page:999}]);assert.equal(check.claim_support_verified,false);
});
test('60-case no-key benchmark reports retrieval and numeric abstention, not answer accuracy',()=>{
 const report=evaluatePublicKnowledge();assert.equal(report.benchmark_cases,60);assert.equal(report.network_calls,0);assert.equal(report.model_calls,0);assert(report.metrics.hit_at_k>=.95);assert.equal(report.metrics.numeric_gate_correct,8);assert.equal(report.metrics.unknown_empty_correct,2);
});

test('precise Munk keeps only reviewed source pages and does not fill noisy eight slots',()=>{
 const rows=course('Munk 理想剖面的适用条件是什么'),raw=(id,source_id,pdf_page,text)=>({id,source_id,pdf_page,text,evidence_type:'source_excerpt',node_ids:[],retrieval:{role:'text_match'}});
 const good=[raw('GOOD375','S17',375,'Munk profile'),raw('GOOD376','S17',376,'Munk profile')],bad=[raw('COX','S18',400,'Cox–Munk surface roughness'),raw('HISTORY','S17',15,'Munk author history'),raw('INDEX','S17',807,'Munk index'),raw('OTHER','OTHER',375,'Munk profile')];
 const selected=focusEvidenceGate('Munk 理想剖面的适用条件是什么',[...rows,...bad,...good,...publicOcean.retrievePublicOcean('Munk 理想剖面')]);
 assert.deepEqual(selected.filter(row=>row.evidence_type==='source_excerpt').map(row=>row.id),['GOOD375','GOOD376']);assert(selected.every(row=>!bad.some(noise=>noise.id===row.id)));assert(selected.length<8);assert(selected.every(row=>!row.source_id.startsWith('O-')));
});
test('Cox–Munk does not route to the Munk sound speed card; explicit WOA survives',()=>{
 for(const question of ['Cox–Munk 海面粗糙度模型是什么','Cox-Munk surface roughness','Cox Munk 海面模型'])assert.deepEqual(course(question),[]);
 const question='Munk 与 WOA 的声速剖面有什么区别',rows=focusEvidenceGate(question,[...course(question),...publicOcean.retrievePublicOcean(question)]);
 assert(rows.some(row=>row.source_id==='O-WOA'));assert(rows.every(row=>!['O-WOD','O-ARGO-QC'].includes(row.source_id)));
 const full='Munk 与 World Ocean Atlas 的剖面有什么区别';assert(focusEvidenceGate(full,[...course(full),...publicOcean.retrievePublicOcean(full)]).some(row=>row.source_id==='O-WOA'));
 const cox={id:'COX-RAW',source_id:'S18',pdf_page:400,evidence_type:'source_excerpt',text:'Cox-Munk surface roughness model.'},noise={id:'GENERIC',source_id:'O-NOISE',evidence_type:'public_web_excerpt',text:'Generic sea surface and ocean model.'};
 assert.deepEqual(focusEvidenceGate('Cox–Munk 海面粗糙度',[...course('Munk'),cox,noise]).map(row=>row.id),['COX-RAW']);
});
test('no-key formatter renders short reviewed cards and guides instead of extracted PDF body',()=>{
 const garbage='UNREVIEWED_PDF_GARBAGE_'.repeat(200),raw={id:'RAW',source_id:'S17',pdf_page:375,evidence_type:'source_excerpt',text:garbage};
 const answer=noModelAnswer([...course('Munk 理想剖面'),raw]);assert(!answer.includes(garbage.slice(0,40)));assert(answer.includes('适用条件'));assert(answer.includes('资料抽屉'));assert(answer.length<1800);
 assert(!noModelAnswer([raw]).includes(garbage.slice(0,40)));assert(noModelAnswer([raw]).includes('PDF 第 375 页'));
 const guide=noModelAnswer(publicOcean.retrievePublicOcean('海洋酸化'));assert(guide.includes('项目中文导读'));assert(guide.includes('非官方译文'));
});
test('cloud online and offline merges never re-add generic profile pages to Munk',async()=>{
 for(const online of [false,true]){
  const question='Munk 理想剖面的适用条件是什么',nodeRows=course(question),state=setup(undefined,{publicKnowledge:publicOcean,heartbeat:async()=>online,proxy:async()=>new Response(JSON.stringify(nodeRows),{headers:{'content-type':'application/json'}})});
  try{const first=await state.call('/api/config'),answer=await state.call('/api/chat','POST',{message:question,knowledge_mode:'course'},first.cookie);assert.equal(answer.r.status,200);assert.equal(answer.data.model_used,false);assert(answer.data.evidence.every(row=>!row.source_id.startsWith('O-')));assert(answer.data.reply.includes('资料抽屉'));assert(answer.data.reply.length<1800)}finally{state.sqlite.close()}
 }
});

test('Cox-only cloud merge keeps an actual named excerpt or returns empty without public padding',async()=>{
 for(const online of [false,true]){
  const cox={id:'COX-RAW',source_id:'S18',pdf_page:400,evidence_type:'source_excerpt',text:'Cox-Munk surface roughness model.'},state=setup(undefined,{publicKnowledge:publicOcean,heartbeat:async()=>online,proxy:async()=>new Response(JSON.stringify([cox]),{headers:{'content-type':'application/json'}})});
  try{const first=await state.call('/api/config'),answer=await state.call('/api/chat','POST',{message:'Cox–Munk 海面粗糙度模型是什么',knowledge_mode:'course'},first.cookie);assert.equal(answer.r.status,200);assert.deepEqual(answer.data.evidence.map(row=>row.id),online?['COX-RAW']:[]);assert.equal(answer.data.model_used,false)}finally{state.sqlite.close()}
 }
});
