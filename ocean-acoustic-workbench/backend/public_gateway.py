"""Visitor-scoped public gateway. Administrative localhost API is never tunneled."""
import json,secrets,time,sqlite3,asyncio,re,hashlib
from pathlib import Path
import httpx
from fastapi import FastAPI,Request,HTTPException
from fastapi.responses import JSONResponse,Response
import knowledge,models
ROOT=Path(__file__).resolve().parents[1];LOCAL=ROOT/'.local';STATE=LOCAL/'public-runtime.json';DB=LOCAL/'public-visitors.sqlite3'
runtime=json.loads(STATE.read_text(encoding='utf-8'));SECRET=runtime['gateway_secret'];ORIGIN=runtime['site_origin'];PRIVATE='http://127.0.0.1:8765'
def connect():
 c=sqlite3.connect(DB);c.row_factory=sqlite3.Row;return c
with connect() as db:db.executescript('CREATE TABLE IF NOT EXISTS visitors(id TEXT PRIMARY KEY, seen REAL); CREATE TABLE IF NOT EXISTS owned_jobs(id TEXT PRIMARY KEY, visitor TEXT); CREATE TABLE IF NOT EXISTS visitor_messages(id INTEGER PRIMARY KEY, visitor TEXT, role TEXT, text TEXT);')
profiles={};limits={};submit_lock=asyncio.Lock();app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
def defaults():return {'provider':'Qwen','base_url':'https://dashscope.aliyuncs.com/compatible-mode/v1','model':'qwen3.7-plus','api_key':'','public_mode':True,'api_key_set':False}
def current(visitor):return profiles.setdefault(visitor,{'selected':defaults(),'providers':{}})['selected'].copy()
def public(cfg):return {k:v for k,v in cfg.items() if k!='api_key'}|{'api_key_set':bool(cfg.get('api_key')),'public_mode':True}
@app.middleware('http')
async def protect(request,call_next):
 if not secrets.compare_digest(request.headers.get('x-ocean-gateway',''),SECRET):return JSONResponse({'detail':'此接口仅接受已发布网站的连接'},403)
 if int(request.headers.get('content-length','0') or '0')>65536:return JSONResponse({'detail':'请求内容过长'},413)
 if request.method not in ['GET','HEAD'] and request.headers.get('origin') not in [ORIGIN]:return JSONResponse({'detail':'请求来源不匹配'},403)
 visitor=request.cookies.get('ocean_visitor','');fresh=False
 with connect() as db:
  row=db.execute('SELECT seen FROM visitors WHERE id=?',(visitor,)).fetchone()
  if not row or time.time()-row['seen']>30*86400:visitor=secrets.token_urlsafe(32);fresh=True;db.execute('INSERT INTO visitors VALUES(?,?)',(visitor,time.time()))
  else:db.execute('UPDATE visitors SET seen=? WHERE id=?',(time.time(),visitor))
 request.state.visitor=visitor
 ip=request.headers.get('x-ocean-client-ip','unknown');now=time.time();stamp=limits.setdefault(ip,[]);stamp[:]=[x for x in stamp if now-x<60]
 if len(stamp)>240:return JSONResponse({'detail':'请求过于频繁，请稍后再试'},429)
 stamp.append(now)
 response=await call_next(request);response.headers['Cache-Control']='no-store';response.headers['X-Content-Type-Options']='nosniff'
 if fresh:response.set_cookie('ocean_visitor',visitor,max_age=30*86400,httponly=True,secure=True,samesite='lax',path='/')
 return response
async def upstream(request,path=None,body=None):
 async with httpx.AsyncClient(timeout=100) as client:
  response=await client.request(request.method,PRIVATE+(path or request.url.path),params=request.query_params,content=json.dumps(body,ensure_ascii=False).encode() if body is not None else await request.body(),headers={'Content-Type':'application/json'})
 headers={k:v for k,v in response.headers.items() if k.lower() in ['content-type','content-disposition']}
 return Response(response.content,status_code=response.status_code,headers=headers)
@app.get('/api/health')
async def health(request:Request):
 async with httpx.AsyncClient(timeout=5) as c:r=await c.get(PRIVATE+'/api/health')
 result=r.json();cfg=current(request.state.visitor);catalog=models.catalog()
 result.update(public_mode=True,model_configured=bool(cfg.get('api_key')),model_name=next((m['name'] for m in catalog['models'] if m['provider']==cfg['provider'] and m['id']==cfg['model']),cfg['model']),provider_name=next(p['name'] for p in catalog['providers'] if p['id']==cfg['provider']))
 return result
