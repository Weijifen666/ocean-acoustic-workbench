"""Offline HTTP-contract tests. No live site, node, solver or process is used."""
import copy
from email.message import Message
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.request import BaseHandler
from urllib.response import addinfourl
from urllib.parse import urlsplit
import zipfile

spec=importlib.util.spec_from_file_location('check_public_node',Path(__file__).with_name('check-public-node.py'))
checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
REAL_CLIENT=checker.PublicClient
REFERENCE="""'BBMunk profile'
50
1
'NVW'
0 0 5000
0 1548.52 0 1 0 0
5000 1551.91 /
'A' 0.0
5000 1600 0 1.8 0.8 /
1500 1600
0 ! RMAX
2 ! NSD
25 250 / ! SD
1001 ! NRD
0 5000 /
"""


class FakeSite(BaseHandler):
    handler_order=100

    def __init__(self,online=True,lose_response=False):
        self.online=online;self.lose_response=lose_response;self.requests=[];self.receipts={};self.created=0
        ranges=[1000+20*i for i in range(51)];depths=[100*i for i in range(51)]
        matrix=[[None if y==0 else 60+y*.1+x*.01 for x in range(51)] for y in range(51)]
        self.result={'ranges_m':ranges,'depths_m':depths,'tl_db':matrix,'curve_tl_db':matrix[10],
         'shape':[51,51],'valid_ratio':50/51,'frequency_hz':50.,'source_depth_m':1000.,
         'water_depth_m':5000.,'requested_receiver_depth_m':1000.,'actual_receiver_depth_m':1000.,
         'receiver_depth_error_m':0.,'solver':'kraken','environment_type':'munk_5000m',
         'mode_addition':'incoherent','field_options':'RCOI','mode_count':10}
        self.summary={k:v for k,v in self.result.items() if k not in ('ranges_m','depths_m','tl_db','curve_tl_db')}
        self.case={**checker.PLAN,'studio':True,'frequency_hz':50.,'source_depth_m':1000.}
        case_env=REFERENCE.replace('2 ! NSD','1 ! NSD').replace('25 250 / ! SD','1000 / ! SD')
        self.artifacts={'result.json':json.dumps(self.result).encode(),'summary.json':json.dumps(self.summary).encode(),
         'case.env':case_env.encode(),'case.json':json.dumps(self.case).encode(),
         'run.log':b'TEST ONLY fixture\nOCEAN_STAGE: INPUT_VALIDATED\nOCEAN_STAGE: RESULT_VALIDATED 51 x 51\n'}
        self.names=[*self.artifacts,'case.prt','case.shd','tl_map.png','tl_curve.png','modes.json']

    def https_open(self,request):
        method=request.get_method();url=urlsplit(request.full_url);path=url.path
        headers={k.lower():v for k,v in request.header_items()}
        body=json.loads(request.data) if request.data else None
        self.requests.append((method,path,body,headers))
        status=200;kind='application/json'
        if path=='/api/health':value={'matlab_available':True,'solver_available':True}
        elif path=='/api/workbench/capabilities':value={'node_online':self.online,'script_execution':False,'queue_admin':False}
        elif path=='/api/simulation/plans/preview':
            assert method=='POST' and body==checker.PLAN
            value={'case_count':1,'plan':body}
        elif path=='/api/simulation/jobs':
            assert method=='POST' and body==checker.PLAN
            key=headers.get('idempotency-key');assert key and headers.get('cookie')
            if key not in self.receipts:
                self.created+=1;self.receipts[key]={'ids':['a'*12],'batch_id':'b'*32,'reused':False}
            value=self.receipts[key]
            if self.lose_response:self.lose_response=False;status=503;value={'detail':'test-only lost acknowledgement'}
        elif path=='/api/jobs/'+'a'*12:value={'id':'a'*12,'state':'SUCCEEDED','plan':self.case,'artifacts':self.names,'summary':self.summary}
        elif path.startswith('/api/jobs/'+'a'*12+'/artifact/'):
            value=self.artifacts[path.rsplit('/',1)[-1]]
        elif path=='/api/jobs/'+'a'*12+'/download':
            buffer=io.BytesIO()
            with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
                for name in self.names:archive.writestr(name,self.artifacts.get(name,b'TEST ONLY fixture binary'))
            value=buffer.getvalue();kind='application/zip'
        elif path=='/api/batches/'+'b'*32:value={'id':'b'*32,'complete':True,'cases':[{'id':'a'*12,'state':'SUCCEEDED'}]}
        elif path=='/api/project/file':value={'content':REFERENCE,'sha256':checker.sha(REFERENCE.encode()),'truncated':False}
        else:raise AssertionError('Unexpected public endpoint '+path)
        payload=value if isinstance(value,bytes) else json.dumps(value).encode()
        response_headers=Message();response_headers['Content-Type']=kind
        response_headers['Set-Cookie']='ocean_visitor='+'A'*64+'; Path=/; Secure; HttpOnly; SameSite=Lax'
        response=addinfourl(io.BytesIO(payload),response_headers,request.full_url,status);response.msg='test fixture'
        return response


