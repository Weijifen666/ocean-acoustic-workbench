// Build-time, explicit-allowlist export. No filesystem access is needed by the Worker.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizeSourceText = text => text.replaceAll('\r\n', '\n');
function sourceFingerprint(text) {
  const raw = normalizeSourceText(text);
  return {raw, sha256: hash(raw), size: Buffer.byteLength(raw), source_hash_normalization: 'utf8-lf'};
}
// Independently check the exact source-hash convention without exporting any files:
// node scripts/generate-public-research.mjs --hash-source < source.txt
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--hash-source') {
  const {raw, ...fingerprint} = sourceFingerprint(fs.readFileSync(0, 'utf8'));
  console.log(JSON.stringify(fingerprint));
  process.exit(0);
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(repo, 'ocean-acoustic-workbench');
const publicRoot = path.join(repo, 'ocean-acoustic-public');
const skillIds = ['at-environment', 'seasonal-layer-diagnostics', 'surface-duct-investigation',
  'at-kraken', 'at-krakenc', 'at-scooter', 'at-bellhop', 'at-ram', 'at-simplepe', 'at-sparc', 'at-bellhop3d', 'at-krakel'];
const json = value => JSON.stringify(value, null, 2) + '\n';
const publicNote = '公共资料适用范围：本文件是只读知识与可复核的构造配方。执行、写文件和本机工具调用仅适用于已授权且在线的计算节点；先查询本次能力与模型可用性。历史执行记录不证明当前节点可用，也不证明任意新环境的数值收敛或物理精度。节点未连接时完成资料检索、条件核对与输入计划，并明确指出待执行项。';
const historical = '历史本地审阅和运行记录；不是本次公网节点的执行或精度验证。';
const sourceFiles = [];

