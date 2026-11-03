"""Budget views preserve original protocol and explicitly identify omissions."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import context_budget
import research_context


class ResearchContext(unittest.TestCase):
    def test_latest_skill_page_json_formatting_does_not_consume_its_evidence_budget(self):
        # The installed path varies between clones. At a tight budget retain
        # every actual page value and the full tool schema, rather than losing
        # the answer because JSON separators carry avoidable spaces.
        page={'skill':'at-environment','path':'references/casebook.json',
              'local_path':'C:/课程项目🌊/'+'long-worktree-folder/'*12+'references/casebook.json',
              'content':'真实算例片段，缺测状态不得填值。\n'*60,'sha256':'1'*64,
              'offset':0,'next_offset':1200,'returned_bytes':3600,'total_bytes':120000,
              'has_more':True,'complete':False,'content_format':'text_fragment'}
        page.update(next_offset=len(page['content']),returned_bytes=len(page['content'].encode('utf-8')))
        call={'id':'latest-skill','function':{'name':'read_skill_resource','arguments':'{"id":"at-environment","path":"references/casebook.json"}'}}
        tools=[{'type':'function','function':{'name':'read_skill_resource','parameters':{'type':'object',
                'properties':{'id':{'type':'string'},'path':{'type':'string'},'offset':{'type':'integer'}},'required':['id','path']}}}]
        messages=[{'role':'system','content':'required instructions'}, {'role':'user','content':'Read the actual complete page and its source'},
                  {'role':'assistant','content':None,'reasoning_content':'opaque private continuation','tool_calls':[call]},
                  {'role':'tool','tool_call_id':'latest-skill','content':json.dumps(page,ensure_ascii=False,indent=2)}]
        compact=copy.deepcopy(messages);compact[-1]['content']=json.dumps(page,ensure_ascii=False,separators=(',',':'))
        limit=context_budget.resolve_budget('auto')-context_budget.CONTEXT_RESERVE
        padding='x'*(limit-context_budget.estimate_messages(compact,tools)-1)
        messages[0]['content']+=padding;compact[0]['content']+=padding
        original=copy.deepcopy(messages)
        original_tools=copy.deepcopy(tools)
        self.assertGreater(context_budget.estimate_messages(messages,tools),limit)
        packed=research_context.prepare(messages,tools,'auto',current_user_index=1)
        self.assertLessEqual(packed['context']['estimated_input_tokens'],limit)
        self.assertEqual(json.loads(packed['messages'][-1]['content']),page)
        self.assertEqual(packed['messages'][:-1],original[:-1])
        self.assertEqual(packed['messages'][-1]['tool_call_id'],'latest-skill')
        self.assertEqual(packed['context']['dropped_tool_messages'],0)
        self.assertEqual(packed['context']['compacted_tool_messages'],0)
        self.assertEqual(messages,original,'Provider projection cannot rewrite stored protocol')
        self.assertEqual(tools,original_tools,'Full tool definitions cannot be clipped to meet the budget')

    def test_directory_pages_keep_total_and_valid_continuations(self):
        source={'root':'authorized','files':[{'path':f'file-{i}.m'} for i in range(45)]}
        first=research_context.file_directory(source,{})
        last=research_context.file_directory(source,{'offset':40,'limit':5})
        self.assertEqual(len(first['files']),20);self.assertEqual(first['total'],45);self.assertEqual(first['next_offset'],20)
        self.assertEqual(last['files'],source['files'][40:]);self.assertIsNone(last['next_offset'])
        self.assertEqual(len(source['files']),45)
        for args in [{'offset':-1},{'offset':True},{'limit':0},{'limit':51}]:
            with self.assertRaises(ValueError):research_context.file_directory(source,args)

    def test_file_pages_are_unicode_safe_and_never_claim_a_prefix_hash_is_the_full_file(self):
        text='海🌊'*200
        source={'kind':'text','path':'actual.m','content':text,'sha256':'actual-existing-hash','truncated':False}
        page=research_context.file_page(source,{'offset':10,'max_bytes':256})
        self.assertEqual(page['content'],text[10:page['next_offset']]);self.assertLessEqual(page['returned_bytes'],256)
        self.assertFalse(page['complete']);self.assertTrue(page['has_more']);self.assertEqual(page['sha256'],source['sha256'])
        truncated=research_context.file_page({**source,'truncated':True},{})
        self.assertTrue(truncated['source_truncated']);self.assertEqual(truncated['sha256_scope'],'first_200000_bytes');self.assertFalse(truncated['complete'])
        self.assertEqual(source['content'],text)

    def test_budget_drops_complete_prior_groups_preserves_latest_multicall_and_actual_job_locator(self):
        system='mandatory system'+context_budget.CONTEXT_LABEL+json.dumps({'evidence':[{'id':'original-source','text':'e'*13000}]})
        prior=[{'role':'user','content':'old question'},{'role':'assistant','content':None,'reasoning_content':'old reasoning','tool_calls':[{'id':'old-history-call','function':{'name':'read','arguments':'{}'}}]},
               {'role':'tool','tool_call_id':'old-history-call','content':'old result'},{'role':'user','content':'old internal followup'},{'role':'assistant','content':'old final','reasoning_content':'old final reasoning'}]
        old=[{'role':'assistant','content':None,'reasoning_content':'r'*3000,'tool_calls':[{'id':'submit','function':{'name':'submit','arguments':'{}'}}]},
             {'role':'tool','tool_call_id':'submit','content':json.dumps({'ids':['abcdef123456'],'state':'QUEUED','unnecessary_raw':'x'*3000})}]
        latest=[{'role':'assistant','content':None,'reasoning_content':'keep exact reasoning','tool_calls':[{'id':'last-one','function':{'name':'read','arguments':'{}'}},{'id':'last-two','function':{'name':'read','arguments':'{}'}}]},
                {'role':'tool','tool_call_id':'last-one','content':'latest actual observation one'},{'role':'tool','tool_call_id':'last-two','content':'latest actual observation two'}]
        messages=[{'role':'system','content':system},*prior,{'role':'user','content':'original current question'},*old,*latest]
        snapshot=copy.deepcopy(messages)
        result=research_context.prepare(messages,[],8192,current_user_index=6,history_turn_lengths=[5])
        self.assertEqual(messages,snapshot);self.assertEqual(result['context']['dropped_history_messages'],5)
        self.assertEqual(result['context']['dropped_tool_messages'],1);self.assertEqual(result['messages'][-3:],latest)
        self.assertIn('abcdef123456',result['messages'][0]['content']);self.assertEqual(result['messages'][1]['content'],'original current question')
        self.assertGreater(result['context']['dropped_evidence_count'],0)
        context_budget.assert_messages_budget(result['messages'],8192)

    def test_latest_oversized_observation_fails_clearly_instead_of_clipping_it(self):
        messages=[{'role':'system','content':'system'},{'role':'user','content':'actual question'},
                  {'role':'assistant','content':None,'reasoning_content':'keep','tool_calls':[{'id':'latest','function':{'name':'read','arguments':'{}'}}]},
                  {'role':'tool','tool_call_id':'latest','content':json.dumps({'raw_text':'x'*12000})}]
        with self.assertRaises(context_budget.ContextBudgetError) as caught:
            research_context.prepare(messages,[],4096,current_user_index=1)
        self.assertGreater(caught.exception.context['estimated_input_tokens'],4096)
        self.assertIn('工具结果',str(caught.exception));self.assertEqual(messages[-1]['content'],json.dumps({'raw_text':'x'*12000}))

    def test_incomplete_call_group_cannot_be_sent_as_an_orphan(self):
        messages=[{'role':'system','content':'system'},{'role':'user','content':'question'},
                  {'role':'assistant','content':None,'tool_calls':[{'id':'missing','function':{'name':'read','arguments':'{}'}}]}]
        with self.assertRaises(context_budget.ContextBudgetError):research_context.prepare(messages,[],32768,current_user_index=1)

    def test_numerical_projection_retains_scalar_values_and_marks_large_matrix_omissions(self):
        source={'id':'abcdef123456','state':'SUCCEEDED','summary':{'tl_min_db':70.125,'physical_accuracy_proven':False,'density_mld':{'status':'not_computed'}},
                'tl_db':[[70.125]*51 for _ in range(51)],'log':'actual log\n'*2000}
        projected=research_context.project_result(source)
        self.assertEqual(projected['summary'],source['summary']);self.assertNotIn('tl_db',projected)
        self.assertTrue(projected['tl_db_index']['omitted']);self.assertEqual(projected['tl_db_index']['length'],51)
        self.assertTrue(projected['log_truncated']);self.assertIn('tl_db',source)


if __name__=='__main__':unittest.main()
