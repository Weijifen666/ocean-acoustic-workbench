"""Actual local child-process and geometry failure checks; no model or MATLAB."""
import json
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
import code_sandbox
import ray_tracer
import materials


class LocalExecution(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.local = Path(self.temp.name)
        self.db = self.local / 'workbench.sqlite3'
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute('CREATE TABLE jobs(id TEXT PRIMARY KEY,state TEXT,created TEXT,updated TEXT,plan TEXT,error TEXT)')
        self.env = patch.dict(os.environ, {'OCEAN_RUNTIME_DIR': str(self.local)})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def state(self, identity):
        with closing(sqlite3.connect(self.db)) as db:
            return db.execute('SELECT state FROM jobs WHERE id=?', (identity,)).fetchone()[0]

    def test_custom_runtime_contains_actual_script_outputs_and_job(self):
        result = code_sandbox.run_code_sandbox("from pathlib import Path\nPath('values.csv').write_text('x,y\\n1,2\\n')")
        self.assertEqual(result['state'], 'SUCCEEDED', result)
        self.assertEqual(self.state(result['job_id']), 'SUCCEEDED')
        self.assertEqual((self.local/'runs'/result['job_id']/'values.csv').read_text().splitlines(), ['x,y', '1,2'])
        self.assertTrue(result['download_url'].endswith('/download'))

    def test_failed_registration_never_starts_child(self):
        self.db.unlink()
        with closing(sqlite3.connect(self.db)):
            pass
        with patch('code_sandbox.subprocess.Popen') as launch:
            with self.assertRaisesRegex(ValueError, '尚未执行'):
                code_sandbox.run_code_sandbox('print("must not run")')
        launch.assert_not_called()

    def test_timeout_waits_for_actual_child_exit_before_return(self):
        code = "import os,time\nfrom pathlib import Path\nPath('child.pid').write_text(str(os.getpid()))\ntime.sleep(30)"
        started = time.monotonic()
        result = code_sandbox.run_python_code_sandbox(code, timeout=1)
        self.assertLess(time.monotonic()-started, 15)
        self.assertEqual(result['state'], 'FAILED')
        self.assertEqual(self.state(result['job_id']), 'FAILED')
        pid = int((self.local/'runs'/result['job_id']/'child.pid').read_text())
        if os.name == 'nt':
            check = subprocess.run(['tasklist', '/FI', f'PID eq {pid}', '/FO', 'CSV', '/NH'], capture_output=True)
            self.assertNotIn(str(pid).encode(), check.stdout)
        else:
            with self.assertRaises(ProcessLookupError): os.kill(pid, 0)

    def test_unknown_language_and_missing_matlab_are_clear_failures(self):
        with self.assertRaisesRegex(ValueError, '仅支持'):
            code_sandbox.run_code_sandbox('print(1)', language='javascript')
        (self.local/'config.json').write_text(json.dumps({'matlab_path': str(self.local/'missing-matlab.exe')}))
        with self.assertRaisesRegex(ValueError, '尚未执行'):
            code_sandbox.run_code_sandbox('disp(1)', language='matlab')

    def test_runtime_paths_are_shared_by_knowledge_cache_models_and_ingestion(self):
        source = "import sys,json;sys.path.insert(0,sys.argv[1]);import knowledge,public_ocean,models,ingestion;print(json.dumps([str(knowledge.CHUNKS),str(public_ocean.CACHE_ROOT),str(models.LOCAL),str(ingestion.DEFAULT_OUTPUT)]))"
        result = subprocess.run([sys.executable, '-c', source, str(ROOT/'backend')], capture_output=True, text=True, check=True)
        for value in json.loads(result.stdout):
            self.assertTrue(Path(value).is_relative_to(self.local), value)

    def test_invalid_rays_rejected_before_bounce_loop(self):
        for args in [(100, 101, [15], 1), (100, 50, [90], 1),
                     (100, 50, [float('nan')], 1), (.001, .0005, [89], 500)]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                ray_tracer.validate_parameters(*args)
        with self.assertRaises(ValueError):
            ray_tracer.trace_ray_isovelocity(100, 50, 90, 1000)

    def test_existing_chunk_index_is_readable_by_research_page_tools(self):
        kb=self.local/'kb';kb.mkdir()
        (kb/'source_registry.json').write_text(json.dumps({'sources':[{'id':'S01','name':'Fixture','pdf_pages':5}]}))
        chunks=kb/'chunks.sqlite3'
        with closing(sqlite3.connect(chunks)) as db, db:
            db.execute('CREATE TABLE chunks(id TEXT PRIMARY KEY,source_id TEXT,pdf_page INTEGER,payload TEXT)')
            for identity,start,text in [('one',0,'sound speed'),('two',6,'speed profile')]:
                value={'id':identity,'source_id':'S01','pdf_page':2,'label':'Fixture','char_start':start,'text':text}
                db.execute('INSERT INTO chunks VALUES(?,?,?,?)',(identity,'S01',2,json.dumps(value)))
        with patch.object(materials,'LOCAL',self.local),patch.object(materials,'INDEX',kb/'material_pages.json'):
            self.assertEqual(materials.catalog()[0]['indexed_pages'],1)
            self.assertEqual(materials.search('profile')['matches'][0]['page'],2)
            page=materials.read('S01',2)
            self.assertEqual(page['text'],'sound speed profile')
            self.assertEqual(page['text_basis'],'ingested_page_excerpts')
            self.assertIn('/S01/page/2',page['image_url'])

    def test_material_tools_gracefully_report_an_unconfigured_library(self):
        with patch.object(materials,'LOCAL',self.local),patch.object(materials,'INDEX',self.local/'absent.json'):
            self.assertEqual(materials.catalog(),[])
            self.assertIn('error',materials.read('S01',1))

    def test_valid_horizontal_and_reflected_rays_stay_in_water(self):
        ray = ray_tracer.trace_ray_isovelocity(100, 50, 45, 1000)
        self.assertEqual(ray['total_bounces'], 10)
        self.assertTrue(all(0 <= z <= 100 for z in ray['z_points']))
        horizontal = ray_tracer.trace_ray_isovelocity(100, 50, 0, 1000)
        self.assertEqual(horizontal['total_bounces'], 0)


if __name__ == '__main__': unittest.main()
