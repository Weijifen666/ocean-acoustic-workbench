import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createResearchCatalog} from '../server/research-catalog.mjs';
import {createCourseRetriever} from '../server/course-retrieval.mjs';

const data = name => JSON.parse(fs.readFileSync(new URL('../data/' + name, import.meta.url), 'utf8'));
const assets = data('research-assets.json');
const graph = data('graph.json');
const api = createResearchCatalog(assets);
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const status = expected => error => error.status === expected;

test('UTF-8 source fingerprints and sizes are identical for LF and CRLF checkouts', () => {
  const generator = fileURLToPath(new URL('../../scripts/generate-public-research.mjs', import.meta.url));
  const lf = '温盐剖面\nfirst line\nlast line\n';
  const fingerprint = input => {
    const result = spawnSync(process.execPath, [generator, '--hash-source'], {input, encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const expected = {sha256: sha(lf), size: Buffer.byteLength(lf), source_hash_normalization: 'utf8-lf'};
  assert.deepEqual(fingerprint(lf), expected);
  assert.deepEqual(fingerprint(lf.replaceAll('\n', '\r\n')), expected);
  assert.equal(assets.provenance.source_hash_normalization, 'utf8-lf');
  assert.equal(graph.public_metadata.source_hash_normalization, 'utf8-lf');
});

test('all 12 skills expose complete registered resources with reproducible source and public hashes', () => {
  const catalog = api.catalog();
  assert.equal(catalog.skills.length, 12);
  assert.equal(new Set(catalog.skills.map(skill => skill.id)).size, 12);
  assert.equal(catalog.resource_count, 35);
  for (const skill of catalog.skills) {
    assert.equal(skill.sha256, api.readSkill(skill.id).sha256);
    assert.ok(skill.resource_count >= 1);
    for (const resource of skill.resources) {
      const read = api.readSkill(skill.id, resource.path);
      assert.equal(read.path, resource.path);
      assert.equal(read.id, skill.id);
      assert.equal(read.sha256, sha(read.content));
      assert.equal(read.size, Buffer.byteLength(read.content));
      assert.match(read.source_sha256, /^[a-f0-9]{64}$/);
      assert.equal(read.read_only, true);
      assert.equal(read.metadata.execution, 'reference_only');
      assert.equal(read.metadata.source_hash_normalization, 'utf8-lf');
      assert.equal(read.local_path, undefined);
      assert.equal(fs.readFileSync(new URL('../skills/' + skill.id + '/' + resource.path, import.meta.url), 'utf8'), read.content);
    }
  }
  assert.ok(api.readSkill('at-environment', 'scripts/summarize_model.m').content.includes('read_shd(workflow_output)'));
  assert.ok(api.readSkill('seasonal-layer-diagnostics', 'scripts/analyze_profiles.py').content.includes('sigma0'));
});

test('scientific protocol is complete and public skills route missing local tools without claiming equivalent diagnostics', () => {
  const resource = api.readSkill('at-environment', 'references/scientific-evidence.md');
  const source = fs.readFileSync(new URL('../../ocean-acoustic-workbench/skills/at-environment/references/scientific-evidence.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(resource.source_sha256, sha(source));
  assert.equal(resource.sha256, sha(resource.content));
  assert(resource.content.endsWith(source));
  for (const requirement of ['tl_db[depth, range]', 'frequency_hz', 'tl_reference', 'agent_self_report', 'scientific_validation', '共同有效掩码', '真实误差界'])
    assert(resource.content.includes(requirement), requirement);
  assert.equal(api.readProjectFile('@workbench/skills/at-environment/references/scientific-evidence.md').sha256, resource.sha256);
  for (const text of [resource.content, ...['at-environment','seasonal-layer-diagnostics','surface-duct-investigation'].map(id => api.readSkill(id).content)]) {
    assert(text.indexOf('公网工具路由') < text.indexOf('# '));
    for (const boundary of ['只调用当前请求实际注册的工具', '节点在线也不会自动授予', 'diagnose_seasonal_layers', '原位温度', '不能冒充本地位温/位密度双判据', 'density_mld=not_computed', '不归档研究任务', '不自行重写算法'])
      assert(text.includes(boundary), boundary);
  }
});

test('nine recipe and experience models retain eight supported recipes without claiming current executors', () => {
  const models = api.modelWorkflows().models;
  assert.equal(models.length, 9);
  assert.equal(assets.model_experience.models.length, 9);
  assert.equal(models.filter(model => model.supported).length, 8);
  assert.equal(models.filter(model => model.recipe_supported).length, 8);
  assert.ok(models.every(model => model.available === false && model.runtime_available === false));
  const krakel = models.find(model => model.id === 'krakel');
  assert.equal(krakel.supported, false);
  assert.equal(krakel.recipe_supported, false);
  assert.match(krakel.unavailable_reason, /尚未核验/);
  assert.match(api.readSkill('at-krakel').content, /只读知识/);
});

test('skill path traversal, encoded paths, absolute paths, unknown IDs and inherited keys cannot escape allowlist', () => {
  for (const resourcePath of ['../SKILL.md', 'references/../../backend/app.py', '/etc/passwd', 'C:/secret',
    'references\\models.json', '%2e%2e/secret', 'references/%252e%252e/secret', 'references//models.json',
    './SKILL.md', 'SKILL.md\0', 'references/models.json?secret', 'references/../models.json'])
    assert.throws(() => api.readSkill('at-environment', resourcePath), status(422), resourcePath);
  for (const id of ['../at-environment', '__proto__', 'constructor', 'at-environment%2f..', '', null])
    assert.throws(() => api.readSkill(id), error => [404,422].includes(error.status));
  assert.throws(() => api.readSkill('unregistered-skill'), status(404));
  assert.throws(() => api.readSkill('at-environment', 'references/not-published.json'), status(404));
});

test('shared project list contains classified source and real ENV/FLP snapshots, no private runs or arbitrary files', () => {
  const result = api.listProjectFiles();
  assert.equal(result.total, 57);
  assert.ok(result.groups.every(group => ['workbench','project'].includes(group.id)));
  assert.equal(result.roots.runs, undefined);
  assert.ok(result.files.some(file => file.path.endsWith('.env')));
  assert.ok(result.files.some(file => file.path.endsWith('.flp')));
  assert.ok(result.files.some(file => file.category === 'code'));
  assert.ok(result.files.some(file => file.category === 'tests'));
  for (const file of result.files) {
    assert.equal(file.source, file.group);
    assert.ok(file.size > 0 && file.label && file.category);
    const read = api.readProjectFile(file.path);
    assert.equal(sha(read.content), file.sha256);
    assert.equal(read.kind, 'text');
    assert.equal(read.truncated, false);
  }
  assert.ok(api.listProjectFiles({source: 'project', query: 'Munk'}).files.every(file => file.group === 'project' && /munk/i.test(file.label)));
  assert.equal(api.listProjectFiles({query: 'a-file-not-published-anywhere'}).total, 0);
  for (const requested of ['@workbench/../backend/app.py', '@workbench/.local/config.json', '@runs/private/summary.json',
    '@workbench/backend/../../secret', '@workbench/backend\\app.py', '@project/%2e%2e/secret', '/etc/passwd', '__proto__'])
    assert.throws(() => api.readProjectFile(requested), error => [404,422].includes(error.status));
  assert.throws(() => api.readProjectFile('@workbench/backend/app.py'), status(404));
  assert.throws(() => api.listProjectFiles({source:'runs'}), status(422));
});

test('69-card, 180-edge graph preserves sources, images, code links and retriever compatibility', () => {
  const nodes = graph.nodes.filter(node => node.kind === 'knowledge');
  assert.equal(nodes.length, 69);
  assert.equal(graph.edges.length, 180);
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  const sources = data('sources.json');
  const sourceIds = new Set(sources.map(source => source.id));
  assert.equal(sources.length, 25);
  assert.ok(graph.nodes.flatMap(node => node.references).every(ref => sourceIds.has(ref.source_id)));
  assert.ok(sources.filter(source => ['S21','S22','S23','S24'].includes(source.id)).every(source => source.name.endsWith('.pdf') && source.available === false));
  assert.ok(sources.every(source => source.path === undefined && source.local_path === undefined));
  assert.ok(graph.edges.every(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)));
  for (const node of nodes) {
    assert.ok(node.references.length && node.source_claim_ids.length);
    assert.ok(Array.isArray(node.images));
    assert.ok(node.images.every(image => image.url && image.caption));
  }
  const munk = nodes.find(node => node.id === 'munk_case');
  assert.ok(munk.references.every(ref => ref.code_url));
  assert.match(api.readKnowledgeCode('munk_case', 0).content, /BBMunk/);
  assert.match(api.readKnowledgeCode('munk_case', 1).content, /function/);
  assert.throws(() => api.readKnowledgeCode('../../etc', 0), status(422));
  const retrieve = createCourseRetriever(graph);
  for (const query of ['球面扩展','KRAKENC','RAM 抛物方程','表面声道']) assert.ok(retrieve(query).length, query);
});

test('snapshots are immutable to callers and all public data exclude machine paths or credential strings', () => {
  const one = api.readSkill('at-environment');
  one.content = 'mutated'; one.metadata.execution = 'ran';
  assert.notEqual(api.readSkill('at-environment').content, 'mutated');
  assert.equal(api.readSkill('at-environment').metadata.execution, 'reference_only');
  api.catalog().skills.pop();
  assert.equal(api.catalog().skills.length, 12);
  const serialized = JSON.stringify(assets);
  assert.doesNotMatch(serialized, /(?<![A-Za-z0-9])[A-Z]:[\\/]|\/(?:Users|home)\/|\bsk-[A-Za-z0-9_-]{24,}\b/);
  assert.doesNotMatch(serialized, /尚未移植，涉及这些数据|新版固定表单仍为Munk/);
  assert.ok(Object.values(assets.resources).filter(resource => resource.path.endsWith('.md')).every(resource => resource.content.includes('公共资料适用范围')));
});

test('empty assets are safe for existing integrations and never provide filesystem fallback', () => {
  const empty = createResearchCatalog();
  assert.deepEqual(empty.catalog().skills, []);
  assert.deepEqual(empty.modelWorkflows().models, []);
  assert.deepEqual(empty.listProjectFiles().files, []);
  assert.throws(() => empty.readSkill('at-environment'), status(404));
  assert.throws(() => empty.readProjectFile('@workbench/backend/app.py'), status(404));
});
