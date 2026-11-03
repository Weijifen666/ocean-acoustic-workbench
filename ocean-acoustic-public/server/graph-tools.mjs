// Read-only course graph operations. Selection is an explicit value, never global state.
const GROUPS=['hierarchy','prerequisite','related'];
const NOTE='父子关系表示课程层级，建议先学表示教学顺序，概念关联不等于物理因果或证明。';
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status})};
const copy=value=>structuredClone(value);
const normalize=value=>String(value).normalize('NFKC').toLowerCase().trim();
const ALIASES={'normal modes':'简正波','normal mode':'简正波','sound speed profile':'声速剖面','transmission loss':'传播损失','wavenumber integration':'波数积分','parabolic equation':'抛物方程','surface duct':'表面声道','deep sound channel':'深海声道','ray tracing':'射线','wave equation':'波动方程'};
function paging(offset,limit){if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50)fail('分页需要非负offset和1–50的limit');}
function page(items,offset,limit){paging(offset,limit);return {items:items.slice(offset,offset+limit),offset,limit,total:items.length,next_offset:offset+limit<items.length?offset+limit:null};}
function groups(value){if(!Array.isArray(value)||!value.length||value.some(v=>!GROUPS.includes(v)))fail('关系类型只能选择hierarchy、prerequisite或related');return [...new Set(value)];}
function direction(value){if(!['both','outgoing','incoming'].includes(value))fail('方向只能选择both、outgoing或incoming');return value;}
const nodeFields=['id','label','kind','chapter','overview','key_points','formula','conditions','misconception','tags','references','images','source_claim_ids'];
const nodeView=node=>Object.fromEntries(nodeFields.filter(key=>node[key]!==undefined).map(key=>[key,copy(node[key])]));

export function createGraphTools(graph){
 if(!graph||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))fail('图谱数据不可用',503);
 const snapshot=copy(graph),nodes=new Map(snapshot.nodes.map(n=>[n.id,n]));
 const requireNode=id=>{if(typeof id!=='string'||!nodes.has(id))fail('知识节点不存在',404);return nodes.get(id)};
 const edgeView=edge=>({...copy(edge),source_label:nodes.get(edge.source)?.label,target_label:nodes.get(edge.target)?.label,meaning:NOTE});
 function listNodes({query='',chapter=null,kind='knowledge',offset=0,limit=20}={}){
  if(typeof query!=='string'||query.length>200)fail('查询应为不超过200字符的文本');
  if(!['knowledge','chapter','course','all'].includes(kind))fail('节点类型无效');
  if(chapter!==null&&!snapshot.chapters.some(c=>c.id===chapter))fail('课程单元不存在',404);
  const q=normalize(query),words=q.split(/\s+/).filter(Boolean),expanded=[...new Set(Object.entries(ALIASES).filter(([term])=>q.includes(term)).map(([,term])=>term))];
  const rows=snapshot.nodes.filter(n=>(kind==='all'||n.kind===kind)&&(!chapter||n.chapter===chapter||n.id===chapter)).map(n=>{
   const label=normalize(n.label),text=normalize([n.id,n.label,n.overview,...(n.tags||[]),...(n.key_points||[])].join(' '));
   return {node:n,match:!q||text.includes(q)||words.every(word=>text.includes(word))||expanded.some(term=>text.includes(term)),score:label===q?4:label.includes(q)||expanded.some(term=>label.includes(term))?3:normalize(n.id).includes(q)?2:1};
  }).filter(row=>row.match).sort((a,b)=>b.score-a.score||a.node.id.localeCompare(b.node.id)).map(row=>nodeView(row.node));
  return {...page(rows,offset,limit),expanded_terms:expanded,relation_note:NOTE,read_only:true};
 }
 function readNode(id){return {...nodeView(requireNode(id)),relation_note:NOTE,read_only:true};}
 function readRelations({node_id,groups:types=GROUPS,direction:flow='both',offset=0,limit=20}={}){
  requireNode(node_id);const selected=groups(types);direction(flow);
  const rows=snapshot.edges.filter(e=>selected.includes(e.group)&&(flow==='outgoing'?e.source===node_id:flow==='incoming'?e.target===node_id:e.source===node_id||e.target===node_id)).map(edgeView);
  return {...page(rows,offset,limit),node_id,direction:flow,relation_note:NOTE,read_only:true};
 }
 function findPath({source,target,groups:types=['related'],direction:flow='both',max_depth=8}={}){
  requireNode(source);requireNode(target);const selected=groups(types);direction(flow);
  if(!Number.isInteger(max_depth)||max_depth<1||max_depth>12)fail('路径深度应为1–12');
  const queue=[{ids:[source],edges:[]}],seen=new Set([source]);
  while(queue.length){const current=queue.shift(),id=current.ids.at(-1);
   if(id===target)return {found:true,nodes:current.ids.map(id=>nodeView(nodes.get(id))),edges:current.edges,groups:selected,direction:flow,relation_note:NOTE,read_only:true};
   if(current.edges.length>=max_depth)continue;
   for(const edge of snapshot.edges){if(!selected.includes(edge.group))continue;
    const next=edge.source===id&&flow!=='incoming'?edge.target:edge.target===id&&flow!=='outgoing'?edge.source:null;
    if(next&&!seen.has(next)){seen.add(next);queue.push({ids:[...current.ids,next],edges:[...current.edges,{...edgeView(edge),traversed_from:id,traversed_to:next,traversed_reverse:edge.source!==id}]});}
   }
  }
  return {found:false,nodes:[],edges:[],groups:selected,direction:flow,max_depth,relation_note:NOTE,read_only:true};
 }
 function selection(node_ids=[]){
  if(!Array.isArray(node_ids)||node_ids.length>8||node_ids.some(id=>typeof id!=='string'))fail('最多选择8个知识点ID');
  const ids=[...new Set(node_ids)];for(const id of ids)if(requireNode(id).kind!=='knowledge')fail('对话上下文只能选择知识点');
  return {node_ids:ids,nodes:ids.map(id=>nodeView(nodes.get(id))),edges:snapshot.edges.filter(e=>ids.includes(e.source)&&ids.includes(e.target)).map(edgeView),
   evidence_type:'explicit_graph_selection',selection_scope:'current_request',relation_note:NOTE,read_only:true};
 }
 function selectionEvidence(node_ids=[]){
  const selected=selection(node_ids);
  return selected.nodes.flatMap(node=>{
   const id=node.source_claim_ids?.find(value=>typeof value==='string'&&value),reference=node.references?.find(value=>typeof value?.source_id==='string'&&value.source_id);
   if(!id||!reference)return [];
   const row={id,node_id:node.id,label:node.label,text:[node.overview,...(node.key_points||[])].filter(Boolean).join(' '),formula:node.formula||'',conditions:node.conditions||'适用条件请参见原始资料。',source_id:reference.source_id,pdf_page:reference.pdf_page||null,locator:reference.locator||'',all_references:copy(node.references),evidence_type:'knowledge_card',retrieval:{methods:['explicit_graph_selection'],role:'explicit_graph_selection',focus:true,support_status:'candidate_only',claim_support_verified:false},related_triples:selected.edges.filter(edge=>edge.source===node.id||edge.target===node.id).map(edge=>({source:edge.source_label,target:edge.target_label,relation:edge.label,relation_kind:edge.group,note:NOTE}))};
   row.citation={id,label:row.label,node_id:node.id,source_id:row.source_id,pdf_page:row.pdf_page,locator:row.locator,url:row.pdf_page?`/api/source/${row.source_id}/page/${row.pdf_page}`:reference.url||reference.code_url||null,evidence_type:'knowledge_card',citation_role:'retrieval_candidate',claim_support_verified:false};
   return [row];
  });
 }
 return {listNodes,readNode,readRelations,findPath,selection,selectionEvidence};
}

