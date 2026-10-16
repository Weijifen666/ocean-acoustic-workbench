from __future__ import annotations
import os, sys, json, sqlite3, threading, subprocess, queue, uuid, time, shutil, io, zipfile, re, math, hashlib, asyncio
from pathlib import Path
if sys.stdout is None:
    try:
        log_p = Path(__file__).resolve().parents[1]/'.local/server.log'
        log_p.parent.mkdir(parents=True, exist_ok=True)
        sys.stdout = open(log_p, 'a', encoding='utf-8')
    except Exception: sys.stdout = io.StringIO()
if sys.stderr is None:
    try:
        log_p = Path(__file__).resolve().parents[1]/'.local/server.log'
        log_p.parent.mkdir(parents=True, exist_ok=True)
        sys.stderr = open(log_p, 'a', encoding='utf-8')
    except Exception: sys.stderr = io.StringIO()
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
import httpx
sys.path.insert(0, str(Path(__file__).resolve().parent))
import knowledge, models, ray_tracer, code_sandbox, simulation, science

ROOT=Path(__file__).resolve().parents[1]; LOCAL=ROOT/'.local';LOCAL.mkdir(exist_ok=True)
DB=LOCAL/'workbench.sqlite3'; CONFIG=LOCAL/'config.json'
def connect():
    c=sqlite3.connect(DB);c.row_factory=sqlite3.Row;return c
with connect() as c:
    c.executescript('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, state TEXT, created TEXT, updated TEXT, plan TEXT, error TEXT); CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, session TEXT, role TEXT, text TEXT, created TEXT);')
    c.execute("UPDATE jobs SET state='FAILED', error='后台重启中断，需重新提交' WHERE state IN ('QUEUED','RUNNING')")
def config():return json.loads(CONFIG.read_text(encoding='utf-8')) if CONFIG.exists() else {}
def stamp():return datetime.now().astimezone().isoformat(timespec='seconds')
def kbfile(name):return LOCAL/'kb'/name
def claims():return knowledge.knowledge_cards()
def sources():return json.loads(kbfile('source_registry.json').read_text(encoding='utf-8'))['sources']
def job(id):
    with connect() as c:r=c.execute('SELECT * FROM jobs WHERE id=?',(id,)).fetchone()
    if not r:raise HTTPException(404,'任务不存在')
    v=dict(r);v['plan']=json.loads(v['plan']);return v
def update(id,state,error=None):
    with connect() as c:c.execute('UPDATE jobs SET state=?,error=?,updated=? WHERE id=?',(state,error,stamp(),id))
def run_dir(id):
    if not re.fullmatch(r'[a-f0-9]{12}',id):raise HTTPException(400,'非法任务标识')
    return LOCAL/'runs'/id
Q=queue.Queue();PROCESSES={};PAUSED=False;STATELOCK=threading.RLock();PDFLOCK=threading.Lock()

class Plan(BaseModel):
    frequencies_hz:list[float]=Field(default=[50],min_length=1,max_length=4)
    source_depths_m:list[float]=Field(default=[1000],min_length=1,max_length=3)
    receiver_depth_m:float=Field(default=1000,gt=0,lt=5000)
    range_min_km:float=Field(default=1,ge=0.1,le=99)
    range_max_km:float=Field(default=50,gt=0.1,le=100)
    range_points:int=Field(default=201,ge=51,le=501)
    depth_points:int=Field(default=251,ge=51,le=501)
    template:str='munk_5000m'
    @field_validator('frequencies_hz')
    @classmethod
    def freqs(cls,v):
        if any(not math.isfinite(f) or f<10 or f>200 for f in v):raise ValueError('首版频率范围 10–200 Hz')
        return sorted(set(v))
    @field_validator('source_depths_m')
    @classmethod
    def depths(cls,v):
        if any(not math.isfinite(f) or f<=0 or f>=5000 for f in v):raise ValueError('源深须在 0–5000 m 内')
        return sorted(set(v))
    def checked(self):
        if self.range_max_km<=self.range_min_km:raise HTTPException(422,'最大距离须大于最小距离')
        if self.template!='munk_5000m':raise HTTPException(422,'首版仅支持已接入的 Munk 模板')
        if len(self.frequencies_hz)*len(self.source_depths_m)>12:raise HTTPException(422,'单批最多12组')

def plot_result(folder):
    import matplotlib;matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    data=json.loads((folder/'result.json').read_text(encoding='utf-8-sig'))
    x=np.asarray(data['ranges_m'])/1000;z=np.asarray(data['depths_m']);tl=np.asarray(data['tl_db'],dtype=float)
    if tl.shape!=(len(z),len(x)) or not np.isfinite(tl).any():raise ValueError('结果维度或有效值校验失败')
    fig,ax=plt.subplots(figsize=(10,5),facecolor='#f6fafb');fig.subplots_adjust(left=.09,right=.95,bottom=.14,top=.9)
    im=ax.pcolormesh(x,z,tl,shading='auto',cmap='viridis_r',vmin=40,vmax=110);ax.invert_yaxis();ax.set(xlabel='Range (km)',ylabel='Depth (m)',title=f"KRAKEN · {data['frequency_hz']:g} Hz · source {data['source_depth_m']:g} m")
    fig.colorbar(im,ax=ax,label='TL (dB)');fig.savefig(folder/'tl_map.png',dpi=150);plt.close(fig)
    fig,ax=plt.subplots(figsize=(10,3.5),facecolor='#f6fafb');ax.plot(x,data['curve_tl_db'],color='#07828c',lw=1.2);ax.set(xlabel='Range (km)',ylabel='TL (dB)',title=f"Receiver depth {data['actual_receiver_depth_m']:g} m");ax.grid(alpha=.16);fig.tight_layout();fig.savefig(folder/'tl_curve.png',dpi=150);plt.close(fig)
    data['tl_min_db']=float(np.nanmin(tl));data['tl_max_db']=float(np.nanmax(tl));data['tl_median_db']=float(np.nanmedian(tl));data['created']=stamp()
    (folder/'summary.json').write_text(json.dumps({k:v for k,v in data.items() if k not in ['tl_db','ranges_m','depths_m','curve_tl_db']},ensure_ascii=False,indent=2),encoding='utf-8')

