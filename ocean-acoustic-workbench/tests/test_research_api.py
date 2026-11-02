"""Migration integration checks with real task files, no paid provider or MATLAB."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid
from fastapi.testclient import TestClient

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
import research_tasks


class ResearchAPI(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.local=Path(self.temp.name)
        (self.local/'project').mkdir()
        (self.local/'config.json').write_text(json.dumps({'project_path':str(self.local/'project'),'toolbox_path':str(self.local/'toolbox'),'matlab_path':'','provider':'DeepSeek','base_url':'https://api.deepseek.com','model':'test','api_key':''}),encoding='utf-8')
        self.environment=patch.dict(os.environ,{'OCEAN_RUNTIME_DIR':str(self.local),'OCEAN_DISABLE_WORKER':'1','OCEAN_DISABLE_PUBLIC_REFRESH':'1'});self.environment.start()
        spec=importlib.util.spec_from_file_location('research_test_'+uuid.uuid4().hex,ROOT/'backend/app.py');self.module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=self.module;spec.loader.exec_module(self.module)
        self.context=TestClient(self.module.app);self.client=self.context.__enter__()
    def tearDown(self):
        self.context.__exit__(None,None,None);sys.modules.pop(self.module.__name__,None);self.environment.stop();self.temp.cleanup()
    def engine(self):
        r=self.module.RESEARCH
        return research_tasks.Engine(ROOT,r.config,r.lookup,r.create,r.update,r.processes,r.lock,asyncio.Event(),local=self.local)
    def test_skill_catalog_and_unavailable_model(self):
        data=self.client.get('/api/research-skills').json()
        self.assertEqual(len(data['skills']),12)
        self.assertIn('at-ram',{s['id'] for s in data['skills']})
        with self.assertRaises(ValueError):asyncio.run(self.engine().execute('prepare_model_research_task',{'model':'krakel','case':'','title':'KRAKEL','objective':'Unavailable fixture'}))
        self.assertEqual(self.client.get('/api/jobs').json(),[])
    def test_research_is_not_claimed_by_fixed_template_queue(self):
        created=asyncio.run(self.engine().execute('create_research_task',{'title':'isolated research','objective':'test'}))
        self.assertIsNone(self.module.STORE.claim_next('fixed-worker'))
        rows=self.client.get('/api/jobs').json();self.assertEqual(rows[0]['id'],created['id']);self.assertEqual(rows[0]['plan']['kind'],'research')
        self.assertEqual(self.client.post('/api/jobs/'+created['id']+'/cancel').status_code,200)
        self.assertEqual(self.client.get('/api/jobs/'+created['id']).json()['state'],'CANCELLED')
    def test_dsh_dispatch_uses_new_runtime_and_full_history_is_exportable(self):
        session='dsh-migrated-session'
        with self.module.STORE.connection() as db:
            for i in range(40):db.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',('research:'+session,'user' if i%2==0 else 'assistant','message '+str(i),'2026-10-25'))
        seen={}
        async def provider(messages,tools,execute,stop,trace,instructions,cwd,**kwargs):
            seen.update(kwargs);seen['messages']=messages;seen['tools']={t['function']['name'] for t in tools}
            kwargs['progress']['model']='test-dsh';return 'DSH routed successfully'
        body={'session':session,'request_id':'dsh-dispatch-test','message':'continue','backend':'dsh'}
        with patch('research_api.dsh_bridge.run',side_effect=provider):
            self.assertEqual(self.client.post('/api/research/chat',json=body).status_code,200)
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                current=self.client.get('/api/research/runs/'+body['request_id']).json()
                if current['state']!='running':break
                time.sleep(.02)
        self.assertEqual(current['state'],'done');self.assertEqual(current['backend'],'dsh')
        self.assertEqual(seen['runtime'],self.local);self.assertEqual(len(seen['messages']),30)
        self.assertIn('get_ocean_profile',seen['tools']);self.assertIn('read_material_page',seen['tools'])
        rows=self.client.get('/api/research/history',params={'session':session}).json()
        self.assertEqual(len(rows),42);self.assertEqual(rows[0]['text'],'message 0')
    def test_secret_and_path_boundaries(self):
        for key in ['@workbench/.local/config.json','../config.json']:
            self.assertEqual(self.client.get('/api/project/file',params={'path':key}).status_code,403)
        functions={t['function']['name'] for t in self.module.RESEARCH.tools()}
        self.assertIn('prepare_model_research_task',functions);self.assertIn('get_ocean_profile',functions);self.assertIn('read_material_page',functions)
        for name in ['diagnose_ocean_layers','evaluate_acoustic_checks','audit_research_task']:self.assertIn(name,functions)
    def test_canonical_diagnostic_can_archive_and_legacy_report_cannot_forge_verification(self):
        engine=self.engine();created=asyncio.run(engine.execute('create_research_task',{'title':'Layer fixture','objective':'MLD from a frozen profile'}));identity=created['id']
        profile={'selected':{'lon':120,'lat':20},'requested':{'lon':120,'lat':20},'period':16,
                 'rows':[{'depth_m':d,'temperature_c':25-d*.02,'practical_salinity':35.,'sound_speed_m_s':1500+d*.01} for d in [0,5,10,20,30,50]]}
        with patch('research_api.ocean_data.profile',return_value=profile) as reader:
            result=asyncio.run(self.module.RESEARCH.execute(engine,'diagnose_ocean_layers',{'id':identity,'lon':120,'lat':20,'periods':[16],'reference_depth_m':10.,'density_threshold':.03,'temperature_threshold':.2}))
        reader.assert_called_once_with(120,20,16)
        report={'method':'Canonical profile method','assumptions':[],'inputs':[],'sources':['Fixture'],
                'outputs':[{'file':f} for f in result['artifacts']],'checks':[{'name':'Self assessment','passed':True,'evidence':'Agent assertion'}],
                'conclusion':'Bounded diagnostic','limitations':['No propagation or observation validation']}
        asyncio.run(engine.execute('finish_research_task',{'id':identity,'report':report}))
        folder=Path(created['directory']);summary=folder/'summary.json'
        fake=json.loads(summary.read_text(encoding='utf-8'));fake['scientific_validation']={'numerical_status':'proven','physical_accuracy':'proven'}
        summary.write_text(json.dumps(fake),encoding='utf-8');before=summary.read_bytes()
        detail=self.client.get('/api/jobs/'+identity).json()
        self.assertEqual(detail['summary']['scientific_validation']['numerical_status'],'checked')
        self.assertEqual(detail['summary']['scientific_validation']['physical_accuracy'],'not_established')
        self.assertEqual(detail['summary']['checks'][0]['authority'],'agent_self_report')
        self.assertEqual(summary.read_bytes(),before,'Read projection must not edit legacy reports')
        (folder/result['artifacts'][0]).write_text('[]',encoding='utf-8')
        self.assertEqual(self.client.get('/api/jobs/'+identity).json()['summary']['scientific_validation']['numerical_status'],'stale')
        self.assertEqual(self.client.delete('/api/jobs/'+identity).status_code,200)
        self.assertFalse(folder.exists())
        self.assertEqual(engine.validations.receipts(identity,folder),[])
    def test_agent_creates_runs_and_reports_real_python_task_once(self):
        async def provider(messages,tools,execute,stop,trace,*args,**kwargs):
            async def call(name,args):
                result=await execute(name,args);trace.append({'tool':name,'status':'done'});return result
            await call('load_research_skill',{'id':'at-ram'})
            created=await call('create_research_task',{'title':'Migration fixture','objective':'Produce a tiny actual CSV'})
            await call('write_research_file',{'id':created['id'],'file':'run.py','content':'from pathlib import Path\nPath("values.csv").write_text("x,y\\n1,2\\n")'})
            await call('run_research_script',{'id':created['id'],'file':'run.py'})
            await call('finish_research_task',{'id':created['id'],'report':{'method':'Actual isolated Python fixture','assumptions':['Fixture only'],'inputs':['run.py'],'sources':['Analytic fixture'],'outputs':[{'file':'values.csv'}],'checks':[{'name':'Fixture value','passed':True,'evidence':'x=1,y=2'}],'conclusion':'Execution checked','limitations':['Not acoustic validation']}})
            return 'fixture complete'
        body={'session':'research-test-session','request_id':'migration-test-request','message':'test fixture','backend':'codex'}
        with patch('research_api.codex_bridge.run',side_effect=provider):
            first=self.client.post('/api/research/chat',json=body);self.assertEqual(first.status_code,200,first.text)
            again=self.client.post('/api/research/chat',json=body);self.assertTrue(again.json()['reused'])
            end=time.monotonic()+10
            while time.monotonic()<end:
                current=self.client.get('/api/research/runs/'+body['request_id']).json()
                if current['state']!='running':break
                time.sleep(.02)
        self.assertEqual(current['state'],'done',current)
        jobs=self.client.get('/api/jobs').json();self.assertEqual(len(jobs),1);identity=jobs[0]['id']
        detail=self.client.get('/api/jobs/'+identity).json();self.assertEqual(detail['state'],'SUCCEEDED');self.assertTrue(detail['summary']['outputs'][0]['sha256'])
        self.assertEqual(self.client.get('/api/jobs/'+identity+'/artifact/values.csv').text.splitlines(),['x,y','1,2'])
        self.assertEqual(self.client.post('/api/jobs/compare',json={'ids':[identity,'abcdefabcdef']}).status_code,409)
        content=self.client.get('/api/project/file',params={'path':'@runs/'+identity+'/values.csv'}).json();self.assertEqual(content['kind'],'text')
        conflict=self.client.post('/api/research/chat',json={**body,'message':'changed'});self.assertEqual(conflict.status_code,409)
        self.assertFalse((ROOT/'.local/runs'/identity).exists(),'Test leaked into the real runtime')


if __name__=='__main__':unittest.main()
