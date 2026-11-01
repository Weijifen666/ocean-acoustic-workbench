"""Visitor isolation over the real gateway, Studio Plan/expansion and JobStore.

Only temporary databases and output files are used. No MATLAB, live runtime,
credentials, network or existing task data are accessed by this test suite.
"""
import ast
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from pydantic import ValidationError
import test_public_gateway as legacy
import simulation_studio
import task_files

STUDIO={'solver':'kraken','template':'pekeris_100m','frequencies_hz':[50.0],
        'source_depths_m':[50.0],'receiver_depth_m':50.0,'range_min_km':0.1,
        'range_max_km':5.0,'range_points':51,'depth_points':51}


class PublicStudioGateway(legacy.PublicGateway):
 async def private(self,method,url,**options):
  path=httpx.URL(url).path
  payload=options.get('json')
  if payload is None and options.get('content'):payload=json.loads(options['content'])
  if path.startswith('/api/simulation/'):
   self.calls.append({'method':method,'path':path,'headers':dict(options.get('headers',{})),'payload':payload})
   if path not in ('/api/simulation/plans/preview','/api/simulation/jobs') or method!='POST':raise AssertionError('Unexpected private route')
   try:
    plan=simulation_studio.Plan(**payload)
    if path.endswith('/preview'):return httpx.Response(200,json=simulation_studio.preview(plan))
    mode=self.fail;self.fail=None
    if mode=='failure_before_commit':return httpx.Response(500,json={'detail':'synthetic failure before commit'})
    if mode=='timeout_before_commit':raise httpx.ReadTimeout('synthetic interruption before commit')
    headers=options.get('headers',{})
    wake=type('Wake',(),{'set':lambda self:None})()
    value=simulation_studio.submit(plan,self.node,wake,'studio:'+headers.get('X-Ocean-Submission-Scope','local'),headers.get('Idempotency-Key'))
    if mode=='timeout_after_commit':raise httpx.ReadTimeout('synthetic lost response after commit')
    if mode=='failure_after_commit':return httpx.Response(500,json={'detail':'synthetic failure after commit'})
    return httpx.Response(200,json=value)
   except ValidationError:return httpx.Response(422,json={'detail':'invalid studio fixture plan'})
   except HTTPException as error:return httpx.Response(error.status_code,json={'detail':error.detail})
  if path.startswith('/api/batches/'):
   self.calls.append({'method':method,'path':path,'headers':dict(options.get('headers',{})),'payload':payload})
   try:data=simulation_studio.batch_results(path.rsplit('/',1)[-1],self.node,self.local)
   except HTTPException as error:return httpx.Response(error.status_code,json={'detail':error.detail})
   if getattr(self,'batch_extra',False):data['cases'].append({'id':'f'*12,'state':'FAILED','private':'SHOULD-NOT-LEAK'})
   return httpx.Response(200,json=data)
  if method=='DELETE' and path.startswith('/api/jobs/'):
   self.calls.append({'method':method,'path':path,'headers':dict(options.get('headers',{})),'payload':payload})
   identity=path.rsplit('/',1)[-1];value=self.node.get(identity)
   if not value:return httpx.Response(404,json={'detail':'missing'})
   if value['state'] in ('QUEUED','RUNNING'):return httpx.Response(409,json={'detail':'active'})
   task_files.remove(self.local/'runs',identity)
   with self.node.connection() as db:
    db.execute('DELETE FROM job_events WHERE job_id=?',(identity,));db.execute('DELETE FROM jobs WHERE id=?',(identity,))
   return httpx.Response(200,json={'id':identity,'deleted':True,'files_deleted':True,'recoverable':False})
  return await super().private(method,url,**options)

 async def studio_create(self,visitor='A',key='studio-request-0001',plan=None):
  response=await self.call(visitor,'/api/simulation/jobs',body=plan or STUDIO,key=key)
  self.assertEqual(response.status_code,200,response.text);return response.json()

 async def test_studio_preview_uses_actual_plan_validation_and_never_submits(self):
  for solver in ('kraken','scooter','bellhop'):
   response=await self.call('A','/api/simulation/plans/preview',body={**STUDIO,'solver':solver})
   self.assertEqual(response.status_code,200,response.text);self.assertEqual(response.json()['case_count'],1)
   self.assertEqual(response.json()['plan']['solver'],solver)
  self.assertEqual(self.node.list(),[])
  self.assertTrue(all(row['path']=='/api/simulation/plans/preview' for row in self.calls))

 async def test_studio_case_limit_counts_expanded_cases_not_only_frequency_times_depth(self):
  # WOA itself is not exercised here; this deterministic environment fixture
  # lets the actual scenario expander generate all four seasons per frequency.
  environment={'ssp':[{'depth_m':0,'sound_speed_m_s':1500},{'depth_m':100,'sound_speed_m_s':1501}],
   'water_depth_m':100,'water_density_g_cm3':1.025,'bottom':{'speed_m_s':1800,'density_g_cm3':1.8,'attenuation_db_wavelength':0.8},'assumptions':['test-only environment']}
  plan={**STUDIO,'template':'woa18','scenario':'seasonal','water_depth_m':100,'frequencies_hz':[50.0,100.0]}
  with patch('custom_environment.prepare',return_value=environment):
   for path in ('/api/simulation/plans/preview','/api/simulation/jobs'):
    response=await self.call('A',path,body=plan,key='too-many-expanded-cases');self.assertEqual(response.status_code,422,response.text)
   response=await self.call('A','/api/simulation/jobs',body={**plan,'frequencies_hz':[50.]},key='four-expanded-cases')
  self.assertEqual(response.status_code,200,response.text);self.assertEqual(len(response.json()['ids']),4)
  self.assertEqual(len(self.node.list()),4)

 async def test_studio_persistent_receipts_recover_after_response_loss_without_extra_compute(self):
  self.fail='timeout_after_commit'
  response=await self.call('A','/api/simulation/jobs',body=STUDIO,key='studio-lost-response')
  self.assertEqual(response.status_code,503);self.assertEqual(len(self.node.list()),1)
  # Simulate a gateway restart losing all its pending/cache rows, retaining the
  # node's durable receipt. Recovery must use studio:{visitor scope} and the
  # node hash over frozen {plan,cases}, not the legacy plain-plan fingerprint.
  with self.namespace['connect']() as db:db.execute('DELETE FROM public_submissions')
  self.full_queue()
  recovered=await self.studio_create(key='studio-lost-response');self.assertTrue(recovered['reused'])
  self.assertEqual(len(self.node.list()),1)
  self.assertEqual(sum(c['method']=='POST' and c['path']=='/api/simulation/jobs' for c in self.calls),1)
  identity=recovered['ids'][0]
  self.assertEqual((await self.call('A','/api/jobs/'+identity,method='GET')).status_code,200)
  self.assertEqual((await self.call('B','/api/jobs/'+identity,method='GET')).status_code,404)

 async def test_studio_cached_replay_precedes_quota_and_foreign_request_keys_do_not_leak(self):
  a=await self.studio_create('A');b=await self.studio_create('B');self.assertNotEqual(a['ids'],b['ids'])
  self.full_queue();again=await self.studio_create('A');self.assertEqual(a['ids'],again['ids']);self.assertTrue(again['reused'])
  changed=await self.call('A','/api/simulation/jobs',body={**STUDIO,'receiver_depth_m':40.},key='studio-request-0001');self.assertEqual(changed.status_code,409)
  sent=[c['headers'] for c in self.calls if c['path']=='/api/simulation/jobs']
  self.assertNotEqual(sent[0]['X-Ocean-Submission-Scope'],sent[1]['X-Ocean-Submission-Scope'])
  self.assertTrue(all(set(headers)=={'Content-Type','X-Ocean-Submission-Scope','Idempotency-Key'} for headers in sent))

 async def test_studio_scope_and_case_hash_tampering_fail_closed(self):
  self.fail='timeout_after_commit';await self.call('A','/api/simulation/jobs',body=STUDIO,key='studio-tamper-request')
  with self.node.connection() as db:
   row=db.execute('SELECT id,plan FROM jobs').fetchone();plan=json.loads(row['plan']);plan['receiver_depth_m']=45.
   db.execute('UPDATE jobs SET plan=? WHERE id=?',(json.dumps(plan),row['id']))
  response=await self.call('A','/api/simulation/jobs',body=STUDIO,key='studio-tamper-request')
  self.assertEqual(response.status_code,409);self.assertEqual(len(self.node.list()),1)

 async def test_studio_parallel_retries_and_legacy_jobs_share_visitor_quota(self):
  results=await asyncio.gather(*[self.call('A','/api/simulation/jobs',body=STUDIO,key='studio-parallel-request') for _ in range(6)])
  self.assertTrue(all(r.status_code==200 for r in results),[r.text for r in results]);self.assertEqual(len(self.node.list()),1)
  self.assertEqual((await self.call('A',body=legacy.PLAN,key='new-legacy-request')).status_code,429)
  self.assertEqual((await self.call('A','/api/simulation/jobs',body=STUDIO,key='another-studio-request')).status_code,429)

 async def test_batch_requires_every_case_owned_and_validates_returned_membership(self):
  a=await self.studio_create('A',plan={**STUDIO,'scenario':'source_scan','source_depths_m':[20.,50.]})
  b=await self.studio_create('B')
  for visitor,batch in [('A',b),('B',a)]:
   self.assertEqual((await self.call(visitor,'/api/batches/'+batch['batch_id'],method='GET')).status_code,404)
  allowed=await self.call('A','/api/batches/'+a['batch_id'],method='GET');self.assertEqual(allowed.status_code,200,allowed.text)
  self.assertEqual({c['id'] for c in allowed.json()['cases']},set(a['ids']))
  with self.namespace['connect']() as db:db.execute('UPDATE owned_jobs SET visitor=? WHERE id=?',('B'*64,a['ids'][1]))
  before=sum(c['path'].startswith('/api/batches/') for c in self.calls)
  self.assertEqual((await self.call('A','/api/batches/'+a['batch_id'],method='GET')).status_code,404)
  self.assertEqual(sum(c['path'].startswith('/api/batches/') for c in self.calls),before)
  with self.namespace['connect']() as db:db.execute('UPDATE owned_jobs SET visitor=? WHERE id=?',('A'*64,a['ids'][1]))
  self.batch_extra=True
  response=await self.call('A','/api/batches/'+a['batch_id'],method='GET')
  self.assertEqual(response.status_code,503);self.assertNotIn('SHOULD-NOT-LEAK',response.text)

 async def test_delete_physically_removes_only_owned_terminal_files(self):
  a=await self.studio_create('A');b=await self.studio_create('B');identity=a['ids'][0]
  folder=self.local/'runs'/identity;folder.mkdir(parents=True);(folder/'result.txt').write_text('test-only output')
  other=self.local/'runs'/b['ids'][0];other.mkdir();(other/'keep.txt').write_text('foreign test-only output')
  self.assertEqual((await self.call('B','/api/jobs/'+identity,method='DELETE')).status_code,404)
  for state in ('QUEUED','RUNNING'):
   with self.node.connection() as db:db.execute('UPDATE jobs SET state=? WHERE id=?',(state,identity))
   self.assertEqual((await self.call('A','/api/jobs/'+identity,method='DELETE')).status_code,409)
   self.assertTrue(folder.exists())
  self.assertFalse(any(c['method']=='DELETE' for c in self.calls))
  self.node.finish(identity,'CANCELLED')
  result=await self.call('A','/api/jobs/'+identity,method='DELETE')
  self.assertEqual(result.status_code,200,result.text);self.assertTrue(result.json()['files_deleted'])
  self.assertFalse(folder.exists());self.assertIsNone(self.node.get(identity));self.assertTrue(other.exists())
  self.assertEqual((await self.call('B','/api/jobs/'+b['ids'][0],method='GET')).status_code,200)

 async def test_private_execution_keys_and_admin_routes_never_reach_localhost(self):
  for body in ([1],None,{'api_key':'VISITOR-SECRET'}, {**STUDIO,'script':'system(...)'}, {**STUDIO,'solver':'VISITOR-SECRET'}, {**STUDIO,'receiver_depth_m':{'api_key':'VISITOR-SECRET'}}, {**STUDIO,'frequencies_hz':['VISITOR-SECRET']}):
   for path in ('/api/simulation/jobs','/api/simulation/plans/preview'):
    response=await self.call('A',path,raw=json.dumps(body));self.assertEqual(response.status_code,422,response.text)
  for method,path in [('POST','/api/research/jobs'),('POST','/api/research/runs'),('POST','/api/agent/run'),('POST','/api/queue/pause'),('GET','/api/queue/status'),('DELETE','/api/queue'),('POST','/api/project/file'),('POST','/api/simulation/jobs/anything'),('GET','/api/batches/not-an-id'),('GET','/api/batches/%2e%2e'),('DELETE','/api/jobs/%2e%2e%2fconfig.json')]:
   response=await self.call('A',path,method=method,body={})
   self.assertIn(response.status_code,(403,404,405),response.text)
  self.assertEqual(self.calls,[])
  a=await self.studio_create()
  for method in ('GET','POST','DELETE'):
   response=await self.call('A',f"/api/jobs/{a['ids'][0]}/open-folder",method=method,body={})
   self.assertIn(response.status_code,(403,404,405),response.text)
  self.assertFalse(any('/open-folder' in c['path'] for c in self.calls))

 async def test_invalid_json_and_missing_keys_are_rejected_without_credentials(self):
  for path in ('/api/simulation/jobs','/api/simulation/plans/preview'):
   self.assertEqual((await self.call('A',path,raw='{broken')).status_code,422)
  response=await self.client.post('/api/simulation/jobs',json=STUDIO)
  self.assertEqual(response.status_code,403);self.assertEqual(self.calls,[])

 def test_private_origin_validation_is_loopback_only_and_never_echoes_input(self):
  validate=self.namespace['private_url']
  self.assertEqual(validate('http://127.0.0.1:8767/'),'http://127.0.0.1:8767')
  self.assertEqual(validate('http://localhost:8765'),'http://localhost:8765')
  invalid=['https://127.0.0.1:8765','http://example.com:8765','http://127.0.0.1.example.com:8765','http://127.1:8765','http://0.0.0.0:8765','http://[::1]:8765','http://127.0.0.1','http://127.0.0.1:0','http://127.0.0.1:65536','http://user:PRIVATE-SECRET@127.0.0.1:8765','http://127.0.0.1:8765/api','http://localhost:8765?url=evil','http://localhost:8765#evil','http://127.0.0.1:8765;evil']
  for value in invalid:
   with self.subTest(value=value),self.assertRaises(ValueError) as caught:validate(value)
   self.assertNotIn('PRIVATE-SECRET',str(caught.exception));self.assertNotIn(value,str(caught.exception))

 async def test_bridge_proxy_is_explicit_loopback_and_runtime_directory_is_configurable(self):
  source=ast.parse((legacy.ROOT/'backend/cloud_bridge.py').read_text(encoding='utf-8'))
  runtime_dir=self.local/'bridge-runtime';runtime_dir.mkdir()
  (runtime_dir/'public-runtime.json').write_text(json.dumps({'gateway_secret':'TEST-ONLY-BRIDGE-SECRET','site_origin':'https://course.test','outbound_proxy':'http://127.0.0.1:7897'}),encoding='utf-8')
  namespace={'__name__':'bridge_proxy_test','__file__':str(legacy.ROOT/'backend/cloud_bridge.py')}
  with patch.dict(os.environ,{'OCEAN_RUNTIME_DIR':str(runtime_dir)}):exec(compile(source,'bridge-proxy-test','exec'),namespace)
  validate=namespace['outbound_proxy'];self.assertIsNone(validate(None));self.assertIsNone(validate(''))
  self.assertEqual(validate('http://127.0.0.1:7897'),'http://127.0.0.1:7897')
  for value in ('http://external.test:7897','http://localhost:0','http://localhost:7897/path','http://PRIVATE-SECRET@localhost:7897'):
   with self.assertRaises(ValueError) as caught:validate(value)
   self.assertNotIn('PRIVATE-SECRET',str(caught.exception))
  self.assertEqual(namespace['STATE'],runtime_dir/'public-runtime.json')
  clients=[]
  class StopAfterConfiguration(Exception):pass
  class Client:
   def __init__(self,**kwargs):clients.append(kwargs)
   async def __aenter__(self):return self
   async def __aexit__(self,*args):return False
   async def post(self,*args,**kwargs):raise StopAfterConfiguration()
  with patch.object(httpx,'AsyncClient',Client),self.assertRaises(StopAfterConfiguration):await namespace['main']()
  self.assertEqual(clients[0]['proxy'],'http://127.0.0.1:7897')
  self.assertFalse(clients[0]['trust_env']);self.assertFalse(clients[1]['trust_env'])
  self.assertFalse(clients[0]['follow_redirects']);self.assertFalse(clients[1]['follow_redirects'])
  self.assertNotIn('proxy',clients[1])

 def test_gateway_loads_only_selected_runtime_and_validates_the_private_origin(self):
  runtime_dir=self.local/'gateway-runtime';runtime_dir.mkdir()
  (runtime_dir/'public-runtime.json').write_text(json.dumps({'gateway_secret':'TEST-ONLY-SELECTED-RUNTIME-SECRET','site_origin':'https://course.test'}),encoding='utf-8')
  source=ast.parse((legacy.ROOT/'backend/public_gateway.py').read_text(encoding='utf-8-sig'))
  source.body=[node for node in source.body if not isinstance(node,ast.Import) or not any(name.name in ('knowledge','models') for name in node.names)]
  namespace={'__name__':'configured_gateway_test','__file__':str(legacy.ROOT/'backend/public_gateway.py'),'knowledge':object(),'models':object()}
  with patch.dict(os.environ,{'OCEAN_RUNTIME_DIR':str(runtime_dir),'OCEAN_PRIVATE_URL':'http://localhost:8767/'}):exec(compile(source,'configured-gateway-test','exec'),namespace)
  self.assertEqual(namespace['LOCAL'],runtime_dir);self.assertEqual(namespace['DB'],runtime_dir/'public-visitors.sqlite3')
  self.assertEqual(namespace['PRIVATE'],'http://localhost:8767')
  self.assertEqual(namespace['SECRET'],'TEST-ONLY-SELECTED-RUNTIME-SECRET')
  self.assertTrue(namespace['DB'].is_file())


if __name__=='__main__':unittest.main()
