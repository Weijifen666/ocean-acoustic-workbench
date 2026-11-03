"""Real PDF render/cache checks plus generated image provenance; no private files."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid
from fastapi.testclient import TestClient

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
import knowledge
from test_knowledge import authored_pdf


class GraphMedia(unittest.TestCase):
    def test_69_nodes_have_available_diagram_and_original_source_links_are_retained(self):
        nodes=[n for n in knowledge.graph_data()['nodes'] if n['kind']=='knowledge']
        self.assertEqual(len(nodes),69)
        for node in nodes:
            self.assertEqual(node['images'][0]['kind'],'authored_diagram',node['id'])
            self.assertTrue((ROOT/'public'/node['images'][0]['url'].lstrip('/')).is_file(),node['id'])
            for ref in node['references']:
                if ref.get('pdf_page'):self.assertIn(f"/api/source/{ref['source_id']}/page/{ref['pdf_page']}",{i['url'] for i in node['images']})
        wave=next(n for n in nodes if n['id']=='wave_equation')
        self.assertEqual([r['source_id'] for r in wave['references']],['S21','S21'])
        self.assertTrue(any(i['kind']=='supplementary_source_page' and i['source_id']=='S17' and i['pdf_page']==86 for i in wave['images']))

    def test_missing_original_is_explicit_and_supplied_pdf_renders_and_caches_real_png(self):
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'OCEAN_RUNTIME_DIR':directory,'OCEAN_DISABLE_WORKER':'1','OCEAN_DISABLE_PUBLIC_REFRESH':'1'}):
            local=Path(directory);(local/'sources').mkdir();(local/'config.json').write_text('{}')
            # Authored fixture is a real PDF, not a substituted textbook image.
            authored_pdf(local/'sources/S17.pdf',['Linear wave equation fixture','Frequency transform fixture'])
            name='image_api_'+uuid.uuid4().hex
            spec=importlib.util.spec_from_file_location(name,ROOT/'backend/app.py');module=importlib.util.module_from_spec(spec);sys.modules[name]=module
            try:
                spec.loader.exec_module(module)
                with TestClient(module.app) as client:
                    missing=client.get('/api/source/S21/page/2');self.assertEqual(missing.status_code,404);self.assertIn('尚未接入',missing.json()['detail'])
                    self.assertEqual(client.get('/api/source/S99/page/1').status_code,404)
                    self.assertEqual(client.get('/api/source/S17/page/0').status_code,404)
                    self.assertEqual(client.get('/api/source/S17/page/3').status_code,404)
                    png=client.get('/api/source/S17/page/2');self.assertEqual(png.status_code,200);self.assertEqual(png.headers['content-type'],'image/png');self.assertTrue(png.content.startswith(b'\x89PNG\r\n\x1a\n'))
                    self.assertEqual(client.get('/api/source/S17/page/2').content,png.content)
                    self.assertTrue((local/'page-images/S17-2.png').is_file())
                    sources=client.get('/api/sources').json();status={s['id']:s['available'] for s in sources}
                    self.assertTrue(status['S17']);self.assertFalse(status['S21'])
                    self.assertFalse((local/'page-images/S21-2.png').exists())
            finally:sys.modules.pop(name,None)


if __name__=='__main__':unittest.main()
