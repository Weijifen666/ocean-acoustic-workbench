"""Local code repository: durable revisions and untrusted output receipts, no execution."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from code_artifacts import ArtifactError, Store, router
from persistence import JobStore


PREFIX = '/api/research/code/artifacts'
PNG = base64.b64encode(base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQv0AAAAASUVORK5CYII='
)).decode('ascii')


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


class CodeArtifacts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.jobs = JobStore(self.folder / 'workbench.sqlite3')
        self.jobs.migrate()
        self.store = Store(self.jobs.connection)
        app = FastAPI()
        app.include_router(router(self.jobs.connection))
        self.client = TestClient(app)
        self.source = {'title': '声速分析', 'language': 'python',
                       'code': 'print("声速")\n', 'input_csv': 'depth,speed\n0,1500\n'}

    def tearDown(self):
        self.client.close()
        self.temporary.cleanup()

    def create(self, **changes):
        response = self.client.post(PREFIX, json=self.source | changes)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def result(self, record, **changes):
        return {'status': 'succeeded', 'stdout': '声速结果\n', 'stderr': '',
                'code_sha256': digest(record['code']), 'input_sha256': digest(record['input_csv']),
                'artifacts': [{'name': '声速.png', 'mime': 'image/png', 'data_base64': PNG},
                              {'name': 'profile.csv', 'mime': 'text/csv', 'text': 'depth,speed\n0,1500\n'}]} | changes

    def upload(self, record, result=None, revision=None):
        return self.client.post(PREFIX + '/' + record['id'] + '/results', json={
            'expected_revision': record['revision'] if revision is None else revision,
            'result': self.result(record) if result is None else result})

    def test_constructor_is_lazy_and_persistence_round_trip_never_executes_code(self):
        def never_connect():
            raise AssertionError('Construction must not access the database')
        Store(never_connect)
        target = self.folder / 'must-not-be-created'
        record = self.create(code='from pathlib import Path\nPath(' + repr(str(target)) + ').touch()\n')
        self.assertFalse(target.exists())
        self.assertEqual(record['revision'], 1)
        self.assertIsNone(record['result'])
        self.assertEqual(record['code_sha256'], digest(record['code']))
        self.assertEqual(record['input_sha256'], digest(record['input_csv']))
        reopened = Store(JobStore(self.folder / 'workbench.sqlite3').connection)
        self.assertEqual(reopened.read(record['id']), record)
        self.assertEqual(self.client.get(PREFIX + '/' + record['id']).json(), record)
        rows = self.client.get(PREFIX).json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['id'], record['id'])
        self.assertFalse(rows[0]['has_result'])
        self.assertNotIn('code', rows[0])

    def test_upload_is_bound_to_both_exact_sources_and_cannot_claim_server_verification(self):
        record = self.create()
        response = self.upload(record, self.result(record, server_verified=True,
                               provenance='server', physical_accuracy='proven'))
        self.assertEqual(response.status_code, 200, response.text)
        stored = response.json()
        self.assertEqual(stored['revision'], 2)
        result = stored['result']
        self.assertEqual(result['provenance'], 'browser_client_report')
        self.assertIs(result['server_verified'], False)
        self.assertEqual(result['physical_accuracy'], 'not_established')
        self.assertEqual(result['artifacts'][0]['base64'], PNG)
        self.assertNotIn('data_base64', result['artifacts'][0])
        self.assertEqual(result['artifacts'][1]['text'], 'depth,speed\n0,1500\n')
        self.assertTrue(self.client.get(PREFIX).json()[0]['has_result'])

    def test_missing_wrong_or_old_input_hash_cannot_attach_a_result(self):
        record = self.create()
        for field in ('code_sha256', 'input_sha256'):
            for value in (None, '', '0' * 64, digest(record['code'] + '\n')):
                result = self.result(record, **{field: value})
                response = self.upload(record, result)
                self.assertEqual(response.status_code, 409, response.text)
        current = self.client.get(PREFIX + '/' + record['id']).json()
        self.assertEqual(current['revision'], 1)
        self.assertIsNone(current['result'])
        # Same code but a different input must invalidate a previously produced output.
        response = self.client.post(PREFIX + '/' + record['id'], json=self.source | {
            'expected_revision': record['revision'], 'input_csv': 'depth,speed\n0,1490\n'})
        updated = response.json()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.upload(updated, self.result(record)).status_code, 409)
        self.assertEqual(self.upload(updated).status_code, 200)

    def test_edits_clear_output_and_revision_prevents_lost_updates(self):
        original = self.create()
        output = self.upload(original).json()
        for revision in (None, '2', True, 1, 3):
            body = self.source | {'expected_revision': revision, 'code': 'print("changed")'}
            response = self.client.post(PREFIX + '/' + original['id'], json=body)
            self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.client.get(PREFIX + '/' + original['id']).json(), output)
        response = self.client.post(PREFIX + '/' + original['id'], json=self.source | {
            'expected_revision': output['revision'], 'title': '更新标题'})
        self.assertEqual(response.status_code, 200, response.text)
        edited = response.json()
        self.assertEqual(edited['created'], original['created'])
        self.assertEqual(edited['revision'], 3)
        self.assertIsNone(edited['result'])
        self.assertEqual(self.upload(edited, revision=2).status_code, 409)

    def test_concurrent_writers_only_one_wins(self):
        record = self.create()
        def save(title):
            try:
                return self.store.save(self.source | {'title': title, 'expected_revision': 1}, id=record['id'])['title']
            except ArtifactError as error:
                return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            values = list(pool.map(save, ('writer one', 'writer two')))
        self.assertEqual(values.count(409), 1)
        winner = self.store.read(record['id'])
        self.assertIn(winner['title'], values)
        self.assertEqual(winner['revision'], 2)

    def test_cancelled_and_failed_runs_are_never_reclassified_as_success(self):
        for status in ('cancelled', 'failed', 'stopped', 'timed_out'):
            with self.subTest(status=status):
                record = self.create()
                response = self.upload(record, self.result(record, status=status, artifacts=[]))
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['result']['status'], status)

    def test_code_and_csv_limits_count_utf8_bytes(self):
        self.create(code='x' * 50000, input_csv='x' * 100000)
        for change in ({'code': 'x' * 50001}, {'code': '声' * 16667},
                       {'input_csv': '声' * 33334}, {'title': '声' * 81},
                       {'code': ' \n'}, {'code': None}, {'language': 'bash'}):
            response = self.client.post(PREFIX, json=self.source | change)
            self.assertEqual(response.status_code, 422, str(change)[:80])

    def test_output_formats_and_names_are_validated(self):
        record = self.create()
        bad_artifacts = [
            {'name': '../escape.png', 'mime': 'image/png', 'base64': PNG},
            {'name': 'dir/file.csv', 'mime': 'text/csv', 'text': 'x'},
            {'name': 'dir\\file.csv', 'mime': 'text/csv', 'text': 'x'},
            {'name': ' ', 'mime': 'text/csv', 'text': 'x'},
            {'name': 'x.html', 'mime': 'text/html', 'text': '<script>alert(1)</script>'},
            {'name': 'x.svg', 'mime': 'image/svg+xml', 'text': '<svg/>'},
            {'name': 'x.png', 'mime': 'image/png', 'base64': base64.b64encode(b'<svg/>').decode()},
            {'name': 'x.png', 'mime': 'image/png', 'base64': PNG + '%'},
            {'name': 'x.png', 'mime': 'image/png', 'base64': PNG, 'data_base64': 'different'},
            {'name': 'x.txt', 'mime': 'text/plain', 'text': '声' * 50001},
        ]
        for artifact in bad_artifacts:
            response = self.upload(record, self.result(record, artifacts=[artifact]))
            self.assertEqual(response.status_code, 422, response.text)
        for change in ({'artifacts': [{}] * 9}, {'artifacts': {}},
                       {'stdout': 'x' * 20001}, {'stderr': 'x' * 8001}, {'status': 'verified'}):
            response = self.upload(record, self.result(record, **change))
            self.assertEqual(response.status_code, 422, response.text)

    def test_result_and_combined_limits(self):
        record = self.create(code='x' * 50000, input_csv='x' * 100000)
        files = [{'name': 'part' + str(i) + '.txt', 'mime': 'text/plain', 'text': 'x' * 149800}
                 for i in range(4)]
        # The result is below 600KB but the combined document exceeds 700KB.
        result = self.result(record, artifacts=files)
        self.assertLess(len(json.dumps(result).encode()), 600000)
        self.assertEqual(self.upload(record, result).status_code, 422)
        # Unknown fields cannot be used to bypass the incoming result budget.
        self.assertEqual(self.upload(record, self.result(record, extra='x' * 600000)).status_code, 422)
        self.assertEqual(self.store.read(record['id'])['revision'], 1)

    def test_route_validation_quota_and_delete(self):
        for raw in ('[]', 'null', '{broken', '42'):
            self.assertEqual(self.client.post(PREFIX, content=raw).status_code, 422)
        self.assertEqual(self.client.post(PREFIX, content=b'x' * 750001).status_code, 413)
        self.assertEqual(self.client.get(PREFIX + '/bad').status_code, 422)
        self.assertEqual(self.client.get(PREFIX + '/unknown_identity').status_code, 404)
        for i in range(50):
            self.create(title=str(i))
        self.assertEqual(self.client.post(PREFIX, json=self.source).status_code, 422)
        records = self.client.get(PREFIX).json()
        self.assertEqual(len(records), 50)
        identity = records[0]['id']
        self.assertEqual(self.client.delete(PREFIX + '/' + identity).json(), {'deleted': True})
        self.assertEqual(self.client.get(PREFIX + '/' + identity).status_code, 404)
        self.assertEqual(self.client.delete(PREFIX + '/' + identity).status_code, 404)
        self.assertEqual(len(self.store.list()), 49)
        self.create(title='quota reopened after deletion')


if __name__ == '__main__':
    unittest.main()
