import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createCourseRetriever,focusEvidenceGate} from '../server/course-retrieval.mjs';
const graph=JSON.parse(fs.readFileSync(new URL('../data/graph.json',import.meta.url),'utf8')),course=createCourseRetriever(graph);
const excerpt=(id,page,char_start,text)=>({id,source_id:'S17',pdf_page:page,char_start,text:'TEST ONLY: '+text,evidence_type:'source_excerpt'});
const raw=rows=>rows.filter(row=>row.evidence_type==='source_excerpt');

test('adjacent main-reference definition paragraphs survive a distracting secondary elastic-mode page',()=>{
 const cards=course('什么是简正波？'),intro=excerpt('INTRO',356,0,'vertical modes and horizontal propagation'),continuation=excerpt('CONTINUATION',356,928,'source-weighted modal sum'),elastic=excerpt('ELASTIC',421,931,'elastic bottom stress and displacement');
 // Higher lexical rank on the secondary page and reverse input order on the
 // primary page must not split the introductory definition.
 const result=focusEvidenceGate('什么是简正波？',[...cards,elastic,continuation,intro]);
 assert.deepEqual(raw(result).map(row=>row.id),['INTRO','CONTINUATION']);assert.equal(result[0].node_id,'normal_mode_field');assert.equal(raw(result).length,2);
});

test('comparison questions preserve one main source page per focused concept before adjacent paragraphs',()=>{
 const normal=course('简正波')[0],munk=course('Munk声速剖面')[0];
 const a=excerpt('NORMAL-INTRO',356,0,'normal mode definition'),a2=excerpt('NORMAL-CONTINUATION',356,928,'normal mode continuation'),b=excerpt('MUNK-INTRO',375,0,'Munk profile definition'),elastic=excerpt('ELASTIC',421,0,'secondary elastic example');
 const result=focusEvidenceGate('简正波与Munk声速剖面有什么关系',[normal,munk,elastic,a2,a,b]);
 assert.deepEqual(raw(result).map(row=>row.id),['NORMAL-INTRO','MUNK-INTRO']);
});

test('missing main-page excerpts still allow other cited pages and never unrelated pages',()=>{
 const cards=course('简正波'),secondary=excerpt('SECONDARY',359,0,'cited derivation'),elastic=excerpt('ELASTIC',421,0,'cited example'),noise=excerpt('NOISE',999,0,'uncited page');
 const result=focusEvidenceGate('简正波',[...cards,noise,secondary,elastic]);
 assert.deepEqual(raw(result).map(row=>row.id),['SECONDARY','ELASTIC']);assert(!result.some(row=>row.id==='NOISE'));
});