@app.get('/api/config')
def get_config(request:Request):return public(current(request.state.visitor))
@app.put('/api/config')
async def save_config(request:Request):
 body=await request.json();visitor=request.state.visitor;cfg=current(visitor);bucket=profiles[visitor]
 provider=body.get('provider',cfg['provider'])
 if provider not in [p['id'] for p in models.catalog()['providers']]:raise HTTPException(422,'未知供应商')
 if provider!=cfg['provider']:
  bucket['providers'][cfg['provider']]=cfg.copy();entry=next(p for p in models.catalog()['providers'] if p['id']==provider)
  cfg=bucket['providers'].get(provider,{'provider':provider,'base_url':entry['base_url'],'model':next(m['id'] for m in models.catalog()['models'] if m['provider']==provider),'api_key':''}).copy()
 for key in ['provider','base_url','model']:
  if key in body:cfg[key]=str(body[key])
 if body.get('api_key'):cfg['api_key']=str(body['api_key'])
 if body.get('clear_api_key'):cfg['api_key']=''
 models.validate_endpoint(provider,cfg['base_url'])
 if len(cfg['model'])>160 or len(cfg.get('api_key',''))>4096:raise HTTPException(422,'模型配置过长')
 bucket['selected']=cfg;bucket['providers'][provider]=cfg.copy();return public(cfg)
@app.get('/api/models/profiles')
def model_profiles(request:Request):
 visitor=request.state.visitor;cfg=current(visitor);rows=profiles[visitor]['providers'].copy();rows[cfg['provider']]=cfg
 return {p:public(c) for p,c in rows.items()}
@app.post('/api/models/{action}')
async def model_action(action:str,request:Request):
 if action not in ['test','list']:raise HTTPException(404)
 body=await request.json();cfg=current(request.state.visitor);provider=body.get('provider',cfg['provider'])
 saved=profiles[request.state.visitor]['providers'].get(provider,cfg if cfg['provider']==provider else {})
 key=body.get('api_key') or saved.get('api_key')
 if not key:raise HTTPException(422,'请填写你自己的供应商 API Key')
 selected={**saved,**body,'provider':provider,'api_key':key}
 return await (models.test_connection if action=='test' else models.list_account_models)(selected,lambda:selected)
@app.post('/api/environment/check')
async def environment(request:Request):
 h=await health(request)
 return {'checks':[{'name':'计算节点 MATLAB','ok':h['matlab_available'],'detail':'由项目计算节点执行，无需访客安装'},{'name':'KRAKEN / FIELD','ok':h['solver_available'],'detail':'Munk 示例求解器'},{'name':'你的模型 API Key','ok':h['model_configured'],'detail':'仅使用当前访客自己的模型配置'}]}
@app.get('/api/project/files')
def template_files():return {'root':'课程共享示例 · 只读','files':[{'path':n,'size':len(template_content(n).encode())} for n in ['run_ocean_case.m','MunkK.env','MunkK.flp']]}
def template_content(name):
 if name=='run_ocean_case.m':path=ROOT/'backend/matlab/run_ocean_case.m'
 elif name in ['MunkK.env','MunkK.flp']:
  private_cfg=json.loads((LOCAL/'config.json').read_text(encoding='utf-8'));path=Path(private_cfg['toolbox_path'])/'tests/Munk'/name
 else:raise HTTPException(403,'仅能读取课程公开示例')
 return path.read_text(encoding='utf-8',errors='replace')
@app.get('/api/project/file')
def template_file(path:str):
 content=template_content(path);return {'path':path,'content':content,'sha256':hashlib.sha256(content.encode()).hexdigest()}
@app.get('/api/chat/history')
def chat_history(request:Request):
 with connect() as db:rows=db.execute('SELECT role,text FROM visitor_messages WHERE visitor=? ORDER BY id DESC LIMIT 40',(request.state.visitor,)).fetchall()
 return [dict(r) for r in reversed(rows)]
