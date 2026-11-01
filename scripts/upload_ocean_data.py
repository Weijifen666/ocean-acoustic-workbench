"""Upload a verified export through the authenticated Worker importer; activate last."""
from __future__ import annotations
import argparse,base64,concurrent.futures,getpass,hashlib,json,os,sys,time
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from urllib.parse import urlparse

def sha(data):return hashlib.sha256(data).hexdigest()
def send(site,token,action,body):
    payload=json.dumps(body,separators=(',',':')).encode()
    for attempt in range(6):
        try:
            request=Request(site+'/_ocean-admin/'+action,data=payload,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'OceanAcousticWorkbench/0.7 (+https://github.com/Weijifen666/ocean-acoustic-workbench)'},method='POST')
            with urlopen(request,timeout=150) as response:return json.load(response)
        except HTTPError as error:
            detail=error.read(2000).decode(errors='replace')
            if error.code not in (429,500,502,503,504) or attempt==5:raise RuntimeError(f'Import HTTP {error.code}: {detail}') from None
        except (URLError,TimeoutError,OSError):
            if attempt==5:raise RuntimeError('Import connection failed after retries') from None
        time.sleep(min(20,2**attempt))

def upload(root,site,token,workers=3):
    inventory_bytes=(root/'objects.json').read_bytes();inventory=json.loads(inventory_bytes)
    manifest_bytes=(root/'manifest.json').read_bytes();manifest=json.loads(manifest_bytes)
    if not manifest.get('complete'):raise ValueError('Partial exports cannot be published')
    version=manifest['version'];items=inventory['objects']
    if version!=inventory['version']:raise ValueError('Manifest versions differ')
    print(f'Checking {len(items)} local objects before upload...',flush=True)
    for item in items:
        p=(root/item['key']).resolve()
        if not p.is_relative_to(root.resolve()):raise ValueError('Unsafe inventory path')
        data=p.read_bytes()
        if len(data)!=item['bytes'] or sha(data)!=item['sha256']:raise ValueError('Local data hash mismatch: '+item['key'])
    items=items+[
        {'key':'objects.json','bytes':len(inventory_bytes),'sha256':sha(inventory_bytes)},
        {'key':'manifest.json','bytes':len(manifest_bytes),'sha256':sha(manifest_bytes)},
    ]
    state_path=root/'.upload-state.json';state_key=site+'|'+sha(manifest_bytes)+'|'+sha(inventory_bytes)
    state=json.loads(state_path.read_text()) if state_path.exists() else {}
    completed=set(state.get('completed',[])) if state.get('key')==state_key else set()
    pending=[o for o in items if o['key'] not in completed]
    batches=[];batch=[];size=0
    for item in pending:
        if batch and (len(batch)>=16 or size+item['bytes']>6000000):batches.append(batch);batch=[];size=0
        batch.append(item);size+=item['bytes']
    if batch:batches.append(batch)
    def one(objects):
        encoded=[{'key':o['key'],'sha256':o['sha256'],'body':base64.b64encode((root/o['key']).read_bytes()).decode('ascii')} for o in objects]
        result=send(site,token,'batch',{'version':version,'objects':encoded})
        receipts={o['key']:o for o in result.get('objects',[])}
        if not result.get('ok') or any(receipts.get(o['key'],{}).get('sha256')!=o['sha256'] or receipts[o['key']]['bytes']!=o['bytes'] for o in objects):raise RuntimeError('Invalid upload acknowledgement')
        return [o['key'] for o in objects]
    started=time.monotonic();print(f'Uploading {len(pending)} objects in {len(batches)} batches ({len(completed)} already acknowledged).',flush=True)
    def acknowledge(keys):
        completed.update(keys)
        temporary=state_path.with_suffix('.tmp');temporary.write_text(json.dumps({'key':state_key,'completed':sorted(completed)}),encoding='utf-8');temporary.replace(state_path)
        print(f'Uploaded {len(completed)}/{len(items)} objects, elapsed {time.monotonic()-started:.0f}s',flush=True)
    # Authenticate and verify the first real batch before scheduling a large upload.
    if batches:acknowledge(one(batches.pop(0)))
    pool=concurrent.futures.ThreadPoolExecutor(max_workers=workers)
    futures=[pool.submit(one,b) for b in batches]
    try:
        for future in concurrent.futures.as_completed(futures):acknowledge(future.result())
    except BaseException:
        for future in futures:future.cancel()
        pool.shutdown(wait=True,cancel_futures=True);raise
    else:pool.shutdown(wait=True)
    print('Verifying remote object hashes and activating complete dataset...',flush=True)
    result=send(site,token,'activate',{'version':version,'manifest_sha256':sha(manifest_bytes),'inventory_sha256':sha(inventory_bytes)})
    if not result.get('ok') or result.get('verified_objects')!=inventory['total_objects'] or result.get('verified_bytes')!=inventory['total_bytes']:raise RuntimeError('Remote activation not verified')
    (root/'deployment-receipt.json').write_text(json.dumps({'site':site,**result},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'site':site,**result},ensure_ascii=False),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',type=Path,required=True);parser.add_argument('--site',required=True);parser.add_argument('--workers',type=int,default=3,choices=range(1,9));args=parser.parse_args()
    site=args.site.rstrip('/');url=urlparse(site)
    if url.scheme!='https' or not url.hostname or url.username or url.password or url.path not in ('','/'):parser.error('site must be an HTTPS origin')
    token=os.environ.get('DATA_PUBLISH_TOKEN') or getpass.getpass('Publish token (hidden): ')
    try:upload(args.data,site,token,args.workers)
    except Exception as error:print('Publish failed: '+str(error),file=sys.stderr);sys.exit(1)
