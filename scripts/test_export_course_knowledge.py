import gzip
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from contextlib import closing

spec = importlib.util.spec_from_file_location('export_course', Path(__file__).with_name('export-course-knowledge.py'))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.database = self.root / 'chunks.sqlite3'
        self.row = {'id': 'D-S17-test', 'source_id': 'S17', 'pdf_page': 356,
                    'label': 'C:\\private\\book.pdf', 'text': 'ψₘ(z) 𝑝(r,z) 保留①原文',
                    'source_revision': 'a' * 64, 'ingestion_version': 2,
                    'node_id': 'normal_mode_field', 'node_ids': ['normal_mode_field'],
                    'printed_page': None, 'char_start': 0, 'char_end': 21,
                    'search_text': 'THIS IS NOT DISPLAY TEXT', 'api_key': 'TEST-MUST-NOT-EXPORT',
                    'all_references': [{'local_path': 'C:/private/book.pdf'}]}

    def tearDown(self):
        self.temporary.cleanup()

    def write_database(self):
        with closing(sqlite3.connect(self.database)) as connection:
            connection.executescript('CREATE TABLE chunks(id TEXT,source_id TEXT,pdf_page INTEGER,payload TEXT);CREATE TABLE metadata(key TEXT,value TEXT);')
            connection.execute('INSERT INTO chunks VALUES(?,?,?,?)', (self.row['id'], self.row['source_id'], self.row['pdf_page'], json.dumps(self.row, ensure_ascii=False)))
            connection.execute('INSERT INTO metadata VALUES(?,?)', ('report', json.dumps({'source_coverage': [{'source_id': 'S17', 'title': 'C:/private/book.pdf', 'total_pages': 500, 'local_path': 'C:/private'}]})))
            connection.commit()

    def test_export_is_private_read_only_whitelisted_and_unicode_faithful(self):
        self.write_database()
        before = hashlib.sha256(self.database.read_bytes()).hexdigest()
        output = self.root / '.local' / 'export'
        manifest = exporter.export_course_knowledge(self.database, output, 'test-v1')
        packed = (output / 'chunks.json.gz').read_bytes()
        raw = gzip.decompress(packed)
        payload = json.loads(raw)
        self.assertEqual(payload['chunks'][0]['text'], self.row['text'])
        self.assertEqual(payload['chunks'][0]['label'], 'book.pdf')
        self.assertEqual(payload['chunks'][0]['evidence_type'], 'source_excerpt')
        self.assertFalse(payload['chunks'][0]['math_layout_verified'])
        self.assertEqual(manifest['chunks_sha256'], hashlib.sha256(packed).hexdigest())
        self.assertEqual(manifest['uncompressed_bytes'], len(raw))
        self.assertEqual(manifest['compressed_bytes'], len(packed))
        self.assertEqual(manifest['indexed_sources'], 1)
        self.assertEqual(manifest['indexed_pages'], 1)
        self.assertEqual((output / '.gitignore').read_text(), '*\n')
        self.assertEqual(before, hashlib.sha256(self.database.read_bytes()).hexdigest())
        joined = raw.decode() + (output / 'manifest.json').read_text(encoding='utf-8')
        for forbidden in ['api_key', 'TEST-MUST-NOT-EXPORT', 'search_text', 'local_path', 'C:/private', 'C:\\private']:
            self.assertNotIn(forbidden, joined)

    def test_legacy_or_oversized_text_refuses_export(self):
        for field, value in [('ingestion_version', 1), ('text', 'x' * 4001)]:
            with self.subTest(field=field):
                if self.database.exists():
                    self.database.unlink()
                original = self.row[field]
                self.row[field] = value
                self.write_database()
                with self.assertRaises(ValueError):
                    exporter.export_course_knowledge(self.database, self.root / 'rejected', 'test-v1')
                self.row[field] = original

    def test_existing_uppercase_experiment_nodes_and_default_conditions(self):
        self.row.update(node_id='SW06_CTD', node_ids=['SW06_CTD', 'ASIAEX_CTD'],
                        conditions='以下为原文片段；适用条件、单位及公式需结合原页和人工核查，不能据此补造结论。')
        self.write_database()
        output = self.root / 'legacy-case'
        exporter.export_course_knowledge(self.database, output, 'test-v1')
        row = json.loads(gzip.decompress((output / 'chunks.json.gz').read_bytes()))['chunks'][0]
        self.assertEqual(row['node_ids'], ['SW06_CTD', 'ASIAEX_CTD'])
        self.assertEqual(row['conditions'], '教材原文片段')
        self.assertEqual(row['text'], self.row['text'])

    def test_unsafe_version_and_existing_bundle_are_rejected(self):
        self.write_database()
        output = self.root / 'export'
        with self.assertRaises(ValueError):
            exporter.export_course_knowledge(self.database, output, '../private')
        exporter.export_course_knowledge(self.database, output, 'test-v1')
        with self.assertRaises(ValueError):
            exporter.export_course_knowledge(self.database, output, 'test-v1')


if __name__ == '__main__':
    unittest.main()
