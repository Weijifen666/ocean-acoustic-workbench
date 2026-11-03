import React from 'react';
import {Copy,Waves} from 'lucide-react';

const labels={dsh:'DSH',codex:'Codex',api:'模型接口'};

// Both workbenches share bubbles while retaining their renderer and protocol.
export default function DialogueMessage({text,role='assistant',index=0,onCopy,streaming=false,backend,children,renderAnswer=value=>value}){
 const user=role==='user';
 return <article className={'dialogue-message '+(user?'user':'assistant')+(streaming?' streaming':'')} aria-label={user?'你的消息':'Agent 回答'}>
  <div className="dialogue-avatar" aria-hidden="true">{user?'我':<Waves size={17}/>}</div>
  <div className="dialogue-content">
   <div className="dialogue-message-label"><span>{user?'你':'海洋声学 Agent'}</span>{streaming&&<span className="dialogue-generating">{labels[backend]||'Agent'} · 正在回答</span>}</div>
   <div className="dialogue-bubble">
    {user?<div className="dialogue-user-text">{text}</div>:text?renderAnswer(text):streaming&&!children?<span className="dialogue-generating">正在整理思路…</span>:null}
    {children}
   </div>
   {!streaming&&typeof onCopy==='function'&&<div className="dialogue-message-actions"><button type="button" aria-label={'复制第'+(index+1)+'条消息'} title="复制消息" onClick={()=>onCopy(text)}><Copy size={13}/><span>复制</span></button></div>}
  </div>
 </article>;
}