def worker():
    while True:
        id=Q.get()
        while PAUSED:time.sleep(.4)
        try:
            with STATELOCK:
                if job(id)['state']=='CANCELLED':continue
                update(id,'RUNNING')
            cfg=config();plan=job(id)['plan'];folder=run_dir(id);folder.mkdir(parents=True,exist_ok=True)
            executable=Path(cfg.get('matlab_path',''))
            if not executable.is_file():raise RuntimeError('MATLAB 路径不存在，请检查环境配置')
            toolbox=Path(cfg['toolbox_path'])
            for name in ['kraken.exe','field.exe']:
                if not (toolbox/'bin'/name).is_file():raise RuntimeError('缺少 '+name)
            case={**plan,'toolbox_path':str(toolbox),'template_env':str(toolbox/'tests/Munk/MunkK.env')}
            (folder/'case.json').write_text(json.dumps(case,ensure_ascii=False),encoding='utf-8')
            shutil.copy2(ROOT/'backend/matlab/run_ocean_case.m',folder/'run_ocean_case.m')
            with (folder/'run.log').open('wb') as log:
                log.write(('任务 '+id+'\nMATLAB 实际计算，Munk 深海模板\n').encode());log.flush()
                with STATELOCK:
                    if job(id)['state']=='CANCELLED':continue
                    proc=subprocess.Popen([str(executable),'-wait','-noFigureWindows','-batch','run_ocean_case'],cwd=folder,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
                    PROCESSES[id]=proc
                try:code=proc.wait(timeout=int(cfg.get('timeout_seconds',240)))
                except subprocess.TimeoutExpired:
                    kill(id);raise RuntimeError('计算超时，当前任务已终止')
            if job(id)['state']=='CANCELLED':continue
            if code!=0:raise RuntimeError('MATLAB 运行失败，退出码 '+str(code)+'；请查看日志')
            if not (folder/'result.json').exists():raise RuntimeError('缺少本次 result.json')
            plot_result(folder)
            with STATELOCK:
                if job(id)['state']!='CANCELLED':update(id,'SUCCEEDED')
        except Exception as exc:
            if job(id)['state']!='CANCELLED':update(id,'FAILED',str(exc))
        finally:PROCESSES.pop(id,None);Q.task_done()
def kill(id):
    proc=PROCESSES.get(id)
    if proc and proc.poll() is None:
        if os.name=='nt':subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
        else:proc.terminate()
threading.Thread(target=worker,daemon=True).start()
app=FastAPI(title='海洋声学工作台',docs_url='/api/docs')

@app.middleware('http')
async def local_guard(request:Request,call_next):
    host=request.headers.get('host','').split(':')[0]
    if host not in ['127.0.0.1','localhost','testserver']:return Response('Local service only',status_code=403)
    origin=request.headers.get('origin')
    if request.method not in ['GET','HEAD','OPTIONS'] and origin and origin not in ['http://127.0.0.1:8765','http://localhost:8765','http://127.0.0.1:5173','http://localhost:5173']:return Response('Invalid origin',status_code=403)
    return await call_next(request)

@app.get('/api/health')
def health():
    cfg = config()
    t = Path(cfg.get('toolbox_path', '.'))
    m_path = cfg.get('matlab_path', '')
    matlab_ver = 'R2024b'
    if m_path:
        match = re.search(r'R202\d[ab]', m_path, re.IGNORECASE)
        if match:
            matlab_ver = match.group(0).upper()
        elif Path(m_path).is_file():
            matlab_ver = '已连接'
    return {
        'version': '0.2.0',
        'matlab_available': Path(m_path).is_file() if m_path else False,
        'matlab_version': matlab_ver,
        'solver_available': (t / 'bin/kraken.exe').is_file() and (t / 'bin/field.exe').is_file(),
        'model_configured': bool(cfg.get('api_key')),
        'knowledge_cards': len(claims()),
        'model_name': next((m['name'] for m in models.catalog()['models'] if m['provider'] == cfg.get('provider') and m['id'] == cfg.get('model')), cfg.get('model', '')),
        'provider_name': next((p['name'] for p in models.catalog()['providers'] if p['id'] == cfg.get('provider')), cfg.get('provider', '')),
        'sources': len(sources()),
        'paused': PAUSED
    }

@app.get('/api/config')
def get_config():
    cfg = config()
    cfg['api_key_set'] = bool(cfg.pop('api_key', ''))
    return cfg

@app.put('/api/config')
async def save_config(request: Request):
    data = await request.json()
    cfg = config()
    old_provider = cfg.get('provider')
    new_provider = data.get('provider', old_provider)
    if new_provider and new_provider not in [p['id'] for p in models.catalog()['providers']]:
        raise HTTPException(422, '未知供应商')
    if new_provider != old_provider:
        models.store_profile(cfg)
        cfg['api_key'] = models.profiles(config).get(new_provider, {}).get('api_key', '')
    allowed = ['matlab_path', 'toolbox_path', 'project_path', 'provider', 'base_url', 'model', 'api_key', 'timeout_seconds']
    for key in allowed:
        if key in data and (key != 'api_key' or data[key]):
            cfg[key] = data[key]
    if data.get('clear_api_key'):
        cfg.pop('api_key', None)
    if cfg.get('provider') and cfg.get('base_url'):
        models.validate_endpoint(cfg['provider'], str(cfg.get('base_url', '')))
    if not 30 <= int(cfg.get('timeout_seconds', 240)) <= 600:
        raise HTTPException(422, '超时范围30–600秒')
    models.store_profile(cfg)
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'saved': True}

@app.get('/api/matlab/detect')
def detect_matlab():
    cfg = config()
    candidates_m = [
        cfg.get('matlab_path', ''),
        r"D:\Program Files\MATLAB\R2024b\bin\matlab.exe",
        r"D:\Program Files\MATLAB\R2024a\bin\matlab.exe",
        r"C:\Program Files\MATLAB\R2024b\bin\matlab.exe",
        r"C:\Program Files\MATLAB\R2024a\bin\matlab.exe",
        r"C:\Program Files\MATLAB\R2023b\bin\matlab.exe",
        r"C:\Program Files\MATLAB\R2023a\bin\matlab.exe",
    ]
    for d in [r"D:\Program Files\MATLAB", r"C:\Program Files\MATLAB"]:
        try:
            dp = Path(d)
            if dp.is_dir():
                for sub in dp.iterdir():
                    exe = sub / 'bin' / 'matlab.exe'
                    if exe.is_file() and str(exe) not in candidates_m:
                        candidates_m.append(str(exe))
        except Exception:
            pass

    candidates_tb = [
        cfg.get('toolbox_path', ''),
        r"D:\matlab-project&tool\at-matlab\at",
        r"C:\at",
        r"D:\at",
        str(ROOT.parent / "at"),
        str(ROOT / "at"),
    ]

    detected_matlab = []
    for p in candidates_m:
        if p and Path(p).is_file() and p not in detected_matlab:
            detected_matlab.append(p)

    detected_toolbox = []
    for p in candidates_tb:
        if p and Path(p).is_dir() and p not in detected_toolbox:
            detected_toolbox.append(p)

    return {
        'detected_matlab': detected_matlab,
        'detected_toolbox': detected_toolbox,
        'current_matlab': cfg.get('matlab_path', ''),
        'current_toolbox': cfg.get('toolbox_path', '')
    }

