export const MAX_GRAPH_SELECTION=8;
export function normalizeKnowledgeSelection(nodes=[]){
 if(!Array.isArray(nodes))throw Error('知识点选取必须为列表');
 const result=[],seen=new Set();
 for(const node of nodes){
  if(!node||typeof node.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(node.id))throw Error('知识点标识无效');
  if(seen.has(node.id))continue;seen.add(node.id);
  result.push({id:node.id,label:typeof node.label==='string'&&node.label.trim()?node.label.slice(0,120):node.id});
 }
 if(result.length>MAX_GRAPH_SELECTION)throw Error('最多选择8个知识点');
 return result;
}
export function toggleKnowledgeSelection(nodes,node){
 const current=normalizeKnowledgeSelection(nodes),item=normalizeKnowledgeSelection([node])[0];
 return current.some(n=>n.id===item.id)?current.filter(n=>n.id!==item.id):normalizeKnowledgeSelection([...current,item]);
}
export function knowledgeRequestIds(nodes=[]){return normalizeKnowledgeSelection(nodes).map(node=>node.id);}
export function createKnowledgeDraft(value){
 const nodes=normalizeKnowledgeSelection(Array.isArray(value)?value:[value]);
 if(!nodes.length)throw Error('请先选择知识点');
 const names=nodes.map(n=>'“'+n.label+'”').join('、');
 return {id:crypto.randomUUID(),knowledge_nodes:nodes,text:nodes.length===1
  ?`请解释知识图谱中的${names}，结合公式、适用条件和相关知识点，并给出资料出处。`
  :`请结合知识图谱中选取的${names}，解释各自的适用条件并查找它们已有的关联路径，区分课程层级、建议先学和概念关联，给出资料出处。`};
}
