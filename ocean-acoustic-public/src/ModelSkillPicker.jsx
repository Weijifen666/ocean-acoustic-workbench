import React,{useState} from 'react';
import {modelWorkflows,modelSkillPrompt} from './modelSkills';
export default function ModelSkillPicker({onSelect,disabled}){
 const [model,setModel]=useState('kraken');
 const recipe=modelWorkflows.find(r=>r.id===model);
 return <details className="chat-model-skills"><summary>模型构造 Skill · 选择模型与创建流程</summary><div className="chat-toolbar"><label>模型流程 <select aria-label="模型构造Skill" disabled={disabled} value={model} onChange={e=>setModel(e.target.value)}>{modelWorkflows.map(r=><option key={r.id} value={r.id}>{r.name}{r.supported?'':' · 暂不可运行'}</option>)}</select></label><button className="button" disabled={disabled} onClick={()=>onSelect(modelSkillPrompt(model))}>规划自定义研究</button><button className="button" disabled={disabled||!recipe.supported} onClick={()=>onSelect(modelSkillPrompt(model,true))}>规划经典算例复现</button></div><p className="result-note">载入技能 → 检查条件 → 形成输入计划 → 节点执行与验证。点击先填入消息；公共站仅调用已开放工具，不执行任意脚本。{!recipe.supported&&recipe.unavailable_reason}</p></details>
}
