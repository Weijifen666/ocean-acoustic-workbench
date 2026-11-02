"""Scientific provenance checks with isolated files, no model/solver calls."""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
import research_tasks
import research_validation as validation


class ResearchValidation(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.jobs={};self.runner=asyncio.Runner()
        def create(identity,plan):self.jobs[identity]={'id':identity,'state':'RUNNING','plan':plan}
        def update(identity,state,error=None):self.jobs[identity].update(state=state,error=error)
        self.engine=research_tasks.Engine(self.root,lambda:{},self.jobs.__getitem__,create,update,{},threading.RLock(),asyncio.Event())
        self.created=self.call('create_research_task',{'title':'Fixture','objective':'Check provenance'})
        self.identity=self.created['id'];self.folder=Path(self.created['directory'])

    def tearDown(self):self.runner.close();self.temp.cleanup()

    def call(self,name,args):return self.runner.run(self.engine.execute(name,args))

    def run_script(self,name,content,**kwargs):
        self.call('write_research_file',{'id':self.identity,'file':name,'content':content})
        return self.call('run_research_script',{'id':self.identity,'file':name,**kwargs})

    def report(self):
        return {'method':'Fixture','assumptions':[],'inputs':[],'sources':[],
                'outputs':[{'file':'values.csv'}],'checks':[{'name':'Science','passed':True,'evidence':'Agent assertion'}],
                'conclusion':'Negative or inconclusive findings are still archivable','limitations':['No observations']}

    def finish(self,report=None):
        return self.call('finish_research_task',{'id':self.identity,'report':report or self.report()})

    def fields(self):
        common={'z_m':np.array([0.,10.,20.]),'r_km':np.arange(1.,11.),
                'frequency_hz':1000.,'source_depth_m':10.,'environment_id':'fixture',
                'tl_reference':'1m','field_type':'coherent','model':'BELLHOP'}
        for name,value in [('base.npz',70.),('fine.npz',73.)]:
            np.savez(self.folder/name,tl_db=np.full((3,10),value),**common)
        return {'baseline_file':'base.npz','refined_file':'fine.npz',
                'roi':{'depth_min_m':0,'depth_max_m':20,'range_min_km':1,'range_max_km':10}}

    def test_agent_self_grade_is_not_program_validation(self):
        self.run_script('run.py','from pathlib import Path\nPath("values.csv").write_text("x\\n1\\n")')
        report=self.report();report['scientific_validation']={'numerical_status':'checked','physical_accuracy':'proven'}
        self.finish(report)
        saved=json.loads((self.folder/'summary.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['checks'][0]['authority'],'agent_self_report')
        self.assertEqual(saved['scientific_validation']['numerical_status'],'not_checked')
        self.assertEqual(saved['scientific_validation']['physical_accuracy'],'not_established')
        before={p.name:p.read_bytes() for p in self.folder.iterdir()}
        audit=self.call('audit_research_task',{'id':self.identity})
        self.assertEqual(audit['execution']['status'],'consistent')
        self.assertEqual(before,{p.name:p.read_bytes() for p in self.folder.iterdir()})

    def test_failed_stage_cannot_be_hidden_by_another_success(self):
        self.run_script('failed.py','raise ValueError("failed stage")')
        self.run_script('run.py','from pathlib import Path\nPath("values.csv").write_text("x")')
        with self.assertRaisesRegex(ValueError,'最近执行失败'):self.finish()
        self.run_script('failed.py','pass')
        self.finish()

    def test_changed_declared_input_requires_execution_again(self):
        (self.folder/'input.csv').write_text('1')
        content='from pathlib import Path\nPath("values.csv").write_text(Path("input.csv").read_text())'
        self.run_script('run.py',content,inputs=['input.csv'],outputs=['values.csv'])
        (self.folder/'input.csv').write_text('2')
        with self.assertRaisesRegex(ValueError,'执行输入已变化'):self.finish()
        self.run_script('run.py',content,inputs=['input.csv'],outputs=['values.csv'])
        self.finish()

    def test_missing_output_repaired_by_latest_execution(self):
        self.run_script('run.py','pass',outputs=['values.csv'])
        with self.assertRaisesRegex(ValueError,'声明产物缺失'):self.finish()
        self.run_script('run.py','from pathlib import Path\nPath("values.csv").write_text("x")',outputs=['values.csv'])
        self.finish()

    def test_explicit_in_place_transformation_preserves_pre_and_post_hashes(self):
        (self.folder/'values.csv').write_text('1')
        self.run_script('run.py','from pathlib import Path\np=Path("values.csv")\np.write_text(p.read_text()+"2")',inputs=['values.csv'],outputs=['values.csv'])
        self.finish()
        records=json.loads((self.folder/'executions.json').read_text(encoding='utf-8'))
        self.assertNotEqual(records[0]['declared_input_sha256'],records[0]['declared_output_sha256'])

    def test_finishing_while_compute_is_running_is_rejected(self):
        self.run_script('run.py','from pathlib import Path\nPath("values.csv").write_text("x")')
        self.engine.processes[self.identity]=object()
        with self.assertRaisesRegex(ValueError,'运行'):self.finish()
        self.assertNotEqual(self.jobs[self.identity]['state'],'SUCCEEDED')

    def test_guard_remains_until_execution_record_is_durable(self):
        self.run_script('run.py','from pathlib import Path\nPath("values.csv").write_text("x")')
        entered=threading.Event();release=threading.Event();original=self.engine.record_execution
        def delayed(*args):
            entered.set()
            if not release.wait(5):raise RuntimeError('test synchronization timeout')
            return original(*args)
        async def scenario():
            with patch.object(self.engine,'record_execution',side_effect=delayed):
                running=asyncio.create_task(self.engine.execute('run_research_script',{'id':self.identity,'file':'run.py'}))
                try:
                    self.assertTrue(await asyncio.to_thread(entered.wait,5))
                    with self.assertRaisesRegex(ValueError,'运行'):
                        await self.engine.execute('finish_research_task',{'id':self.identity,'report':self.report()})
                finally:release.set();await running
        self.runner.run(scenario())
        self.assertNotIn(self.identity,self.engine.processes)
        self.finish()

    def test_corrupt_legacy_execution_does_not_hide_report(self):
        self.run_script('run.py','from pathlib import Path\nPath("values.csv").write_text("x")')
        self.finish();summary=(self.folder/'summary.json').read_bytes()
        (self.folder/'executions.json').write_text('[{"broken":')
        audit=self.call('audit_research_task',{'id':self.identity})
        self.assertEqual(audit['execution']['status'],'incomplete')
        self.assertEqual((self.folder/'summary.json').read_bytes(),summary)

    def test_real_roi_receipt_cannot_be_promoted_by_agent_and_stales_on_edit(self):
        self.run_script('run.py','from pathlib import Path\nPath("values.csv").write_text("x")')
        spec=self.fields()
        checked=self.call('evaluate_acoustic_checks',{'id':self.identity,'spec':spec})
        self.assertEqual(checked['status'],'not_stable')
        self.finish()
        audit=self.call('audit_research_task',{'id':self.identity})
        self.assertEqual(audit['scientific_validation']['numerical_status'],'not_stable')
        (self.folder/'fine.npz').write_bytes((self.folder/'base.npz').read_bytes())
        audit=self.call('audit_research_task',{'id':self.identity})
        self.assertEqual(audit['scientific_validation']['numerical_status'],'stale')

    def test_method_change_invalidates_receipt(self):
        source=self.root/'checker.py';source.write_text('version1')
        (self.folder/'values.csv').write_text('x')
        store=self.engine.validations
        store.record(self.identity,'fixture',{'status':'stable'},self.folder,validation.hashes(self.folder,['values.csv']),[source])
        self.assertTrue(store.receipts(self.identity,self.folder)[0]['current'])
        source.write_text('version2')
        self.assertFalse(store.receipts(self.identity,self.folder)[0]['current'])

    def test_program_tool_result_can_finish_without_rewritten_script(self):
        import layer_diagnostics
        z=[0,5,10,20,30,50]
        profile={'selected':{'lon':120,'lat':20},'requested':{'lon':120,'lat':20},'period':16,
                 'rows':[{'depth_m':d,'temperature_c':25-d*.02,'practical_salinity':35.,'sound_speed_m_s':1500+d*.01} for d in z]}
        result=layer_diagnostics.diagnose_profiles([profile])
        saved=self.engine.save_layer_diagnostics(self.identity,[profile],result,[Path(layer_diagnostics.__file__),layer_diagnostics.IMPLEMENTATION_PATH],.1)
        report=self.report();report['outputs']=[{'file':f} for f in saved['artifacts']]
        self.finish(report)
        audit=self.call('audit_research_task',{'id':self.identity})
        self.assertEqual(audit['execution']['status'],'consistent')
        self.assertEqual(audit['scientific_validation']['numerical_status'],'checked')

    def test_traversal_and_receipt_forgery_are_rejected(self):
        with self.assertRaises(ValueError):validation.hashes(self.folder,['../secret.csv'])
        with self.assertRaises(ValueError):
            self.call('evaluate_acoustic_checks',{'id':self.identity,'spec':{**self.fields(),'passed':True}})
        self.assertFalse(self.engine.validations.receipts(self.identity,self.folder))


if __name__=='__main__':unittest.main()
