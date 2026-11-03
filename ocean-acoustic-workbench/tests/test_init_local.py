"""Fresh clones start without private course files; existing work remains untouched."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from init_local import initialize


class InitializeLocal(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.root = self.folder / 'clone/ocean-acoustic-workbench'
        self.public = self.root.parent / 'ocean-acoustic-public/data'
        self.root.mkdir(parents=True)
        self.public.mkdir(parents=True)
        self.rows = [{'id': 'S01', 'name': '课程.pdf', 'type': '.pdf',
                      'path': 'private-course-location', 'sha256': 'private-original-hash',
                      'available': True, 'url': 'https://example.org/course',
                      'description': 'Metadata fixture', 'pdf_pages': 8},
                     {'id': 'PROJECT', 'name': '源码与流程', 'type': '.code'}]
        (self.public / 'sources.json').write_text(json.dumps(self.rows), encoding='utf-8')

    def tearDown(self):
        self.temporary.cleanup()

    def test_no_package_initializes_public_metadata_only(self):
        local = self.folder / 'fresh-runtime'
        with patch('init_local.shutil.which', return_value=None):
            summary = initialize(local, self.root)
        self.assertEqual(set(summary['created']), {'config.json', 'kb/source_registry.json'})
        self.assertTrue(summary['existing_files_preserved'])
        self.assertFalse(summary['private_materials_imported'])
        for path in ('kb', 'project', 'sources'):
            self.assertTrue((local / path).is_dir())
        config = json.loads((local / 'config.json').read_text(encoding='utf-8'))
        self.assertEqual(config['matlab_path'], '')
        self.assertEqual(config['toolbox_path'], '')
        self.assertNotIn('api_key', config)
        self.assertEqual(Path(config['project_path']), local / 'project')
        registry = json.loads((local / 'kb/source_registry.json').read_text(encoding='utf-8'))
        self.assertEqual(len(registry['sources']), 2)
        self.assertTrue(all(row['available'] is False for row in registry['sources']))
        self.assertNotIn('path', registry['sources'][0])
        self.assertNotIn('sha256', registry['sources'][0])
        self.assertEqual(registry['sources'][0]['pdf_pages'], 8)
        self.assertEqual(list(local.rglob('*.pdf')), [])

    def test_existing_configuration_registry_and_project_are_byte_preserved(self):
        local = self.folder / 'runtime'
        initialize(local, self.root, matlab='C:/MATLAB/bin/matlab.exe', toolbox='C:/AT', project='C:/my-project')
        config = local / 'config.json'
        before_config = '{"api_key":"fixture-not-a-real-key","custom":true}\n'.encode('utf-8')
        before_registry = '{"sources":[],"custom":"keep"}\n'.encode('utf-8')
        config.write_bytes(before_config)
        (local / 'kb/source_registry.json').write_bytes(before_registry)
        project = local / 'project/old.m'
        project.write_bytes(b'disp("preserved");\r\n')
        old_project = project.read_bytes()
        summary = initialize(local, self.root, matlab='replacement', toolbox='replacement', project='replacement')
        self.assertEqual(summary['created'], [])
        self.assertEqual(config.read_bytes(), before_config)
        self.assertEqual((local / 'kb/source_registry.json').read_bytes(), before_registry)
        self.assertEqual(project.read_bytes(), old_project)

    def test_runtime_environment_and_explicit_initial_parameters(self):
        env_runtime = self.folder / 'environment-runtime'
        explicit_runtime = self.folder / 'explicit-runtime'
        with patch.dict(os.environ, {'OCEAN_RUNTIME_DIR': str(env_runtime)}):
            initialize(root=self.root, matlab='C:/MATLAB/bin/matlab.exe', toolbox='C:/AT', project='C:/project')
            initialize(explicit_runtime, self.root)
        config = json.loads((env_runtime / 'config.json').read_text(encoding='utf-8'))
        self.assertEqual(config['matlab_path'], 'C:/MATLAB/bin/matlab.exe')
        self.assertEqual(config['toolbox_path'], 'C:/AT')
        self.assertEqual(config['project_path'], 'C:/project')
        self.assertTrue((explicit_runtime / 'config.json').is_file())
        (self.public / 'sources.json').unlink()
        missing_public = self.folder / 'no-public-metadata'
        initialize(missing_public, self.root)
        registry = json.loads((missing_public / 'kb/source_registry.json').read_text(encoding='utf-8'))
        self.assertEqual(registry['sources'], [])

    def test_documented_cli_works_with_standard_library_only(self):
        runtime = self.folder / 'cli-runtime'
        completed = subprocess.run([sys.executable, '-I', '-S', str(ROOT / 'backend/init_local.py'),
                                    '--runtime-dir', str(runtime), '--matlab', 'C:/MATLAB/bin/matlab.exe',
                                    '--toolbox', 'C:/AT'], capture_output=True, text=True, check=True)
        self.assertFalse(json.loads(completed.stdout)['private_materials_imported'])
        config = json.loads((runtime / 'config.json').read_text(encoding='utf-8'))
        self.assertEqual(config['toolbox_path'], 'C:/AT')
        self.assertEqual(config['matlab_path'], 'C:/MATLAB/bin/matlab.exe')


class FreshCloneHTTP(unittest.TestCase):
    def test_no_config_no_private_package_starts_health_and_full_course_graph(self):
        with tempfile.TemporaryDirectory() as temporary:
            local = Path(temporary) / 'runtime'
            environment = {'OCEAN_RUNTIME_DIR': str(local), 'OCEAN_DISABLE_WORKER': '1',
                           'OCEAN_DISABLE_PUBLIC_REFRESH': '1', 'OCEAN_DATA_URL': '',
                           'OCEAN_DATA_DIR': str(Path(temporary) / 'absent-ocean-data')}
            # Import the app in its own process so environment-bound module globals
            # cannot reuse a maintainer's runtime or contaminate other test modules.
            script = '''
import json, sys
from unittest.mock import patch
sys.path.insert(0, sys.argv[1] + '/backend')
from fastapi.testclient import TestClient
with patch('init_local.shutil.which', return_value=None):
    import app
    with TestClient(app.app) as client:
        health = client.get('/api/health')
        graph = client.get('/api/graph')
        body = graph.json()
        print('FRESH_CLONE_REPORT=' + json.dumps({
            'health_status': health.status_code, 'health': health.json(),
            'graph_status': graph.status_code, 'nodes': len(body['nodes']),
            'edges': len(body['edges']),
            'knowledge': sum(n['kind'] == 'knowledge' for n in body['nodes'])}))
'''
            completed = subprocess.run([sys.executable, '-c', script, str(ROOT)],
                                       env=dict(os.environ) | environment,
                                       capture_output=True, text=True, timeout=60)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            report_line = next(line for line in completed.stdout.splitlines() if line.startswith('FRESH_CLONE_REPORT='))
            report = json.loads(report_line.partition('=')[2])
            self.assertEqual(report['health_status'], 200)
            self.assertEqual(report['graph_status'], 200)
            self.assertEqual(report['nodes'], 76)
            self.assertEqual(report['edges'], 180)
            self.assertEqual(report['knowledge'], 69)
            self.assertFalse(report['health']['model_configured'])
            self.assertFalse(report['health']['matlab_available'])
            self.assertFalse(report['health']['solver_available'])
            config = json.loads((local / 'config.json').read_text(encoding='utf-8'))
            self.assertFalse(config.get('api_key'))
            self.assertEqual(config['matlab_path'], '')
            sources = json.loads((local / 'kb/source_registry.json').read_text(encoding='utf-8'))['sources']
            self.assertGreater(len(sources), 0)
            self.assertTrue(all(source['available'] is False for source in sources))
            self.assertEqual(list(local.rglob('*.pdf')), [])
            self.assertFalse((local / 'kb/chunks.sqlite3').exists())


if __name__ == '__main__':
    unittest.main()
