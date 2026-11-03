"""Real saved-source execution with CSV, optimistic versions and task cancellation."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import time
import unittest
from unittest.mock import patch

import test_research_api as fixture
import test_public_gateway as gateway_fixture

PREFIX = '/api/research/code/artifacts'


class CodeArtifactExecution(unittest.TestCase):
    setUp = fixture.ResearchAPI.setUp
    tearDown = fixture.ResearchAPI.tearDown

    def create(self, code='print("actual local execution")\n', csv='x,y\r\n1,声速\r\n', language='python'):
        response = self.client.post(PREFIX, json={'title': 'Local CSV fixture', 'code': code,
                                                 'input_csv': csv, 'language': language})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def run_saved(self, record, **changes):
        return self.client.post(PREFIX + '/' + record['id'] + '/run-local',
                                json={'expected_revision': record['revision']} | changes)

    def test_real_python_uses_frozen_exact_source_and_csv_and_persists_job_binding(self):
        code = ('from __future__ import annotations\n'
                'from pathlib import Path\n'
                'assert input_csv == INPUT_CSV\n'
                'assert Path("input.csv").read_bytes() == input_csv.encode("utf-8")\n'
                'Path("copied.csv").write_bytes(input_csv.encode("utf-8"))\n'
                'print("ran exact saved code")\n')
        record = self.create(code)
        # Neither a stale request's source nor its claimed language controls execution.
        result = self.run_saved(record, code='raise RuntimeError("must be ignored")', language='matlab')
        self.assertEqual(result.status_code, 200, result.text)
        value = result.json()
        self.assertEqual(value['state'], 'SUCCEEDED')
        self.assertEqual(value['physical_accuracy'], 'not_established')
        self.assertTrue(value['artifact_linked'])
        self.assertEqual(value['artifact']['revision'], 2)
        self.assertEqual(value['artifact']['last_local_run']['job_id'], value['job_id'])
        self.assertIsNone(value['artifact']['result'])
        folder = self.local / 'runs' / value['job_id']
        self.assertEqual((folder / 'run_sandbox.py').read_bytes(), code.encode('utf-8'))
        self.assertEqual((folder / 'input.csv').read_bytes(), record['input_csv'].encode('utf-8'))
        self.assertEqual((folder / 'copied.csv').read_bytes(), record['input_csv'].encode('utf-8'))
        job = self.client.get('/api/jobs/' + value['job_id']).json()
        expected = {'id': record['id'], 'source_revision': 1,
                    'code_sha256': hashlib.sha256(code.encode('utf-8')).hexdigest(),
                    'input_sha256': hashlib.sha256(record['input_csv'].encode('utf-8')).hexdigest()}
        self.assertEqual(job['plan']['code_artifact'], expected)
        self.assertEqual(value['code_artifact'], expected)
        self.assertIn('ran exact saved code', job['log'])

    def test_stale_version_mismatched_csv_and_local_origin_are_rejected_before_execution(self):
        record = self.create()
        for revision in (None, '1', True, 0, 2):
            self.assertEqual(self.run_saved(record, expected_revision=revision).status_code, 409)
        self.assertEqual(self.run_saved(record, input_csv='different data').status_code, 409)
        url = PREFIX + '/' + record['id'] + '/run-local'
        for headers in ({'Origin': 'https://unrelated.example'}, {'Host': 'public.example'}):
            response = self.client.post(url, json={'expected_revision': 1}, headers=headers)
            self.assertEqual(response.status_code, 403, response.text)
        for raw in ('[]', 'null', '{broken'):
            self.assertEqual(self.client.post(url, content=raw).status_code, 422)
        self.assertEqual(self.client.post(url, content=b'x' * 150001).status_code, 413)
        self.assertEqual(self.client.get('/api/jobs').json(), [])

    def test_nonzero_exit_is_a_persisted_failure_not_a_successful_receipt(self):
        record = self.create('raise RuntimeError("intentional execution failure")\n')
        response = self.run_saved(record)
        self.assertEqual(response.status_code, 200, response.text)
        value = response.json()
        self.assertEqual(value['state'], 'FAILED')
        self.assertEqual(value['artifact']['last_local_run']['state'], 'FAILED')
        self.assertIn('intentional execution failure', value['log'])
        self.assertEqual(self.client.get('/api/jobs/' + value['job_id']).json()['state'], 'FAILED')

    def test_missing_matlab_fails_before_a_job_is_registered(self):
        record = self.create('disp(input_csv);', language='matlab')
        response = self.run_saved(record)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn('尚未执行', response.json()['detail'])
        self.assertEqual(self.client.get('/api/jobs').json(), [])
        self.assertIsNone(self.client.get(PREFIX + '/' + record['id']).json()['last_local_run'])

    def running_job(self, record, pool):
        future = pool.submit(self.run_saved, record)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            jobs = self.client.get('/api/jobs').json()
            if jobs:
                identity = jobs[0]['id']
                if (self.local / 'runs' / identity / 'child.pid').exists():
                    return future, identity
            time.sleep(.02)
        self.fail('Actual local child did not start')

    def test_running_saved_code_can_be_cancelled_and_never_reports_success(self):
        record = self.create('import os,time\nfrom pathlib import Path\n'
                             'Path("child.pid").write_text(str(os.getpid()))\n'
                             'time.sleep(30)\nPath("late.txt").touch()\n')
        with ThreadPoolExecutor(max_workers=1) as pool:
            future, identity = self.running_job(record, pool)
            self.assertFalse(future.done())
            response = self.client.post('/api/jobs/' + identity + '/cancel')
            self.assertEqual(response.status_code, 200, response.text)
            result = future.result(timeout=10)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['state'], 'CANCELLED')
        self.assertEqual(result.json()['artifact']['last_local_run']['state'], 'CANCELLED')
        self.assertNotIn(identity, self.module.PROCESSES)
        self.assertFalse((self.local / 'runs' / identity / 'late.txt').exists())

    def test_edit_during_execution_keeps_old_job_without_attaching_it_to_new_source(self):
        record = self.create('import os,time\nfrom pathlib import Path\n'
                             'Path("child.pid").write_text(str(os.getpid()))\ntime.sleep(1)\n')
        with ThreadPoolExecutor(max_workers=1) as pool:
            future, identity = self.running_job(record, pool)
            edited = self.client.post(PREFIX + '/' + record['id'], json={
                'expected_revision': 1, 'title': 'New revision', 'language': 'python',
                'code': 'print("new code")', 'input_csv': ''})
            self.assertEqual(edited.status_code, 200, edited.text)
            result = future.result(timeout=10)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['state'], 'SUCCEEDED')
        self.assertFalse(result.json()['artifact_linked'])
        self.assertIn('已更新', result.json()['artifact_link_error'])
        current = self.client.get(PREFIX + '/' + record['id']).json()
        self.assertEqual(current['revision'], 2)
        self.assertIsNone(current['last_local_run'])
        self.assertEqual(self.client.get('/api/jobs/' + identity).json()['plan']['code_artifact']['source_revision'], 1)

    def test_existing_direct_code_route_also_supplies_explicit_csv(self):
        response = self.client.post('/api/jobs/code', json={'language': 'python', 'input_csv': 'x\n42\n',
            'code': 'from pathlib import Path\nPath("copied.csv").write_text(input_csv)\n'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['state'], 'SUCCEEDED')
        self.assertEqual((self.local / 'runs' / response.json()['job_id'] / 'copied.csv').read_text(), 'x\n42\n')


class PublicGatewayExecutionBoundary(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = gateway_fixture.PublicGateway.asyncSetUp
    asyncTearDown = gateway_fixture.PublicGateway.asyncTearDown
    call = gateway_fixture.PublicGateway.call

    async def test_public_gateway_never_forwards_local_code_execution(self):
        for path in ('/api/research/code/artifacts/testartifact/run-local', '/api/jobs/code'):
            response = await self.call('A', path, body={'expected_revision': 1, 'code': 'print(1)'})
            self.assertIn(response.status_code, (403, 404), response.text)
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
