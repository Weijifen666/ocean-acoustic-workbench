"""Local research Agent, isolated from the durable fixed-template queue.

The public gateway does not proxy these routes. Model scripts run only after
an explicit local research request; no source DB or credentials are migrated.
"""
import asyncio
import csv
import hashlib
import inspect
import json
import math
from pathlib import Path
import subprocess
import os
import statistics
import threading
import time
import agent_context, materials, ocean_data, dsh_bridge, context_budget, task_files

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Literal
import persistence, research_tasks, research_skills, model_workflows, project_browser, codex_bridge, agent_loop, models
import layer_diagnostics, research_validation
import provider_history, research_context, graph_tools, code_artifacts, code_tools


GUIDANCE = agent_context.guidance(include_research=False) + '''
Load model Skill/references/workflow.md; disclose unverified KRAKEL postprocessing, never replace its solver. Graph selections: request-only/read-only; 层级/先学/关联不等于物理因果。Saved code is not execution; results are read-only, never fabricated.
'''


class ResearchRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: str = Field(pattern=r'^[A-Za-z0-9_-]{8,80}$')
    session: str = Field(pattern=r'^[A-Za-z0-9_-]{8,100}$')
    message: str = Field(min_length=1, max_length=12000)
    backend: Literal['codex', 'api', 'dsh'] = 'codex'
    rounds: int = Field(default=40, ge=0, le=1000)
    context_budget: Literal['auto',4096,8192,16384,32768,65536,131072,'unlimited']='auto'
    knowledge_node_ids: list[str] = Field(default_factory=list,max_length=8)
    @field_validator('context_budget',mode='before')
    @classmethod
    def valid_budget(cls,value):
        context_budget.resolve_budget(value);return value


