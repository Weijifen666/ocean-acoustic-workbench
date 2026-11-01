import React, {useEffect, useState} from 'react';
import DialogueWorkbench from './DialogueWorkbench';
import CourseChat from './CourseChat';
import RichMessage from './RichMessage';

function SimulationChat({openSettings, notify}) {
  const [session, setSession] = useState(() => localStorage.getItem('ocean-natural-session') || 'natural:' + crypto.randomUUID());
  const [rows, setRows] = useState([]), [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    localStorage.setItem('ocean-natural-session', session);
    let active = true;
    fetch('/api/chat/history?session=' + encodeURIComponent(session)).then(async r => {
      if (!r.ok) throw Error('无法载入仿真对话');
      const data = await r.json();
      if (active) setRows(Array.isArray(data) ? data : data.messages || []);
    }).catch(e => {if (active) setError(e.message)});
    return () => {active = false};
  }, [session]);
  async function send(event) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    const message = text.trim(); setText(''); setBusy(true); setError('');
    setRows(old => [...old, {role:'user', text:message}]);
    try {
      const response = await fetch('/api/simulation/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message, session, mode:'agent'})});
      const data = await response.json();
      if (!response.ok) throw Error(typeof data.detail === 'string' ? data.detail : '仿真请求未完成');
      setRows(old => [...old, {role:'assistant', text:data.reply, ...data}]);
    } catch (e) {setError(e.message); notify?.(e.message)} finally {setBusy(false)}
  }
  return <section className="panel" style={{padding:20}}>
    <div className="panel-heading"><span>自然语言仿真</span><button disabled={busy} onClick={() => {setRows([]); setError(''); setSession('natural:' + crypto.randomUUID())}}>新建对话</button><button onClick={openSettings}>模型与 MATLAB 设置</button></div>
    <p>描述声学问题，使用基准 Cookbook、解析射线或 Python / MATLAB 计算；生成的任务与图表也会出现在“任务与结果”。</p>
    {!rows.length && <p>例如：用射线声学计算水深 100m、源深 50m、传播距离 5km 的声线。</p>}
    <div role="log" aria-live="polite" style={{maxHeight:'60vh',overflowY:'auto'}}>{rows.map((row,i) => <article key={row.id || i} className={'message '+row.role}><div className="message-content"><strong>{row.role === 'user' ? '你' : '仿真助手'}</strong>{row.role === 'assistant' ? <RichMessage message={row} onSettings={openSettings}/> : <p style={{whiteSpace:'pre-wrap'}}>{row.text}</p>}</div></article>)}</div>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={send}><textarea aria-label="自然语言仿真需求" value={text} onChange={e => setText(e.target.value)} rows={4} style={{width:'100%'}}/><button type="submit" disabled={busy || !text.trim()}>{busy ? '正在计算与分析…' : '运行仿真'}</button></form>
  </section>;
}

export default function IntegratedDialogue(props) {
  const [mode, setMode] = useState('research');
  useEffect(() => {if (props.draft) setMode('research')}, [props.draft]);
  return <div><nav aria-label="对话模式" className="panel-heading" style={{gap:12,marginBottom:12}}>{[['research','研究代理'],['simulation','自然语言仿真'],['course','课程问答']].map(([id,title]) => <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>{title}</button>)}</nav>
    <div hidden={mode !== 'research'}><DialogueWorkbench {...props}/></div>
    <div hidden={mode !== 'simulation'}><SimulationChat {...props}/></div>
    <div hidden={mode !== 'course'}><CourseChat {...props}/></div>
  </div>;
}
