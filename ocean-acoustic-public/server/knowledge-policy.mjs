import {COURSE_SYSTEM} from './course-retrieval.mjs';

export function answerPolicy(evidence,scope='course',mode='chat') {
 if(!['course','general'].includes(scope))throw new Error('请选择课程依据或模型一般知识');
 const hasEvidence=evidence.length>0,template=mode==='agent',hasPublic=evidence.some(c=>/public|web/.test(c.evidence_type||''));
 const coverage_status=hasEvidence?'course_evidence':template?'course_template':'no_course_evidence';
 const coverage_notice=hasEvidence
  ? scope==='course'?`本次使用检索到的${hasPublic?'课程或公开':'课程'}资料；引用不表示知识库覆盖了全部海洋知识。`:'资料依据与模型一般知识须分别说明；一般知识尚未经本项目原文核验。'
  : template?'本次分析课程共享模板；未检索到对应课程正文。'
  : scope==='course'?'未检索到课程依据。可切换到模型一般知识，或补充对应资料。':'未检索到课程依据；本次使用模型一般知识，尚未经本项目资料核验。';
 const rule=scope==='course'
  ? '当前选择【仅依据资料】。结论只基于本次课程或公开资料片段和允许读取的模板；资料不足时明确缺口，不用一般知识伪装成引用。'
  : '当前选择【资料 + 模型知识】。允许使用模型已有的一般知识回答资料未覆盖的问题。将【检索资料依据】与【模型一般知识，未经本项目原文核验】明确区分；只引用本次真正提供的片段，没有片段时不生成资料引用。公开资料是带抓取时间的快照，不声称已经实时搜索互联网或读过未提供的文献。';
 return {knowledge_scope:scope,coverage_status,coverage_notice,system:COURSE_SYSTEM+'\n'+rule,can_generate:scope==='general'||hasEvidence||template};
}

export function noteKnowledgeGap(state,question,now=Date.now()) {
 state.gaps=state.gaps||[];
 const text=String(question).trim().slice(0,600),existing=state.gaps.find(g=>g.question===text);
 if(existing){existing.count+=1;existing.last_seen=new Date(now).toISOString();return}
 state.gaps.unshift({id:crypto.randomUUID(),question:text,count:1,created_at:new Date(now).toISOString(),last_seen:new Date(now).toISOString(),status:'pending'});
 state.gaps=state.gaps.slice(0,40);
}
