import React from 'react';
import './graph-selection.css';

export default function GraphSelection({nodes=[],onRemove,onClear,onAsk,disabled=false,title='本次问题的图谱上下文'}){
 if(!nodes.length)return null;
 return <section className="graph-selection" aria-label={title}>
  <div className="graph-selection-title"><strong>{title} · {nodes.length}/8</strong><button type="button" disabled={disabled} onClick={onClear}>清除选取</button></div>
  <div className="graph-selection-items">{nodes.map(node=><button type="button" key={node.id} disabled={disabled} onClick={()=>onRemove(node.id)} aria-label={'移除知识点 '+node.label}>{node.label}<span aria-hidden="true"> ×</span></button>)}</div>
  {onAsk&&<button type="button" className="graph-selection-ask" disabled={disabled} onClick={onAsk}>带所选知识提问</button>}
  <small>来自课程图谱的明确选取；连接关系不等于物理因果。</small>
 </section>;
}
