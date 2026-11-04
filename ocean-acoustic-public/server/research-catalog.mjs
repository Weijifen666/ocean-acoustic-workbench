// Pure, read-only access to build-time assets. Never resolve a request as a filesystem path.
const problem = (detail, status = 422) => Object.assign(new Error(detail), {status});
const copy = value => structuredClone(value);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const ownEntries = value => isObject(value) ? Object.entries(value) : [];
const readOnly = {read_only: true, scope: 'public_read_only', runtime_available: false};

function relativePath(value, label = '资源路径') {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\\%\x00-\x20:?#]/.test(value)
    || value.startsWith('/') || value.split('/').some(part => !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part)))
    throw problem(label + '无效；请从目录中选择已登记的文件');
  return value;
}
function projectPath(value) {
  if (typeof value !== 'string' || !/^@(workbench|project)\//.test(value)) throw problem('共享文件路径无效');
  const slash = value.indexOf('/');
  relativePath(value.slice(slash + 1), '共享文件路径');
  return value;
}
function skillId(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw problem('技能标识无效');
  return value;
}

export function createResearchCatalog(assets = {}) {
  if (!isObject(assets)) assets = {};
  // Map lookups exclude inherited keys such as __proto__ and constructor.
  const resources = new Map(ownEntries(assets.resources));
  const projects = new Map(ownEntries(assets.project_contents));
  const knowledgeCode = new Map(ownEntries(assets.knowledge_code));
  const skills = Array.isArray(assets.skills) ? assets.skills : [];
  const skillsById = new Map(skills.map(skill => [skill.id, skill]));
  const roots = copy(assets.roots || {workbench: '共享工作台资料', project: 'AT 输入快照'});
  const groups = copy(assets.groups || [{id: 'workbench', name: '共享代码、Skill 与说明'}, {id: 'project', name: 'AT 经典输入快照'}]);
  const history = assets.history_scope || '模型审阅与运行记录来自历史本地环境；当前执行方式见可用工具。';
  const note = assets.note || '公共目录仅提供参考资料；执行需查询已连接计算节点的实际能力。';

  function catalog() {
    return {skills: copy(skills), ...readOnly, toolbox_status: skills.length + ' 类研究 Skill 资料可读；历史验证记录与当前计算节点状态分别核对。',
      note, history_scope: history, version: assets.id || 'unavailable', resource_count: resources.size,
      provenance: copy(assets.provenance || {})};
  }
  function modelWorkflows() {
    return {models: copy(Array.isArray(assets.models) ? assets.models : []).map(model => ({...model,
      recipe_supported: model.supported === true, available: false, runtime_available: false,
      runtime_status: 'requires_connected_compute_node', read_only: true})), ...readOnly,
      note, history_scope: history, scope: 'public_read_only_model_recipes'};
  }
  function readSkill(id, resourcePath = 'SKILL.md') {
    id = skillId(id);
    relativePath(resourcePath);
    if (!skillsById.has(id)) throw problem('该技能未登记在公共目录中', 404);
    const resource = resources.get(id + '/' + resourcePath);
    if (!resource) throw problem('该技能未收录此资源；请从 resources 列表选择', 404);
    return {...copy(resource), id, skill: id, path: resourcePath, ...readOnly,
      metadata: {...copy(resource.metadata || {}), name: skillsById.get(id).name, execution: 'reference_only'}};
  }
  function listProjectFiles(options = {}) {
    if (!isObject(options)) throw problem('共享文件筛选须为对象');
    const source = options.source ?? 'all', query = options.query ?? options.q ?? '';
    if (typeof source !== 'string' || !['all', ...groups.map(group => group.id)].includes(source)) throw problem('文件来源无效');
    if (typeof query !== 'string' || query.length > 256) throw problem('文件检索词须为最多256字符的文字');
    const needle = query.trim().normalize('NFKC').toLowerCase();
    const files = (Array.isArray(assets.project_files) ? assets.project_files : []).filter(file =>
      projects.has(file.path) && (source === 'all' || file.group === source) &&
      (!needle || String(file.label || file.path).normalize('NFKC').toLowerCase().includes(needle)));
    return {root: '公共共享资料（只读）', roots: copy(roots), groups: copy(groups), files: copy(files),
      total: files.length, ...readOnly, note, history_scope: history};
  }
  function readProjectFile(requestedPath) {
    projectPath(requestedPath);
    const file = projects.get(requestedPath);
    if (!file) throw problem('该文件未登记在公共共享目录中', 404);
    return {...copy(file), ...readOnly, metadata: {...copy(file.metadata || {}), execution: 'reference_only'}};
  }
  function readKnowledgeCode(node, reference = 0) {
    if (typeof node !== 'string' || !/^[a-z][a-z0-9_-]{0,99}$/.test(node) || !Number.isInteger(reference) || reference < 0 || reference > 30)
      throw problem('知识代码引用无效');
    const file = knowledgeCode.get(node + ':' + reference);
    if (!file) throw problem('公共知识图谱未登记该代码引用', 404);
    return {...copy(file), ...readOnly};
  }
  return {catalog, modelWorkflows, readSkill, resource: readSkill, listProjectFiles, readProjectFile, readKnowledgeCode};
}