class ResearchService:
    def __init__(self, root, local, store, config, search, graph=None):
        self.root, self.local, self.store = Path(root), Path(local), store
        self.config, self.search = config, search
        self.graph = graph_tools.GraphTools(graph if graph is not None else json.loads((Path(__file__).with_name('data')/'course_graph.json').read_text(encoding='utf-8')))
        self.graph_names = {tool['function']['name'] for tool in graph_tools.tool_specs()}
        self.code_store = code_artifacts.Store(self.store.connection)
        self.code_names = {tool['function']['name'] for tool in code_tools.tool_specs()}
        self.runs, self.tasks, self.processes = {}, set(), {}
        self.lock = threading.RLock()
        self.fixed_schema = self.fixed_preview = self.fixed_submit = self.fixed_details = None
        self.fixed_batch = None

    def migrate(self):
        with self.store.connection(immediate=True) as db:
            db.execute('CREATE TABLE IF NOT EXISTS research_jobs(id TEXT PRIMARY KEY,state TEXT,created TEXT,updated TEXT,plan TEXT,error TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS research_requests(id TEXT PRIMARY KEY,session TEXT,message_sha TEXT,state TEXT,reply TEXT,error TEXT,created TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS session_titles(session TEXT PRIMARY KEY,title TEXT,updated TEXT)')
            db.execute("UPDATE research_jobs SET state='INTERRUPTED',error='研究执行器已重启，未自动重跑；请核对任务文件。' WHERE state='RUNNING'")
            db.execute("UPDATE research_requests SET state='failed',error='服务已重启，请核对已有任务后继续；未自动重放研究。' WHERE state='running'")

    def sessions(self):
        with self.store.connection() as db:
            rows = db.execute("SELECT session,COUNT(*) AS count,MIN(created) AS created,MAX(created) AS updated FROM messages GROUP BY session ORDER BY updated DESC").fetchall()
            titles = {row['session']: row['title'] for row in db.execute('SELECT session,title FROM session_titles').fetchall()}
            out = []
            for row in rows:
                key = row['session'] or ''
                if not key.startswith('research:'):continue
                first = db.execute("SELECT text FROM messages WHERE session=? AND role='user' ORDER BY id LIMIT 1", (key,)).fetchone()
                fallback = ' '.join((first['text'] or '').split())[:48] if first else '新对话'
                out.append({'id':key[9:],'title':titles.get(key) or fallback or '新对话','count':row['count'],'created':row['created'],'updated':row['updated']})
            return out

    def rename_session(self, identity, title):
        key = 'research:' + identity
        with self.store.connection(immediate=True) as db:
            db.execute('INSERT OR REPLACE INTO session_titles(session,title,updated) VALUES(?,?,?)', (key, title[:80], persistence.now()))

    def delete_session(self, identity):
        key = 'research:' + identity
        with self.store.connection(immediate=True) as db:
            db.execute('DELETE FROM messages WHERE session=?', (key,))
            db.execute('DELETE FROM session_titles WHERE session=?', (key,))

    def get(self, identity):
        with self.store.connection() as db:
            row = db.execute('SELECT * FROM research_jobs WHERE id=?', (identity,)).fetchone()
        if row is None:return None
        value = dict(row); value['plan'] = json.loads(value['plan']); return value

    def lookup(self, identity):
        value = self.get(identity)
        if not value:raise ValueError('研究任务不存在')
        return value

    def jobs(self):
        with self.store.connection() as db:
            ids = [r[0] for r in db.execute('SELECT id FROM research_jobs ORDER BY created DESC LIMIT 100')]
        return [self.get(identity) for identity in ids]

    def create(self, identity, plan):
        stamp = persistence.now()
        with self.store.connection(immediate=True) as db:
            db.execute('INSERT INTO research_jobs VALUES(?,?,?,?,?,NULL)', (identity,'RUNNING',stamp,stamp,json.dumps(plan,ensure_ascii=False)))

    def update(self, identity, state, error=None):
        with self.store.connection(immediate=True) as db:
            db.execute("UPDATE research_jobs SET state=?,error=?,updated=? WHERE id=? AND state!='CANCELLED'", (state,error,persistence.now(),identity))

    def cancel(self, identity):
        with self.lock:
            value = self.lookup(identity)
            if value['state'] not in ('RUNNING','FAILED','INTERRUPTED'):raise ValueError('任务已结束')
            proc = self.processes.get(identity)
            if proc and proc.poll() is None:
                if os.name == 'nt':subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
                else:proc.kill()
                proc.wait(timeout=10)
                if proc.poll() is None:raise ValueError('尚未确认进程停止')
            self.update(identity,'CANCELLED','用户取消研究任务')
        return {'cancelled':True}

    def tools(self):
        base = agent_context.tools()
        compute = []
        for name, desc, fields in [
            ('get_simulation_schema','读取已迁移的声场仿真实际参数范围',{}),
            ('preview_simulation','校验固定表单参数，不执行',{'plan':{'type':'object'}}),
            ('submit_simulation','提交 KRAKEN、SCOOTER、BELLHOP 表单声场仿真',{'plan':{'type':'object'}}),
            ('wait_job','等待指定任务最多20秒',{'id':{'type':'string'}})]:
            compute.append({'type':'function','function':{'name':name,'description':desc,'parameters':{'type':'object','properties':fields,'required':list(fields),'additionalProperties':False}}})
        return base + research_skills.tools() + research_tasks.tools() + compute + graph_tools.tool_specs() + code_tools.tool_specs()

    def details(self, identity):
        value = self.lookup(identity); folder = self.local/'runs'/identity
        value['artifacts'] = [p.name for p in folder.glob('*') if p.is_file()]
        value['log'] = task_files.read_log(folder/'run.log',10000) if (folder/'run.log').exists() else '等待运行脚本或整理报告。'
        if value['state']=='SUCCEEDED' and (folder/'summary.json').is_file():
            report=json.loads((folder/'summary.json').read_text(encoding='utf-8'))
            # Read-time projection also labels legacy tasks without editing them.
            report['checks']=[{**c,'authority':'agent_self_report'} for c in report.get('checks',[])]
            receipts=research_validation.ValidationStore(self.local).receipts(identity,folder)
            audit=research_validation.audit_task(folder,value['plan'],receipts)
            report.update(execution_validation=audit['execution'],scientific_validation=audit['scientific_validation'],
                          validation_scope='执行记录、Agent自评和程序数值检查分别记录；归档完成不代表物理精度已获证明。')
            value['summary']=report
        value['events'] = []
        return value

    def fixed_job_statistics(self, identity, value):
        """Label actual field and receiver scopes separately for model tools."""
        plan=value.get('plan') or {}
        if (plan.get('task_type') or plan.get('kind')=='research' or plan.get('template') not in ('munk_5000m','constant_5000m','pekeris_100m','woa18') or 'frequency_hz' not in plan):return {}
        if value.get('state')!='SUCCEEDED' or not isinstance(value.get('summary'),dict):return {}
        summary=value['summary'];result={}
        if any(key in summary for key in ('tl_min_db','tl_median_db','tl_max_db')):
            result['field_statistics']={'scope':'full_depth_range_field','source_file':'summary.json','tl_unit':'dB',
                **{target:summary[source] for source,target in [('tl_min_db','min_tl_db'),('tl_median_db','median_tl_db'),('tl_max_db','max_tl_db'),('shape','shape'),('valid_ratio','valid_ratio')] if summary.get(source) is not None},
                'missing_samples_excluded':True,'note':'全深度×距离网格的有效值统计，不能当作某一接收深度的曲线统计。'}
        curve={'scope':'receiver_depth_range_curve','source_file':'curve.csv','available':False,'tl_unit':'dB','range_unit':'m',
            **{key:summary[key] for key in ('requested_receiver_depth_m','actual_receiver_depth_m') if summary.get(key) is not None}}
        result['receiver_curve_statistics']=curve
        try:
            folder=task_files.directory(self.local/'runs',identity);path=folder/'curve.csv'
            if not path.is_file():curve['reason']='curve_file_missing';return result
            if path.is_symlink() or path.resolve().parent!=folder or path.stat().st_size>100000:raise ValueError('Invalid curve file')
            raw=path.read_bytes();reader=csv.DictReader(raw.decode('utf-8-sig').splitlines())
            if reader.fieldnames!=['range_m','tl_db']:raise ValueError('Invalid curve columns')
            samples=[(float(row['range_m']),float(row['tl_db'])) for row in reader]
            if not samples or any(not math.isfinite(r) or not math.isfinite(tl) for r,tl in samples) or any(samples[i][0]<=samples[i-1][0] for i in range(1,len(samples))):raise ValueError('Invalid curve samples')
            values=[tl for _,tl in samples]
            curve.update(available=True,source_sha256=hashlib.sha256(raw).hexdigest(),sample_count=len(samples),
                range_min_m=samples[0][0],range_max_m=samples[-1][0],min_tl_db=min(values),median_tl_db=statistics.median(values),max_tl_db=max(values),
                note='仅适用于上述实际接收深度的距离曲线；完整曲线可用read_project_file读取@runs/'+identity+'/curve.csv。')
        except (OSError,ValueError,UnicodeError,KeyError,TypeError):curve['reason']='curve_file_invalid'
        return result

    async def execute(self, engine, name, args, run=None):
        if name in self.graph_names:
            result=self.graph.execute(name,args)
            if name=='select_graph_nodes':
                result={**result,'selection_scope':'current_run','evidence':self.graph.selection_evidence(result['node_ids'])}
                if run is not None:run['graph_selection']={key:value for key,value in result.items() if key!='evidence'}
            return result
        if name in self.code_names:return code_tools.execute(self.code_store,name,args)
        if name in {t['function']['name'] for t in research_tasks.tools()}:return await engine.execute(name,args)
        cfg = self.config(); project = Path(cfg.get('project_path', self.local/'project'))
        if name=='list_project_files':return research_context.file_directory(project_browser.list_files(self.root,project,self.local,self.store.list()+self.jobs()),args)
        if name=='read_project_file':return research_context.file_page(project_browser.read_file(self.root,project,self.local,args['path'],lambda identity:self.get(identity) or self.store.get(identity)),{'max_bytes':6000,**args})
        if name=='list_jobs':return [agent_context.compact(v) for v in sorted(self.store.list()+self.jobs(),key=lambda v:v['created'],reverse=True)[:100]]
        if name=='get_job':
            research=self.get(args['id'])
            value=self.details(args['id']) if research else self.fixed_details(args['id'])
            scopes={key:value[key] for key in ('field_statistics','receiver_curve_statistics') if key in value}
            return {**agent_context.compact(value,True),**({} if research else scopes or self.fixed_job_statistics(args['id'],value))}
        if name=='get_batch':return self.fixed_batch(args['id'])
        if name=='search_knowledge':return self.search(args['query'])
        if name=='list_research_skills':return research_skills.catalog()
        if name=='load_research_skill':return research_skills.resource(args['id'])
        if name=='read_skill_resource':return research_skills.resource(args['id'],args['path'],offset=args.get('offset',0),max_bytes=args.get('max_bytes',6000))
        if name=='list_model_workflows':return model_workflows.catalog(cfg.get('toolbox_path',''),cfg.get('matlab_path',''))
        if name=='list_at_examples':return research_skills.at_catalog(cfg.get('toolbox_path',''),args['query'])
        if name=='read_at_file':return research_skills.at_file(cfg.get('toolbox_path',''),args['path'])
        if name=='list_materials':return await asyncio.to_thread(materials.catalog)
        if name=='search_materials':return await asyncio.to_thread(materials.search,args['query'],args.get('source_id'))
        if name=='read_material_page':return await asyncio.to_thread(materials.read,args['source_id'],args['page'])
        if name=='get_ocean_profile':return await asyncio.to_thread(ocean_data.profile,args['lon'],args['lat'],args['period'])
        if name=='diagnose_ocean_layers':
            periods=args['periods']
            if not isinstance(periods,list) or not 1<=len(periods)<=17 or len(set(periods))!=len(periods) or any(type(p) is not int or not 0<=p<=16 for p in periods):
                raise ValueError('periods须为0—16内不重复的整数列表')
            if 'id' in args:
                job,_=engine.folder(args['id'])
                if job['state'] in ('SUCCEEDED','CANCELLED'):raise ValueError('请新建研究任务保存诊断；已完成任务可只读审核')
            start=time.monotonic()
            profiles=await asyncio.to_thread(lambda:[ocean_data.profile(args['lon'],args['lat'],p) for p in periods])
            result=await asyncio.to_thread(layer_diagnostics.diagnose_profiles,profiles,args['reference_depth_m'],args['density_threshold'],args['temperature_threshold'])
            if 'id' in args:
                implementation=self.root/'skills/seasonal-layer-diagnostics/scripts/analyze_profiles.py'
                saved=engine.save_layer_diagnostics(args['id'],profiles,result,[Path(layer_diagnostics.__file__),implementation],time.monotonic()-start)
                result={**result,**saved}
            return result
        if name=='get_simulation_schema':return self.fixed_schema()
        if name=='preview_simulation':return self.fixed_preview(args['plan'])
        if name=='submit_simulation':
            if engine.stop.is_set():raise ValueError('请求已停止')
            if not hasattr(engine,'submitted'):engine.submitted={}
            key=json.dumps(args['plan'],sort_keys=True)
            if key not in engine.submitted:engine.submitted[key]=self.fixed_submit(args['plan'])
            return engine.submitted[key]
        if name=='wait_job':
            for _ in range(20):
                result=self.get(args['id']) or self.store.get(args['id'])
                if not result:raise ValueError('任务不存在')
                if result['state'] not in ('QUEUED','RUNNING') or engine.stop.is_set():break
                try:await asyncio.wait_for(engine.stop.wait(),1)
                except asyncio.TimeoutError:pass
            return agent_context.compact(result)
        raise ValueError('未知研究工具')

    def snapshot(self, identity):
        run = self.runs.get(identity)
        if run:return {**{k:run.get(k) for k in ['id','session','backend','model','state','stage','trace','partial','reply','error','error_code','context','dsh_session','dsh_recovery','knowledge_node_ids','graph_selection']},'elapsed_seconds':int(time.monotonic()-run['started'])}
        with self.store.connection() as db:row=db.execute('SELECT * FROM research_requests WHERE id=?',(identity,)).fetchone()
        if not row:raise HTTPException(404,'研究请求不存在')
        return {k:dict(row).get(k) for k in ['id','session','state','reply','error']}

    def history(self, session):
        with self.store.connection() as db:rows=db.execute('SELECT role,text FROM messages WHERE session=? ORDER BY id DESC',('research:'+session,)).fetchall()
        return [dict(r) for r in reversed(rows)]

    async def submit(self, body):
        try:selection=self.graph.selection(body.knowledge_node_ids)
        except graph_tools.GraphError as error:raise HTTPException(error.status,str(error))
        digest=hashlib.sha256(json.dumps([body.message,body.backend,body.rounds]+([body.context_budget] if body.context_budget!='auto' else [])+([{'knowledge_node_ids':selection['node_ids']}] if selection['node_ids'] else []),ensure_ascii=False).encode()).hexdigest()
        with self.store.connection(immediate=True) as db:
            old=db.execute('SELECT * FROM research_requests WHERE id=?',(body.request_id,)).fetchone()
            if old:
                if old['session']!=body.session or old['message_sha']!=digest:raise HTTPException(409,'请求标识已用于其他问题')
                return {'id':body.request_id,'reused':True}
            if db.execute("SELECT 1 FROM research_requests WHERE session=? AND state='running'",(body.session,)).fetchone():raise HTTPException(409,'当前研究请求尚未结束')
            if body.backend=='api' and not self.config().get('api_key'):raise HTTPException(422,'现有模型接口尚未配置API Key；可选择本机Codex')
            db.execute('INSERT INTO research_requests VALUES(?,?,?,?,NULL,NULL,?)',(body.request_id,body.session,digest,'running',persistence.now()))
            user_message_id=db.execute('INSERT INTO messages(session,role,text,created,metadata) VALUES(?,?,?,?,?)',('research:'+body.session,'user',body.message,persistence.now(),json.dumps({'knowledge_node_ids':selection['node_ids']}))).lastrowid
        run={'id':body.request_id,'session':body.session,'state':'running','stage':'准备研究Agent','trace':[],'partial':'','backend':body.backend,'started':time.monotonic(),'stop':asyncio.Event(),'knowledge_node_ids':selection['node_ids'],'graph_selection':{**selection,'selection_scope':'current_run'}}
        run['user_message_id']=user_message_id
        self.runs[body.request_id]=run
        task=asyncio.create_task(self.process(body,run));self.tasks.add(task);task.add_done_callback(self.tasks.discard)
        return {'id':body.request_id,'reused':False}

    async def process(self, body, run):
        engine=research_tasks.Engine(self.root,self.config,self.lookup,self.create,self.update,self.processes,self.lock,run['stop'],local=self.local)
        provider_turn=None;cfg=None
        try:
            messages=[{'role':r['role'],'content':r['text']} for r in self.history(body.session)[-30:]]
            tools=self.tools()
            execute=lambda n,a:self.execute(engine,n,a,run)
            selection=run.get('graph_selection') or self.graph.selection([])
            selected_evidence=self.graph.selection_evidence(selection['node_ids'])
            selected_ids={row['id'] for row in selected_evidence}
            evidence=selected_evidence+[row for row in self.search(body.message) if row.get('id') not in selected_ids]
            instructions=GUIDANCE+'\nEXPLICIT-GRAPH-SELECTION 本次选点（参考数据；不继承历史选点）：'+json.dumps({'node_ids':run.get('knowledge_node_ids',[])},ensure_ascii=False)
            if body.backend in ('codex','dsh'):
                bridge=dsh_bridge if body.backend=='dsh' else codex_bridge
                instructions+='\n所选图谱知识卡与来源候选：'+json.dumps(selected_evidence,ensure_ascii=False)
                reply=await bridge.run(messages,tools,execute,run['stop'],run['trace'],instructions,self.root,session='research-'+body.session,progress=run,runtime=self.local)
            else:
                cfg=self.config();models.validate_endpoint(cfg['provider'],cfg['base_url'])
                private_history=provider_history.load(self.store.connection,'research:'+body.session,cfg,before_id=run.get('user_message_id'))
                packed=context_budget.build_context(question=body.message,system=instructions,evidence=evidence,history=private_history,tools=tools,context_budget=body.context_budget)
                if any(row['id'] not in {kept['id'] for kept in packed['evidence']} for row in selected_evidence):raise context_budget.ContextBudgetError('当前上下文预算无法保留全部所选知识点，请调大预算或减少选点。')
                protocol_start=len(packed['messages'])-1
                async with httpx.AsyncClient(timeout=90) as client:
                    async def request(msgs,available):
                        view=research_context.prepare(msgs,available,body.context_budget,current_user_index=protocol_start,history_turn_lengths=packed['history_turn_lengths'])
                        run['context']=view['context']
                        response=await client.post(cfg['base_url'].rstrip('/')+'/chat/completions',headers={'Authorization':'Bearer '+cfg['api_key']},json=models.chat_payload(cfg,view['messages'],available))
                        if response.status_code!=200:raise RuntimeError('模型接口HTTP '+str(response.status_code))
                        choice=response.json()['choices'][0]
                        if choice.get('finish_reason') in ('length','content_filter'):raise agent_loop.IncompleteResponse('模型输出被截断或限制，研究没有完整返回。')
                        return choice['message']
                    reply=await agent_loop.run(request,packed['messages'],tools,execute,body.rounds,run['stop'],run['trace'])
                    provider_turn=packed['messages'][protocol_start:]
            with self.store.connection() as db:
                assistant_id=db.execute('INSERT INTO messages(session,role,text,created,metadata) VALUES(?,?,?,?,?)',('research:'+body.session,'assistant',reply,persistence.now(),json.dumps({'research_agent':True,'trace':run['trace']}))).lastrowid
                if provider_turn and not run['stop'].is_set():provider_history.save(db,assistant_id,'research:'+body.session,cfg,provider_turn)
            # Publish terminal state only after the completed reply is committed.
            run.update(state='stopped' if run['stop'].is_set() else 'done',reply=reply,partial=reply,stage='研究请求已结束')
        except Exception as exc:
            if run.get('partial'):
                with self.store.connection() as db:db.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',('research:'+body.session,'assistant',run['partial']+'\n\n请求未完成，请核对已有结果后继续。',persistence.now()))
            run.update(state='failed',error='研究请求未完成：'+type(exc).__name__)
            if isinstance(exc,(context_budget.ContextBudgetError,agent_loop.IncompleteResponse)):
                run['error']=str(exc);run['error_code']=getattr(exc,'code',None)
                if hasattr(exc,'context'):run['context']=exc.context
            # Errors from our local bridge are useful; HTTP transports may echo secrets.
            if body.backend in ('codex','dsh'):run['error']='研究请求未完成：'+str(exc)[:1000]
        finally:
            for identity in set(engine.created.values())|engine.touched:
                if self.lookup(identity)['state']=='RUNNING' and identity not in self.processes:self.update(identity,'FAILED','未完成研究报告；可核对已有文件后继续整理')
            with self.store.connection() as db:db.execute('UPDATE research_requests SET state=?,reply=?,error=? WHERE id=?',(run['state'],run.get('reply'),run.get('error'),body.request_id))

    async def close(self):
        for run in self.runs.values():run['stop'].set()
        for identity in list(self.processes):
            try:self.cancel(identity)
            except Exception:pass
        if self.tasks:await asyncio.gather(*list(self.tasks),return_exceptions=True)