export const GRAPH_TOOL_SPECS=[
 ['search_graph_nodes','按标题、术语、单元查找课程知识节点；默认20项，使用next_offset续页',{query:{type:'string'},chapter:{type:'string'},offset:{type:'integer'},limit:{type:'integer'}},[]],
 ['read_graph_node','读取真实知识节点、公式、适用条件与来源；不生成或改写正式图谱',{id:{type:'string'}},['id']],
 ['read_graph_relations','读取节点有类型的原始关系，区分课程层级、先学顺序和概念关联',{node_id:{type:'string'},groups:{type:'array',items:{type:'string',enum:GROUPS}},direction:{type:'string',enum:['both','outgoing','incoming']},offset:{type:'integer'},limit:{type:'integer'}},['node_id']],
 ['find_graph_path','在已有关系中查找连接路径；反向遍历有明确标记，路径不等于物理因果',{source:{type:'string'},target:{type:'string'},groups:{type:'array',items:{type:'string',enum:GROUPS}},direction:{type:'string',enum:['both','outgoing','incoming']},max_depth:{type:'integer'}},['source','target']],
 ['select_graph_nodes','返回最多8个真实知识点及其内部关系作为本次研究上下文；不修改正式图谱',{node_ids:{type:'array',items:{type:'string'},maxItems:8}},['node_ids']],
].map(([name,description,properties,required])=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}}));

export function executeGraphTool(api,name,args={}){
 if(name==='search_graph_nodes')return api.listNodes(args);
 if(name==='read_graph_node')return api.readNode(args.id);
 if(name==='read_graph_relations')return api.readRelations(args);
 if(name==='find_graph_path')return api.findPath(args);
 if(name==='select_graph_nodes')return api.selection(args.node_ids);
 fail('未知图谱工具');
}
