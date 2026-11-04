"""Publisher privacy and retry contract, using synthetic text and fake HTTP only."""
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

import httpx

spec = importlib.util.spec_from_file_location('publish_course', Path(__file__).with_name('publish-course-knowledge.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.bundle = Path(self.temporary.name)
        self.token = 'TEST-ONLY-PRIVATE-PUBLISH-TOKEN'
        raw = json.dumps({'schema_version': 1, 'version': 'test-v1',
                          'chunks': [{'id': 'D-S01-one', 'text': 'SYNTHETIC-PRIVATE-TEXT'}]}).encode()
        packed = gzip.compress(raw, mtime=0)
        self.manifest = {'schema_version': 1, 'version': 'test-v1', 'chunks_key': 'chunks.json.gz',
                         'chunks_sha256': hashlib.sha256(packed).hexdigest(),
                         'compressed_bytes': len(packed), 'uncompressed_bytes': len(raw),
                         'chunks': 1, 'indexed_sources': 1, 'indexed_pages': 1,
                         'ingestion_version': 2, 'source_coverage': [{'source_id': 'S01'}]}
        (self.bundle/'manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')
        (self.bundle/'chunks.json.gz').write_bytes(packed)
        self.calls = []; self.options = []; self.stdout = io.StringIO(); self.stderr = io.StringIO()

    def tearDown(self):
        self.temporary.cleanup()

    def success(self):
        return {'ok': True, 'version': 'test-v1', 'chunks': 1, 'indexed_sources': 1,
                'indexed_pages': 1, 'compressed_bytes': self.manifest['compressed_bytes'],
                'manifest_sha256': 'a'*64, 'reused': True,
                'debug': self.token + ' SYNTHETIC-PRIVATE-TEXT'}

    def run_cli(self, handler, **changes):
        def factory(**kwargs):
            self.options.append(kwargs)
            return httpx.Client(transport=httpx.MockTransport(handler), **kwargs)
        pauses = []
        result = publisher.main(['--site-url', changes.get('site', 'https://course.example/'),
                                 '--bundle', str(self.bundle), '--token-stdin'],
                                stdin=io.StringIO(self.token+'\n'), stdout=self.stdout, stderr=self.stderr,
                                client_factory=factory, sleep=pauses.append)
        return result, pauses

    def assert_private_output(self):
        combined = self.stdout.getvalue() + self.stderr.getvalue()
        self.assertNotIn(self.token, combined)
        self.assertNotIn('SYNTHETIC-PRIVATE-TEXT', combined)
        self.assertNotIn('Bearer', combined)

    def test_lost_response_and_transient_failure_reuse_identical_payload_and_safe_output(self):
        def handler(request):
            self.calls.append(request)
            if len(self.calls) == 1:
                raise httpx.ReadError(self.token + ' SYNTHETIC-PRIVATE-TEXT', request=request)
            if len(self.calls) == 2:
                return httpx.Response(503, text=self.token)
            return httpx.Response(200, json=self.success())
        result, pauses = self.run_cli(handler)
        self.assertEqual(result, 0, self.stderr.getvalue())
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(pauses, [.25, .5])
        self.assertTrue(all(r.content == self.calls[0].content for r in self.calls))
        self.assertTrue(all(str(r.url) == 'https://course.example/_knowledge-admin/import' for r in self.calls))
        self.assertTrue(all(r.headers['Authorization'] == 'Bearer '+self.token for r in self.calls))
        self.assertEqual(self.options, [{'trust_env': False, 'timeout': 90, 'follow_redirects': False}])
        summary = json.loads(self.stdout.getvalue().splitlines()[-1])
        self.assertEqual(set(summary), {'ok', 'version', 'chunks', 'indexed_sources', 'indexed_pages', 'bytes', 'manifest_sha256', 'reused'})
        self.assertTrue(summary['reused'])
        self.assert_private_output()

    def test_bad_request_is_not_retried_or_reflected(self):
        def handler(request):
            self.calls.append(request)
            return httpx.Response(400, text=self.token + ' SYNTHETIC-PRIVATE-TEXT')
        result, pauses = self.run_cli(handler)
        self.assertEqual(result, 1)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(pauses, [])
        self.assertIn('status=400', self.stderr.getvalue())
        self.assert_private_output()

    def test_invalid_origin_or_hash_stops_before_network(self):
        def handler(request):
            self.fail('Invalid input must not send a request')
        for site in ('http://course.example', 'https://name:secret@course.example',
                     'https://course.example/path', 'https://course.example/?key=secret'):
            with self.subTest(site=site):
                self.assertEqual(self.run_cli(handler, site=site)[0], 1)
        self.manifest['chunks_sha256'] = '0'*64
        (self.bundle/'manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')
        self.assertEqual(self.run_cli(handler)[0], 1)
        self.assertEqual(self.options, [])
        truncated = (self.bundle/'chunks.json.gz').read_bytes()[:-8]
        (self.bundle/'chunks.json.gz').write_bytes(truncated)
        self.manifest.update(chunks_sha256=hashlib.sha256(truncated).hexdigest(), compressed_bytes=len(truncated))
        (self.bundle/'manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')
        self.assertEqual(self.run_cli(handler)[0], 1)
        self.assertEqual(self.options, [])
        self.assert_private_output()


if __name__ == '__main__':
    unittest.main()