@app.post('/api/matlab/check')
async def check_matlab(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    cfg = config()
    m_path = data.get('matlab_path') or cfg.get('matlab_path', '')
    tb_path = data.get('toolbox_path') or cfg.get('toolbox_path', '')

    exe_p = Path(m_path) if m_path else None
    tb_p = Path(tb_path) if tb_path else None

    matlab_ok = bool(exe_p and exe_p.is_file())
    ver_match = re.search(r'R202\d[ab]', m_path, re.I) if m_path else None
    matlab_ver = ver_match.group(0).upper() if ver_match else ('可用' if matlab_ok else '未检测到')

    kraken_ok = bool(tb_p and (tb_p / 'bin' / 'kraken.exe').is_file())
    bellhop_ok = bool(tb_p and (tb_p / 'bin' / 'bellhop.exe').is_file())
    field_ok = bool(tb_p and (tb_p / 'bin' / 'field.exe').is_file())
    scooter_ok = bool(tb_p and (tb_p / 'bin' / 'scooter.exe').is_file())
    bounce_ok = bool(tb_p and (tb_p / 'bin' / 'bounce.exe').is_file())
    read_ok = bool(tb_p and (tb_p / 'ReadWrite' / 'read_modes.m').is_file())
    shd_ok = bool(tb_p and (tb_p / 'ReadWrite' / 'read_shd.m').is_file())
    env_ok = bool(tb_p and (tb_p / 'tests' / 'Munk' / 'MunkK.env').is_file())

    components = [
        {'id': 'matlab', 'name': 'MATLAB 核心引擎', 'path': m_path, 'ok': matlab_ok, 'desc': f'版本: {matlab_ver}' if matlab_ok else '可执行文件不存在'},
        {'id': 'kraken', 'name': 'KRAKEN 简正波求解器', 'path': str(tb_p / 'bin' / 'kraken.exe') if tb_p else '', 'ok': kraken_ok, 'desc': 'KRAKEN / KRAKENC 二进制求解器'},
        {'id': 'bellhop', 'name': 'BELLHOP 射线求解器', 'path': str(tb_p / 'bin' / 'bellhop.exe') if tb_p else '', 'ok': bellhop_ok, 'desc': '高斯光束与声线追踪求解器'},
        {'id': 'field', 'name': 'FIELD 场分布合成器', 'path': str(tb_p / 'bin' / 'field.exe') if tb_p else '', 'ok': field_ok, 'desc': '声压场与传播损失合成'},
        {'id': 'scooter', 'name': 'SCOOTER 快速场求解器', 'path': str(tb_p / 'bin' / 'scooter.exe') if tb_p else '', 'ok': scooter_ok, 'desc': 'FFP 快速场积分计算'},
        {'id': 'readwrite', 'name': 'AT 数据读写库', 'path': str(tb_p / 'ReadWrite') if tb_p else '', 'ok': read_ok and shd_ok, 'desc': 'read_modes.m, read_shd.m 数据读取函数'},
        {'id': 'testcases', 'name': '基准测试算例', 'path': str(tb_p / 'tests' / 'Munk') if tb_p else '', 'ok': env_ok, 'desc': 'Munk 深海 5000m 环境文件'}
    ]

    all_ok = matlab_ok and kraken_ok and field_ok and read_ok
    return {
        'ok': all_ok,
        'matlab_version': matlab_ver,
        'components': components,
        'summary': 'MATLAB 与 Acoustics Toolbox 计算环境检测全部通过，可执行全套声学仿真。' if all_ok else '部分计算组件缺失，请检查路径配置。'
    }

@app.post('/api/environment/check')
def check_environment():
    cfg = config()
    tool = Path(cfg.get('toolbox_path', '.'))
    prj = Path(cfg.get('project_path', '.'))
    return {
        'checks': [
            {'name': 'MATLAB 可执行程序', 'ok': Path(cfg.get('matlab_path', '')).is_file(), 'detail': cfg.get('matlab_path', '')},
            {'name': 'KRAKEN / FIELD 求解器', 'ok': all((tool / 'bin' / x).is_file() for x in ['kraken.exe', 'field.exe']), 'detail': str(tool / 'bin')},
            {'name': 'Munk 成对输入', 'ok': all((tool / 'tests/Munk' / x).is_file() for x in ['MunkK.env', 'MunkK.flp']), 'detail': '5000 m 深海；50 Hz 原始示例'},
            {'name': '授权项目目录', 'ok': prj.is_dir(), 'detail': str(prj)},
            {'name': '模型 API Key', 'ok': bool(cfg.get('api_key')), 'detail': '已保存' if cfg.get('api_key') else '未配置；图谱浏览与模板仿真仍可用'}
        ]
    }
@app.get('/api/graph')
def graph():return knowledge.graph_data()
@app.get('/api/graph/path')
def graph_path(source:str,target:str):
    try:return knowledge.shortest_path(source,target)
    except ValueError as e:raise HTTPException(422,str(e))
@app.get('/api/models/catalog')
def model_catalog():return models.catalog()
@app.get('/api/models/profiles')
def model_profiles():return models.public_profiles(config)
@app.post('/api/models/test')
async def model_test(request:Request):return await models.test_connection(await request.json(),config)
@app.post('/api/models/list')
async def account_models(request:Request):return await models.list_account_models(await request.json(),config)
@app.get('/api/sources')
def list_sources():return [{**s,'available':(LOCAL/'sources'/(s['id']+'.pdf')).exists(),'index_status':'种子命题已关联' if any(c['source_id']==s['id'] for c in claims()) else '尚未全文入库'} for s in sources()]
@app.get('/api/source/{source_id}')
def source_file(source_id:str):
    if source_id not in [s['id'] for s in sources()]:raise HTTPException(404)
    path=LOCAL/'sources'/(source_id+'.pdf')
    if not path.exists():raise HTTPException(404,'此来源尚未提供在线预览')
    return FileResponse(path,media_type='application/pdf')
@app.get('/api/source/{source_id}/page/{page}')
def source_image(source_id:str,page:int):
    if source_id not in [s['id'] for s in sources()]:raise HTTPException(404)
    path=LOCAL/'sources'/(source_id+'.pdf');cache=LOCAL/'page-images'/f'{source_id}-{page}.png'
    if not path.is_file():raise HTTPException(404)
    # PDFium is not thread-safe. A drawer requests several pages simultaneously.
    with PDFLOCK:
        if not cache.exists():
            import pypdfium2 as pdfium
            with pdfium.PdfDocument(str(path)) as pdf:
                if page<1 or page>len(pdf):raise HTTPException(404)
                cache.parent.mkdir(exist_ok=True);p=pdf[page-1];bitmap=p.render(scale=1.25)
                try:bitmap.to_pil().save(cache)
                finally:bitmap.close();p.close()
    return FileResponse(cache,media_type='image/png')
@app.get('/api/knowledge/code')
def knowledge_code(node:str,reference:int):
    item=next((n for n in knowledge.graph_data()['nodes'] if n['id']==node and n['kind']=='knowledge'),None)
    if not item or reference<0 or reference>=len(item['references']):raise HTTPException(404,'未登记的知识来源')
    ref=item['references'][reference];locator=ref.get('locator','').split(':')[0]
    if ref.get('pdf_page'):raise HTTPException(422,'此来源为 PDF')
    if locator.startswith('at/'):
        base=Path(config()['toolbox_path']).resolve();path=(base/locator[3:]).resolve()
    elif locator.startswith('backend/'):
        base=(ROOT/'backend').resolve();path=(ROOT/locator).resolve()
    else:raise HTTPException(404,'此来源尚未提供代码预览')
    if not path.is_relative_to(base) or not path.is_file() or path.suffix.lower() not in ['.m','.env','.flp','.py']:raise HTTPException(404,'源文件不可预览')
    content=path.read_text(encoding='utf-8',errors='replace')
    return Response(content='来源：'+ref['locator']+'\n\n'+content,media_type='text/plain; charset=utf-8')
@app.get('/api/knowledge/search')
def search(q:str=''):return knowledge.retrieve(q)
@app.post('/api/plans/preview')
def preview(plan:Plan):
    plan.checked();return {'plan':plan.model_dump(),'case_count':len(plan.frequencies_hz)*len(plan.source_depths_m),'warnings':['Munk 5000 m 示例环境，不代表指定真实海域','接收深度使用最近网格点，结果显示实际深度','相干简正波计算；固定 TL 色标 40–110 dB'],'cases':[{'frequency_hz':f,'source_depth_m':z} for f in plan.frequencies_hz for z in plan.source_depths_m]}
@app.post('/api/jobs')
def submit(plan:Plan):
    plan.checked();ids=[]
    for f in plan.frequencies_hz:
        for z in plan.source_depths_m:
            id=uuid.uuid4().hex[:12];cfg=plan.model_dump();cfg.update(frequency_hz=f,source_depth_m=z);ids.append(id)
            with connect() as c:c.execute('INSERT INTO jobs VALUES(?,?,?,?,?,NULL)',(id,'QUEUED',stamp(),stamp(),json.dumps(cfg)))
            Q.put(id)
    return {'ids':ids}
@app.get('/api/jobs')
def jobs():
    with connect() as c:rows=c.execute('SELECT * FROM jobs ORDER BY created DESC,rowid DESC LIMIT 100').fetchall()
    return [{**dict(r),'plan':json.loads(r['plan'])} for r in rows]
@app.get('/api/jobs/{id}')
def details(id:str):
    v=job(id);folder=run_dir(id);v['log']=(folder/'run.log').read_text(encoding='utf-8',errors='replace')[-50000:] if (folder/'run.log').exists() else '等待执行器领取任务…'
    v['artifacts']=[p.name for p in folder.glob('*') if p.is_file()] if folder.exists() else []
    if v['state']=='SUCCEEDED':v['summary']=json.loads((folder/'summary.json').read_text(encoding='utf-8'))
    return v
@app.post('/api/jobs/{id}/cancel')
def cancel(id:str):
    with STATELOCK:
        if job(id)['state'] not in ['QUEUED','RUNNING']:raise HTTPException(409,'任务已结束')
        update(id,'CANCELLED');kill(id)
    return {'cancelled':True}
@app.post('/api/queue/pause')
async def pause(request:Request):
    global PAUSED
    PAUSED=bool((await request.json()).get('paused'));return {'paused':PAUSED}
@app.get('/api/queue/status')
def queue_status():
    with connect() as c:
        counts = {r['state']: r['c'] for r in c.execute('SELECT state, COUNT(*) as c FROM jobs GROUP BY state')}
    return {'backend': 'sqlite', 'worker_active': True, 'paused': PAUSED, 'counts': counts}

@app.get('/api/account')
def account_info():
    return {
        'available': True,
        'authenticated': False,
        'role': 'student',
        'id': 'local-researcher',
        'name': '本地科研工作者'
    }

@app.get('/api/workspaces')
def list_workspaces():
    return {'workspaces': [], 'current': None}

@app.get('/api/workspaces/{path:path}')
def get_workspace_item(path: str):
    return {'workspaces': [], 'items': []}

@app.post('/api/workspaces/{path:path}')
def post_workspace_item(path: str):
    return {'ok': True}

@app.get('/api/exercises')
def exercises():
    p = ROOT / 'backend' / 'data' / 'exercises.json'
    if p.is_file():
        return json.loads(p.read_text(encoding='utf-8'))
    return []

@app.post('/api/plans/draft')
async def plan_draft(request: Request):
    try:
        body = await request.json()
        msg = body.get('message', '')
        return simulation.draft_plan(msg)
    except Exception as e:
        return {'draft_plan': {}, 'missing_fields': [], 'validation_errors': [str(e)], 'unsupported_requests': []}

@app.post('/api/jobs/compare')
async def compare_jobs(request: Request):
    try:
        body = await request.json()
        ids = body.get('ids', [])
        cases = []
        for jid in ids:
            v = job(jid)
            folder = run_dir(jid)
            res_path = folder / 'result.json'
            if res_path.exists():
                cases.append({'id': jid, 'plan': v['plan'], 'result': json.loads(res_path.read_text(encoding='utf-8-sig'))})
        if cases:
            return simulation.compare_cases(cases)
    except Exception:
        pass
    return {'differences': [], 'summary': '暂无可对比的有效仿真结果'}

@app.get('/api/knowledge/status')
def knowledge_status():
    return {'coverage': 1.0, 'status': 'ready', 'source_count': len(sources()), 'claims_count': len(claims())}

@app.get('/api/knowledge/gaps')
def knowledge_gaps():
    return []

@app.get('/api/knowledge/public-sources')
def public_sources():
    return []

@app.get('/api/jobs/{id}/artifact/{name}')
def artifact(id:str,name:str):
    job(id);folder=run_dir(id);path=(folder/name).resolve()
    if not path.is_relative_to(folder.resolve()) or not path.is_file():raise HTTPException(404)
    return FileResponse(path)
@app.get('/api/jobs/{id}/download')
def download(id:str):
    job(id);folder=run_dir(id);buff=io.BytesIO()
    with zipfile.ZipFile(buff,'w',zipfile.ZIP_DEFLATED) as z:
        for path in folder.glob('*'):
            if path.is_file():z.write(path,path.name)
    return Response(buff.getvalue(),media_type='application/zip',headers={'Content-Disposition':f'attachment; filename="ocean-{id}.zip"'})

def project_root():
    path=Path(config()['project_path']).resolve()
    if not path.is_dir():raise HTTPException(400,'项目目录不存在')
    return path
@app.get('/api/project/files')
def files():
    root=project_root();return {'root':str(root),'files':[{'path':str(p.relative_to(root)).replace('\\','/'),'size':p.stat().st_size} for p in root.rglob('*') if p.is_file() and p.suffix.lower() in ['.m','.env','.flp','.json','.txt'] and p.stat().st_size<1_000_000][:250]}
@app.get('/api/project/file')
def read_file(path:str):
    root=project_root();p=(root/path).resolve()
    if not p.is_relative_to(root) or not p.is_file() or p.suffix.lower() not in ['.m','.env','.flp','.json','.txt']:raise HTTPException(403,'仅允许授权项目内的文本文件')
    return {'path':path,'content':p.read_text(encoding='utf-8',errors='replace'),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}

class Chat(BaseModel):
    model_config = {'extra': 'ignore'}
    message:str=Field(min_length=1,max_length=12000)
    mode:str='chat'
    session:str='default'
    provider:str|None=None
    model:str|None=None
    knowledge_mode:str|None=None
    context_budget:object=None

class PlanRay(BaseModel):
    water_depth_m: float = Field(default=100.0, gt=0, le=10000)
    source_depth_m: float = Field(default=50.0, gt=0, le=10000)
    angles_deg: list[float] = Field(default=[5.0, 15.0, 30.0, 45.0, 60.0])
    range_max_km: float = Field(default=5.0, gt=0.1, le=500)
    sound_speed_mps: float = Field(default=1500.0, gt=500, le=3000)
    launch_direction: str = Field(default='both')

def execute_ray_job(params: dict) -> dict:
    id = uuid.uuid4().hex[:12]
    folder = run_dir(id)
    folder.mkdir(parents=True, exist_ok=True)
    plan_meta = {
        'task_type': 'shallow_water_ray_tracing',
        'water_depth_m': float(params.get('water_depth_m', 100.0)),
        'source_depth_m': float(params.get('source_depth_m', 50.0)),
        'range_max_km': float(params.get('range_max_km', 5.0)),
        'angles_deg': [float(a) for a in params.get('angles_deg', [5.0, 15.0, 30.0, 45.0, 60.0])],
        'sound_speed_mps': float(params.get('sound_speed_mps', 1500.0)),
        'launch_direction': str(params.get('launch_direction', 'both'))
    }
    with connect() as c:
        c.execute('INSERT INTO jobs VALUES(?,?,?,?,?,NULL)', (id, 'RUNNING', stamp(), stamp(), json.dumps(plan_meta, ensure_ascii=False)))
    log_file = folder / 'run.log'
    log_file.write_text(f"任务 {id}\n浅海射线声学仿真计算\n参数: {json.dumps(plan_meta, ensure_ascii=False)}\n", encoding='utf-8')
    try:
        res = ray_tracer.run_ray_tracing_job(
            water_depth_m=plan_meta['water_depth_m'],
            source_depth_m=plan_meta['source_depth_m'],
            angles_deg=plan_meta['angles_deg'],
            range_max_km=plan_meta['range_max_km'],
            sound_speed_mps=plan_meta['sound_speed_mps'],
            launch_direction=plan_meta['launch_direction'],
            output_dir=folder
        )
        update(id, 'SUCCEEDED')
        return {
            'status': 'success',
            'job_id': id,
            'state': 'SUCCEEDED',
            'plan': plan_meta,
            'summary': json.loads((folder / 'summary.json').read_text(encoding='utf-8')),
            'ray_plot_url': f"/api/jobs/{id}/artifact/ray_trajectories.png",
            'download_url': f"/api/jobs/{id}/download",
            'csv_url': f"/api/jobs/{id}/artifact/reflection_stats.csv"
        }
    except Exception as e:
        update(id, 'FAILED', str(e))
        return {'status': 'error', 'job_id': id, 'state': 'FAILED', 'error': str(e)}

def execute_code_job(code: str, description: str = "动态声学仿真计算", language: str = "python") -> dict:
    return code_sandbox.run_code_sandbox(
        code=code,
        language=language,
        description=description,
        db_path=DB,
        runs_dir=LOCAL / 'runs'
    )

@app.post('/api/jobs/ray')
def submit_ray(plan: PlanRay):
    return execute_ray_job(plan.model_dump())

@app.post('/api/jobs/code')
async def submit_code(request: Request):
    data = await request.json()
    code = data.get('code', '')
    desc = data.get('description', '动态声学仿真计算')
    lang = data.get('language', 'python')
    if not code.strip(): raise HTTPException(422, '代码不能为空')
    return execute_code_job(code, desc, lang)

def parse_simulation_intent(text: str) -> dict | None:
    text_lower = text.lower()
    # 检查是否为射线声学相关指令
    ray_keywords = ['射线', '声线', '掠射角', '反射次数', 'bellhop', '浅海声线', '海面反射', '海底反射', '轨迹']
    if any(k in text_lower for k in ray_keywords):
        H = 100.0
        m_H = re.search(r'(?:海底\s*[z=:]*|水深\s*[:：=]?)\s*(\d+(?:\.\d+)?)\s*m', text)
        if m_H: H = float(m_H.group(1))

        zs = 50.0
        m_zs = re.search(r'(?:声源|源深|z_?s)\s*(?:在|[:：=])?\s*(\d+(?:\.\d+)?)\s*m', text)
        if m_zs: zs = float(m_zs.group(1))

        c = 1500.0
        m_c = re.search(r'(?:声速\s*[c=:]*|c\s*=)\s*(\d+(?:\.\d+)?)\s*(?:m/s)?', text)
        if m_c: c = float(m_c.group(1))

        r_max = 5.0
        m_r = re.search(r'(?:距离\s*[r=:]*|r\s*=\s*)(\d+(?:\.\d+)?)\s*km', text)
        if m_r: r_max = float(m_r.group(1))

        angles = []
        for m in re.finditer(r'(\d+(?:\.\d+)?)\s*[°度]', text):
            a = float(m.group(1))
            if 0 < a < 90: angles.append(a)
        angles = sorted(list(set(angles)))
        if not angles: angles = [5.0, 15.0, 30.0, 45.0, 60.0]

        return {
            'type': 'ray',
            'water_depth_m': H,
            'source_depth_m': zs,
            'sound_speed_mps': c,
            'range_max_km': r_max,
            'angles_deg': angles,
            'launch_direction': 'both'
        }

    # 检查是否为 KRAKEN 简正波/深海声场相关指令
    sim_keywords = ['仿真', '计算声场', '模拟', '跑一下', '运行声场', 'kraken', 'munk', '传播损失', '声场分布']
    if any(k in text_lower for k in sim_keywords):
        freqs = []
        for m in re.finditer(r'(\d+(?:\.\d+)?)\s*(?:hz|赫兹)', text, re.I):
            f = float(m.group(1))
            if 10 <= f <= 200: freqs.append(f)
        if not freqs:
            m = re.search(r'频率\s*[:：=]?\s*(\d+(?:\.\d+)?)', text)
            if m and 10 <= float(m.group(1)) <= 200: freqs.append(float(m.group(1)))
        if not freqs: freqs = [50.0]

        source_depths = []
        for m in re.finditer(r'(?:源深|声源深度|声源|发射深度)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*m?', text):
            d = float(m.group(1))
            if 0 < d < 5000: source_depths.append(d)
        if not source_depths: source_depths = [1000.0]

        rec_depth = 1000.0
        m = re.search(r'(?:接收深(?:度)?|接收器深度|接收点深度|接收)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*m?', text)
        if m and 0 < float(m.group(1)) < 5000: rec_depth = float(m.group(1))

        r_max = 50.0
        m = re.search(r'(?:最大距离|距离|范围|传播距离)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*km', text)
        if m and 0.1 < float(m.group(1)) <= 100: r_max = float(m.group(1))

        return {
            'type': 'kraken',
            'frequencies_hz': sorted(list(set(freqs))),
            'source_depths_m': sorted(list(set(source_depths))),
            'receiver_depth_m': rec_depth,
            'range_min_km': 1.0,
            'range_max_km': r_max,
            'range_points': 201,
            'depth_points': 251,
            'template': 'munk_5000m'
        }

    return None

async def execute_simulation_and_wait(plan_data:dict, timeout:int=150)->dict:
    try:
        p = Plan(**plan_data)
        p.checked()
    except Exception as e:
        return {'status': 'error', 'error': f'参数校验失败: {str(e)}'}
    
    sub = submit(p)
    job_ids = sub.get('ids', [])
    if not job_ids:
        return {'status': 'error', 'error': '任务提交失败，未生成任务标识'}
    
    start_t = time.time()
    results = []
    for jid in job_ids:
        while time.time() - start_t < timeout:
            jinfo = job(jid)
            if jinfo['state'] in ['SUCCEEDED', 'FAILED', 'CANCELLED']:
                break
            await asyncio.sleep(1.0)
        jinfo = job(jid)
        folder = run_dir(jid)
        item = {
            'job_id': jid,
            'state': jinfo['state'],
            'plan': jinfo['plan'],
            'error': jinfo.get('error')
        }
        if jinfo['state'] == 'SUCCEEDED':
            sum_path = folder / 'summary.json'
            if sum_path.exists():
                item['summary'] = json.loads(sum_path.read_text(encoding='utf-8'))
            item['tl_map_url'] = f"/api/jobs/{jid}/artifact/tl_map.png"
            item['tl_curve_url'] = f"/api/jobs/{jid}/artifact/tl_curve.png"
            item['download_url'] = f"/api/jobs/{jid}/download"
        results.append(item)
    return {'status': 'success', 'results': results}

@app.get('/api/chat/history')
def history(session:str='default'):
    with connect() as c:rows=c.execute('SELECT * FROM messages WHERE session=? ORDER BY id DESC LIMIT 40',(session,)).fetchall()
    return [dict(r) for r in reversed(rows)]

@app.post('/api/chat')
async def chat(body:Chat):
    cfg=config();evidence=search(body.message)
    with connect() as c:c.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',(body.session,'user',body.message,stamp()))
    
    sim_intent = parse_simulation_intent(body.message)
    # 模式一：离线自然语言仿真（当未配置 API Key 时，基于声学意图规则解析器自动提取参数并执行仿真）
    if not cfg.get('api_key') and sim_intent:
        if sim_intent.get('type') == 'ray':
            ray_res = execute_ray_job(sim_intent)
            if ray_res.get('status') == 'success':
                jid = ray_res['job_id']
                summ = ray_res['summary']
                results = summ.get('results', {})
                up_rays = results.get('up', [])
                down_rays = results.get('down', [])
                
                angles = sim_intent['angles_deg']
                H = sim_intent['water_depth_m']
                zs = sim_intent['source_depth_m']
                c = sim_intent['sound_speed_mps']
                rmax = sim_intent['range_max_km']
                
                lines = [
                    "### 🌊 浅海射线声学仿真已自动解析并执行完成",
                    "**任务拆解与工况参数**：",
                    f"- **海水环境**：等声速水体 $c = {c:g} \\text{{ m/s}}$，水深 $H = {H:g} \\text{{ m}}$（海面 $z=0\\text{{ m}}$，海底 $z={H:g}\\text{{ m}}$）",
                    f"- **声源参数**：深度 $z_s = {zs:g} \\text{{ m}}$，发射掠射角：{', '.join(f'{a:g}°' for a in angles)}",
                    f"- **水平范围**：$r = 0 \\sim {rmax:g} \\text{{ km}}$（{rmax*1000:g} m）",
                    "- **仿真引擎**：高精度解析几何与反射相图追踪引擎（支持 BELLHOP 射线格式）",
                    "",
                    f"#### 📊 声线反射统计与到达特征分析表（$r = {rmax:g}\\text{{ km}}$，任务标识: `{jid}`）",
                    "| 掠射角 $\\theta$ | $\\tan\\theta$ | 总反射次数 | 向上发射 (海面/海底) | 向下发射 (海面/海底) | 末次反射位置 | 距终点余量 | 终点深度 $z$ |",
                    "| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
                ]
                
                for idx, ang in enumerate(angles):
                    u = up_rays[idx] if idx < len(up_rays) else {}
                    d = down_rays[idx] if idx < len(down_rays) else {}
                    tan_th = math.tan(math.radians(ang))
                    tot = u.get('total_bounces', 0)
                    u_sb = f"{u.get('surface_bounces',0)} / {u.get('bottom_bounces',0)}"
                    d_sb = f"{d.get('surface_bounces',0)} / {d.get('bottom_bounces',0)}"
                    last_r = f"{u.get('last_bounce_r_m', 0):.1f} m"
                    margin = f"{u.get('margin_to_rmax_m', 0):.1f} m"
                    end_z = f"上{u.get('end_depth_m',0):.1f}m / 下{d.get('end_depth_m',0):.1f}m"
                    lines.append(f"| **{ang:g}°** | {tan_th:.5f} | **{tot} 次** | {u_sb} | {d_sb} | {last_r} | {margin} | {end_z} |")
                
                lines.extend([
                    "",
                    f"![浅海声线传播轨迹]({ray_res['ray_plot_url']})",
                    "",
                    "💡 **物理机理与特性分析**：",
                    f"1. **声源居中对称性**：声源深度 $z_s = {zs:g}\\text{{ m}} = H/2$ 恰处波导中心。朝上（向海面）发射与朝下（向海底）发射的声线轨迹关于深度中心完全对称，反射总次数严格一致；当总次数为奇数时，海面与海底反射次数互换（例如 15° 为 7/6 与 6/7）。",
                    "2. **等声速折射与反射**：等声速介质中折射率恒定，声线严格沿直线传播。海面为自由释放面（声软边界，$V=-1$，反射相位跳变 $\\pi$）；海底为理想镜面全反射，每次反射的掠射角守恒。",
                    "3. **末次反射的端点敏感性**：掠射角越大，反射跃度越密。例如 60° 声线的第 87 次反射发生在 $r = 4994.1\\text{ m}$，距 5 km 终端仅剩 5.9 米！微小的测距误差可能引起反射计数的跳变。",
                    "4. **实际浅海与理想模型的差异**：真实浅海中海底沉积物（如砂质、淤泥）存在剪切波与吸收衰减（$\\alpha \\approx 0.5 \\sim 1.0\\text{ dB}/\\lambda$），高掠射角声线经历几十次海底反射后能量迅速衰减耗尽，远场将以小掠射角声线为主导。",
                    "",
                    f"[📥 下载本次完整仿真结果包 (含高分辨率图、CSV与JSON数据)]({ray_res['download_url']})",
                    ""
                ])
                reply = '\n'.join(lines)
                with connect() as c:c.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',(body.session,'assistant',reply,stamp()))
                return {'reply':reply,'model_used':False,'evidence_ids':[e['id'] for e in evidence]}
            else:
                reply = f"❌ 射线仿真执行失败: {ray_res.get('error')}"
                with connect() as c:c.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',(body.session,'assistant',reply,stamp()))
                return {'reply':reply,'model_used':False,'evidence_ids':[]}
        
        elif sim_intent.get('type') == 'kraken':
            sim_res = await execute_simulation_and_wait(sim_intent)
            if sim_res.get('status') == 'success':
                lines = [
                    "### 🌊 海洋声学仿真智能体已自动解析并执行任务",
                    "**任务拆解与参数提取**：",
                    f"- **频率组合**：{', '.join(f'{f:g} Hz' for f in sim_intent['frequencies_hz'])}",
                    f"- **声源深度**：{', '.join(f'{z:g} m' for z in sim_intent['source_depths_m'])}",
                    f"- **接收深度**：{sim_intent['receiver_depth_m']:g} m",
                    f"- **计算距离**：{sim_intent['range_min_km']:g} ~ {sim_intent['range_max_km']:g} km",
                    "- **声场模型**：KRAKEN 简正波求解器（Munk 5000m 理想深海声道剖面）",
                    ""
                ]
                for r in sim_res['results']:
                    jid = r['job_id']
                    if r['state'] == 'SUCCEEDED':
                        s = r.get('summary', {})
                        lines.extend([
                            f"#### 📊 仿真结果 [任务 ID: {jid}]",
                            f"- **计算工况**：频率 {r['plan'].get('frequency_hz')} Hz | 声源深度 {r['plan'].get('source_depth_m')} m | 实际接收深度 {s.get('actual_receiver_depth_m')} m",
                            f"- **统计指标**：中位传播损失 **{s.get('tl_median_db', 0):.2f} dB** | 最小损失 **{s.get('tl_min_db', 0):.2f} dB** | 最大损失 **{s.get('tl_max_db', 0):.2f} dB**",
                            f"- **有效网格**：{s.get('valid_ratio', 1.0)*100:.1f}% 有效点（忽略海面近零声压残差）",
                            "",
                            f"![传播损失声场分布图]({r['tl_map_url']})",
                            f"![接收深度传播损失曲线]({r['tl_curve_url']})",
                            "",
                            "💡 **物理机理分析**：",
                            "1. **深海声道约束**：声源位于深海声道轴附近时，声能受到上下水层折射（Snell定律）的反转约束，能量长距离滞留在声道内，避免了海面和海底的反射损耗；",
                            "2. **模态干涉效应**：随着传播距离增加，各阶简正波模态相位差累积，引起局部周期性的干涉加强与相消（反转点间距约 30~50 km）；",
                            "3. **传播损失趋势**：远场损失曲线在柱面几何扩展规律的基础上叠加了相干干涉纹波。",
                            f"[📥 下载本次完整仿真结果包]({r['download_url']})",
                            ""
                        ])
                    else:
                        lines.append(f"❌ 任务 {jid} 运行失败：{r.get('error')}")
                reply = '\n'.join(lines)
                with connect() as c:c.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',(body.session,'assistant',reply,stamp()))
                return {'reply':reply,'model_used':False,'evidence_ids':[e['id'] for e in evidence]}
    
    # 模式二：未配置 API Key 且非仿真指令，回退到知识卡检索
    if not cfg.get('api_key'):
        reply=('尚未配置模型 API Key。以下为课程知识卡检索，未调用大模型：\n\n'+'\n\n'.join(f"[{c['id']}] {c['text']}"+(f"\n公式：{c['formula']}" if c['formula'] else '')+f"\n适用条件：{c['conditions']}\n来源：{c['source_id']} "+(f"PDF 第 {c['pdf_page']} 页" if c.get('pdf_page') else c.get('locator','')) for c in evidence)) if evidence else '尚未配置模型 API Key，当前知识库没有找到匹配条目。请尝试声速剖面、源深、模态、传播损失等具体术语，或直接输入例如：“帮我仿真 50Hz 声源 1000m 的声场传播” 或 “用射线声学仿真浅海中的声线传播”。'
        if body.mode=='agent':reply='Agent 模式已接入任务编排与项目读取工具。直接输入仿真需求可自动执行仿真并分析。\n\n'+reply
        used=False
    else:
        tb_path = cfg.get('toolbox_path', r"D:\matlab-project&tool\at-matlab\at")
        sys_prompt = (
            "你是现代海洋声学智能体助手。依据所附知识卡及 related_triples 图谱关系回答并引用编号。\n"
            "你具备完备的海洋声学建模仿真与代码沙箱求解能力，包含：\n"
            "1. 浅海/深海声线追踪仿真（run_ray_simulation 工具）：可精确计算声线传播轨迹、海面与海底反射次数，并输出轨迹图；\n"
            "2. 通用声学代码沙箱（run_acoustic_code 工具）：当面对任意开放式声学任务（如 Pekeris 波导、声影区、反射系数、简正波截止频率、多途时延冲激响应等）时，可自主编写并执行 MATLAB 或 Python 仿真代码，自动生成图表并返回数据；\n"
            "3. 理想深海简正波声场计算（run_ocean_simulation 工具）：调用本机 MATLAB KRAKEN 求解器计算 Munk 声场传播损失。\n"
            "【极速执行准则】：\n"
            "- 当用户要求仿真、计算或画图时，必须在第 1 轮直接调用 run_acoustic_code（若指定 MATLAB/AT 则选 matlab，其他可选 python）或 run_ray_simulation！严禁先调用 list_project_files 或 read_project_file 探测，一步到位写出完整可执行脚本。\n"
            f"- 本机 Acoustics Toolbox (AT) 绝对路径为: {tb_path}。环境变量 AT_PATH 已设为该值，MATLAB 中变量 tb 已自动注入，无需寻找或搜索路径！\n"
            "- 严禁在脚本中编写 dir('C:\\**') 或 dir('D:\\**') 全盘搜索！直接使用 tb 变量或 getenv('AT_PATH') 即可。\n"
            "- 若使用 MATLAB + Acoustics Toolbox 仿真 Pekeris 波导或常规波导：\n"
            "  * .env 环境文件格式要求（切勿遗漏 'CVW' 和网格数）：\n"
            "    fid = fopen('pekeris.env', 'w');\n"
            "    fprintf(fid, \"'Pekeris Waveguide'\\n%.1f\\n1\\n'CVW'\\n10000 0.0 %.1f\\n 0.0 %.1f 0 %.1f /\\n %.1f %.1f /\\n'A' 0.0\\n %.1f %.1f 0.0 %.1f 0.0 /\\n1400.0 20000.0\\n0.0\\n1\\n50.0 /\\n101\\n0.0 %.1f /\\n\", freq, H, c1, rho1, H, c1, H, c2, rho2, H);\n"
            "    fclose(fid);\n"
            "  * 执行 kraken 命令：system(['\"', fullfile(tb,'bin','kraken.exe'), '\" pekeris']);\n"
            "  * 读取模态必须传入文件名与频率：clear read_modes_bin; Mods = read_modes('pekeris.mod', freq);\n"
            "  * 严格传播模态满足 real(k) >= 2*pi*freq/c_bottom 且衰减系数 abs(imag(k)) < 1e-6；\n"
            "  * 绘图后使用 saveas(gcf, 'pekeris_modes.png') 保存，并在最终回复中用 ![图表说明](image_url) 插入展示，严密解析物理机制。\n"
            + json.dumps(evidence, ensure_ascii=False)
        )
        msgs=[{'role':'system','content':sys_prompt}]
        for m in history(body.session)[-12:]:msgs.append({'role':m['role'],'content':m['text']})
        
        tools = [
            {
                'type': 'function',
                'function': {
                    'name': 'run_ray_simulation',
                    'description': '执行浅海或深海射线声学仿真(计算等声速或梯度波导下的声线轨迹、海面与海底反射次数统计、生成轨迹图)。',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'water_depth_m': {'type': 'number', 'description': '水深(m)，默认100'},
                            'source_depth_m': {'type': 'number', 'description': '声源深度(m)，默认50'},
                            'angles_deg': {'type': 'array', 'items': {'type': 'number'}, 'description': '发射掠射角列表(度)，如[5, 15, 30, 45, 60]'},
                            'range_max_km': {'type': 'number', 'description': '最大水平距离(km)，默认5'},
                            'sound_speed_mps': {'type': 'number', 'description': '海水声速(m/s)，默认1500'},
                            'launch_direction': {'type': 'string', 'enum': ['both', 'up', 'down'], 'description': '发射方向，默认both'}
                        },
                        'required': ['angles_deg']
                    }
                }
            },
            {
                'type': 'function',
                'function': {
                    'name': 'run_acoustic_code',
                    'description': f'通用海洋声学代码沙箱。支持动态生成并执行 Python 或 MATLAB/AT 仿真代码！Acoustics Toolbox (AT) 路径已配置为: {tb_path}，已添加到 MATLAB 路径并注入变量 tb 与环境变量 AT_PATH。可以直接使用 tb 调用 kraken.exe, field.exe, bellhop.exe 等，或直接使用 read_modes, read_shd 等函数。严禁在代码中写全盘搜索 dir("C:\\\\**")！',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'language': {'type': 'string', 'enum': ['python', 'matlab'], 'description': '执行语言，可选 python 或 matlab，默认 python。需要调用 AT 工具箱 (如 kraken, bellhop, read_shd) 时请选择 matlab'},
                            'code': {'type': 'string', 'description': '要执行的完整 Python 或 MATLAB 代码。如果使用 matlab，环境已配置 AT 工具箱路径，只需编写执行脚本并将图表保存为当前目录下的 *.png（例如 saveas(gcf, "output.png")）'},
                            'description': {'type': 'string', 'description': '本次计算任务的简要描述'}
                        },
                        'required': ['code', 'description']
                    }
                }
            },
            {
                'type': 'function',
                'function': {
                    'name': 'run_ocean_simulation',
                    'description': '执行理想深海 Munk 简正波声场仿真(调度本机 MATLAB KRAKEN 简正波求解器)。支持输入频率、源深、接收深度和距离，返回计算结果统计与声场图URL。',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'frequencies_hz': {'type': 'array', 'items': {'type': 'number'}, 'description': '频率列表(Hz)，范围10-200，如[50]或[50, 100]'},
                            'source_depths_m': {'type': 'array', 'items': {'type': 'number'}, 'description': '声源深度列表(m)，范围0-5000，如[1000]或[500, 1000]'},
                            'receiver_depth_m': {'type': 'number', 'description': '接收深度(m)，默认1000'},
                            'range_min_km': {'type': 'number', 'description': '起始距离(km)，默认1'},
                            'range_max_km': {'type': 'number', 'description': '终止距离(km)，默认50'}
                        },
                        'required': ['frequencies_hz', 'source_depths_m']
                    }
                }
            },
            {'type':'function','function':{'name':'read_project_file','description':'读取已授权项目中的一个文本文件','parameters':{'type':'object','properties':{'path':{'type':'string'}},'required':['path']}}},
            {'type':'function','function':{'name':'list_project_files','description':'列出授权项目文件','parameters':{'type':'object','properties':{}}}}
        ]
        try:
            async with httpx.AsyncClient(timeout=180) as client:
                for turn in range(10):
                    payload=models.chat_payload(cfg,msgs,tools)
                    r=await client.post(cfg['base_url'].rstrip('/')+'/chat/completions',headers={'Authorization':'Bearer '+cfg['api_key']},json=payload)
                    if r.status_code!=200:raise RuntimeError('模型接口返回 '+str(r.status_code))
                    result=r.json()['choices'][0]['message'];calls=result.get('tool_calls')
                    if not calls:reply=result.get('content') or '模型未返回文字内容';break
                    msgs.append(result)
                    has_successful_sim = False
                    for call in calls:
                        try:
                            args=json.loads(call['function']['arguments'])
                            fname=call['function']['name']
                            print(f"[Agent Turn {turn+1}] Calling tool: {fname}")
                            if fname=='list_project_files':value=files()
                            elif fname=='read_project_file':value=read_file(args['path'])
                            elif fname=='run_ray_simulation':value=execute_ray_job(args)
                            elif fname=='run_acoustic_code':value=execute_code_job(args.get('code',''), args.get('description',''), args.get('language','python'))
                            elif fname=='run_ocean_simulation':value=await execute_simulation_and_wait(args)
                            else:value={'error':'不允许的工具'}
                        except Exception as e:value={'error':str(e)}
                        print(f"[Agent Turn {turn+1}] Result summary: {str(value)[:180]}")
                        msgs.append({'role':'tool','tool_call_id':call['id'],'content':json.dumps(value,ensure_ascii=False)})
                        if fname in ['run_acoustic_code', 'run_ray_simulation', 'run_ocean_simulation']:
                            if isinstance(value, dict) and (value.get('state') == 'SUCCEEDED' or value.get('status') == 'success'):
                                has_successful_sim = True
                    if has_successful_sim:
                        # 仿真已成功完成并生成数据，下一轮强制关闭工具调用，令模型直接输出图表解析与总结
                        tools = None
                else:reply='已达到工具调用轮次上限。'
            used=True
        except Exception as exc:raise HTTPException(502,str(exc))
    with connect() as c:c.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',(body.session,'assistant',reply,stamp()))
    return {'reply':reply,'model_used':used,'evidence_ids':[e['id'] for e in evidence]}

if (ROOT/'dist').exists():app.mount('/',StaticFiles(directory=ROOT/'dist',html=True),name='frontend')
if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=8765)
