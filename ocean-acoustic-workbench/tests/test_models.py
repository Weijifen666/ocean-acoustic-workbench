"""Offline checks of provider isolation and incompatible-model request handling."""
import sys,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import models,httpx
from fastapi import HTTPException

class Connections(unittest.IsolatedAsyncioTestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.local=patch.object(models,'LOCAL',Path(self.temp.name));self.local.start()
  self.cfg={'provider':'DeepSeek','base_url':'https://api.deepseek.com','model':'deepseek-flash','api_key':'deepseek-test-only'}
 def tearDown(self):self.local.stop();self.temp.cleanup()
 def config(self):return dict(self.cfg)
 def test_provider_key_does_not_cross_suppliers(self):
  models.store_profile({'provider':'Kimi','base_url':'https://api.moonshot.cn/v1','model':'kimi-k3','api_key':'kimi-test-only'})
  connection=models.select_connection({'provider':'Kimi','model':'kimi-k3'},self.config)
  self.assertEqual(connection['api_key'],'kimi-test-only')
  with self.assertRaises(HTTPException) as error:models.select_connection({'provider':'GLM','model':'glm-5.3'},self.config)
  self.assertEqual(error.exception.status_code,422)
  public=json.dumps(models.public_profiles(self.config));self.assertNotIn('test-only',public)
 def test_supplier_model_options(self):
  glm=models.chat_payload({'provider':'GLM','model':'glm-5.3'},[])
  self.assertEqual(glm['thinking']['type'],'enabled');self.assertEqual(glm['reasoning_effort'],'low')
  kimi=models.chat_payload({'provider':'Kimi','model':'kimi-k3'},[])
  self.assertNotIn('temperature',kimi);self.assertEqual(kimi['reasoning_effort'],'low')
 async def test_success_uses_exact_api_id_and_does_not_certify_agent(self):
  seen=[]
  def handler(request):
   seen.append(json.loads(request.content));self.assertEqual(str(request.url),'https://api.deepseek.com/chat/completions')
   return httpx.Response(200,json={'model':'deepseek-flash','choices':[{'message':{'content':'OK'}}],'usage':{'total_tokens':9}})
  original=httpx.AsyncClient
  with patch.object(models.httpx,'AsyncClient',side_effect=lambda **kw:original(transport=httpx.MockTransport(handler),**kw)):
   result=await models.test_connection({},self.config)
  self.assertTrue(result['ok']);self.assertEqual(seen[0]['model'],'deepseek-flash');self.assertIn('不表示',result['note'])
  self.assertEqual(seen[0]['thinking'],{'type':'disabled'});self.assertEqual(seen[0]['max_tokens'],256);self.assertFalse(seen[0]['stream']);self.assertNotIn('reasoning_effort',seen[0])
 async def test_permission_failure_redacts_remote_body(self):
  original=httpx.AsyncClient
  with patch.object(models.httpx,'AsyncClient',side_effect=lambda **kw:original(transport=httpx.MockTransport(lambda r:httpx.Response(403,text='echo secret deepseek-test-only')),**kw)):
   with self.assertRaises(HTTPException) as error:await models.test_connection({},self.config)
  self.assertEqual(error.exception.status_code,502);self.assertNotIn('test-only',error.exception.detail)
 async def test_account_list_requires_actual_call_for_certification(self):
  original=httpx.AsyncClient
  with patch.object(models.httpx,'AsyncClient',side_effect=lambda **kw:original(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'data':[{'id':'deepseek-flash'}]})),**kw)):
   result=await models.list_account_models({},self.config)
  self.assertTrue(result['selected_listed']);self.assertIn('实际调用',result['note'])
class CompletionResponses(unittest.TestCase):
 cfg={'provider':'DeepSeek','model':'deepseek-flash','api_key':'TEST-PRIVATE-KEY'}
 def result(self,content='OK',reason='stop',extra=None):return {'model':'actual-provider-model','choices':[{'message':{'content':content,**(extra or {})},'finish_reason':reason}]}
 def test_actual_metadata_and_bom_whitespace(self):
  response=httpx.Response(200,text='\ufeff \n'+json.dumps(self.result()))
  result,content,diagnostic=models.read_test_completion(response,self.cfg)
  self.assertEqual(content,'OK');self.assertEqual(diagnostic['response_model'],'actual-provider-model');self.assertEqual(diagnostic['finish_reason'],'stop')
 def test_empty_reasoning_only_and_truncated_are_failures(self):
  for result in [self.result(''),self.result(None,'length',{'reasoning_content':'PRIVATE '+self.cfg['api_key']}),self.result('OK','length'),self.result('','content_filter')]:
   with self.subTest(result=result),self.assertRaises(HTTPException) as error:models.read_test_completion(httpx.Response(200,json=result),self.cfg)
   self.assertEqual(error.exception.status_code,502);self.assertNotIn(self.cfg['api_key'],error.exception.detail)
   self.assertEqual(error.exception.diagnostic['response_model'],'actual-provider-model');self.assertEqual(error.exception.diagnostic['finish_reason'],result['choices'][0]['finish_reason'])
 def test_format_diagnostics_do_not_echo_response(self):
  for text,code in [('', 'PROVIDER_EMPTY_RESPONSE'),('<html>'+self.cfg['api_key']+'</html>','PROVIDER_HTML_RESPONSE'),('{"private":"'+self.cfg['api_key']+'"','PROVIDER_JSON_INVALID'),('{"choices":[]}','PROVIDER_MESSAGE_MISSING'),(json.dumps({'error':{'message':self.cfg['api_key']}}),'PROVIDER_ERROR_PAYLOAD')]:
   with self.subTest(code=code),self.assertRaises(HTTPException) as error:models.read_test_completion(httpx.Response(200,text=text),self.cfg)
   self.assertEqual(error.exception.headers['X-Ocean-Provider-Code'],code);self.assertNotIn(self.cfg['api_key'],error.exception.detail)
 def test_complete_sse_is_accepted_but_keepalive_is_not(self):
  packet={'model':'actual-stream-model','choices':[{'delta':{'content':'OK'},'finish_reason':'stop'}]}
  response=httpx.Response(200,text=': keepalive\n\ndata: '+json.dumps(packet)+'\n\ndata: [DONE]\n\n')
  result,content,diagnostic=models.read_test_completion(response,self.cfg)
  self.assertEqual(content,'OK');self.assertEqual(diagnostic['response_format'],'event_stream');self.assertEqual(diagnostic['response_model'],'actual-stream-model')
  with self.assertRaises(HTTPException) as error:models.read_test_completion(httpx.Response(200,text=': keepalive\n\n'),self.cfg)
  self.assertEqual(error.exception.headers['X-Ocean-Provider-Code'],'PROVIDER_INCOMPLETE_STREAM')
if __name__=='__main__':unittest.main()
