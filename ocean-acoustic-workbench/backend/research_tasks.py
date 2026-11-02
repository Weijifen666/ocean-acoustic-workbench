"""Custom research scripts and a shared, validated result manifest."""
import asyncio,hashlib,json,os,subprocess,sys,time,uuid,importlib.util
from pathlib import Path
from pydantic import BaseModel,Field
import task_files,model_workflows,research_validation,acoustic_checks

class Output(BaseModel):
    file:str
    caption:str=''

class Check(BaseModel):
    name:str
    passed:bool|None=None
    evidence:str

class Report(BaseModel):
    method:str=Field(min_length=1)
    assumptions:list[str]
    inputs:list[str]
    sources:list[str]
    outputs:list[Output]=Field(min_length=1)
    checks:list[Check]
    conclusion:str=Field(min_length=1)
    limitations:list[str]

def tools():
    specs=[('create_research_task','为不受仿真表单限制的研究创建独立目录和任务记录，返回Python/MATLAB/AT路径及报告结构',{'title':{'type':'string'},'objective':{'type':'string'}}),('write_research_file','在研究任务目录写入Python或MATLAB脚本、输入数据或说明；文件名不含目录',{'id':{'type':'string'},'file':{'type':'string'},'content':{'type':'string'}}),('run_research_script','实际运行任务中的.py或.m脚本并保存日志。失败后可修正脚本重试。执行不是安全沙箱，遵守用户研究范围',{'id':{'type':'string'},'file':{'type':'string'}}),('finish_research_task','提交统一研究报告并校验产物存在、计算退出码与脚本版本。成功仅代表执行完成，验证结论另列',{'id':{'type':'string'},'report':Report.model_json_schema()})]
    schema=Report.model_json_schema();definitions=schema.pop('$defs',{})
    specs.insert(0,('prepare_model_research_task','按模型Skill在独立目录创建已核对的经典算例输入、溯源和运行脚本；不执行。case传空字符串使用默认基线；自定义环境在任务副本上修改后运行。缺少程序会直接说明',{'model':{'type':'string','enum':[r['id'] for r in model_workflows.recipes()]},'case':{'type':'string'},'title':{'type':'string'},'objective':{'type':'string'}}))
    def inline(value):
        if isinstance(value,list):return [inline(v) for v in value]
        if isinstance(value,dict):
            if '$ref' in value:return inline(definitions[value['$ref'].split('/')[-1]])
            return {k:inline(v) for k,v in value.items()}
        return value
    specs[-1][2]['report']=inline(schema)
    specs.extend([
        ('evaluate_acoustic_checks','按明确的深度/距离区域比较两级NPZ声场，核对控制参数、共同有效覆盖、TL差异分位和两种平均值。程序保存绑定输入版本的数值检查；两级一致不证明物理精度',{'id':{'type':'string'},'spec':acoustic_checks.SPEC_SCHEMA}),
        ('audit_research_task','只读核对已有研究任务的执行、文件版本和程序数值检查；支持已完成任务，不重跑或修改原任务',{'id':{'type':'string'}})])
    result=[{'type':'function','function':{'name':name,'description':desc,'parameters':{'type':'object','properties':fields,'required':list(fields),'additionalProperties':False}}} for name,desc,fields in specs]
    runner=next(t['function']['parameters'] for t in result if t['function']['name']=='run_research_script')
    for key in ('inputs','outputs'):
        runner['properties'][key]={'type':'array','items':{'type':'string'},'description':'可选，声明本次实际读取或生成的任务内普通文件名，记录SHA256以检查计算依赖'}
    return result

