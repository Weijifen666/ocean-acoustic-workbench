// The caller must first GET this visitor's job through the ownership-checked
// gateway. This module only projects that actual response into download links.
const problem = (detail, status) => Object.assign(new Error(detail), {status});
const validId = /^[a-f0-9]{12}$/;
const gatewayName = /^[A-Za-z0-9_.-]+$/;
const partialStates = new Set(['QUEUED', 'RUNNING']);

function existingNames(detail, id) {
  if (typeof id !== 'string' || !validId.test(id)) throw problem('任务标识须为12位小写十六进制字符。', 422);
  if (!detail || typeof detail !== 'object' || Array.isArray(detail) || detail.id !== id)
    throw problem('任务响应与所请求的本人任务标识不匹配。', 502);
  if (!Array.isArray(detail.artifacts) || !Array.from(detail.artifacts).every(name => typeof name === 'string'))
    throw problem('任务响应没有有效的真实文件清单，不能推测可下载文件。', 502);
  return [...new Set(detail.artifacts)];
}

function listNote(partial, unavailable) {
  return '仅依据已查询的本人任务与实际文件清单列出已有文件；未读取或校验文件内容，不保证已完成下载。'
    + (partial ? '任务仍在排队或运行，当前清单只包含此时已存在的部分产物。' : '')
    + (unavailable ? '部分真实文件名不符合网关单文件链接规则，已列入 unavailable_names，未为其构造单独链接。' : '');
}

export function listJobArtifacts(detail, {id, offset = 0, limit = 40} = {}) {
  const names = existingNames(detail, id);
  if (!Number.isInteger(offset) || offset < 0 || offset > names.length || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw problem('文件分页参数无效：offset须在去重后清单范围内，limit须为1–100的整数。', 422);
  const page = names.slice(offset, offset + limit), artifacts = [], unavailable = [];
  for (const name of page) {
    if (gatewayName.test(name) && name !== '.' && !name.includes('..'))
      artifacts.push({name, url: '/api/jobs/' + id + '/artifact/' + name});
    else unavailable.push(name);
  }
  return {id, state: detail.state ?? null, artifact_count: names.length, offset,
    next_offset: offset + limit < names.length ? offset + limit : null,
    artifacts, unavailable_names: unavailable, scope: 'existing_task_files',
    note: listNote(partialStates.has(detail.state), unavailable.length > 0)};
}

export function exportJobResults(detail, {id} = {}) {
  const page = listJobArtifacts(detail, {id, offset: 0, limit: 40});
  if (!page.artifact_count) throw problem('该任务当前没有已存在的任务文件，无法提供结果包。', 409);
  const partial = partialStates.has(detail.state);
  return {...page, download: {url: '/api/jobs/' + id + '/download', filename: 'ocean-' + id + '.zip'},
    download_on_click: true, archive_created: false, partial,
    note: '仅核对已查询的本人任务及其实际文件清单；点击下载地址时由服务即时打包 ZIP。本次没有创建压缩包或开始下载，也没有校验文件内容或完整性。'
      + (partial ? '任务仍在排队或运行，下载只会包含打包时已存在的部分产物，不能视为任务已完成。' : '')
      + (page.unavailable_names.length ? 'unavailable_names 中的文件没有单独链接；未猜测文件大小或哈希。' : '')};
}
