"""Natural-language requests must execute the stated method and report real inputs."""
import unittest
import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
import time
from unittest.mock import patch
import test_research_api as fixture


class NaturalExecution(unittest.TestCase):
    setUp=fixture.ResearchAPI.setUp
    tearDown=fixture.ResearchAPI.tearDown

    def chat(self,text):
        with patch('natural_agent.search',return_value=[]):
            result=self.client.post('/api/simulation/chat',json={'message':text,'session':'natural-functional-test'})
        self.assertEqual(result.status_code,200,result.text)
        return result.json()['reply']

    def test_concept_questions_and_named_solvers_do_not_run_wrong_method(self):
        self.chat('什么是射线？')
        reply=self.chat('请用 BELLHOP 仿真 100Hz 声场')
        self.assertIn('未将它替换',reply)
        reply=self.chat('请计算 Munk 声道内的梯度折射声线')
        self.assertIn('不能用直线反射代替',reply)
        self.assertEqual(self.client.get('/api/jobs').json(),[])

    def test_off_center_no_bounce_ray_reply_uses_actual_case(self):
        reply=self.chat('请仿真等声速射线，水深100m，声源10m，距离1km，掠射角0.01度')
        self.assertIn('非居中声源',reply);self.assertIn('无反射',reply)
        self.assertNotIn('第 87 次',reply);self.assertNotIn('支持 BELLHOP 射线格式',reply)
        jobs=self.client.get('/api/jobs').json();self.assertEqual(len(jobs),1)
        self.assertEqual(jobs[0]['state'],'SUCCEEDED')

    def test_invalid_vertical_ray_and_unknown_code_language_are_422(self):
        result=self.client.post('/api/jobs/ray',json={'angles_deg':[90]})
        self.assertEqual(result.status_code,422,result.text)
        result=self.client.post('/api/jobs/code',json={'code':'print(1)','language':'javascript'})
        self.assertEqual(result.status_code,422,result.text)
        self.assertEqual(self.client.get('/api/jobs').json(),[])

    def test_invalid_or_question_requests_create_no_jobs(self):
        for text in ['请问如何运行KRAKEN仿真？', '请仿真浅海100米声场', '请用KRAKEN仿真Munk声场，频率500Hz', '请仿真射线，水深100英尺']:
            self.chat(text)
        self.assertEqual(self.client.get('/api/jobs').json(), [])

    def test_actual_chinese_unit_ray_http_outputs_match_requested_values(self):
        self.chat('请仿真等声速射线，水深200米，声源20米，距离10千米，掠射角15度')
        jobs = self.client.get('/api/jobs').json();self.assertEqual(len(jobs), 1)
        task = self.client.get('/api/jobs/' + jobs[0]['id']).json()
        self.assertEqual(task['state'], 'SUCCEEDED')
        self.assertEqual(task['plan']['water_depth_m'], 200);self.assertEqual(task['plan']['source_depth_m'], 20)
        self.assertEqual(task['plan']['range_max_km'], 10)
        self.assertIn('ray_trajectories.png', task['artifacts']);self.assertIn('reflection_stats.csv', task['artifacts'])

    def test_inner_failed_cancelled_interrupted_and_running_are_not_success(self):
        import natural_agent
        intent = natural_agent.parse_simulation_intent('请仿真Munk声场，频率50Hz，源深1000m')
        identity = 'abcdef123456'
        for state in ['FAILED', 'CANCELLED', 'INTERRUPTED', 'RUNNING', 'QUEUED']:
            with self.subTest(state=state), patch('natural_agent.submit', return_value={'ids':[identity]}), patch('natural_agent.job', return_value={'state':state,'plan':{},'error':'test failure' if state=='FAILED' else None}):
                result = asyncio.run(natural_agent.execute_simulation_and_wait(intent, timeout=0))
            self.assertEqual(result['status'], 'pending' if state in ('RUNNING','QUEUED') else 'error')
            self.assertFalse(natural_agent.simulation_succeeded(result))
            text = natural_agent.format_ocean_simulation_reply(intent, result)
            self.assertNotIn('仿真已完成', text)
            self.assertNotIn('tl_map.png', text)
            if state in ('RUNNING','QUEUED'):self.assertIn('等待结束不等于计算失败', text)

    def test_success_receipt_requires_actual_output_files(self):
        import natural_agent
        identity = 'abcdef123456';folder = self.local/'runs'/identity;folder.mkdir(parents=True)
        with patch('natural_agent.job', return_value={'state':'SUCCEEDED','plan':{},'error':None}):
            failed = asyncio.run(natural_agent.wait_for_simulation_jobs([identity], timeout=0))
            self.assertEqual(failed['status'], 'error');self.assertIn('缺少', failed['results'][0]['output_error'])
            (folder/'summary.json').write_text(json.dumps({'tl_median_db':65}), encoding='utf-8')
            (folder/'result.json').write_text('{}', encoding='utf-8')
            for name in ['tl_map.png','tl_curve.png']:(folder/name).write_bytes(b'\x89PNG\r\n\x1a\n')
            good = asyncio.run(natural_agent.wait_for_simulation_jobs([identity], timeout=0))
            self.assertEqual(good['status'], 'success');self.assertTrue(natural_agent.simulation_succeeded(good))
            self.assertFalse(natural_agent.simulation_succeeded({'status':'success','results':[{'state':'FAILED'}]}))
            self.assertFalse(natural_agent.simulation_succeeded({'status':'success'}))
            self.assertFalse(natural_agent.simulation_succeeded({'status':'failed','state':'SUCCEEDED'}))

    def test_mock_provider_never_receives_success_notice_for_pending_or_failed_jobs(self):
        import natural_agent
        from unittest.mock import AsyncMock
        from types import SimpleNamespace
        for status, state in [('pending','RUNNING'), ('error','FAILED')]:
            captured=[]
            async def post(_url, **options):
                captured.append(json.loads(json.dumps(options['json'])))
                message = {'role':'assistant','content':None,'tool_calls':[{'id':'test-call-'+str(len(captured)),'type':'function','function':{'name':'run_ocean_simulation','arguments':'{"frequencies_hz":[50],"source_depths_m":[1000]}'}}]} if len(captured)<=2 else {'role':'assistant','content':'任务尚未成功完成，请核对任务状态。'}
                return SimpleNamespace(status_code=200,json=lambda:{'choices':[{'message':message}]})
            mock_client=AsyncMock();mock_client.post.side_effect=post;mock_client.__aenter__.return_value=mock_client
            cfg={'provider':'DeepSeek','base_url':'https://api.deepseek.com','model':'deepseek-flash','api_key':'TEST-ONLY-NOT-A-REAL-KEY','toolbox_path':str(self.local/'toolbox')}
            result={'status':status,'state':state,'results':[{'job_id':'abcdef123456','state':state,'plan':{},'error':'solver failed' if state=='FAILED' else None}]}
            with self.subTest(state=state), patch('natural_agent.config',return_value=cfg), patch('natural_agent.httpx.AsyncClient',return_value=mock_client), patch('natural_agent.execute_simulation_and_wait',new=AsyncMock(return_value=result)) as submit, patch('natural_agent.wait_for_simulation_jobs',new=AsyncMock(return_value=result)) as reuse:
                reply=self.chat('请用KRAKEN仿真Munk声场，频率50Hz，源深1000m')
            self.assertIn('尚未成功完成',reply);self.assertEqual(len(captured),3)
            self.assertEqual(submit.await_count,1);self.assertEqual(reuse.await_count,1)
            self.assertNotIn('【仿真计算已成功完成并生成图表】',json.dumps(captured[1]['messages'],ensure_ascii=False))
            self.assertIn('tools',captured[1],'A failed receipt must not force the success-only final turn')

    def test_running_python_job_can_be_cancelled_over_http(self):
        code="import os,time\nfrom pathlib import Path\nPath('child.pid').write_text(str(os.getpid()))\ntime.sleep(30)\nPath('late.txt').write_text('must not finish')"
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(self.client.post,'/api/jobs/code',json={'code':code,'language':'python'})
            deadline=time.monotonic()+8;identity=None
            while time.monotonic()<deadline:
                jobs=self.client.get('/api/jobs').json()
                if jobs:
                    identity=jobs[0]['id']
                    if (self.local/'runs'/identity/'child.pid').exists():break
                time.sleep(.02)
            self.assertIsNotNone(identity)
            self.assertFalse(future.done(),'HTTP event loop was blocked or code did not run')
            cancel=self.client.post('/api/jobs/'+identity+'/cancel')
            self.assertEqual(cancel.status_code,200,cancel.text)
            result=future.result(timeout=10)
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()['state'],'CANCELLED')
        self.assertNotIn(identity,self.module.PROCESSES)
        self.assertFalse((self.local/'runs'/identity/'late.txt').exists())
        self.assertEqual(self.client.get('/api/jobs/'+identity).json()['state'],'CANCELLED')


if __name__=='__main__':unittest.main()