def router(service):
    api=APIRouter()
    @api.get('/api/research/capabilities')
    def capabilities():
        data=ocean_data.status()
        return {'enabled':True,'scope':'local_research','codex_available':bool(codex_bridge.executable()),'api_configured':bool(service.config().get('api_key')),'ocean_data_available':data['available'],'ocean_data':data,
                'graph_tools':True,'graph_selection_limit':8,'graph_write':False,'code_artifacts':True,
                'scientific_tools':[t['function']['name'] for t in service.tools() if t['function']['name'] in ('diagnose_ocean_layers','evaluate_acoustic_checks','audit_research_task')]}
    @api.get('/api/research/dsh/status')
    async def dsh_status():return await dsh_bridge.status()
    @api.get('/api/research/codex/status')
    async def codex_status():return await codex_bridge.status()
    @api.get('/api/research-skills')
    def skills():return research_skills.catalog()
    @api.get('/api/model-workflows')
    def workflows():return model_workflows.catalog(service.config().get('toolbox_path',''),service.config().get('matlab_path',''))
    @api.post('/api/research/chat')
    async def chat(body:ResearchRequest):return await service.submit(body)
    @api.get('/api/research/runs/{identity}')
    def status(identity:str):return service.snapshot(identity)
    @api.post('/api/research/runs/{identity}/stop')
    def stop(identity:str):
        run=service.runs.get(identity)
        if run:run['stop'].set()
        return {'stopped':bool(run),'note':'停止回答不取消已启动脚本；任务页可取消计算。'}
    @api.get('/api/research/history')
    def history(session:str):return service.history(session)
    @api.get('/api/research/active')
    def active(session:str):
        with service.store.connection() as db:row=db.execute('SELECT id FROM research_requests WHERE session=? ORDER BY created DESC LIMIT 1',(session,)).fetchone()
        return service.snapshot(row['id']) if row else None
    @api.get('/api/research/sessions')
    def sessions():return service.sessions()
    @api.patch('/api/research/sessions/{identity}')
    def rename_session(identity:str,body:dict):
        title=str((body or {}).get('title') or '').strip()
        if not title:raise HTTPException(422,'标题不能为空')
        service.rename_session(identity,title);return {'ok':True}
    @api.delete('/api/research/sessions/{identity}')
    def delete_session(identity:str):
        service.delete_session(identity);return {'ok':True}
    return api
