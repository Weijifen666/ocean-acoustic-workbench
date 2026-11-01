"""Full physics forms use the existing durable queue, not a second worker."""
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import test_research_api as research_fixture
import ocean_cloud


class StudioMigration(unittest.TestCase):
    setUp=research_fixture.ResearchAPI.setUp
    tearDown=research_fixture.ResearchAPI.tearDown
    def base(self,**changes):
        return {'solver':'kraken','template':'pekeris_100m','frequencies_hz':[50.0],'source_depths_m':[50.0],'receiver_depth_m':50.0,'range_min_km':.1,'range_max_km':5.0,'range_points':51,'depth_points':51,**changes}
    def profile(self,lon,lat,period):
        return {'requested':{'lon':lon,'lat':lat},'selected':{'lon':119.5,'lat':19.5},'period':str(period),'period_id':period,'rows':[{'depth_m':z,'sound_speed_m_s':1500+z*.01+period*.1} for z in [0,100,300,500,1000]],'missing_depths_m':[],'depth_limit_m':1000,'bottom':{'elevation_m':-1200},'grid_bottom':{'elevation_m':-1200}}
    def test_all_three_solvers_preview_and_expanded_submission_idempotency(self):
        for solver in ['kraken','scooter','bellhop']:
            r=self.client.post('/api/simulation/plans/preview',json=self.base(solver=solver))
            self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['case_count'],1)
        body=self.base(source_depths_m=[20.0,50.0],scenario='source_scan')
        r=self.client.post('/api/simulation/jobs',json=body,headers={'idempotency-key':'studio-replay-key'});self.assertEqual(r.status_code,200,r.text)
        batch=r.json();self.assertEqual(len(batch['ids']),2)
        again=self.client.post('/api/simulation/jobs',json=body,headers={'idempotency-key':'studio-replay-key'}).json()
        self.assertEqual(batch['ids'],again['ids']);self.assertTrue(again['reused'])
        claimed=self.module.STORE.claim_next('fixture-worker');self.assertTrue(claimed['plan']['studio']);self.assertIn(claimed['id'],batch['ids'])
        self.assertEqual(claimed['plan']['batch_id'],batch['batch_id'])
        self.assertEqual(self.client.get('/api/batches/'+batch['batch_id']).status_code,200)
        self.assertEqual(self.client.post('/api/simulation/jobs',json={**body,'frequencies_hz':[100.]},headers={'idempotency-key':'studio-replay-key'}).status_code,409)
    def test_seasons_freeze_distinct_real_profile_inputs_and_env_files(self):
        body=self.base(template='woa18',scenario='seasonal',water_depth_m=500,source_depths_m=[100.],receiver_depth_m=100.)
        with patch('ocean_data.profile',side_effect=self.profile):
            r=self.client.post('/api/simulation/jobs',json=body);self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(len(r.json()['ids']),4)
        periods=[]
        for identity in r.json()['ids']:
            value=self.module.STORE.get(identity);periods.append(value['plan']['environment_snapshot']['profile']['period_id'])
            folder=self.local/'runs'/identity;folder.mkdir(parents=True)
            self.module.simulation_studio.prepare_case(folder,value['plan'],self.module.config(),Path(__file__).resolve().parents[1])
            env=(folder/'case.env').read_text();self.assertIn('500',env);self.assertIn('100 / ! SD',env)
            self.assertTrue((folder/'environment.json').exists());self.assertTrue((folder/'ssp.csv').exists());self.assertTrue((folder/'run_studio_case.m').exists())
        self.assertEqual(periods,[13,14,15,16])
        with patch('ocean_data.profile',side_effect=self.profile):
            ocean=self.client.get('/api/ocean-data/profile?lon=120&lat=20&period=13');self.assertEqual(ocean.json()['period_id'],13)
    def test_convergence_and_model_comparison_expand_frozen_cases(self):
        body=self.base(solver='bellhop',scenario='convergence',bellhop_output='incoherent',beam_count=101,ray_step_m=10)
        r=self.client.post('/api/simulation/jobs',json=body);self.assertEqual(r.status_code,200,r.text)
        cases=[self.module.STORE.get(identity)['plan'] for identity in r.json()['ids']]
        self.assertEqual(len(cases),4);self.assertEqual({c['beam_count'] for c in cases},{101,202});self.assertEqual({c['ray_step_m'] for c in cases},{5,10})
        self.assertEqual(len({c['environment_fingerprint'] for c in cases}),1)
        comparison=self.client.post('/api/simulation/jobs',json=self.base(scenario='model_compare')).json()
        cases=[self.module.STORE.get(identity)['plan'] for identity in comparison['ids']]
        self.assertEqual({c['solver'] for c in cases},{'kraken','bellhop'})
    def test_task_deletion_removes_files_and_record_but_blocks_active_jobs(self):
        result=self.client.post('/api/simulation/jobs',json=self.base()).json();identity=result['ids'][0]
        folder=self.local/'runs'/identity;folder.mkdir(parents=True);(folder/'result.txt').write_text('fixture')
        self.assertEqual(self.client.delete('/api/jobs/'+identity).status_code,409)
        self.assertEqual(self.client.post('/api/jobs/'+identity+'/cancel').status_code,200)
        response=self.client.delete('/api/jobs/'+identity);self.assertEqual(response.status_code,200,response.text)
        self.assertTrue(response.json()['files_deleted']);self.assertFalse(folder.exists());self.assertIsNone(self.module.STORE.get(identity))
    def test_cloud_profile_and_terrain_forward_pinned_version_and_preserve_conflict(self):
        with patch('ocean_cloud.base_url',return_value='https://data.example'),patch('ocean_cloud.read',return_value={'dataset_version':'v1'}) as read:
            response=self.client.get('/api/ocean-data/profile?lon=120&lat=20&period=13&version=v1')
            self.assertEqual(response.status_code,200,response.text)
            read.assert_called_once_with('/profile',lon=120.0,lat=20.0,period=13,version='v1')
            read.reset_mock()
            response=self.client.get('/api/ocean-data/terrain?west=95&east=145&south=-5&north=45&version=v1')
            self.assertEqual(response.status_code,200,response.text)
            read.assert_called_once_with('/terrain',west=95.0,east=145.0,south=-5.0,north=45.0,version='v1')
            read.reset_mock()
            self.assertEqual(self.client.get('/api/ocean-data/profile?lon=120&lat=20&period=13').status_code,200)
            read.assert_called_once_with('/profile',lon=120.0,lat=20.0,period=13)
        with patch('ocean_cloud.base_url',return_value='https://data.example'),patch('ocean_cloud.read',side_effect=ocean_cloud.DatasetVersionMismatch('请刷新页面')):
            for path in ('/api/ocean-data/profile?version=obsolete','/api/ocean-data/terrain?version=obsolete'):
                response=self.client.get(path)
                self.assertEqual(response.status_code,409,response.text)
                self.assertIn('刷新',response.json()['detail'])
    def test_cloud_failure_aborts_preview_and_entire_submission_before_enqueue(self):
        body=self.base(template='woa18',water_depth_m=500,source_depths_m=[100.],receiver_depth_m=100.)
        for path in ('/api/simulation/plans/preview','/api/simulation/jobs'):
            with patch('ocean_cloud.base_url',return_value='https://data.example'),patch('ocean_cloud.read',side_effect=ConnectionError('在线数据暂不可达')):
                response=self.client.post(path,json=body)
                self.assertEqual(response.status_code,503,response.text)
                self.assertIn('暂不可达',response.json()['detail'])
        # A later season failing must not enqueue already expanded earlier seasons.
        with patch('ocean_cloud.base_url',return_value='https://data.example'),patch('ocean_cloud.read',side_effect=[self.profile(120,20,13),ConnectionError('第二季数据暂不可达')]):
            response=self.client.post('/api/simulation/jobs',json={**body,'scenario':'seasonal'})
            self.assertEqual(response.status_code,503,response.text)
        self.assertEqual(self.client.get('/api/jobs').json(),[])
        self.assertFalse((self.local/'runs').exists() and any((self.local/'runs').iterdir()))

if __name__=='__main__':unittest.main()
