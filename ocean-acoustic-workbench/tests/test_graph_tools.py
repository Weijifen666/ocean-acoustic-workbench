import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from graph_tools import GraphTools, GraphError, tool_specs

ROOT = Path(__file__).resolve().parents[2]
GRAPH = json.loads((ROOT/'ocean-acoustic-public/data/graph.json').read_text(encoding='utf-8'))
TOY = {'chapters':[{'id':'unit'}], 'nodes':[{'id':key,'label':key,'kind':'knowledge','chapter':'unit','overview':'example','references':[]} for key in 'abcd'],
       'edges':[{'id':'e1','source':'a','target':'b','group':'prerequisite','label':'先学'}, {'id':'e2','source':'b','target':'c','group':'related','label':'关联'}]}


class GraphToolTests(unittest.TestCase):
    def test_actual_graph_search_paging_and_copy(self):
        api=GraphTools(GRAPH); identities=[]; offset=0
        while offset is not None:
            result=api.list_nodes(offset=offset,limit=13)
            identities.extend(row['id'] for row in result['items']);offset=result['next_offset']
        self.assertEqual((len(identities),len(set(identities))),(69,69))
        self.assertEqual(api.list_nodes(query='normal modes')['items'][0]['id'],'normal_mode_field')
        self.assertEqual(api.list_nodes(query='Munk 理想剖面')['items'][0]['id'],'munk_profile')
        item=api.read_node('munk_profile');item['references'].clear()
        self.assertTrue(api.read_node('munk_profile')['references'])
        for args in ({'limit':0},{'offset':True},{'chapter':'unknown'}):
            with self.assertRaises(GraphError):api.list_nodes(**args)

    def test_direction_and_typed_path(self):
        api=GraphTools(TOY)
        self.assertFalse(api.find_path('a','c')['found'])
        forward=api.find_path('a','c',groups=['prerequisite','related'],direction='outgoing')
        self.assertEqual([row['id'] for row in forward['nodes']],list('abc'))
        self.assertTrue(all(not row['traversed_reverse'] for row in forward['edges']))
        reverse=api.find_path('c','a',groups=['prerequisite','related'])
        self.assertTrue(all(row['traversed_reverse'] for row in reverse['edges']))
        self.assertIn('不等于物理因果',reverse['relation_note'])
        self.assertFalse(api.find_path('c','a',groups=['prerequisite','related'],direction='outgoing')['found'])
        self.assertEqual(api.read_relations('b',groups=['prerequisite'],direction='incoming')['items'][0]['id'],'e1')
        self.assertFalse(api.find_path('a','c',groups=['prerequisite','related'],max_depth=1)['found'])

    def test_selection_is_request_scoped_and_rejects_invalid(self):
        api=GraphTools(GRAPH)
        first=api.selection(['munk_profile','sound_speed_profile','munk_profile'])
        self.assertEqual(first['node_ids'],['munk_profile','sound_speed_profile'])
        first['nodes'][0]['label']='forged'
        self.assertEqual(api.selection()['nodes'],[])
        self.assertNotEqual(api.selection(['munk_profile'])['nodes'][0]['label'],'forged')
        for nodes in (['course'],['unknown'],['munk_profile']*9,'munk_profile'):
            with self.assertRaises(GraphError):api.selection(nodes)
        self.assertEqual(len(tool_specs()),5)
        self.assertEqual(api.execute('read_graph_node',{'id':'munk_profile'})['id'],'munk_profile')

    def test_javascript_and_python_operations_agree(self):
        node=shutil.which('node')
        if not node:self.skipTest('Node is unavailable')
        module=(ROOT/'ocean-acoustic-public/server/graph-tools.mjs').as_uri()
        code="import fs from 'node:fs';import {createGraphTools} from "+json.dumps(module)+";const api=createGraphTools(JSON.parse(fs.readFileSync(0,'utf8')));console.log(JSON.stringify({list:api.listNodes({query:'normal modes'}),selection:api.selection(['munk_profile','sound_speed_profile']),path:api.findPath({source:'munk_profile',target:'sound_speed_profile'})}));"
        result=subprocess.run([node,'--input-type=module','-e',code],input=json.dumps(GRAPH),text=True,encoding='utf-8',capture_output=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr)
        api=GraphTools(GRAPH)
        expected={'list':api.list_nodes(query='normal modes'),'selection':api.selection(['munk_profile','sound_speed_profile']),
                  'path':api.find_path('munk_profile','sound_speed_profile')}
        self.assertEqual(json.loads(result.stdout),expected)


if __name__=='__main__':unittest.main()
