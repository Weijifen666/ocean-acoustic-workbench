import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {createPublicOceanKnowledge,configurePublicOcean,retrievePublicOcean,publicOceanStatus} from '../server/open-ocean-retrieval.mjs';

const sources=JSON.parse(fs.readFileSync(new URL('../data/open-ocean-sources.json',import.meta.url),'utf8'));
const chunks=JSON.parse(fs.readFileSync(new URL('../data/open-ocean-chunks.json',import.meta.url),'utf8'));
const corpus=createPublicOceanKnowledge({sources,chunks});

test('actual public NOAA snapshots answer new Chinese ocean topics with web provenance',()=>{
 const expected=new Map([
  ['海洋酸化为什么影响碳酸盐','O-NOAA-ACIDIFICATION'],
  ['珊瑚白化能恢复吗','O-NOAA-CORAL-BLEACH'],
  ['全球海平面和相对海平面有什么区别','O-NOAA-SEALEVEL-GLOBAL-LOCAL'],
  ['海流受什么驱动','O-NOAA-CURRENT'],
  ['漂流浮标怎么监测海流','O-NOAA-CURRENTMON'],
  ['海啸传播速度与水深有什么关系','O-NOAA-TSUNAMI'],
  ['Argo 数据质控如何选择延时模式','O-ARGO-QC'],
 ]);
 for(const [question,source] of expected){const rows=corpus.retrievePublicOcean(question,8);assert(rows.some(r=>r.source_id===source),question);for(const row of rows){assert.equal(row.pdf_page,null);assert(row.citation.url.startsWith('https://'));assert.equal(row.snapshot_not_realtime,true);assert(row.text)}}
 assert.deepEqual(corpus.retrievePublicOcean('世界杯足球冠军'),[]);
 assert.deepEqual(corpus.retrievePublicOcean('海洋酸化',0),[]);
});

test('public page counts remain distinct from PDF pages and realtime observations',()=>{
 const status=corpus.publicOceanStatus(Date.now());assert(status.successful_web_documents>=20);assert(status.reference_guides>=5);assert.equal(status.realtime_observations_connected,false);assert.equal(status.live_web_search,false);assert.equal(status.training_performed,false);assert.equal(status.chunks,chunks.length);assert.equal(status.indexed_pages,undefined);
 for(const source of status.web_sources.filter(s=>s.snapshot_status==='ingested')){assert.match(source.sha256,/^[0-9a-f]{64}$/);assert(source.fetched_at);assert(source.source_updated_at);assert(source.license.url);assert.equal(typeof source.stale,'boolean')}
 const future=corpus.publicOceanStatus(Date.now()+10*24*3600000);assert(future.stale_sources>=20);
});

test('retrieval returns copies and explicit reference-guide classification',()=>{
 const before=corpus.retrievePublicOcean('海洋酸化',1)[0];before.text='client mutation';assert.notEqual(corpus.retrievePublicOcean('海洋酸化',1)[0].text,'client mutation');
 const guide=corpus.retrievePublicOcean('TEOS-10 保守温度',3).find(r=>r.source_id==='O-TEOS-10');assert(guide);assert.equal(guide.evidence_type,'public_reference_guide');assert.match(guide.all_references[0].locator,/自写导读/);
 configurePublicOcean({sources,chunks});assert(retrievePublicOcean('海洋酸化').length);assert.equal(publicOceanStatus().chunks,chunks.length);
});