class Engine:
    def __init__(self,root,config,lookup,create,update,processes,lock,stop,local=None):
        self.root=Path(root);self.config=config;self.lookup=lookup;self.create=create;self.update=update;self.processes=processes;self.lock=lock;self.stop=stop;self.created={};self.touched=set();self.local=Path(local) if local else self.root/'.local'
        self.validations=research_validation.ValidationStore(self.local)

    def folder(self,identity):
        job=self.lookup(identity)
        if job['plan'].get('kind')!='research':raise ValueError('不是自定义研究任务')
        return job,task_files.directory(self.local/'runs',identity)

    def file(self,folder,name):
        if not name or name!=Path(name).name or '/' in name or '\\' in name or ':' in name or name.startswith('.'):raise ValueError('只允许任务目录内的普通文件名')
        path=folder/name
        if path.is_symlink() or path.resolve().parent!=folder.resolve():raise ValueError('文件路径越界')
        return path

    def save_layer_diagnostics(self,identity,profiles,result,implementations,seconds):
        job,folder=self.folder(identity)
        if self.stop.is_set() or job['state'] in ('SUCCEEDED','CANCELLED'):raise ValueError('请在未完成的研究任务中保存诊断')
        if research_validation.sha256(implementations[-1])!=result['implementation_sha256']:raise ValueError('诊断方法已更新，请重新诊断')
        tag=uuid.uuid4().hex[:10]
        profile_file='profiles-'+tag+'.json';result_file='layer-diagnostics-'+tag+'.json'
        for name,value in ((profile_file,profiles),(result_file,result)):
            self.file(folder,name).write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
        bindings=research_validation.hashes(folder,[profile_file,result_file])
        receipt=self.validations.record(identity,'layer_diagnostics',result,folder,bindings,implementations)
        record={'kind':'program_tool','file':'diagnose_ocean_layers','sha256':result['implementation_sha256'],
                'receipt_id':receipt['id'],'exit_code':0,'timed_out':False,'seconds':round(seconds,3),
                'declared_input_sha256':{profile_file:bindings[profile_file]},
                'declared_output_sha256':{result_file:bindings[result_file]}}
        path=folder/'executions.json';records=json.loads(path.read_text(encoding='utf-8')) if path.exists() else []
        records.append(record);path.write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
        self.touched.add(identity)
        return {'id':identity,'receipt_id':receipt['id'],'artifacts':[profile_file,result_file]}

    async def execute(self,name,args):
        if name=='prepare_model_research_task':
            files,manifest=model_workflows.payload(self.config().get('toolbox_path',''),args['model'],args['case'])
            if manifest['runner'].endswith('.m') and not Path(self.config().get('matlab_path','')).is_file():raise ValueError('此模型流程需要配置可用的MATLAB')
            created=await self.execute('create_research_task',{'title':args['title'],'objective':args['objective'],'_workflow':manifest})
            folder=Path(created['directory'])
            if not (folder/'workflow.json').exists():
                for filename,raw in files.items():self.file(folder,filename).write_bytes(raw)
                (folder/'workflow.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
            return {**created,'workflow':manifest,'files':[p.name for p in folder.iterdir() if p.is_file()],'project_files':{p.name:'@runs/'+created['id']+'/'+p.name for p in folder.iterdir() if p.is_file()},'next_step':'read_project_file使用project_files中的路径核对输入；run_research_script运行runner，检查model_metrics.json与数值/图片，再finish_research_task。创建不等于已运行。'}
        if name=='create_research_task':
            if self.stop.is_set():raise ValueError('请求已停止')
            title=args['title'].strip()[:200];objective=args['objective'].strip()[:12000]
            if not title or not objective:raise ValueError('标题和目标不能为空')
            workflow=args.get('_workflow');key=json.dumps([title,objective,workflow.get('model') if workflow else None,workflow.get('case') if workflow else None],ensure_ascii=False)
            if key not in self.created:
                identity=uuid.uuid4().hex[:12];folder=task_files.directory(self.local/'runs',identity);folder.mkdir(parents=True)
                plan={'kind':'research','solver':'research','title':title,'objective':objective}
                if workflow:plan['model_workflow']=workflow
                (folder/'case.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')
                self.create(identity,plan);self.created[key]=identity
            cfg=self.config();identity=self.created[key];self.touched.add(identity)
            return {'id':identity,'directory':str(self.local/'runs'/identity),'python':sys.executable,'matlab':cfg.get('matlab_path'),'acoustic_toolbox':cfg.get('toolbox_path'),'report_schema':Report.model_json_schema(),'python_packages':{name:importlib.util.find_spec(name) is not None for name in ['numpy','scipy','matplotlib','pypdfium2','gsw']},'note':'脚本在任务目录运行；结果图片、数据保存为普通文件，完成后finish_research_task。依赖可用性见python_packages；缺少依赖时优先改用现有依赖实现。'}
        job,folder=self.folder(args['id']);identity=args['id']
        if name=='audit_research_task':
            return {'id':identity,**research_validation.audit_task(folder,job['plan'],self.validations.receipts(identity,folder))}
        self.touched.add(identity)
        if job['state'] in ('SUCCEEDED','CANCELLED'):raise ValueError('任务已完成或取消，请新建任务')
        if name=='evaluate_acoustic_checks':
            if self.stop.is_set():raise ValueError('请求已停止')
            result=await asyncio.to_thread(acoustic_checks.evaluate,folder,args['spec'])
            bindings={v['file']:v['sha256'] for v in result['inputs'].values()}
            receipt=self.validations.record(identity,'acoustic_refinement',result,folder,bindings,[Path(acoustic_checks.__file__)])
            return {'receipt_id':receipt['id'],**result}
        if name=='write_research_file':
            if self.stop.is_set():raise ValueError('请求已停止')
            path=self.file(folder,args['file'])
            if path.name in ('case.json','summary.json','research_report.json','executions.json','run.log','workflow.json'):raise ValueError('保留的执行记录文件不能覆盖')
            if path.suffix.lower() not in ('.py','.m','.txt','.md','.json','.csv','.env','.flp','.bty','.ssp','.in','.ati','.brc','.irc','.sbp'):raise ValueError('不支持的输入文件类型')
            if len(args['content'])>400000:raise ValueError('单个输入文件过大')
            path.write_text(args['content'],encoding='utf-8');return {'file':path.name,'bytes':path.stat().st_size}
        if name=='run_research_script':
            task=asyncio.create_task(asyncio.to_thread(self.run_script,identity,folder,args['file'],args.get('inputs'),args.get('outputs')));stopped=asyncio.create_task(self.stop.wait())
            done,_=await asyncio.wait([task,stopped],return_when=asyncio.FIRST_COMPLETED)
            if stopped in done:
                task.add_done_callback(lambda t:t.exception() if not t.cancelled() else None)
                return {'id':identity,'state':'RUNNING','note':'已停止对话；已启动的脚本继续运行，稍后可读取日志并完成报告。'}
            stopped.cancel();await asyncio.gather(stopped,return_exceptions=True)
            return await task
        if name=='finish_research_task':
            with self.lock:
                if identity in self.processes:raise ValueError('计算仍在运行，不能提前完成归档')
                if self.lookup(identity)['state'] in ('CANCELLED','SUCCEEDED'):raise ValueError('任务已结束，不能重复归档')
                return self.finish_report(identity,folder,job,args['report'])
        raise ValueError('未知研究工具')

    def finish_report(self,identity,folder,job,report_input):
        report=Report(**report_input).model_dump();records=json.loads((folder/'executions.json').read_text(encoding='utf-8')) if (folder/'executions.json').exists() else []
        if not records or records[-1]['exit_code']!=0:raise ValueError('尚无成功执行，或最后一次脚本执行失败')
        audit=research_validation.audit_task(folder,job['plan'],self.validations.receipts(identity,folder))
        if audit['execution']['status']!='consistent':raise ValueError('执行完整性检查未通过：'+'；'.join(audit['execution']['issues']))
        if job['plan'].get('model_workflow'):report['model_workflow']=job['plan']['model_workflow']
        for output in report['outputs']:
            path=self.file(folder,output['file'])
            if not path.is_file() or path.stat().st_size==0:raise ValueError('产物不存在或为空：'+output['file'])
            output.update(bytes=path.stat().st_size,sha256=research_validation.sha256(path))
        report['checks']=[{**check,'authority':'agent_self_report'} for check in report['checks']]
        report.update(title=job['plan']['title'],objective=job['plan']['objective'],executions=records,kind='research',
                      execution_validation=audit['execution'],scientific_validation=audit['scientific_validation'],
                      validation_scope='执行与产物版本已核对；Agent自评和程序数值检查分别记录。完成归档不代表物理精度已获证明。')
        for name in ('research_report.json','summary.json'):
            (folder/name).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        self.update(identity,'SUCCEEDED')
        return {'id':identity,'state':'SUCCEEDED','report':'research_report.json','outputs':report['outputs'],'scientific_validation':report['scientific_validation']}

    def run_script(self,identity,folder,name,inputs=None,outputs=None):
        path=self.file(folder,name)
        if not path.is_file():raise ValueError('脚本不存在')
        declared_inputs=research_validation.hashes(folder,inputs) if inputs is not None else None
        if outputs is not None:
            for output in outputs:
                if self.file(folder,output).name in ('case.json','summary.json','research_report.json','executions.json','run.log','workflow.json'):
                    raise ValueError('执行记录不能作为脚本产物声明')
        cfg=self.config()
        if path.suffix=='.py':command=[sys.executable,'-I',str(path)]
        elif path.suffix=='.m':
            matlab=Path(cfg.get('matlab_path',''))
            if not matlab.is_file():raise ValueError('未找到MATLAB')
            command=[str(matlab),'-wait','-noFigureWindows','-batch',"run('"+path.name.replace("'","''")+"')"]
        else:raise ValueError('仅运行Python或MATLAB脚本')
        env={k:v for k,v in os.environ.items() if k.upper() in ('PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)')}
        env.update(PYTHONIOENCODING='utf-8',MPLBACKEND='Agg')
        digest=hashlib.sha256(path.read_bytes()).hexdigest();start=time.monotonic();timed_out=False
        model_inputs=model_workflows.input_hashes(folder) if self.lookup(identity)['plan'].get('model_workflow') else None
        with (folder/'run.log').open('ab') as log:
            log.write(('\n执行脚本：'+name+'\n').encode());log.flush()
            with self.lock:
                if self.stop.is_set() or self.lookup(identity)['state'] in ('CANCELLED','SUCCEEDED'):raise ValueError('请求或任务已结束')
                if identity in self.processes:raise ValueError('此任务已有脚本运行')
                self.update(identity,'RUNNING')
                try:proc=subprocess.Popen(command,cwd=folder,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
                except OSError as exc:self.update(identity,'FAILED',str(exc));raise
                self.processes[identity]=proc
            try:
                try:code=proc.wait(timeout=600)
                except subprocess.TimeoutExpired:
                    timed_out=True
                    if os.name=='nt':subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
                    else:proc.kill()
                    proc.wait();code=-1
                # Keep the process guard until records and state are durable;
                # finishing in this interval must not use an older success.
                return self.record_execution(identity,folder,name,digest,code,start,timed_out,declared_inputs,outputs,model_inputs)
            finally:
                with self.lock:self.processes.pop(identity,None)

    def record_execution(self,identity,folder,name,digest,code,start,timed_out,declared_inputs,outputs,model_inputs):
        record={'file':name,'sha256':digest,'exit_code':code,'seconds':round(time.monotonic()-start,3),'timed_out':timed_out}
        if declared_inputs is not None:record['declared_input_sha256']=declared_inputs
        if outputs is not None:
            present=[n for n in outputs if self.file(folder,n).is_file() and self.file(folder,n).stat().st_size>0]
            record['declared_output_sha256']=research_validation.hashes(folder,present)
            record['missing_outputs']=[n for n in outputs if n not in present]
        if model_inputs is not None:record['model_input_sha256']=model_inputs
        path_records=folder/'executions.json';records=json.loads(path_records.read_text(encoding='utf-8')) if path_records.exists() else [];records.append(record);path_records.write_text(json.dumps(records,indent=2),encoding='utf-8')
        with self.lock:
            if self.lookup(identity)['state']!='CANCELLED':
                if code!=0:self.update(identity,'FAILED','脚本超时' if timed_out else '脚本退出码 '+str(code))
                elif self.stop.is_set():self.update(identity,'FAILED','对话已停止，脚本已结束，可继续整理研究报告')
        return {**record,'id':identity,'error':('脚本执行失败，请查看日志并修正' if code else None),'log_tail':task_files.read_log(folder/'run.log',8000)}
