import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createCourseRetriever} from '../server/course-retrieval.mjs';
import {createPublicOceanKnowledge} from '../server/open-ocean-retrieval.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL('../data/'+name+'.json',import.meta.url),'utf8'));
const graph=read('graph'),retrieve=createCourseRetriever(graph);
const variants=['简正波','什么是简正波','什么是简正波？','简正波是什么？','请给我讲讲简正波呗','normal modes','what are normal modes?','normal mode','normal-mode','normal-modes','Normal–Modes','normal   mode'];

test('original introductory normal-mode questions retrieve the actual theory card before solver or waveguide cards',()=>{
 for(const query of variants){
  const rows=retrieve(query),first=rows[0];
  assert.equal(first?.node_id,'normal_mode_field',query);assert.equal(first.id,'K017',query);
  assert.equal(first.retrieval.focus,true,query);assert.equal(first.retrieval.role,'question_focus',query);
  assert.equal(first.evidence_type,'knowledge_card');assert.equal(first.citation.source_id,'S17');assert.equal(first.citation.pdf_page,356);
  assert(first.text.includes('模态'));assert(first.formula.includes('ψ'));assert(first.conditions);
  assert.equal(first.claim_support_verified,false); // Presence is never a claim-level proof.
 }
});

test('repeated normal-mode words in an unrelated distractor cannot displace the explicit concept',()=>{
 const polluted=structuredClone(graph),distractor=polluted.nodes.find(node=>node.id==='krakenc');
 distractor.overview+=' '+('简正波 normal modes '.repeat(80));
 const search=createCourseRetriever(polluted);
 for(const query of variants){const rows=search(query);assert.equal(rows[0]?.node_id,'normal_mode_field',query);assert(rows.every(row=>row.citation.claim_support_verified===false),query)}
 assert.notEqual(search('Munk声速剖面')[0]?.node_id,'normal_mode_field');
});

test('normal-mode aliases respect English token boundaries and do not fabricate coverage',()=>{
 const isolated={nodes:[structuredClone(graph.nodes.find(node=>node.id==='normal_mode_field'))],edges:[]},search=createCourseRetriever(isolated);
 for(const query of ['abnormal mode','normal model','normal models','normal-modelling','世界杯足球冠军是哪国'])assert.equal(search(query).length,0,query);
 const absent=structuredClone(graph);absent.nodes=absent.nodes.filter(node=>node.id!=='normal_mode_field');absent.edges=absent.edges.filter(edge=>edge.source!=='normal_mode_field'&&edge.target!=='normal_mode_field');
 assert(createCourseRetriever(absent)('简正波').every(row=>row.node_id!=='normal_mode_field'));
});

test('public snapshots do not invent normal-mode excerpts when their registered corpus does not cover the term',()=>{
 // Real but unrelated excerpts ensure that a nonempty marine corpus is not
 // mistaken for coverage. The full public corpus may gain acoustics later.
 const registry=read('open-ocean-sources'),sources=(Array.isArray(registry)?registry:registry.sources).filter(row=>row.id==='O-NOAA-ACIDIFICATION'),chunks=read('open-ocean-chunks').filter(row=>row.source_id==='O-NOAA-ACIDIFICATION');
 assert(chunks.length>0);const knowledge=createPublicOceanKnowledge({sources,chunks});
 for(const query of variants)assert.deepEqual(knowledge.retrievePublicOcean(query),[],query);
 const status=knowledge.publicOceanStatus();assert.equal(status.training_performed,false);assert.equal(status.live_web_search,false);
});
