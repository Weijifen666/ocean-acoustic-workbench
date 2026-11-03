"""Natural-language requests must execute the stated method and report real inputs."""
import unittest
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
