/** Retrieval relevance and citation IDs are not semantic claim support. */
const variables={sound_speed:/声速|声音.*速度|sound speed/i,temperature:/海温|海水温度|水温|\btemperature\b/i,salinity:/盐度|salinity/i,sea_level:/海平面|潮位|sea level/i,wave_height:/浪高|波高|wave height/i,current_speed:/流速|海流速度|current speed/i,oxygen:/溶解氧|含氧量|dissolved oxygen/i};
const regions=['东海','南海','黄海','渤海','北海','日本海','太平洋','大西洋','印度洋','北冰洋','南大洋','east china sea','south china sea'];
const current=/今天|今日|现在|当前|此刻|实时|最新|此时|today|right now|\bcurrent(?:ly)?\b(?!\s+(?:speed|direction|meter|data))|latest|real.time/i;
const numeric=/多少|多高|多大|几度|几米|数值|测量值|实测值|观测值|是多少|哪个.*快|哪个.*高|how (?:much|high|fast)|what is.*(?:value|temperature|speed|level)/i;
const conceptual=/为什么|为何|如何|原理|机制|什么因素|有什么关系|是什么意思|是什么|怎么形成|方法|假设|理想|算例|研究|论文|why|mechanism|method|affect|definition/i;
export function observationRequirements(question){
 const text=String(question??'').toLowerCase(),found=Object.entries(variables).filter(([,pattern])=>pattern.test(text)).map(([name])=>name),locations=regions.filter(place=>text.includes(place));
 const year=text.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/),depth=text.match(/(\d+(?:\.\d+)?)\s*(千米|公里|km|米|m)(?:深|水深|处|深度)?/i);
 let depth_m=depth?Number(depth[1])*(['千米','公里','km'].includes(depth[2])?1000:1):null;
 if(depth_m===null)for(const [phrase,value] of [['一千米',1000],['一公里',1000],['一百米',100],['五百米',500],['两千米',2000],['二千米',2000]])if(text.includes(phrase)){depth_m=value;break}
 const implicit=!!(found.length&&(current.test(text)||(locations.length&&depth_m!==null))&&!conceptual.test(text));
 return {requires_observation:!!(found.length&&(numeric.test(text)||implicit)&&(current.test(text)||locations.length||year)),variables:found,locations,depth_m,current_requested:current.test(text),year:year?Number(year[0]):null,numeric_requested:numeric.test(text),implicit_numeric_requested:implicit};
}
function observationMatches(row,request,now){
 if(row.evidence_type!=='structured_observation'||row.verification_status!=='trusted_observation_adapter')return false;
 const value=row.observation||{};
 if(!request.variables.includes(value.variable)||!value.units||typeof value.value!=='number'||!Number.isFinite(value.value)||value.quality_control!=='accepted'||!row.source_id||!row.url)return false;
 if(!request.locations.length||!request.locations.some(place=>String(value.location||'').toLowerCase().includes(place)))return false;
 if(['sound_speed','temperature','salinity','oxygen'].includes(value.variable)&&(request.depth_m===null||value.depth_m!==request.depth_m))return false;
 const date=Date.parse(value.observed_at);if(!Number.isFinite(date))return false;
 if(request.current_requested)return now-date>=-300000&&now-date<=86400000;
 if(request.year)return new Date(date).getUTCFullYear()===request.year;
 return false;
}
export function assessEvidence(question,evidence=[],now=Date.now()){
 const request=observationRequirements(question),matching=evidence.filter(row=>request.requires_observation&&observationMatches(row,request,now)),observations=matching.map(row=>row.id);
 const missing=request.variables.flatMap(variable=>request.locations.filter(location=>!matching.some(row=>row.observation.variable===variable&&String(row.observation.location).toLowerCase().includes(location))).map(location=>({variable,location})));
 const blocked=request.requires_observation&&(!observations.length||!request.locations.length||missing.length>0);
 return {status:blocked?'missing_observation_data':observations.length?'structured_observation_available':evidence.length?'candidate_evidence_only':'no_evidence',candidate_count:evidence.length,candidate_ids:evidence.map(row=>row.id),claim_support_verified:false,semantic_support_checked:false,citation_role:'retrieval_candidates',observation_requirements:request,observation_ids:observations,missing_observation_pairs:missing,can_answer_requested_numeric:!blocked,note:blocked?'未检索到同时符合时间、海域、深度、变量、单位和质量控制要求的实测记录；教材典型值、历史案例、气候态与网页抓取时间均不能替代。':'当前资料仅为相关候选；尚未逐项核验生成答案与引用的蕴含关系。'};
}
export function annotateCandidates(evidence,question){const assessment=assessEvidence(question,evidence);return evidence.map(row=>({...row,support_status:'candidate_only',claim_support_verified:false,evidence_assessment:{status:assessment.status,requires_observation:assessment.observation_requirements.requires_observation,claim_support_verified:false}}))}
export function validateCitationIds(answer,evidence=[]){
 const known=new Set(evidence.map(row=>row.id)),used=[...new Set([...String(answer).matchAll(/\[([A-Za-z][A-Za-z0-9_.:-]{1,100})\]/g)].map(m=>m[1]))];
 const locators=[...new Map([...String(answer).matchAll(/\[([A-Za-z][A-Za-z0-9_-]{0,64})\s*,\s*(\d{1,5})\]/g)].map(m=>[m[1]+':'+Number(m[2]),{source_id:m[1],pdf_page:Number(m[2])}])).values()];
 const available=new Set(evidence.flatMap(row=>(row.all_references||[row]).map(ref=>ref.source_id+':'+ref.pdf_page)));
 return {used_ids:used,unknown_ids:used.filter(id=>!known.has(id)),known_ids:used.filter(id=>known.has(id)),used_source_locators:locators,unknown_source_locators:locators.filter(ref=>!available.has(ref.source_id+':'+ref.pdf_page)),claim_support_verified:false,check:'citation_id_and_locator_membership_only'};
}
