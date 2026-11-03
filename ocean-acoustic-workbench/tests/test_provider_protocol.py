"""Exercise the real local endpoints with a strict thinking-mode HTTP provider.

The transport returns 400 for a lost/altered reasoning field. No paid network,
MATLAB, generated code, or real user data are used.
"""
import copy
import json
import time
import unittest
from unittest.mock import patch

import httpx
import test_research_api as fixture
import context_budget
import persistence
import provider_history


class ProviderProtocol(unittest.TestCase):
    setUp = fixture.ResearchAPI.setUp
    tearDown = fixture.ResearchAPI.tearDown

    def exercise(self, mode):
        configuration = self.module.config()
        configuration.update(provider='DeepSeek', model='deepseek-flash', api_key='TEST-ONLY-PRIVATE-PROTOCOL-KEY')
        (self.local / 'config.json').write_text(json.dumps(configuration), encoding='utf-8')
        original_client = httpx.AsyncClient
        requests = []
        markers = []
        rejections = []
        tool = 'read_project_file'
        (self.local/'project'/'protocol.txt').write_text('Actual authorized test file; no model reasoning or credentials.',encoding='utf-8')

        def strict_provider(request):
            body = json.loads(request.content)
            requests.append(copy.deepcopy(body))
            for message in body['messages']:
                if message['role'] == 'tool':
                    result=json.loads(message['content'])
                    if result.get('content')!='Actual authorized test file; no model reasoning or credentials.':
                        rejections.append('The authorized file tool did not execute successfully')
                        return httpx.Response(400,json={'error':{'message':rejections[-1]}})
                if message['role'] != 'assistant':
                    continue
                if message.get('tool_calls'):
                    index = int(message['tool_calls'][0]['id'].rsplit('-', 1)[1])
                    expected = f'PRIVATE-PROTOCOL-TOOL-{index}'
                else:
                    index = int(message.get('content', '').rsplit('-', 1)[1])
                    expected = f'PRIVATE-PROTOCOL-FINAL-{index}'
                if message.get('reasoning_content') != expected:
                    rejections.append('reasoning_content missing or changed')
                    return httpx.Response(400, json={'error': {'message': rejections[-1]}})
            phase = len(requests) - 1
            index = phase // 2
            reasoning = f'PRIVATE-PROTOCOL-{"TOOL" if phase % 2 == 0 else "FINAL"}-{index}'
            markers.append(reasoning)
            message = {'role': 'assistant', 'content': None if phase % 2 == 0 else f'actual-provider-final-{index}', 'reasoning_content': reasoning}
            if phase % 2 == 0:
                message['tool_calls'] = [{'id': f'protocol-call-{index}', 'type': 'function', 'function': {'name': tool, 'arguments': json.dumps({'path':'protocol.txt'})}}]
            return httpx.Response(200, json={'model': 'deepseek-flash', 'choices': [{'finish_reason': 'tool_calls' if phase % 2 == 0 else 'stop', 'message': message}]})

        def client_factory(*args, **kwargs):
            kwargs['transport'] = httpx.MockTransport(strict_provider)
            return original_client(*args, **kwargs)

        session = 'provider-protocol-' + mode
        with patch('httpx.AsyncClient', side_effect=client_factory), patch('natural_agent.search', return_value=[]):
            for index in range(2):
                message = '请说明本工作台已经提供的工具。' if index == 0 else '根据上一次已返回的工具继续说明。'
                if mode == 'research':
                    identity = 'protocol-research-request-' + str(index)
                    response = self.client.post('/api/research/chat', json={'session': session, 'request_id': identity, 'message': message, 'backend': 'api'})
                    self.assertEqual(response.status_code, 200, response.text)
                    deadline = time.monotonic() + 5
                    while time.monotonic() < deadline:
                        result = self.client.get('/api/research/runs/' + identity).json()
                        if result['state'] != 'running':
                            break
                        time.sleep(.01)
                    self.assertEqual(result['state'], 'done', result)
                    history = self.client.get('/api/research/history', params={'session': session}).json()
                    storage_session = 'research:' + session
                else:
                    endpoint = '/api/simulation/chat' if mode == 'natural' else '/api/chat'
                    response = self.client.post(endpoint, json={'session': session, 'message': message, 'mode': 'agent', **({'knowledge_mode': 'general'} if mode == 'course-agent' else {})})
                    self.assertEqual(response.status_code, 200, response.text)
                    result = response.json()
                    self.assertTrue(result['model_used'])
                    history = self.client.get('/api/chat/history', params={'session': session}).json()
                    storage_session = session
                self.assertEqual(len(history), 2 * (index + 1))
                for marker in markers:
                    self.assertNotIn(marker, json.dumps(result))
                    self.assertNotIn(marker, json.dumps(history))
                # A new store instance and connection must recover the private
                # turn from disk, independently of in-memory Agent state.
                reopened = persistence.JobStore(self.local / 'workbench.sqlite3')
                recovered = provider_history.load(reopened.connection, storage_session, configuration)
                self.assertEqual(recovered[-1]['role'], 'provider_turn')
                turn = recovered[-1]['messages']
                self.assertEqual([row['role'] for row in turn], ['user', 'assistant', 'tool', 'assistant'])
                self.assertEqual(turn[1]['reasoning_content'], f'PRIVATE-PROTOCOL-TOOL-{index}')
                self.assertEqual(turn[-1]['reasoning_content'], f'PRIVATE-PROTOCOL-FINAL-{index}')
        self.assertEqual(rejections, [])
        self.assertEqual(len(requests), 4)
        retained = requests[2]['messages']
        self.assertTrue(any(row.get('tool_call_id') == 'protocol-call-0' for row in retained))
        self.assertTrue(any(row.get('reasoning_content') == 'PRIVATE-PROTOCOL-FINAL-0' for row in retained))
        if mode == 'research':
            self.assertEqual(self.client.delete('/api/research/sessions/' + session).status_code, 200)
            with self.module.STORE.connection() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM provider_protocol_turns WHERE session=?', (storage_session,)).fetchone()[0], 0)

    def test_research_api_preserves_private_complete_turns(self):
        self.exercise('research')

    def test_natural_agent_preserves_private_complete_turns(self):
        self.exercise('natural')

    def test_legacy_course_agent_preserves_private_complete_turns(self):
        self.exercise('course-agent')

    def test_history_budget_keeps_an_entire_provider_turn_including_internal_followup(self):
        def turn(index):
            return {'role': 'provider_turn', 'messages': [
                {'role': 'user', 'content': 'question-' + str(index)},
                {'role': 'assistant', 'content': None, 'reasoning_content': 'R' * 900, 'tool_calls': [{'id': 'call-' + str(index), 'type': 'function', 'function': {'name': 'read', 'arguments': '{}'}}]},
                {'role': 'tool', 'tool_call_id': 'call-' + str(index), 'content': 'actual tool result'},
                {'role': 'user', 'content': 'Internal application request to summarize the completed tool result.'},
                {'role': 'assistant', 'content': 'actual final', 'reasoning_content': 'F' * 900}]}
        packed = context_budget.build_context(question='new', system='system', history=[turn(1), turn(2), turn(3)], context_budget=4096)
        self.assertEqual(packed['context']['history_messages_used'], 5)
        self.assertEqual(packed['context']['dropped_history_messages'], 10)
        self.assertEqual(packed['messages'][1:-1], turn(3)['messages'])
        context_budget.assert_messages_budget(packed['messages'], 4096)

    def test_skill_resource_pagination_is_forwarded_through_the_real_research_dispatch(self):
        import asyncio
        engine = fixture.ResearchAPI.engine(self)
        args = {'id': 'at-environment', 'path': 'references/casebook.json', 'offset': 20, 'max_bytes': 512}
        result = asyncio.run(self.module.RESEARCH.execute(engine, 'read_skill_resource', args))
        self.assertEqual(result['offset'], 20)
        self.assertLessEqual(result['returned_bytes'], 512)
        self.assertGreater(result['next_offset'], 20)
        self.assertTrue(result['has_more'])

    def test_real_schema_directory_and_large_skill_continue_with_bounded_protocol_requests(self):
        configuration=self.module.config();configuration.update(provider='DeepSeek',model='deepseek-flash',api_key='TEST-ONLY-PROTOCOL-KEY')
        (self.local/'config.json').write_text(json.dumps(configuration),encoding='utf-8')
        original=httpx.AsyncClient;requests=[];observed={}
        def transport(request):
            body=json.loads(request.content);requests.append(body)
            context_budget.assert_messages_budget(body['messages'],32768,body.get('tools'))
            for message in body['messages']:
                if message['role']=='assistant':self.assertIn('reasoning_content',message)
                if message['role']=='tool':
                    value=json.loads(message['content']);self.assertNotIn('error',value);observed[message['tool_call_id']]=value
            index=len(requests)
            calls=([{'id':'real-schema','type':'function','function':{'name':'get_simulation_schema','arguments':'{}'}},
                    {'id':'real-directory','type':'function','function':{'name':'list_project_files','arguments':'{}'}}] if index==1 else
                   [{'id':'real-large-skill','type':'function','function':{'name':'read_skill_resource','arguments':json.dumps({'id':'at-environment','path':'references/casebook.json'})}}] if index==2 else [])
            message={'role':'assistant','content':None if calls else '使用真实目录、完整Plan字段和明确分页的算例片段完成说明。','reasoning_content':'PRIVATE-PROTOCOL-LARGE-'+str(index)}
            if calls:message['tool_calls']=calls
            return httpx.Response(200,json={'choices':[{'message':message,'finish_reason':'tool_calls' if calls else 'stop'}]})
        def factory(*args,**kwargs):return original(*args,transport=httpx.MockTransport(transport),**kwargs)
        identity='real-large-research-request'
        with patch('httpx.AsyncClient',side_effect=factory):
            self.assertEqual(self.client.post('/api/research/chat',json={'session':'large-research-session','request_id':identity,'message':'读取真实声场参数、文件目录与AT算例，不运行求解器。','backend':'api'}).status_code,200)
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                current=self.client.get('/api/research/runs/'+identity).json()
                if current['state']!='running':break
                time.sleep(.01)
        self.assertEqual(current['state'],'done',current)
        self.assertEqual(len(requests),3)
        self.assertIn('frequencies_hz',observed['real-schema']['schema']['properties'])
        self.assertGreater(observed['real-directory']['total'],20);self.assertEqual(len(observed['real-directory']['files']),20);self.assertEqual(observed['real-directory']['next_offset'],20)
        self.assertTrue(observed['real-large-skill']['has_more']);self.assertLessEqual(observed['real-large-skill']['returned_bytes'],12000)
        self.assertGreater(current['context']['dropped_evidence_count']+current['context']['dropped_tool_messages'],0)

    def test_provider_rejection_is_failed_instead_of_a_successful_partial_answer(self):
        configuration=self.module.config();configuration.update(provider='DeepSeek',model='deepseek-flash',api_key='TEST-ONLY-PROTOCOL-KEY')
        (self.local/'config.json').write_text(json.dumps(configuration),encoding='utf-8')
        original=httpx.AsyncClient;count=[]
        def transport(request):count.append(request);return httpx.Response(400,json={'error':{'message':'TEST-ONLY-REJECTION'}})
        def factory(*args,**kwargs):return original(*args,transport=httpx.MockTransport(transport),**kwargs)
        identity='rejected-research-request'
        with patch('httpx.AsyncClient',side_effect=factory):
            self.assertEqual(self.client.post('/api/research/chat',json={'session':'rejected-session','request_id':identity,'message':'只解释工具范围。','backend':'api'}).status_code,200)
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                current=self.client.get('/api/research/runs/'+identity).json()
                if current['state']!='running':break
                time.sleep(.01)
        self.assertEqual(current['state'],'failed',current);self.assertIsNone(current['reply']);self.assertEqual(len(count),1)
        self.assertNotIn('TEST-ONLY-PROTOCOL-KEY',json.dumps(current))
        self.assertEqual(len(self.client.get('/api/research/history',params={'session':'rejected-session'}).json()),1)


if __name__ == '__main__':
    unittest.main()
