"""A full-field TL maximum must never stand in for a receiver-curve maximum."""
import hashlib,tempfile,unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from research_api import ResearchService

class ScopedStatistics(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.local=Path(self.tmp.name)
  self.service=ResearchService.__new__(ResearchService);self.service.local=self.local
  self.identity='abcdef123456';self.folder=self.local/'runs'/self.identity;self.folder.mkdir(parents=True)
  self.value={'state':'SUCCEEDED','plan':{'template':'munk_5000m','frequency_hz':50,'solver':'kraken'},'summary':{'tl_min_db':64.3,'tl_median_db':73.47,'tl_max_db':78.95,'shape':[51,51],'valid_ratio':2550/2601,'requested_receiver_depth_m':1000,'actual_receiver_depth_m':1000}}
 def tearDown(self):self.tmp.cleanup()
 def test_field_and_receiver_statistics_preserve_distinct_objects_units_and_source(self):
  source=b'range_m,tl_db\n1000,64.3\n2000,70.2\n5000,71.32\n';(self.folder/'curve.csv').write_bytes(source)
  result=self.service.fixed_job_statistics(self.identity,self.value)
  field=result['field_statistics'];curve=result['receiver_curve_statistics']
  self.assertEqual(field['scope'],'full_depth_range_field');self.assertEqual(field['max_tl_db'],78.95)
  self.assertEqual(curve['scope'],'receiver_depth_range_curve');self.assertEqual(curve['max_tl_db'],71.32);self.assertEqual(curve['median_tl_db'],70.2)
  self.assertEqual(curve['actual_receiver_depth_m'],1000);self.assertEqual(curve['range_min_m'],1000);self.assertEqual(curve['range_max_m'],5000)
  self.assertEqual(curve['tl_unit'],'dB');self.assertEqual(curve['range_unit'],'m');self.assertEqual(curve['sample_count'],3)
  self.assertEqual(curve['source_sha256'],hashlib.sha256(source).hexdigest())
 def test_missing_or_invalid_curve_never_reuses_full_field_numbers(self):
  result=self.service.fixed_job_statistics(self.identity,self.value);curve=result['receiver_curve_statistics']
  self.assertFalse(curve['available']);self.assertEqual(curve['reason'],'curve_file_missing');self.assertNotIn('max_tl_db',curve)
  for source in ['range_m,tl_db\n1000,NaN\n','range_m,tl_db\n2000,70\n1000,71\n','other,value\n1,2\n']:
   with self.subTest(source=source):
    (self.folder/'curve.csv').write_text(source,encoding='utf8');curve=self.service.fixed_job_statistics(self.identity,self.value)['receiver_curve_statistics']
    self.assertFalse(curve['available']);self.assertEqual(curve['reason'],'curve_file_invalid');self.assertNotIn('max_tl_db',curve)
 def test_script_or_research_summary_cannot_claim_fixed_solver_field_scope(self):
  for plan in [{'task_type':'custom_sandbox_code','template':'munk_5000m','frequency_hz':50},{'kind':'research'},{}, {'template':'unknown','frequency_hz':50}]:
   with self.subTest(plan=plan):
    self.assertEqual(self.service.fixed_job_statistics(self.identity,{**self.value,'plan':plan}),{})
 def test_running_tasks_do_not_claim_completed_statistics(self):
  self.assertEqual(self.service.fixed_job_statistics(self.identity,{**self.value,'state':'RUNNING'}),{})

if __name__=='__main__':unittest.main()
