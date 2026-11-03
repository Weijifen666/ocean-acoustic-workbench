"""Exercise both merged agents against the same isolated runtime and job schema."""
import json
import unittest
from unittest.mock import patch
import test_research_api as fixture


class IntegratedAgents(unittest.TestCase):
    setUp = fixture.ResearchAPI.setUp
    tearDown = fixture.ResearchAPI.tearDown

    def test_shared_routes_and_matlab_configuration(self):
        for path in ['/api/chat', '/api/research/chat', '/api/simulation/chat',
                     '/api/simulation/jobs']:
            response = self.client.post(path, json={})
            expected = 200 if path == '/api/simulation/jobs' else 422
            self.assertEqual(response.status_code, expected, (path, response.text))
        self.assertEqual(self.client.post('/api/matlab/check', json={}).status_code, 200)
        response = self.client.get('/api/matlab/detect')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['current_toolbox'], str(self.local / 'toolbox'))

    def test_ray_job_uses_migrated_schema_and_shared_results(self):
        response = self.client.post('/api/jobs/ray', json={
            'water_depth_m': 100, 'source_depth_m': 50,
            'angles_deg': [15], 'range_max_km': 1})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data['state'], 'SUCCEEDED', data)
        detail = self.client.get('/api/jobs/' + data['job_id']).json()
        self.assertEqual(detail['plan']['task_type'], 'shallow_water_ray_tracing')
        self.assertIn('ray_trajectories.png', detail['artifacts'])
        self.assertEqual(self.client.get(data['ray_plot_url']).status_code, 200)
        self.assertIsNone(self.module.STORE.claim_next('test-worker'))

    def test_offline_simulation_chat_returns_and_persists_reply(self):
        with patch('natural_agent.search', return_value=[]):
            response = self.client.post('/api/simulation/chat', json={
                'message': '你好', 'session': 'natural:integration-test'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['reply'])
        rows = self.client.get('/api/chat/history?session=natural:integration-test').json()
        self.assertEqual([row['role'] for row in rows], ['user', 'assistant'])

    def test_python_task_is_visible_to_unified_results(self):
        response = self.client.post('/api/jobs/code', json={
            'code': "from pathlib import Path\nPath('result.txt').write_text('integration-ok')",
            'description': 'Integration fixture', 'language': 'python'})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data['state'], 'SUCCEEDED', data)
        detail = self.client.get('/api/jobs/' + data['job_id']).json()
        self.assertIn('result.txt', detail['artifacts'])
        self.assertEqual(detail['summary']['description'], 'Integration fixture')

    def test_natural_kraken_plan_uses_durable_submit_contract(self):
        import asyncio
        import natural_agent
        identity = 'abcdef123456'
        folder = self.local / 'runs' / identity
        folder.mkdir(parents=True)
        (folder/'summary.json').write_text('{}', encoding='utf-8')
        (folder/'result.json').write_text('{}', encoding='utf-8')
        for name in ['tl_map.png','tl_curve.png']:
            (folder/name).write_bytes(b'\x89PNG\r\n\x1a\n')
        plan = {'frequencies_hz':[50.0], 'source_depths_m':[1000.0],
                'receiver_depth_m':1000.0, 'range_min_km':1.0,
                'range_max_km':50.0, 'range_points':201, 'depth_points':251}
        with patch('natural_agent.submit', return_value={'ids':[identity]}) as submit, patch(
                'natural_agent.job', return_value={'state':'SUCCEEDED','plan':plan}):
            result = asyncio.run(natural_agent.execute_simulation_and_wait({'type':'kraken', **plan}))
        self.assertEqual(result['status'], 'success', result)
        self.assertEqual(len(submit.call_args.args), 2)
        self.assertEqual(submit.call_args.args[0].frequencies_hz, [50.0])
