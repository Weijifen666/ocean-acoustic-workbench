"""Outbound HTTPS bridge; only the scoped public gateway can receive cloud requests."""
import asyncio,json,time,hashlib,base64,os,uuid
from pathlib import Path
from urllib.parse import urlsplit
import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
def outbound_proxy(value):
 """An optional administrator-configured loopback proxy; never trust env proxies."""
 if value is None or value=='':return None
 try:
  if not isinstance(value,str):raise ValueError()
  parsed=urlsplit(value)
  if parsed.scheme!='http' or parsed.hostname not in ('127.0.0.1','localhost') or parsed.username or parsed.password or parsed.path not in ('','/') or parsed.query or parsed.fragment or not parsed.port or not 1<=parsed.port<=65535:raise ValueError()
 except (ValueError,TypeError):raise ValueError('outbound_proxy must be an explicit loopback HTTP origin') from None
 return f'http://{parsed.hostname}:{parsed.port}'
ROOT=Path(__file__).resolve().parents[1];STATE=Path(os.environ.get('OCEAN_RUNTIME_DIR',str(ROOT/'.local'))).expanduser().resolve()/'public-runtime.json'
runtime=json.loads(STATE.read_text(encoding='utf-8'));secret=runtime['gateway_secret'];site=runtime['site_origin'];cipher=AESGCM(hashlib.sha256(secret.encode()).digest())
def encrypt(value):
 iv=os.urandom(12);return base64.b64encode(iv+cipher.encrypt(iv,json.dumps(value,ensure_ascii=False).encode(),None)).decode()
def decrypt(value):
 b=base64.b64decode(value);return json.loads(cipher.decrypt(b[:12],b[12:],None))
async def execute(row,cloud,local):
 try:
  data=decrypt(row['payload']);path=data['path']
  if not path.startswith('/api/') or '://' in path or '\\' in path:raise ValueError('Unapproved path')
  headers={**data.get('headers',{}),'x-ocean-gateway':secret,'content-type':'application/json'}
  response=await local.request(data['method'],'http://127.0.0.1:8780'+path,headers=headers,content=data.get('body','').encode())
  values={'status':response.status_code,'headers':[[k,v] for k,v in response.headers.multi_items() if k.lower() in ['content-type','content-disposition','set-cookie']],'body':base64.b64encode(response.content).decode()}
 except Exception as e:
  print('Gateway request failed:',type(e).__name__,flush=True)
  values={'status':502,'headers':[['content-type','application/json']],'body':base64.b64encode(json.dumps({'detail':'计算节点未完成请求，请稍后重试'},ensure_ascii=False).encode()).decode()}
 completed={'id':row['id'],'payload':encrypt(values)}
 for attempt in range(4):
  try:
   response=await cloud.post(site+'/_bridge/complete',json=completed)
   if response.status_code in [200,410]:return
   if response.status_code not in [500,502,503,504]:break
  except httpx.HTTPError:pass
  await asyncio.sleep(1+attempt)
 print('Cloud result could not be acknowledged:',row['id'],flush=True)
async def main():
 tasks=set();seen_ok=False;last_request=0;poll_id=str(uuid.uuid4())
 async with httpx.AsyncClient(timeout=20,headers={'x-ocean-bridge':secret,'User-Agent':'OceanAcousticWorkbench/0.7 (+https://github.com/Weijifen666/ocean-acoustic-workbench)'},trust_env=False,follow_redirects=False,proxy=outbound_proxy(runtime.get('outbound_proxy')),limits=httpx.Limits(max_keepalive_connections=0)) as cloud,httpx.AsyncClient(timeout=95,trust_env=False,follow_redirects=False) as local:
  while True:
   try:
    response=await cloud.post(site+'/_bridge/poll',json={'poll_id':poll_id})
    if response.status_code==200:
     if not seen_ok:print('Public cloud bridge connected',flush=True);seen_ok=True
     rows=response.json()['requests']
     if rows:last_request=time.time()
     for row in rows:
      task=asyncio.create_task(execute(row,cloud,local));tasks.add(task);task.add_done_callback(tasks.discard)
     poll_id=str(uuid.uuid4())
    else:
     seen_ok=False;print('Cloud waiting:',response.status_code,flush=True)
   except httpx.HTTPError as e:
    seen_ok=False;print('Cloud poll connection:',type(e).__name__,flush=True)
   await asyncio.sleep(1 if time.time()-last_request<30 else 3)
if __name__=='__main__':asyncio.run(main())
