"""Real service dispatch, request-scoped graph context and code-document tools."""
import asyncio,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import httpx
from fastapi import HTTPException
from pydantic import ValidationError

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
import persistence,research_api,graph_tools,code_tools


class ResearchGraphTools(unittest.IsolatedAsyncioTestCase):
 def setUp(self):
  self.temporary=tempfile.TemporaryDirectory();self.local=Path(self.temporary.name)
  self.store=persistence.JobStore(self.local/'workbench.sqlite3');self.store.migrate()
  self.cfg={'provider':'DeepSeek','base_url':'https://api.deepseek.com','model':'deepseek-flash','api_key':'TEST-NOT-A-REAL-KEY'}
  self.service=research_api.ResearchService(ROOT,self.local,self.store,lambda:dict(self.cfg),lambda question:[]);self.service.migrate()
 def tearDown(self):self.temporary.cleanup()
 async def asyncTearDown(self):await self.service.close()
 def request(self,**changes):return research_api.ResearchRequest(**{'request_id':'graph-request-0001','session':'graph-session-0001','message':'解释所选知识点与连接','backend':'dsh','context_budget':'unlimited',**changes})
 async def finish(self):
  if self.service.tasks:await asyncio.gather(*list(self.service.tasks))
 async def test_all_graph_tools_dispatch_and_selection_is_current_run_only(self):
  registered={tool['function']['name'] for tool in self.service.tools()}
  self.assertTrue({tool['function']['name'] for tool in graph_tools.tool_specs()+code_tools.tool_specs()}<=registered)
  page=await self.service.execute(None,'search_graph_nodes',{'query':'Munk','limit':1});self.assertEqual(len(page['items']),1)
  node=await self.service.execute(None,'read_graph_node',{'id':'munk_profile'});self.assertTrue(node['source_claim_ids'])
  edge=next(edge for edge in self.service.graph.graph['edges'] if edge['group']=='related')
  relations=await self.service.execute(None,'read_graph_relations',{'node_id':edge['source'],'groups':['related'],'direction':'outgoing','limit':1})
  self.assertEqual(relations['direction'],'outgoing');self.assertEqual(relations['items'][0]['source'],edge['source'])
  path=await self.service.execute(None,'find_graph_path',{'source':edge['target'],'target':edge['source'],'groups':['related']})
  self.assertTrue(path['found']);self.assertTrue(path['edges'][0]['traversed_reverse']);self.assertIn('不等于物理因果',path['relation_note'])
  run_a={};run_b={'graph_selection':self.service.graph.selection([])}
  selected=await self.service.execute(None,'select_graph_nodes',{'node_ids':['munk_profile']},run_a)
  self.assertEqual(run_a['graph_selection']['node_ids'],['munk_profile']);self.assertEqual(run_b['graph_selection']['node_ids'],[])
  self.assertEqual(selected['evidence'][0]['id'],node['source_claim_ids'][0]);self.assertFalse(selected['evidence'][0]['citation']['claim_support_verified'])
 async def test_validation_and_idempotency_include_selection(self):
  for ids,status in [(['missing-node'],404),(['course'],422)]:
   with self.assertRaises(HTTPException) as error:await self.service.submit(self.request(knowledge_node_ids=ids))
   self.assertEqual(error.exception.status_code,status)
  with self.assertRaises(ValidationError):self.request(knowledge_node_ids=['munk_profile']*9)
  with self.assertRaises(ValidationError):self.request(knowledge_node_ids=[1])
  async def bridge(*args,**kwargs):return '真实fixture回答'
  with patch('research_api.dsh_bridge.run',side_effect=bridge):
   first=await self.service.submit(self.request(knowledge_node_ids=['munk_profile','munk_profile']));await self.finish()
   replay=await self.service.submit(self.request(knowledge_node_ids=['munk_profile']));self.assertTrue(replay['reused']);self.assertEqual(first['id'],replay['id'])
   with self.assertRaises(HTTPException) as error:await self.service.submit(self.request(knowledge_node_ids=[]))
   self.assertEqual(error.exception.status_code,409)
 async def test_harness_receives_canonical_evidence_and_cleared_or_other_sessions_are_empty(self):
  instructions=[]
  async def bridge(messages,tools,execute,stop,trace,guidance,*args,**kwargs):
   instructions.append(guidance)
   if len(instructions)==1:await execute('select_graph_nodes',{'node_ids':['sound_speed_profile']})
   return '已读取图谱'
  with patch('research_api.dsh_bridge.run',side_effect=bridge):
   await self.service.submit(self.request(knowledge_node_ids=['munk_profile']));await self.finish()
   first=self.service.snapshot('graph-request-0001');self.assertEqual(first['knowledge_node_ids'],['munk_profile']);self.assertEqual(first['graph_selection']['node_ids'],['sound_speed_profile'])
   await self.service.submit(self.request(request_id='graph-request-clear',knowledge_node_ids=[]));await self.finish()
   await self.service.submit(self.request(request_id='graph-request-other',session='graph-session-other'));await self.finish()
  source=self.service.graph.read_node('munk_profile')['source_claim_ids'][0];self.assertIn(source,instructions[0])
  for guidance in instructions[1:]:
   self.assertIn('"node_ids": []',guidance);self.assertIn('所选图谱知识卡与来源候选：[]',guidance);self.assertNotIn(source,guidance)
 async def test_api_selected_context_is_resolved_server_side_and_cited(self):
  sent=[];original=httpx.AsyncClient
  def handler(request):
   sent.append(json.loads(request.content));return httpx.Response(200,json={'model':'fixture-model','choices':[{'finish_reason':'stop','message':{'content':'依据所选知识点回答'}}]})
  with patch.object(research_api.httpx,'AsyncClient',side_effect=lambda **kwargs:original(transport=httpx.MockTransport(handler),**kwargs)):
   await self.service.submit(self.request(backend='api',knowledge_node_ids=['munk_profile','sound_speed_profile']));await self.finish()
  self.assertEqual(self.service.snapshot('graph-request-0001')['state'],'done')
  system=sent[0]['messages'][0]['content']
  for identity in ['munk_profile','sound_speed_profile']:
   node=self.service.graph.read_node(identity);self.assertIn(node['source_claim_ids'][0],system)
  self.assertIn('explicit_graph_selection',system);self.assertIn('不等于物理因果',system)
 async def test_code_documents_are_readable_editable_and_never_forge_execution_results(self):
  source={'title':'声速分析','language':'python','code':'print(1500)\n','input_csv':'depth,speed\n0,1500'}
  result=await self.service.execute(None,'write_code_artifact',source)
  self.assertFalse(result['executed']);self.assertEqual(result['workspace_url'],'/#code/'+result['id'])
  self.assertEqual(len((await self.service.execute(None,'list_code_artifacts',{}))['artifacts']),1)
  read=await self.service.execute(None,'read_code_artifact',{'id':result['id'],'field':'input_csv','max_bytes':256})
  self.assertEqual(read['content'],source['input_csv']);self.assertTrue(read['complete'])
  missing=await self.service.execute(None,'read_code_result',{'id':result['id']});self.assertIsNone(missing['result']);self.assertFalse(missing['executed'])
  with self.assertRaises(ValueError):await self.service.execute(None,'write_code_artifact',{**source,'id':result['id'],'result':{'status':'succeeded'}})
  with self.assertRaises(ValueError):await self.service.execute(None,'write_code_artifact',{**source,'id':result['id'],'expected_revision':0})
  updated=await self.service.execute(None,'write_code_artifact',{**source,'id':result['id'],'expected_revision':result['revision'],'code':'print(1501)\n'})
  self.assertEqual(updated['revision'],result['revision']+1);self.assertFalse(updated['executed'])

if __name__=='__main__':unittest.main()