class Checker(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.app=Path(self.directory.name)/'app';(self.app/'.local').mkdir(parents=True)
        (self.app/'.local/public-runtime.json').write_text(json.dumps({'site_origin':'https://course.test','outbound_proxy':'http://127.0.0.1:7897','gateway_secret':'MUST-NEVER-APPEAR-IN-OUTPUT'}),encoding='utf8')

    def tearDown(self):self.directory.cleanup()

    def run_fake(self,site,simulate=False):
        class Client(REAL_CLIENT):
            def __init__(self,*args,**kwargs):
                super().__init__(*args,**kwargs);self.opener.add_handler(site)
        with patch.object(checker,'PublicClient',Client),patch.object(checker.time,'sleep',return_value=None):
            return checker.run_check(self.app,simulate,wait_seconds=1)

    def test_default_is_strictly_readonly_and_reports_offline_without_any_post(self):
        for online in (True,False):
            site=FakeSite(online=online);report,path=self.run_fake(site)
            self.assertEqual(report['passed'],online,report)
            self.assertEqual([(m,p) for m,p,_,_ in site.requests],[('GET','/api/health'),('GET','/api/workbench/capabilities')])
            self.assertEqual(site.created,0);self.assertNotIn('MUST-NEVER',path.read_text())

    def test_simulation_checks_real_http_contract_then_reuses_saved_cookie_and_receipt(self):
        site=FakeSite();report,_=self.run_fake(site,True)
        self.assertTrue(report['passed'],report);self.assertEqual(site.created,1)
        self.assertEqual(report['result'],'simulation_verified');self.assertTrue(report['simulation']['env_checks']['ssp_and_bottom_unchanged'])
        self.assertFalse(report['simulation']['physical_accuracy_proven'])
        self.assertTrue((self.app/'.local/validation/public-visitor.cookies.txt').is_file())
        before=sum(m=='POST' and p=='/api/simulation/jobs' for m,p,_,_ in site.requests)
        repeated,_=self.run_fake(site,True);self.assertTrue(repeated['passed'],repeated)
        self.assertEqual(site.created,1);self.assertEqual(sum(m=='POST' and p=='/api/simulation/jobs' for m,p,_,_ in site.requests),before)
        self.assertNotIn('MUST-NEVER',json.dumps(site.requests))

    def test_response_lost_after_commit_retries_same_idempotency_key_only(self):
        site=FakeSite(lose_response=True);report,_=self.run_fake(site,True)
        self.assertTrue(report['passed'],report);self.assertEqual(site.created,1)
        keys=[h.get('idempotency-key') for m,p,_,h in site.requests if m=='POST' and p=='/api/simulation/jobs']
        self.assertEqual(len(keys),2);self.assertEqual(keys[0],keys[1])

    def test_independent_checks_detect_transposed_axes_curve_errors_and_bottom_changes(self):
        result=FakeSite().result
        self.assertTrue(checker.validate_field(result,checker.PLAN)['passed'])
        for mutate in (lambda r:r['ranges_m'].__setitem__(0,1.),lambda r:r.__setitem__('curve_tl_db',[999.,*r['curve_tl_db'][1:]]),lambda r:r.__setitem__('valid_ratio',1.),lambda r:r.__setitem__('source_depth_m',50.)):
            bad=copy.deepcopy(result);mutate(bad)
            with self.assertRaises(checker.CheckError):checker.validate_field(bad,checker.PLAN)
        generated=REFERENCE.replace('2 ! NSD','1 ! NSD').replace('25 250 / ! SD','1000 / ! SD')
        self.assertTrue(checker.validate_env(generated.replace('  ','\t'),REFERENCE,checker.PLAN)['passed'])
        with self.assertRaises(checker.CheckError):checker.validate_env(generated.replace('5000 1600','5000 1700'),REFERENCE,checker.PLAN)


if __name__=='__main__':unittest.main()