function read(relative) {
  const source = sourceFingerprint(fs.readFileSync(path.join(local, relative), 'utf8'));
  sourceFiles.push({path: relative, sha256: source.sha256, size: source.size});
  return {raw: source.raw, source_sha256: source.sha256};
}
function redact(text) {
  return text.replaceAll('\r\n', '\n')
    .replace(/(?<![A-Za-z0-9])(?:[A-Z]:[\\/])[^\s"'<>|)\],;]+/g, '[LOCAL_PATH]')
    .replace(/\/(?:Users|home)\/[^\s"'<>|)\],;]+/g, '[LOCAL_PATH]');
}
function assertPublic(text, label) {
  if (/(?<![A-Za-z0-9])[A-Z]:[\\/]|\/(?:Users|home)\//.test(text)) throw Error('Private absolute path in ' + label);
  if (/\bsk-[A-Za-z0-9_-]{24,}\b|\bBearer\s+[A-Za-z0-9_-]{24,}\b/.test(text)) throw Error('Possible credential in ' + label);
}
function addNote(text, note) {
  const front = text.match(/^---\n[\s\S]*?\n---\n/);
  if (front) return front[0] + '\n> ' + note + '\n' + text.slice(front[0].length);
  return '> ' + note + '\n\n' + text;
}
function cleanText(text, relative) {
  text = redact(text);
  if (relative.endsWith('.md')) {
    text = text.replace('本批仅移植AT模型构造；WOA18、混合层及表面波导数据技能尚未移植，涉及这些数据时先说明缺项。',
      'WOA18 剖面可通过已开放的海洋数据工具按需读取。混合层与表面声道技能提供诊断方法；脚本执行与传播验证以本次节点能力为准。');
    text = text.replace('KRAKEL（弹性模态）缺程序，已从清单移除', 'KRAKEL 保留为未开放创建配方的研究条目，弹性场后处理与收敛尚待核验');
    text = text.replace('KRAKEL（已移除）', 'KRAKEL（未开放创建配方）');
    text = addNote(text, publicNote);
  }
  return text;
}
function write(relative, text) {
  assertPublic(text, relative);
  const target = path.join(publicRoot, relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, text);
}

const rawModels = read('skills/at-environment/references/models.json');
const library = JSON.parse(redact(rawModels.raw));
library.scope = historical + ' 保留模型条件、输入格式、调用链及原始输入快照；公共站仅展示，实时节点能力另行检查。';
for (const model of library.models) {
  model.status = '历史记录 · ' + model.status.replace(/^移植前记录\s*·\s*/, '');
  model.integration = model.id === 'krakel'
    ? '公共站提供方法与历史源码经验。KRAKEL 弹性场后处理及收敛未核验，尚无受支持的创建配方。'
    : '公共站提供使用条件、经典输入快照与创建配方；实际准备和执行任务需要已授权且在线的计算节点。';
  model.execution_context = 'historical_local_record';
  model.runtime_available = false;
  model.experience = (model.experience || []).map(text => text.replaceAll('本轮', '历史审计中').replaceAll('本机', '原本地环境'));
}
const rawRecipes = read('skills/at-environment/references/creation-workflows.json');
const recipes = JSON.parse(redact(rawRecipes.raw));
recipes.scope = '模型创建配方资料。supported 表示存在已固化的输入与检查流程，不表示当前公网节点可执行。';
for (const model of recipes.models) {
  model.recipe_supported = model.supported;
  model.available = false;
  model.runtime_available = false;
  model.runtime = model.id === 'ram' ? 'Python + RAM' : model.id === 'simplepe' ? 'MATLAB' : 'MATLAB + AT';
  model.runtime_status = 'requires_connected_compute_node';
  model.execution_context = 'historical_local_record';
  model.availability_reason = model.supported ? '公共站只读资料；实际执行须检查已连接计算节点。' : '未提供受支持的创建配方；不能创建经典基线。';
  if (!model.supported) {
    model.unavailable_reason = '历史记录中曾编译并冒烟运行 KRAKEL，但弹性场后处理与收敛尚未核验；公共站不开放基线创建。';
    model.limitations = ['KRAKEL 弹性场后处理、FIELD 兼容与 Ahmad 弹性收敛待独立验证。', historical];
  }
}
const cached = new Map([
  ['at-environment/references/models.json', {content: json(library), source_sha256: rawModels.source_sha256}],
  ['at-environment/references/creation-workflows.json', {content: json(recipes), source_sha256: rawRecipes.source_sha256}],
]);
const resources = {};
function walkSkill(id, dir, relative = '') {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
    const rel = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (['references', 'scripts'].includes(rel)) walkSkill(id, path.join(dir, entry.name), rel);
      continue;
    }
    if (!entry.isFile() || !/\.(?:md|json|py|m)$/.test(rel) || /(?:^|\/)(?:\.|__pycache__)/.test(rel)) continue;
    const key = id + '/' + rel;
    const source = cached.get(key) || (() => {
      const original = read('skills/' + key);
      let content = cleanText(original.raw, rel);
      if (rel.endsWith('.json')) {
        const record = JSON.parse(content);
        record.public_scope = historical;
        record.execution_context = 'historical_local_record';
        if (record.scope) record.scope = historical + ' ' + record.scope;
        content = json(record);
      }
      return {content, source_sha256: original.source_sha256};
    })();
    assertPublic(source.content, key);
    resources[key] = {id, skill: id, path: rel, content: source.content, sha256: hash(source.content),
      source_sha256: source.source_sha256, size: Buffer.byteLength(source.content), read_only: true,
      scope: 'public_read_only', metadata: {source: 'repository_skill_snapshot', execution: 'reference_only',
        history_scope: historical, source_hash_normalization: 'utf8-lf',
        url: '/api/project/file?path=' + encodeURIComponent('@workbench/skills/' + key)}};
    write('skills/' + key, source.content);
  }
}
for (const id of skillIds) walkSkill(id, path.join(local, 'skills', id));
const coverage = JSON.parse(resources['at-environment/references/casebook-summary.json'].content);

const skills = [
  {id: 'at-environment', name: 'AT 环境构造与算例复现', description: '查阅模型、tests 调用证据及 ENV/FLP，形成可复核的环境与验证计划。', prompt: '请载入 at-environment 技能，依据已收录的 AT tests 对应算例规划研究任务。我的目标是：'},
  {id: 'seasonal-layer-diagnostics', name: '混合层的季节变化', description: '按温度与位密度阈值诊断混合层，保留缺测、参考深度和空间尺度差异。', prompt: '请载入 seasonal-layer-diagnostics 技能，先读取 120°E、20°N 的 WOA18 四季剖面，说明判据与缺测，再规划混合层季节诊断。单点气候态不得代替区域或瞬时观测。'},
  {id: 'surface-duct-investigation', name: '表面声道与传播研究', description: '先诊断近表层声速结构，再按频率、边界与几何选择传播计算。', prompt: '请载入 surface-duct-investigation 技能，读取 120°E、20°N 的 WOA18 四季近表层剖面，区分混合层与声道候选结构；先完成环境诊断，传播验证前列出缺失条件与节点能力。'},
  ...recipes.models.map(model => ({id: model.skill, name: model.name + ' 模型构造', model: model.id,
    description: model.supported ? '固化 ' + model.name + ' 的适用条件、输入、执行与检查流程；公共站提供只读配方。' : model.unavailable_reason,
    prompt: '请载入 ' + model.skill + ' 技能及 references/workflow.md，先解释使用条件和所需环境，再依据我的目标形成输入与检查计划。我的目标是：'})),
].map(skill => ({...skill, read_only: true, resource_count: Object.values(resources).filter(r => r.skill === skill.id).length,
  sha256: resources[skill.id + '/SKILL.md'].sha256, resources: Object.values(resources).filter(r => r.skill === skill.id).map(({path,sha256,size}) => ({path,sha256,size})),
  runtime_available: false, scope: 'public_read_only'}));

// The published bundle contains only these reviewed source files plus embedded input snapshots.
// Never enumerate arbitrary app directories, private runs, config, uploads or textbook PDFs.
const projectContents = {};
function addProject(key, content, {source = 'workbench', label = key, category = 'docs', source_sha256 = sourceFingerprint(content).sha256, metadata = {}} = {}) {
  content = redact(content);
  assertPublic(content, key);
  if (projectContents[key]) {
    if (projectContents[key].content !== content) throw Error('Conflicting published snapshot: ' + key);
    return;
  }
  projectContents[key] = {path: key, label, group: source, source, category, kind: 'text', url: null,
    content, size: Buffer.byteLength(content), sha256: hash(content), source_sha256, truncated: false,
    read_only: true, scope: 'public_read_only', metadata: {execution: 'reference_only', source_hash_normalization: 'utf8-lf', ...metadata}};
}
const repoAllowlist = [
  'backend/matlab/run_ocean_case.m', 'backend/matlab/run_studio_case.m',
  'backend/classic_environments.py', 'backend/custom_environment.py', 'backend/solver_results.py',
  'backend/field_plots.py', 'tests/check_ram_grid.py', 'tests/test_science.py',
];
for (const relative of repoAllowlist) {
  const source = read(relative);
  addProject('@workbench/' + relative, source.raw, {label: relative, source_sha256: source.source_sha256,
    category: relative.startsWith('tests/') ? 'tests' : 'code', metadata: {source: 'repository_source_snapshot', history_scope: historical}});
}
for (const resource of Object.values(resources)) addProject('@workbench/skills/' + resource.skill + '/' + resource.path, resource.content,
  {label: 'skills/' + resource.skill + '/' + resource.path, category: /\.(py|m)$/.test(resource.path) ? 'code' : 'docs',
    source_sha256: resource.source_sha256, metadata: resource.metadata});
for (const model of library.models) for (const example of model.examples || []) {
  if (!/^tests\/[A-Za-z0-9_./-]+$/.test(example.path) || example.path.split('/').includes('..')) throw Error('Unsafe example locator');
  addProject('@project/at/' + example.path, example.text, {source: 'project', label: 'at/' + example.path,
    category: /\.(env|flp|in|bty|ssp)$/.test(example.path) ? 'inputs' : 'code',
    source_sha256: sourceFingerprint(example.text).sha256, metadata: {source: 'AT_input_snapshot', original_locator: example.path,
      original_sha256: example.sha256 || null, original_sha256_scope: 'historical_AT_file_bytes', history_scope: historical}});
}
addProject('@workbench/PUBLIC_RESEARCH_README.md', '# 公共研究资料\n\n' + publicNote + '\n\n' +
  '目录提供 12 个 Skill、9 类模型经验与 8 个受支持的模型创建配方；KRAKEL 保留为待验证条目。\n\n' +
  '输入样例与脚本均为只读源代码快照，不代表页面已执行。旧算例中记录的输出、可执行文件状态、误差与审计日期属于历史本地环境。\n\n' +
  '资料不包含教材全文、个人会话、私有任务、配置密钥或本机数据路径。海洋数据由单独的数据接口按需读取。\n', {label: 'PUBLIC_RESEARCH_README.md'});
const projectFiles = Object.values(projectContents).map(({content,...file}) => file).sort((a,b) => a.path.localeCompare(b.path));

// Preserve public image/code-link shape while replacing the older 39-card graph with 69 cards.
const graphSource = read('backend/data/course_graph.json');
const graph = JSON.parse(redact(graphSource.raw));
// Export source metadata only. A clone can rebuild from the checked-in public registry;
// a maintainer may supply a private registry at build time, but its paths never leave here.
const publicSourcesFile = path.join(publicRoot, 'data/sources.json');
const sourcesById = new Map(JSON.parse(fs.readFileSync(publicSourcesFile, 'utf8')).map(source => [source.id, source]));
const registryPath = process.env.OCEAN_SOURCE_REGISTRY || path.join(local, '.local/kb/source_registry.json');
if (fs.existsSync(registryPath)) {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  for (const source of Array.isArray(registry) ? registry : registry.sources || []) {
    if (!/^S\d{2,4}$/.test(source.id || '')) continue;
    const safe = {};
    for (const key of ['id', 'name', 'type', 'extraction_state', 'duplicate_of', 'reading_scope', 'sha256'])
      if (source[key] !== undefined) safe[key] = typeof source[key] === 'string' ? redact(source[key]) : source[key];
    sourcesById.set(source.id, {...sourcesById.get(source.id), ...safe, available: false,
      index_status: '课程知识卡与来源定位；全文未公开分发', public_access: 'metadata_only'});
  }
}
for (const node of graph.nodes) for (const ref of node.references || []) {
  if (sourcesById.has(ref.source_id)) continue;
  sourcesById.set(ref.source_id, ref.source_id === 'PROJECT'
    ? {id: 'PROJECT', name: '工作台项目源码与计算流程', type: '.code', available: true,
      public_access: 'reviewed_source_snapshots', extraction_state: 'not_applicable', duplicate_of: null,
      reading_scope: '仅共享目录明确列出的源码与输入；其余定位不代表已公开全文', index_status: '代码片段与流程已关联'}
    : {id: ref.source_id, name: ref.title || ref.source_id, type: '.reference', available: false,
      public_access: 'metadata_only', reading_scope: '以知识卡提供的页码或定位为准', index_status: '课程来源定位'});
}
const publicSourceKeys = ['id','name','type','extraction_state','duplicate_of','reading_scope','available','index_status','public_access','sha256'];
const sources = [...sourcesById.values()].map(source => Object.fromEntries(publicSourceKeys.filter(key => source[key] !== undefined)
  .map(key => [key, typeof source[key] === 'string' ? redact(source[key]) : source[key]])))
  .sort((a,b) => a.id.localeCompare(b.id));
const oldGraph = JSON.parse(fs.readFileSync(path.join(publicRoot, 'data/graph.json'), 'utf8'));
const oldNodes = new Map(oldGraph.nodes.map(node => [node.id, node]));
const knowledgeCode = {};
for (const node of graph.nodes) {
  if (node.kind !== 'knowledge') continue;
  const old = oldNodes.get(node.id);
  node.images = structuredClone(old?.images || []);
  if (!node.images.length && node.diagram && fs.existsSync(path.join(publicRoot, 'public/assets/knowledge', node.diagram + '.svg')))
    node.images.push({url: '/assets/knowledge/' + node.diagram + '.svg', caption: '课程原理示意 · 非求解器声场结果'});
  for (const ref of node.references) {
    if (ref.pdf_page) {
      const url = '/api/source/' + encodeURIComponent(ref.source_id) + '/page/' + ref.pdf_page;
      if (!node.images.some(image => image.url === url)) node.images.push({url, caption: ref.source_id + ' · 教材原页 ' + ref.pdf_page, source_url: url});
    }
  }
  node.references.forEach((ref, index) => {
    if (!['S20', 'PROJECT'].includes(ref.source_id)) return;
    ref.code_url = '/api/knowledge/code?node=' + encodeURIComponent(node.id) + '&reference=' + index;
    const locator = (ref.locator || '').split(':')[0];
    const projectPath = ref.source_id === 'PROJECT' ? '@workbench/' + locator : '@project/' + locator;
    const item = projectContents[projectPath];
    knowledgeCode[node.id + ':' + index] = item ? {node_id: node.id, reference_index: index, locator: ref.locator,
      ...item, metadata: {...item.metadata, source_id: ref.source_id}} : {
      node_id: node.id, reference_index: index, locator: ref.locator, kind: 'text', read_only: true, scope: 'public_read_only',
      content: '此引用用于定位原 AT/工作台源码。本公共资料包尚未收录该文件全文，请按定位查阅对应版本；这里不以其他文件替代。\n',
      metadata: {source_id: ref.source_id, content_available: false}};
    knowledgeCode[node.id + ':' + index].sha256 ||= hash(knowledgeCode[node.id + ':' + index].content);
    knowledgeCode[node.id + ':' + index].size ||= Buffer.byteLength(knowledgeCode[node.id + ':' + index].content);
  });
  if (node.id === 'munk_case') {
    node.label = 'Munk 声场仿真案例';
    node.overview = '历史本地工作台曾用 MATLAB 与 KRAKEN / FIELD 复现 Munk 声道。公共站提供对应输入与流程；实际计算取决于本次连接节点。';
    node.key_points = ['历史记录包含 50/100 Hz 与 500/1000 m 源深四组检查；不代表当前公网节点已重跑。', '新任务应独立保存 ENV、FLP、输出、图表与验证记录。'];
  }
}
graph.status = '人工课程知识与来源定位；69 个知识点、180 条关系。图中历史执行描述不是当前节点状态，教材页能否展示取决于已授权的来源服务。';
graph.public_metadata = {source: 'backend/data/course_graph.json', source_sha256: graphSource.source_sha256,
  knowledge_count: graph.nodes.filter(node => node.kind === 'knowledge').length, edge_count: graph.edges.length,
  source_hash_normalization: 'utf8-lf', execution_scope: historical};
const assets = {schema_version: 1, id: 'public-research-v1', scope: 'public_read_only', note: publicNote,
  history_scope: historical, skills, models: recipes.models, model_experience: library, coverage, resources,
  project_files: projectFiles, project_contents: projectContents, knowledge_code: knowledgeCode,
  roots: {workbench: '共享工作台代码、Skill 与说明', project: 'AT 经典输入快照'},
  groups: [{id: 'workbench', name: '共享代码、Skill 与说明'}, {id: 'project', name: 'AT 经典 ENV/FLP 与输入快照'}],
  graph: {knowledge_count: graph.public_metadata.knowledge_count, node_count: graph.nodes.length, edge_count: graph.edges.length,
    source_sha256: graphSource.source_sha256},
  provenance: {generator: 'scripts/generate-public-research.mjs', source_hash_normalization: 'utf8-lf',
    sources: sourceFiles.sort((a,b) => a.path.localeCompare(b.path))}};
assets.provenance.source_manifest_sha256 = hash(json(assets.provenance.sources));
assets.provenance.public_sources_sha256 = hash(json(sources));
assets.source_count = sources.length;
write('data/graph.json', json(graph));
write('data/sources.json', json(sources));
write('data/research-models.json', json(library));
write('data/research-workflows.json', json({version: recipes.version, scope: recipes.scope, models: recipes.models}));
write('data/research-catalog.json', json({skills, scope: assets.scope, note: assets.note, history_scope: historical}));
write('data/research-assets.json', json(assets));
console.log(json({skills: skills.length, resources: Object.keys(resources).length, models: recipes.models.length,
  supported_recipes: recipes.models.filter(model => model.supported).length, project_files: projectFiles.length,
  knowledge: graph.public_metadata.knowledge_count, edges: graph.edges.length,
  assets_bytes: Buffer.byteLength(json(assets)), source_manifest_sha256: assets.provenance.source_manifest_sha256}));
