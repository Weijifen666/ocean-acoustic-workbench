"""Real packaged Skill resources stay readable without unbounded tool payloads."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
import research_skills


class SkillResources(unittest.TestCase):
    def test_real_casebook_roundtrips_with_full_hash_and_character_offsets(self):
        raw = (ROOT / 'skills/at-environment/references/casebook.json').read_bytes()
        offset, chunks = 0, []
        while True:
            result = research_skills.resource('at-environment', 'references/casebook.json', offset=offset, max_bytes=4096)
            self.assertEqual(result['offset'], offset)
            self.assertEqual(result['offset_unit'], 'unicode_code_points')
            self.assertEqual(result['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertEqual(result['total_bytes'], len(raw))
            self.assertEqual(result['returned_bytes'], len(result['content'].encode('utf-8')))
            self.assertLessEqual(result['returned_bytes'], 4096)
            self.assertTrue(result['truncated'])
            self.assertFalse(result['complete'])
            chunks.append(result['content'])
            if result['next_offset'] is None:
                self.assertFalse(result['has_more'])
                break
            self.assertGreater(result['next_offset'], offset)
            self.assertEqual(result['next_offset'], offset + len(result['content']))
            offset = result['next_offset']
        self.assertEqual(''.join(chunks), raw.decode('utf-8'))
        self.assertGreater(len(chunks), 10)
        first = research_skills.resource('at-environment', 'references/casebook.json')
        self.assertLessEqual(first['returned_bytes'], 12000)
        self.assertIn('next_offset', first['note'])

    def test_registered_matlab_and_small_skill_are_complete_without_new_arguments(self):
        result = research_skills.resource('at-environment', 'scripts/summarize_model.m')
        raw = (ROOT / 'skills/at-environment/scripts/summarize_model.m').read_bytes()
        self.assertEqual(result['content'], raw.decode('utf-8'))
        self.assertEqual(result['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertTrue(result['complete'])
        self.assertFalse(result['truncated'])
        self.assertIsNone(result['next_offset'])
        self.assertTrue(research_skills.resource('at-ram')['complete'])

    def test_utf8_budget_never_replaces_or_splits_chinese_or_supplementary_characters(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / 'at-environment/references'
            folder.mkdir(parents=True)
            text = '海洋🌊声学é' * 60
            (folder / 'unicode.md').write_bytes(text.encode('utf-8'))
            with patch.object(research_skills, 'SKILLS', root):
                result = research_skills.resource('at-environment', 'references/unicode.md', max_bytes=256)
                self.assertEqual(result['content'], text[:result['next_offset']])
                self.assertLessEqual(result['returned_bytes'], 256)
                self.assertNotIn('\ufffd', result['content'])
                tail = research_skills.resource('at-environment', 'references/unicode.md', offset=result['next_offset'], max_bytes=20000)
                self.assertEqual(result['content'] + tail['content'], text)
                self.assertTrue(tail['truncated'], 'A final page with a nonzero offset remains a fragment')
                end = research_skills.resource('at-environment', 'references/unicode.md', offset=len(text))
                self.assertEqual(end['content'], '')
                self.assertIsNone(end['next_offset'])

    def test_bounds_and_nonregistered_paths_fail_without_filesystem_fallback(self):
        for kwargs in [{'offset': -1}, {'offset': True}, {'offset': 1.5}, {'offset': 10000000},
                       {'max_bytes': 255}, {'max_bytes': 20001}, {'max_bytes': True}, {'max_bytes': 4096.0}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                research_skills.resource('at-environment', **kwargs)
        for path in ['../at-ram/SKILL.md', 'references/../../backend/app.py', '/etc/passwd',
                     'C:/Windows/win.ini', 'references/%2e%2e/secret.md', 'references\\models.json',
                     '.local/secret.py', 'scripts/private.json', 'references/unknown.json', 'backend/app.py']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                research_skills.resource('at-environment', path)
        with self.assertRaises(ValueError):
            research_skills.resource('unregistered', 'SKILL.md')

    def test_reader_schema_keeps_existing_required_arguments_and_exposes_paging(self):
        reader = next(tool['function'] for tool in research_skills.tools() if tool['function']['name'] == 'read_skill_resource')
        self.assertEqual(reader['parameters']['required'], ['id', 'path'])
        self.assertEqual(reader['parameters']['properties']['max_bytes']['maximum'], 20000)
        self.assertIn('offset', reader['parameters']['properties'])
        self.assertFalse(reader['parameters']['additionalProperties'])


if __name__ == '__main__':
    unittest.main()
