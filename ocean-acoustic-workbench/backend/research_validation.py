"""Program-owned numerical receipts and read-only execution provenance checks.

Receipts live outside Agent-editable task artifacts. This is provenance against
accidental/self-reported validation, not a sandbox for arbitrary local scripts.
"""
import hashlib
import json
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def task_file(folder, name):
    folder = Path(folder).resolve()
    if not isinstance(name,str) or not name or name != Path(name).name or any(c in name for c in '/\\:') or name.startswith('.'):
        raise ValueError('只允许任务目录内的普通文件名')
    path = folder / name
    if path.is_symlink() or path.resolve().parent != folder:
        raise ValueError('文件路径越界')
    return path


def hashes(folder, names):
    return {name: sha256(task_file(folder, name)) for name in names}


class ValidationStore:
    def __init__(self, local):
        self.path = Path(local) / 'research-validation.sqlite3'

    def record(self, identity, kind, result, folder, bindings, implementations):
        # Bind the exact bytes evaluated, detecting edits during computation.
        if hashes(folder, bindings) != bindings:
            raise ValueError('检查期间输入已改变，请重新检查')
        payload = {'id': uuid.uuid4().hex, 'kind': kind,
                   'created': datetime.now(timezone.utc).isoformat(),
                   'authority': 'program', 'result': result, 'input_sha256': bindings,
                   'implementation_sha256': {str(Path(p).resolve()): sha256(p) for p in implementations}}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,job_id TEXT,payload TEXT)')
            db.execute('INSERT INTO receipts VALUES(?,?,?)', (payload['id'], identity, json.dumps(payload, ensure_ascii=False, allow_nan=False)))
        return payload

    def receipts(self, identity, folder):
        if not self.path.exists():
            return []
        with closing(sqlite3.connect(f'{self.path.as_uri()}?mode=ro', uri=True)) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='receipts'").fetchone():
                return []
            rows = db.execute('SELECT payload FROM receipts WHERE job_id=? ORDER BY rowid', (identity,)).fetchall()
        out = []
        for row in rows:
            value = json.loads(row[0]); stale = []
            for name, digest in value['input_sha256'].items():
                try:
                    if sha256(task_file(folder, name)) != digest: stale.append(name)
                except (OSError, ValueError): stale.append(name)
            for name, digest in value['implementation_sha256'].items():
                try:
                    if sha256(name) != digest: stale.append('检查方法已更新')
                except OSError: stale.append('检查方法不可用')
            value.update(current=not stale, stale_sources=stale)
            # Backend paths are useful in storage, not needed in model/UI output.
            value['implementation_sha256'] = {Path(p).name: h for p, h in value['implementation_sha256'].items()}
            out.append(value)
        return out

    def delete(self, identity):
        if self.path.exists():
            with closing(sqlite3.connect(self.path)) as db, db:
                db.execute('DELETE FROM receipts WHERE job_id=?', (identity,))


def scientific_validation(receipts):
    # Rechecking the same inputs supersedes an older receipt without erasing it.
    latest = {}
    for receipt in receipts:
        result = receipt['result']
        scope = {k: result.get(k) for k in ('roi', 'parameters', 'criteria')}
        key = (receipt['kind'], tuple(sorted(receipt['input_sha256'])), json.dumps(scope, sort_keys=True))
        latest[key] = receipt
    active = list(latest.values())
    states = [('stale' if not r['current'] else r['result'].get('status', 'computed')) for r in active]
    status = next((s for s in ('stale', 'not_stable', 'inconclusive') if s in states), 'checked' if states else 'not_checked')
    return {'authority': 'program', 'numerical_status': status, 'checks': active,
            'physical_accuracy': 'not_established',
            'scope': '仅覆盖所列方法、输入和区域；数值检查不构成物理精度或研究结论的证明。'}


def audit_task(folder, plan, receipts=()):
    """Read existing files only; legacy self-assessments confer no validation."""
    folder = Path(folder)
    record_path = task_file(folder, 'executions.json')
    problems = []
    try:
        records = json.loads(record_path.read_text(encoding='utf-8')) if record_path.exists() else []
        if not isinstance(records,list) or any(not isinstance(r,dict) or not isinstance(r.get('file'),str) for r in records):
            raise ValueError('执行记录结构无效')
        if any(not isinstance(r.get(k,{}),dict) for r in records for k in ('declared_input_sha256','declared_output_sha256')):
            raise ValueError('依赖记录结构无效')
    except (OSError,ValueError):
        records=[];problems.append('执行记录无法读取或格式损坏')
    latest = {r['file']: r for r in records}
    if not records: problems.append('尚无执行记录')
    for name, record in latest.items():
        if record.get('exit_code') != 0 or record.get('timed_out'):
            problems.append('最近执行失败：' + name)
        if record.get('kind') == 'program_tool':
            if record.get('receipt_id') not in {r['id'] for r in receipts}:
                problems.append('程序计算记录缺少检查凭据：' + name)
        else:
            try:
                if sha256(task_file(folder, name)) != record.get('sha256'):
                    problems.append('脚本版本已变化：' + name)
            except (OSError, ValueError): problems.append('脚本不可用：' + name)
        for input_name, digest in record.get('declared_input_sha256', {}).items():
            try:
                current = sha256(task_file(folder, input_name))
                # An explicitly declared in-place transformation records both
                # historic input and resulting output; compare the latter now.
                expected = record.get('declared_output_sha256', {}).get(input_name, digest)
                if current != expected: problems.append('执行输入已变化：' + input_name)
            except (OSError, ValueError): problems.append('执行输入不可用：' + input_name)
    # Check the latest producer for each explicitly declared output.
    outputs = {}
    for record in records:
        if record.get('exit_code') == 0:
            outputs.update(record.get('declared_output_sha256', {}))
    for record in latest.values():
        if record.get('missing_outputs'): problems.append('声明产物缺失：' + ', '.join(record['missing_outputs']))
    for name, digest in outputs.items():
        try:
            if sha256(task_file(folder, name)) != digest: problems.append('执行产物已变化：' + name)
        except (OSError, ValueError): problems.append('执行产物不可用：' + name)
    summary_path = task_file(folder, 'summary.json')
    if summary_path.exists():
        try:
            report = json.loads(summary_path.read_text(encoding='utf-8'))
            for output in report.get('outputs', []):
                name=output.get('file')
                try:
                    if sha256(task_file(folder, name)) != output.get('sha256'):
                        problems.append('归档产物版本不符：' + name)
                except (OSError, ValueError): problems.append('归档产物不可用：' + str(name))
        except (OSError,ValueError,TypeError,AttributeError): problems.append('归档报告无法读取或格式损坏')
    workflow = plan.get('model_workflow')
    if workflow:
        import model_workflows
        model_runs = [r for r in records if r['file'] == workflow['runner'] and r.get('exit_code') == 0]
        if not model_runs or not (folder / 'model_metrics.json').is_file():
            problems.append('模型基线流程缺少成功记录或产物')
        elif model_runs[-1].get('model_input_sha256') != model_workflows.input_hashes(folder):
            problems.append('模型基线输入版本已变化')
    return {'execution': {'status': 'consistent' if not problems else 'incomplete',
                           'execution_count': len(records), 'issues': list(dict.fromkeys(problems)),
                           'dependency_scope': 'declared' if records and all('declared_input_sha256' in r for r in records) else 'legacy_or_undeclared',
                           'scope': '核对执行记录、脚本与声明的文件版本；基线执行记录不验证其他研究输出。'},
            'scientific_validation': scientific_validation(receipts)}