@app.post('/api/chat')
async def chat(request:Request):
 body=await request.json();message=str(body.get('message',''));visitor=request.state.visitor
 if not 1<=len(message)<=12000:raise HTTPException(422,'问题长度须为 1–12000 字符')
 evidence=knowledge.retrieve(message);cfg=current(visitor)
 if not cfg.get('api_key'):
  reply='未配置你的模型 API Key。以下为课程知识卡检索：\n\n'+'\n\n'.join(f"[{c['id']}] {c['label']}\n{c['text']}\n公式：{c['formula'] or '见知识详情'}\n来源：{c['source_id']} {c['locator']}" for c in evidence) if evidence else '当前课程知识卡没有匹配内容，请尝试更具体的声学术语。'
 else:
  messages=[{'role':'system','content':'你是海洋声学课程助手。依据知识卡和图谱关系回答，引用编号，说明假设。课程层级与建议顺序不表示因果。当前不允许修改代码或宣称已经执行仿真。'+json.dumps(evidence,ensure_ascii=False)}]+[{'role':m['role'],'content':m['text']} for m in chat_history(request)[-10:]]+[{'role':'user','content':message}]
  if body.get('mode')=='agent':messages[0]['content']+='\n课程公开模板：'+template_content('run_ocean_case.m')[:18000]
  models.validate_endpoint(cfg['provider'],cfg['base_url'])
  try:
   async with httpx.AsyncClient(timeout=90,follow_redirects=False) as client:r=await client.post(cfg['base_url'].rstrip('/')+'/chat/completions',headers={'Authorization':'Bearer '+cfg['api_key']},json=models.chat_payload(cfg,messages))
   models.raise_remote(r);reply=r.json()['choices'][0]['message'].get('content') or '模型未返回文字内容'
  except httpx.RequestError:raise HTTPException(502,'模型服务连接未完成，请核对网络与配置')
  except (KeyError,ValueError):raise HTTPException(502,'模型响应格式不兼容')
 with connect() as db:
  db.execute('INSERT INTO visitor_messages(visitor,role,text) VALUES(?,?,?)',(visitor,'user',message));db.execute('INSERT INTO visitor_messages(visitor,role,text) VALUES(?,?,?)',(visitor,'assistant',reply))
 return {'reply':reply,'model_used':bool(cfg.get('api_key')),'evidence_ids':[c['id'] for c in evidence]}
@app.post('/api/jobs')
async def submit(request:Request):
 visitor=request.state.visitor;body=await request.json()
 count=len(body.get('frequencies_hz',[50]))*len(body.get('source_depths_m',[1000]))
 if count>4:raise HTTPException(422,'公开版每批最多 4 组，请拆分提交')
 async with submit_lock:
  async with httpx.AsyncClient(timeout=10) as c:jobs=(await c.get(PRIVATE+'/api/jobs')).json()
  active=[j for j in jobs if j['state'] in ['RUNNING','QUEUED']]
  with connect() as db:owned={r['id'] for r in db.execute('SELECT id FROM owned_jobs WHERE visitor=?',(visitor,))}
  if len(active)+count>16:raise HTTPException(429,'计算节点队列已满，请稍后提交')
  if any(j['id'] in owned for j in active):raise HTTPException(429,'你的上一批仿真尚未完成')
  result=await upstream(request,body=body)
  if result.status_code==200:
   data=json.loads(result.body)
   with connect() as db:
    for id in data['ids']:db.execute('INSERT INTO owned_jobs VALUES(?,?)',(id,visitor))
  return result
@app.get('/api/jobs')
async def jobs(request:Request):
 async with httpx.AsyncClient(timeout=10) as c:data=(await c.get(PRIVATE+'/api/jobs')).json()
 with connect() as db:owned={r['id'] for r in db.execute('SELECT id FROM owned_jobs WHERE visitor=?',(request.state.visitor,))}
 return [j for j in data if j['id'] in owned]
@app.api_route('/api/jobs/{id}/{rest:path}',methods=['GET','POST'])
@app.get('/api/jobs/{id}')
async def own_job(id:str,request:Request,rest:str=''):
 with connect() as db:owned=db.execute('SELECT 1 FROM owned_jobs WHERE id=? AND visitor=?',(id,request.state.visitor)).fetchone()
 if not owned:raise HTTPException(404,'任务不存在或不属于当前访客')
 if rest and rest not in ['cancel','download'] and not re.fullmatch(r'artifact/[a-zA-Z0-9_.-]+',rest):raise HTTPException(404)
 if request.method=='POST' and rest!='cancel':raise HTTPException(405)
 return await upstream(request)
@app.api_route('/api/{path:path}',methods=['GET','POST','PUT'])
async def readonly(path:str,request:Request):
 permitted=request.method=='GET' and (path in ['graph','graph/path','sources','models/catalog','knowledge/search'] or re.fullmatch(r'source/S\d{2}/page/\d+',path) or path=='knowledge/code')
 if request.method=='GET' and re.fullmatch(r'source/S\d{2}',path):raise HTTPException(403,'公开版提供教材原页片段，完整资料请使用课程资料包')
 if request.method=='POST' and path=='plans/preview':
  body=await request.json()
  if len(body.get('frequencies_hz',[50]))*len(body.get('source_depths_m',[1000]))>4:raise HTTPException(422,'公开版每批最多 4 组，请拆分提交')
  permitted=True
 if not permitted:raise HTTPException(403,'公开访客不能操作本地管理接口')
 return await upstream(request)
if __name__=='__main__':
 import uvicorn
 uvicorn.run(app,host='127.0.0.1',port=8780)
