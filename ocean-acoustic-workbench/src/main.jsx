import React,{useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import GraphExplorer from './GraphExplorer';
import ModelPanel from './ModelPanel';
import MatlabPanel from './MatlabPanel';
import {Waves,MessageSquare,Network,FlaskConical,FolderCode,Settings2,Activity,ArrowUpRight,ChevronRight,Search,Maximize2,Plus,Minus,RotateCcw,BookOpen,ExternalLink,ArrowUp,Play,Pause,Check,AlertCircle,X,Download,FileText,Terminal,GitBranch,SlidersHorizontal,Image as ImageIcon,Loader2,CheckCircle2,Save,PanelRightClose,Cpu} from 'lucide-react';
import './style.css';
const api=async(path,options={})=>{const r=await fetch('/api'+path,{headers:{'Content-Type':'application/json'},...options});if(!r.ok){const data=await r.json().catch(()=>({detail:r.statusText}));throw Error(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail));}return r.json()};
const stateName={QUEUED:'排队中',RUNNING:'运行中',SUCCEEDED:'已完成',FAILED:'失败',CANCELLED:'已取消'};
const relationName={has_boundary:'边界条件',affects:'影响',formed_by:'组成',requires:'需要',differs_from:'不同于',calls_afterkraken:'随后调用',has_axes:'数据维度',observes:'观测'};
const pages=[['graph','知识图谱',Network],['chat','对话工作台',MessageSquare],['simulation','声场仿真',FlaskConical],['project','项目文件',FolderCode],['jobs','任务与结果',Activity]];
const classes={'声学原理':'#15868e','工具与数据':'#657bac','实验观测':'#b48747'};
function Button({children,onClick,variant='',disabled=false,type='button',title,ariaLabel}){return <button type={type} title={title} aria-label={ariaLabel} disabled={disabled} className={'button '+variant} onClick={onClick}>{children}</button>}
function Badge({state}){return <span className={'badge '+state.toLowerCase()}><i/>{stateName[state]}</span>}
function App(){
 const [page,setPage]=useState('graph'),[initialQuestion,setInitialQuestion]=useState(null),[health,setHealth]=useState(null),[toast,setToast]=useState(''),[image,setImage]=useState(null),[refresh,setRefresh]=useState(0),[activeJob,setActiveJob]=useState(null),[settingsTab,setSettingsTab]=useState('matlab');
 useEffect(()=>{let alive=true;const fetch=()=>api('/health').then(x=>alive&&setHealth(x)).catch(e=>alive&&setToast(e.message));fetch();const t=setInterval(fetch,7000);return()=>{alive=false;clearInterval(t)}},[refresh]);
 useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),7000);return()=>clearTimeout(t)}},[toast]);
 const title=pages.find(x=>x[0]===page)?.[1]||'环境配置';
 return <div className="app"><aside className="sidebar"><div className="brand"><span className="brand-icon"><Waves size={23}/></span><div>海洋声学<span>Ocean Acoustics</span></div></div><div className="side-label">工作空间</div><nav>{pages.map(([id,label,Icon])=><button key={id} className={page===id?'nav-item active':'nav-item'} onClick={()=>setPage(id)}><Icon size={18}/>{label}{id==='graph'&&<span className="nav-count">{health?.knowledge_cards||46}</span>}</button>)}</nav><div className="sidebar-note"><GitBranch size={16}/><div>课程资源项目<span>Munk 深海示例 · 本地工作区</span></div></div><div className="side-bottom"><button className={page==='settings'?'nav-item active':'nav-item'} onClick={()=>{setSettingsTab('matlab');setPage('settings');}}><Settings2 size={18}/>环境配置</button><div className="local-status"><i className={health?'green':'orange'}/><span>{health?'本地服务已连接':'正在连接本地服务'}</span><small>v0.2</small></div><div className="team">高嘉豪 · 周子涵 · 刘继洲 · 李杰</div></div></aside><div className="main"><header><div className="breadcrumb">海洋声学工作台<ChevronRight size={14}/><strong>{title}</strong></div><div className="header-status"><button className="matlab-header-btn" title="点击配置 MATLAB 与声学工具箱" onClick={()=>{setSettingsTab('matlab');setPage('settings');}}><i className={health?.matlab_available?'green':'orange'}/><span>MATLAB {health?.matlab_version||'内核'}</span><span className="mini-badge">{health?.matlab_available?'就绪':'待配置'}</span></button><button onClick={()=>{setSettingsTab('model');setPage('settings');}}><span className={'mini-dot '+(health?.model_configured?'green':'orange')}/>{health?.model_name||'选择具体模型'}{health?.model_configured?'':' · 待配置'}<ChevronRight size={13}/></button></div></header><main>
 {page==='graph'&&<GraphExplorer setImage={setImage} notify={setToast} onAsk={node=>{setInitialQuestion({id:Date.now(),text:`请解释知识图谱中的“${node.label}”，结合公式、适用条件和相关知识点，并给出资料出处。`});setPage('chat')}} onSimulation={()=>setPage('simulation')}/>}
 {page==='chat'&&<ChatView initialQuestion={initialQuestion} health={health} notify={setToast} openSettings={(tab='matlab')=>{setSettingsTab(tab);setPage('settings');}} setImage={setImage}/>}
 {page==='simulation'&&<Simulation notify={setToast} onSubmit={id=>{setActiveJob(id);setPage('jobs')}}/>}
 {page==='project'&&<Project notify={setToast}/>}
 {page==='jobs'&&<Jobs notify={setToast} activeJob={activeJob} setActiveJob={setActiveJob} openSim={()=>setPage('simulation')} setImage={setImage}/>}
 {page==='settings'&&<Config notify={setToast} onSaved={()=>setRefresh(x=>x+1)} activeTab={settingsTab} setActiveTab={setSettingsTab}/>}
 </main></div>{toast&&<div className="toast"><AlertCircle size={17}/>{toast}<button onClick={()=>setToast('')}><X size={15}/></button></div>}{image&&<div className="modal-backdrop" onClick={()=>setImage(null)}><div className="image-modal" onClick={e=>e.stopPropagation()}><div className="modal-title">{image.caption}<button aria-label="关闭图片" onClick={()=>setImage(null)}><X/></button></div><img src={image.url} alt={image.caption}/>{image.source_url&&<a target="_blank" rel="noreferrer" href={image.source_url}>查看原始来源 <ExternalLink size={14}/></a>}</div></div>}</div>
}
function PageTitle({eyebrow,title,description,children}){return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description&&<p>{description}</p>}</div><div className="page-actions">{children}</div></div>}
function FormattedText({text, setImage}){
 if(!text)return null;
 const lines=text.split('\n');
 return (
  <div className="formatted-chat-msg">
   {lines.map((line,idx)=>{
    const imgMatch=line.match(/^!\[(.*?)\]\((.*?)\)$/);
    if(imgMatch){
     const caption=imgMatch[1];
     const url=imgMatch[2];
     return (
      <div key={idx} style={{margin:'10px 0'}}>
       <div
        style={{border:'1px solid #d2e1e6',borderRadius:8,overflow:'hidden',background:'#f8fbfc',cursor:'pointer',boxShadow:'0 2px 6px rgba(0,0,0,0.05)'}}
        onClick={()=>setImage&&setImage({url,caption:caption||'声场计算结果'})}
       >
        <img src={url} alt={caption} style={{width:'100%',display:'block'}}/>
        <div style={{padding:'6px 12px',fontSize:11,color:'#4b7582',display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'1px solid #e5eff2'}}>
         <span>🖼️ {caption}</span>
         <small style={{color:'#15868e',fontWeight:500}}>点击放大查看 🔍</small>
        </div>
       </div>
      </div>
     );
    }
    const linkMatch=line.match(/\[(.*?)\]\((.*?)\)/);
    if(linkMatch){
     const parts=line.split(/\[.*?\]\(.*?\)/);
     return (
      <div key={idx} style={{margin:'4px 0'}}>
       {parts[0]}
       <a href={linkMatch[2]} target="_blank" rel="noreferrer" style={{color:'#13868e',textDecoration:'underline',fontWeight:500}}>
        {linkMatch[1]}
       </a>
       {parts[1]||''}
      </div>
     );
    }
    if(line.startsWith('### ')){
     return <h3 key={idx} style={{fontSize:14,margin:'10px 0 4px',color:'#13868e',fontWeight:600}}>{line.slice(4)}</h3>;
    }
    if(line.startsWith('#### ')){
     return <h4 key={idx} style={{fontSize:12,margin:'8px 0 3px',color:'#2b5866',fontWeight:600}}>{line.slice(5)}</h4>;
    }
    if(line.trim()===''){
     return <div key={idx} style={{height:6}}/>;
    }
    return <div key={idx} style={{margin:'2px 0'}}>{line}</div>;
   })}
  </div>
 );
}
function ChatView({health,notify,openSettings,initialQuestion,setImage}){
 const [mode,setMode]=useState('agent'),[text,setText]=useState(''),[msgs,setMsgs]=useState([]),[busy,setBusy]=useState(false);const bottom=useRef(null);
 useEffect(()=>{api('/chat/history').then(setMsgs).catch(e=>notify(e.message))},[]);useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'})},[msgs,busy]);
 async function send(){if(!text.trim()||busy)return;const message=text;setText('');setMsgs(m=>[...m,{role:'user',text:message}]);setBusy(true);try{const r=await api('/chat',{method:'POST',body:JSON.stringify({message,mode})});setMsgs(m=>[...m,{role:'assistant',text:r.reply}])}catch(e){notify(e.message);setMsgs(m=>[...m,{role:'assistant',text:'请求未完成：'+e.message}])}finally{setBusy(false)}}
 useEffect(()=>{if(initialQuestion)setText(initialQuestion.text)},[initialQuestion]);
 return <><PageTitle eyebrow="ACOUSTIC ASSISTANT" title="海洋声学智能体" description="自然语言指令分解、声场建模仿真与多维度声学机理分析。"><div className="segmented">{[['agent','Agent 仿真模式'],['chat','知识问答模式']].map(([id,name])=><button className={mode===id?'active':''} key={id} onClick={()=>setMode(id)}>{id==='agent'?<FlaskConical size={14}/>:<MessageSquare size={14}/>} {name}</button>)}</div></PageTitle><div className="chat-layout"><div className="chat-panel panel"><div className="chat-scroll">{msgs.length===0&&<div className="chat-welcome"><span className="welcome-logo"><Waves size={32}/></span><h2>自然语言驱动海洋声学仿真</h2><p>说出一个声学任务，智能体将自动提取参数、调度 MATLAB 求解并解读声场。</p><div className="prompt-grid">{['帮我在深海声道轴(1000m)处仿真 50Hz 声场并分析传播损失','对比声源 500m 与 1000m 时 50km 内的传播损失','声源深度如何影响模态激发？','相干与非相干模态求和有什么区别？'].map(s=><button key={s} onClick={()=>setText(s)}><span>{s}</span><ArrowUpRight size={17}/></button>)}</div></div>}{msgs.map((m,i)=><div className={'message '+m.role} key={m.id||i}><div className="avatar">{m.role==='assistant'?<Waves size={17}/>: '我'}</div><div><div className="message-label">{m.role==='assistant'?'海洋声学助手':'你'}</div><div className="message-text"><FormattedText text={m.text} setImage={setImage}/></div></div></div>)}{busy&&<div className="thinking"><Loader2 className="spin" size={16}/>正在解析任务并调度 MATLAB 计算声场，请稍候…</div>}<div ref={bottom}/></div><div className="composer"><textarea aria-label="输入问题" placeholder={mode==='agent'?'输入仿真任务（例如：帮我仿真 50Hz 源深 1000m 接收 1000m 在 50km 内的传播损失）...':'输入海洋声学原理问题…'} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}/><div><span><BookOpen size={13}/>{health?.model_configured?'云端大模型 Agent 已就绪':'离线声学智能体已就绪 (支持一句话自动仿真)'}</span><Button ariaLabel="发送问题" variant="primary icon" disabled={busy||!text.trim()} onClick={send}><ArrowUp size={18}/></Button></div></div></div><aside className="chat-context panel"><div className="panel-heading">智能体能力与上下文</div><div className="context-item"><FlaskConical size={19}/><div>KRAKEN 仿真执行器<span>Munk 5000 m · MATLAB R2024b</span></div></div><div className="context-item"><BookOpen size={19}/><div>课程知识库<span>{health?.knowledge_cards||46} 张知识卡 · 20 份来源</span></div></div><div className="context-item"><FolderCode size={19}/><div>本地项目环境<span>支持任务编排与图表导出</span></div></div><div className="context-note"><strong>{mode==='agent'?'自然语言仿真 Agent':'知识问答状态'}</strong><p>{mode==='agent'?'已接通自然语言任务拆解与全自动 MATLAB 计算闭环！支持提取频率、源深、接收深度，自动绘制 TL 二维图并分析物理机理。':health?.model_configured?'已启用云端大模型接口。回答严格对应课程知识点。':'未配置 API Key 时可直接体验离线自然语言仿真与知识卡检索。'}</p></div><div style={{display:'flex',flexDirection:'column',gap:8,marginTop:15}}><Button onClick={()=>openSettings('matlab')}><Terminal size={15}/>配置 MATLAB 工具箱</Button><Button onClick={()=>openSettings('model')}><Settings2 size={15}/>配置模型接口</Button></div></aside></div></>
}
const initialPlan={frequencies_hz:'50, 100',source_depths_m:'500, 1000',receiver_depth_m:1000,range_min_km:1,range_max_km:50,range_points:201,depth_points:251};
function Simulation({notify,onSubmit}){
 const [form,setForm]=useState(initialPlan),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false);const set=(key,value)=>{setForm(f=>({...f,[key]:value}));setPreview(null)};
 const plan=()=>({...form,frequencies_hz:form.frequencies_hz.split(/[,，\s]+/).filter(Boolean).map(Number),source_depths_m:form.source_depths_m.split(/[,，\s]+/).filter(Boolean).map(Number),receiver_depth_m:Number(form.receiver_depth_m),range_min_km:Number(form.range_min_km),range_max_km:Number(form.range_max_km),range_points:Number(form.range_points),depth_points:Number(form.depth_points)});
 async function check(){try{setPreview(await api('/plans/preview',{method:'POST',body:JSON.stringify(plan())}))}catch(e){notify(e.message)}}
 async function run(){setBusy(true);try{const r=await api('/jobs',{method:'POST',body:JSON.stringify(plan())});notify('已提交 '+r.ids.length+' 组真实 MATLAB 计算');onSubmit(r.ids[0])}catch(e){notify(e.message)}finally{setBusy(false)}}
 return <><PageTitle eyebrow="SIMULATION STUDIO" title="配置声场仿真" description="确认环境与参数后，由本机 MATLAB 执行计算。"/><div className="simulation-layout"><section className="panel sim-form"><div className="panel-heading"><span>01 <b>环境与求解器</b></span><span className="tag">已接入</span></div><div className="template-card"><div className="template-icon"><Waves size={28}/></div><div><h3>Munk 深海声道</h3><p>水深 5000 m · 声速剖面来自教师示例</p><small>KRAKEN / FIELD · 相干简正波</small></div><CheckCircle2 size={20}/></div><div className="inline-note"><AlertCircle size={14}/>示例环境不代表指定真实海域。首版暂不开放任意环境编辑。</div><div className="panel-heading second"><span>02 <b>频率与深度</b></span></div><div className="form-grid"><Field label="频率组合" unit="Hz" hint="10–200 Hz，用逗号分隔"><input value={form.frequencies_hz} onChange={e=>set('frequencies_hz',e.target.value)}/></Field><Field label="声源深度组合" unit="m" hint="0–5000 m，用逗号分隔"><input value={form.source_depths_m} onChange={e=>set('source_depths_m',e.target.value)}/></Field><Field label="接收深度" unit="m" hint="返回最近网格点的实际深度"><input type="number" value={form.receiver_depth_m} onChange={e=>set('receiver_depth_m',e.target.value)}/></Field><Field label="接收深度网格" unit="点" hint="覆盖 0–5000 m"><select value={form.depth_points} onChange={e=>set('depth_points',e.target.value)}>{[101,251,501].map(n=><option key={n}>{n}</option>)}</select></Field></div><div className="panel-heading second"><span>03 <b>距离与网格</b></span></div><div className="form-grid three"><Field label="起始距离" unit="km"><input type="number" value={form.range_min_km} onChange={e=>set('range_min_km',e.target.value)}/></Field><Field label="终止距离" unit="km"><input type="number" value={form.range_max_km} onChange={e=>set('range_max_km',e.target.value)}/></Field><Field label="距离网格" unit="点"><select value={form.range_points} onChange={e=>set('range_points',e.target.value)}>{[101,201,501].map(n=><option key={n}>{n}</option>)}</select></Field></div><div className="form-footer"><span>参数修改后需重新检查</span><Button onClick={check}><Check size={16}/>检查并生成计划</Button></div></section><aside className="panel plan-panel"><div className="panel-heading">计算计划 <FlaskConical size={17}/></div>{preview?<><div className="case-number">{preview.case_count}<span>组独立计算</span></div><div className="case-list">{preview.cases.map((c,i)=><div key={i}><small>{String(i+1).padStart(2,'0')}</small><span>{c.frequency_hz} Hz</span><span>源深 {c.source_depth_m} m</span></div>)}</div><div className="plan-notes">{preview.warnings.map(s=><p key={s}><AlertCircle size={13}/>{s}</p>)}</div><Button variant="primary wide" disabled={busy} onClick={run}><Play size={16}/>确认并运行 MATLAB</Button></>:<div className="empty compact"><SlidersHorizontal size={35}/><h3>等待参数确认</h3><p>配置左侧参数并检查，查看组合与计算范围。</p></div>}<div className="plan-foot"><Terminal size={14}/>独立目录 · 串行运行 · 保留日志</div></aside></div></>
}
function Field({label,unit,hint,children}){return <label className="field"><span>{label}<small>{unit}</small></span>{children}{hint&&<em>{hint}</em>}</label>}
function Jobs({notify,activeJob,setActiveJob,openSim,setImage}){
 const [jobs,setJobs]=useState([]),[detail,setDetail]=useState(null),[tab,setTab]=useState('result'),[paused,setPaused]=useState(false);
 useEffect(()=>{let alive=true;const poll=async()=>{try{const list=await api('/jobs');if(!alive)return;setJobs(list);const health=await api('/health');setPaused(health.paused);const id=activeJob||list[0]?.id;if(id)setDetail(await api('/jobs/'+id))}catch(e){notify(e.message)}};poll();const t=setInterval(poll,3000);return()=>{alive=false;clearInterval(t)}},[activeJob]);
 async function cancel(){try{await api('/jobs/'+detail.id+'/cancel',{method:'POST'});setDetail(await api('/jobs/'+detail.id))}catch(e){notify(e.message)}}
 async function pause(){try{const r=await api('/queue/pause',{method:'POST',body:JSON.stringify({paused:!paused})});setPaused(r.paused)}catch(e){notify(e.message)}}
 async function rerun(){try{const p=detail.plan;const r=await api('/jobs',{method:'POST',body:JSON.stringify({...p,frequencies_hz:[p.frequency_hz],source_depths_m:[p.source_depth_m]})});setActiveJob(r.ids[0])}catch(e){notify(e.message)}}
  const getJobTitle=(p)=>{
    if(!p)return '未知任务';
    if(p.task_type==='shallow_water_ray_tracing')return `浅海射线 · 水深 ${p.water_depth_m}m · 源深 ${p.source_depth_m}m`;
    if(p.task_type==='custom_sandbox_code')return `代码沙箱 · ${p.description||'动态计算'}`;
    return `${p.frequency_hz||'50'} Hz · 源深 ${p.source_depth_m||'1000'} m`;
  };
  const getJobHeader=(p)=>{
    if(!p)return '仿真任务';
    if(p.task_type==='shallow_water_ray_tracing')return `浅海射线追踪 · 水深 ${p.water_depth_m} m / 源深 ${p.source_depth_m} m`;
    if(p.task_type==='custom_sandbox_code')return `代码沙箱求解 · ${p.description||'自定义计算'}`;
    return `${p.frequency_hz} Hz / 源深 ${p.source_depth_m} m`;
  };
  const getMetrics=(d)=>{
    if(!d?.summary)return [];
    if(d.summary.shape)return [['有效比例',(d.summary.valid_ratio*100).toFixed(1)+'%'],['中位 TL',d.summary.tl_median_db.toFixed(2)+' dB'],['接收深度',d.summary.actual_receiver_depth_m+' m'],['结果网格',d.summary.shape.join(' × ')]];
    if(d.plan?.task_type==='shallow_water_ray_tracing')return [['水深',d.plan.water_depth_m+' m'],['声速',d.plan.sound_speed_mps+' m/s'],['计算距离',d.plan.range_max_km+' km'],['角度组数',d.plan.angles_deg?.length+' 组']];
    return [['任务类型','通用代码沙箱'],['产物文件',d.artifacts?.length+' 个'],['状态','SUCCEEDED']];
  };
  return <><PageTitle eyebrow="RUNS & RESULTS" title="任务与计算结果" description="每次运行保留独立参数、日志和本次输出。"><Button onClick={pause}>{paused?<Play size={15}/>:<Pause size={15}/>} {paused?'继续队列':'暂停领取'}</Button><Button variant="primary" onClick={openSim}><Plus size={16}/>新建仿真</Button></PageTitle>{jobs.length===0?<div className="empty panel"><Activity size={42}/><h2>还没有计算任务</h2><p>配置一个仿真，开始第一组真实计算。</p><Button variant="primary" onClick={openSim}>配置声场仿真</Button></div>:<div className="jobs-layout"><aside className="panel job-list"><div className="panel-heading">运行记录 <span>{jobs.length}</span></div>{jobs.map(j=><button key={j.id} className={(activeJob||jobs[0].id)===j.id?'selected':''} onClick={()=>setActiveJob(j.id)}><div><strong>{getJobTitle(j.plan)}</strong><Badge state={j.state}/></div><small>{j.id} · {new Date(j.created).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</small></button>)}</aside><section className="panel job-detail">{detail&&<><div className="job-detail-header"><div><span className="eyebrow">{detail.id}</span><h2>{getJobHeader(detail.plan)}</h2></div><Badge state={detail.state}/></div><div className="job-actions"><span>{detail.plan?.task_type==='shallow_water_ray_tracing'?'解析几何 / BELLHOP 射线追踪':detail.plan?.task_type==='custom_sandbox_code'?'Python 科学计算沙箱':'Munk · 5000 m · MATLAB R2024a'}</span>{['QUEUED','RUNNING'].includes(detail.state)?<Button onClick={cancel}><X size={14}/>取消任务</Button>:<Button onClick={rerun}><RotateCcw size={14}/>重跑</Button>}<a className="button" href={'/api/jobs/'+detail.id+'/download'}><Download size={14}/>下载结果包</a></div><div className="tabs">{[['result','结果图表'],['log','运行日志'],['files','输出文件']].map(([id,name])=><button key={id} className={tab===id?'selected':''} onClick={()=>setTab(id)}>{name}</button>)}</div>{tab==='log'?<pre className="code log">{detail.log}</pre>:tab==='files'?<div className="artifact-list">{detail.artifacts.map(f=><a key={f} href={`/api/jobs/${detail.id}/artifact/${f}`} target="_blank" rel="noreferrer"><FileText size={16}/>{f}<Download size={15}/></a>)}</div>:detail.state==='SUCCEEDED'?<div className="result-body"><div className="result-metrics">{getMetrics(detail).map(([l,v])=><div key={l}><span>{l}</span><strong>{v}</strong></div>)}</div>{(detail.artifacts?.filter(f=>f.endsWith('.png'))||[]).map(name=><button className="result-image" key={name} onClick={()=>setImage({url:`/api/jobs/${detail.id}/artifact/${name}`,caption:'仿真计算结果 · '+name})}><img src={`/api/jobs/${detail.id}/artifact/${name}`} alt={name}/></button>)}<p className="result-note">{detail.summary?.reference||'计算结果已通过验证并保存到任务独立工作区。'}</p></div>:<div className="empty"><span>{detail.state==='RUNNING'?<Loader2 className="spin" size={34}/>:detail.state==='FAILED'?<AlertCircle size={34}/>:<Activity size={34}/>}</span><h3>{stateName[detail.state]}</h3><p>{detail.error||'结果通过校验后，将在这里显示。可切换到运行日志查看进度。'}</p>{detail.state==='FAILED'&&<Button onClick={()=>setTab('log')}>查看失败日志</Button>}</div>}</>}</section></div>}</>
}
function Project({notify}){
 const [data,setData]=useState(null),[file,setFile]=useState(null),[q,setQ]=useState('');useEffect(()=>{api('/project/files').then(setData).catch(e=>notify(e.message))},[]);
 async function open(path){try{setFile(await api('/project/file?path='+encodeURIComponent(path)))}catch(e){notify(e.message)}}
 return <><PageTitle eyebrow="LOCAL PROJECT" title="项目文件" description="查看已授权项目中的 MATLAB 脚本和仿真输入。"/><div className="project-root"><FolderCode size={16}/>{data?.root||'正在读取项目目录…'}<span>只读浏览</span></div><div className="project-layout"><aside className="panel"><label className="search"><Search size={15}/><input aria-label="筛选文件" value={q} onChange={e=>setQ(e.target.value)} placeholder="筛选文件"/></label><div className="file-list">{data?.files.filter(f=>f.path.toLowerCase().includes(q.toLowerCase())).map(f=><button key={f.path} className={file?.path===f.path?'selected':''} onClick={()=>open(f.path)}><FileText size={15}/><span>{f.path}<small>{(f.size/1024).toFixed(1)} KB</small></span></button>)}</div></aside><section className="panel editor"><div className="panel-heading">{file?.path||'选择一个项目文件'}<span>UTF-8</span></div>{file?<><pre className="code">{file.content.split('\n').map((line,i)=><div key={i}><span className="line-num">{i+1}</span>{line||' '}</div>)}</pre><div className="editor-foot">SHA-256 {file.sha256.slice(0,20)}… · 文件读取自本机项目</div></>:<div className="empty"><FolderCode size={38}/><p>点击左侧文件查看内容</p></div>}</section></div></>
}
function Config({notify,onSaved,activeTab='matlab',setActiveTab}){
 const [cfg,setCfg]=useState(null),[checks,setChecks]=useState(null),[busy,setBusy]=useState(false),[resources,setResources]=useState([]);
 useEffect(()=>{api('/config').then(setCfg).catch(e=>notify(e.message));api('/sources').then(setResources).catch(e=>notify(e.message));api('/environment/check',{method:'POST'}).then(setChecks).catch(e=>notify(e.message))},[]);
 async function save(){setBusy(true);try{await api('/config',{method:'PUT',body:JSON.stringify(cfg)});notify('配置已保存到本机后台');onSaved();setCfg(await api('/config'));setChecks(await api('/environment/check',{method:'POST'}))}catch(e){notify(e.message)}finally{setBusy(false)}}
 if(!cfg)return <div className="empty"><Loader2 className="spin"/></div>;
 return <><PageTitle eyebrow="ENVIRONMENT" title="计算环境与模型配置" description="本机 MATLAB 承担声学仿真计算，云端模型负责意图理解与任务规划。"><div className="segmented settings-tab-switcher"><button className={activeTab==='matlab'?'active':''} onClick={()=>setActiveTab&&setActiveTab('matlab')}><Terminal size={14}/> MATLAB 与声学工具箱</button><button className={activeTab==='model'?'active':''} onClick={()=>setActiveTab&&setActiveTab('model')}><Cpu size={14}/> 云端模型与 API Key</button><button className={activeTab==='all'?'active':''} onClick={()=>setActiveTab&&setActiveTab('all')}><SlidersHorizontal size={14}/> 全部概览</button></div></PageTitle><div className="settings-layout">{(activeTab==='matlab'||activeTab==='all')&&<MatlabPanel cfg={cfg} setCfg={setCfg} onSave={save} busy={busy} notify={notify}/>}{(activeTab==='model'||activeTab==='all')&&<ModelPanel cfg={cfg} setCfg={setCfg} onSave={save} busy={busy} notify={notify}/>}</div>{checks&&<section className="panel environment-checks"><div className="panel-heading">全局环境状态自检报告</div><div>{checks.checks.map(c=><div className="check-item" key={c.name}>{c.ok?<CheckCircle2 size={17}/>:<AlertCircle size={17}/>}<div><strong>{c.name}</strong><small>{c.detail}</small></div><span className={c.ok?'ok':'pending'}>{c.ok?'通过':'待配置'}</span></div>)}</div></section>}<section className="panel resource-panel"><div className="panel-heading">资料来源与入库状态<span>{resources.length} 份来源</span></div><div className="resource-scroll"><table><thead><tr><th>编号</th><th>来源文件</th><th>资料状态</th><th>知识关联</th><th/></tr></thead><tbody>{resources.map(s=><tr key={s.id}><td>{s.id}</td><td>{s.name}<small>{s.reading_scope}</small></td><td>{s.duplicate_of?'重复 '+s.duplicate_of:s.extraction_state==='needs_ocr'?'扫描版 · 待 OCR':s.available?'PDF 可预览':'元数据已登记'}</td><td>{s.index_status}</td><td>{s.available&&<a href={'/api/source/'+s.id} target="_blank" rel="noreferrer"><ExternalLink size={15}/></a>}</td></tr>)}</tbody></table></div></section></>
}
createRoot(document.getElementById('root')).render(<App/>);
