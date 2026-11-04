import {COURSE_SYSTEM} from './course-retrieval.mjs';
import {assessEvidence} from './evidence-policy.mjs';

export function answerPolicy(evidence,scope='course',mode='chat',question='') {
 if(!['course','general'].includes(scope))throw new Error('请选择课程依据或模型一般知识');
 const hasEvidence=evidence.length>0,template=mode==='agent',hasPublic=evidence.some(c=>/public|web/.test(c.evidence_type||''));
 let coverage_status=hasEvidence?'course_evidence':template?'course_template':'no_course_evidence';
 let coverage_notice=hasEvidence
  ? scope==='course'?`本次依据检索到的${hasPublic?'课程与公开':'课程'}资料回答。`:'本次结合检索资料与模型已有知识回答。'
  : template?'本次分析课程共享模板；未检索到对应课程正文。'
  : scope==='course'?'尚未找到相关课程资料。可补充资料，或使用“资料 + 模型知识”。':'本次使用模型已有知识回答。';
 const rule=scope==='course'
  ? '当前选择【仅依据资料】。结论只基于本次课程或公开资料片段和允许读取的模板；资料不足时明确缺口，不用一般知识伪装成引用。'
  : '当前选择【资料 + 模型知识】。综合检索资料与预训练知识补充定义、推导、例子和相关理论，直接回答用户的问题。引用对应本次实际提供的片段；补充解释、假设和推断保持清楚，资料冲突时说明具体原因。公开资料按其抓取与更新时间使用。';
 const assessment=assessEvidence(question,evidence);
 if(assessment.status==='missing_observation_data'){coverage_status='missing_observation_data';coverage_notice='无法依据现有资料给出该时空位置的实测数值。请提供带观测时间、站位/坐标、深度、变量、单位和质量标记的数据；当前教材和公开网页仅能解释原理。'}
 return {knowledge_scope:scope,coverage_status,coverage_notice,system:COURSE_SYSTEM+'\n'+rule+' 具体海况数值需使用匹配时间、站位、深度与变量的观测记录。',can_generate:assessment.can_answer_requested_numeric&&(scope==='general'||hasEvidence||template),evidence_assessment:assessment};
}

export function noteKnowledgeGap(state,question,now=Date.now()) {
 state.gaps=state.gaps||[];
 const text=String(question).trim().slice(0,600),existing=state.gaps.find(g=>g.question===text);
 if(existing){existing.count+=1;existing.last_seen=new Date(now).toISOString();return}
 state.gaps.unshift({id:crypto.randomUUID(),question:text,count:1,created_at:new Date(now).toISOString(),last_seen:new Date(now).toISOString(),status:'pending'});
 state.gaps=state.gaps.slice(0,40);
}
