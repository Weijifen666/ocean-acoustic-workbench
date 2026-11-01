import test from 'node:test';
import assert from 'node:assert/strict';
import {listJobArtifacts,exportJobResults} from '../server/job-exports.mjs';

const id = 'aabbccddeeff';
const detail = (artifacts, state = 'SUCCEEDED') => ({id, state, artifacts});
const status = expected => error => error.status === expected;

test('only actual unique names produce gateway-compatible single-file links and unsafe names keep pagination positions', () => {
  const source=detail(['plot.png','plot.png','结果.csv','case..env','.', '../secret', 'data.csv','.metadata','a b.txt']);
  const snapshot=structuredClone(source);
  const first=listJobArtifacts(source,{id,offset:0,limit:4});
  assert.equal(first.artifact_count,8);assert.equal(first.next_offset,4);
  assert.deepEqual(first.artifacts,[{name:'plot.png',url:'/api/jobs/'+id+'/artifact/plot.png'}]);
  assert.deepEqual(first.unavailable_names,['结果.csv','case..env','.']);
  const second=listJobArtifacts(source,{id,offset:first.next_offset,limit:4});
  assert.equal(second.next_offset,null);
  assert.deepEqual(second.artifacts.map(file=>file.name),['data.csv','.metadata']);
  assert.deepEqual(second.unavailable_names,['../secret','a b.txt']);
  assert.equal(first.scope,'existing_task_files');
  assert.deepEqual(source,snapshot);
  assert.ok(first.artifacts.every(file=>Object.keys(file).sort().join(',')==='name,url'));
});

test('invalid IDs, mismatched job responses and absent or non-string artifact lists fail explicitly', () => {
  for (const candidate of [undefined,null,'abc','../aabbccddeeff','AABBCCDDEEFF',123])
    assert.throws(()=>listJobArtifacts(detail(['x.csv']),{id:candidate}),status(422));
  for (const response of [undefined,null,{...detail(['x.csv']),id:'112233445566'},[],{id},detail(null),detail('plot.png'),detail(['x.csv',42]),detail(Array(2))])
    assert.throws(()=>exportJobResults(response,{id}),status(502));
});

test('pagination is bounded against the full deduplicated list and an empty list is readable but not exportable', () => {
  const source=detail(['a.txt','a.txt','b.txt']);
  for (const options of [{offset:-1},{offset:3},{offset:0.5},{offset:'0'},{limit:0},{limit:101},{limit:1.2}])
    assert.throws(()=>listJobArtifacts(source,{id,...options}),status(422));
  assert.deepEqual(listJobArtifacts(source,{id,offset:2}).artifacts,[]);
  const empty=listJobArtifacts(detail([]),{id});
  assert.equal(empty.artifact_count,0);assert.equal(empty.next_offset,null);
  assert.deepEqual(empty.artifacts,[]);assert.deepEqual(empty.unavailable_names,[]);
  assert.throws(()=>exportJobResults(detail([]),{id}),status(409));
});

test('export returns only a click-time ZIP address and first 40 actual entries without inventing size, hashes or completion', () => {
  const source=detail(Array.from({length:45},(_,i)=>'file'+i+'.csv'),'RUNNING');
  const exported=exportJobResults(source,{id});
  assert.equal(exported.artifact_count,45);assert.equal(exported.artifacts.length,40);
  assert.equal(exported.next_offset,40);
  assert.deepEqual(exported.download,{url:'/api/jobs/'+id+'/download',filename:'ocean-'+id+'.zip'});
  assert.equal(exported.download_on_click,true);assert.equal(exported.archive_created,false);assert.equal(exported.partial,true);
  assert.equal(exported.state,'RUNNING');
  assert.match(exported.note,/即时打包 ZIP/);assert.match(exported.note,/没有创建压缩包或开始下载/);
  assert.match(exported.note,/没有校验文件内容/);assert.match(exported.note,/部分产物/);
  assert.ok(!JSON.stringify(exported).includes('sha256')&&!JSON.stringify(exported).includes('size'));
});

test('queued and running exports are partial; completed or failed task files retain their actual state', () => {
  for (const state of ['QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED']) {
    const exported=exportJobResults(detail(['文件.csv'],state),{id});
    assert.equal(exported.state,state);
    assert.equal(exported.partial,['QUEUED','RUNNING'].includes(state));
    assert.deepEqual(exported.artifacts,[]);assert.deepEqual(exported.unavailable_names,['文件.csv']);
    assert.equal(exported.artifact_count,1);
    assert.ok(exported.download.url.endsWith('/download'));
  }
});
