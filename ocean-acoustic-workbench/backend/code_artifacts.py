"""Local code documents and unverified browser result receipts.

This repository stores source and client-reported output only. It never runs
Python/MATLAB, opens task files, or changes a user's model configuration.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import time
import uuid

from fastapi import APIRouter, HTTPException, Request


class ArtifactError(ValueError):
    def __init__(self, detail, status=422):
        super().__init__(detail)
        self.status = status


def _json(value):
    try:
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    except (TypeError, ValueError, UnicodeError):
        raise ArtifactError('代码文档不是可保存的JSON对象') from None


def _bytes(value):
    try:
        return len((value if isinstance(value, str) else _json(value)).encode('utf-8'))
    except UnicodeError:
        raise ArtifactError('文本包含无效Unicode字符') from None


def _text(value, label, maximum):
    if not isinstance(value, str) or _bytes(value) > maximum:
        raise ArtifactError(label + '过长或格式无效')
    return value


def _object(value):
    if not isinstance(value, dict):
        raise ArtifactError('代码文档须为对象')
    return value


def _identity(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', value):
        raise ArtifactError('代码标识无效')
    return value


def source_hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def validate_code(body):
    body = _object(body)
    if body.get('language') not in ('python', 'matlab'):
        raise ArtifactError('代码语言请选择python或matlab')
    code = _text(body.get('code'), '代码', 50000)
    if not code.strip():
        raise ArtifactError('代码不能为空')
    title = _text(body.get('title', '未命名代码'), '标题', 240).strip() or '未命名代码'
    return {'title': title, 'language': body['language'], 'code': code,
            'input_csv': _text(body.get('input_csv', ''), 'CSV数据', 100000)}


def validate_result(value, code, input_csv):
    if not isinstance(value, dict) or _bytes(value) > 600000:
        raise ArtifactError('运行结果格式无效或超过600KB')
    hashes = {'code_sha256': source_hash(code), 'input_sha256': source_hash(input_csv)}
    for field, expected in hashes.items():
        actual = value.get(field)
        if not isinstance(actual, str) or not re.fullmatch(r'[A-Fa-f0-9]{64}', actual) or actual.lower() != expected:
            raise ArtifactError('运行结果与当前代码或CSV数据不一致，请重新运行', 409)
    artifacts = value.get('artifacts', [])
    if not isinstance(artifacts, list) or len(artifacts) > 8:
        raise ArtifactError('最多保存8个输出文件')
    files = []
    for item in artifacts:
        name = item.get('name') if isinstance(item, dict) else None
        if (not isinstance(name, str) or not name.strip() or '..' in name
                or not re.fullmatch(r'[A-Za-z0-9_\u4e00-\u9fff -][A-Za-z0-9_.\u4e00-\u9fff -]{0,100}', name)):
            raise ArtifactError('输出文件名无效')
        mime = item.get('mime')
        if mime == 'image/png':
            data = item.get('base64', item.get('data_base64'))
            if 'base64' in item and 'data_base64' in item and item['base64'] != item['data_base64']:
                raise ArtifactError('PNG编码字段不一致')
            data = _text(data, 'PNG数据', 550000)
            try:
                decoded = base64.b64decode(data, validate=True)
            except (ValueError, binascii.Error):
                raise ArtifactError('PNG编码无效') from None
            if not decoded.startswith(b'\x89PNG\r\n\x1a\n'):
                raise ArtifactError('输出不是PNG文件')
            files.append({'name': name, 'mime': mime, 'base64': data})
        else:
            if mime not in ('text/plain', 'text/csv', 'application/json'):
                raise ArtifactError('只保存PNG或文本分析产物')
            files.append({'name': name, 'mime': mime,
                          'text': _text(item.get('text', ''), '文本产物', 150000)})
    status = value.get('status', 'succeeded')
    if status not in ('succeeded', 'failed', 'cancelled', 'stopped', 'timed_out'):
        raise ArtifactError('运行结果状态无效')
    return {'stdout': _text(value.get('stdout', ''), '标准输出', 20000),
            'stderr': _text(value.get('stderr', ''), '错误输出', 8000),
            'artifacts': files, 'status': status, **hashes,
            'provenance': 'browser_client_report', 'server_verified': False,
            'physical_accuracy': 'not_established',
            'note': '用户浏览器隔离计算的回传结果；服务端仅校验格式和代码/输入版本，没有重新执行或认证科学结论。'}


class Store:
    """A local private namespace, using the application's connection callback."""
    def __init__(self, connect):
        self.connect = connect

    @staticmethod
    def _ensure(db):
        db.execute('''CREATE TABLE IF NOT EXISTS code_artifacts(
            id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL,
            created INTEGER NOT NULL, updated INTEGER NOT NULL)''')

    @staticmethod
    def _begin(db):
        if not db.in_transaction:
            db.execute('BEGIN IMMEDIATE')

    @staticmethod
    def _read(db, identity):
        row = db.execute('SELECT payload,revision,created,updated FROM code_artifacts WHERE id=?', (identity,)).fetchone()
        if row is None:
            raise ArtifactError('代码文档不存在', 404)
        try:
            value = json.loads(row[0])
            return {**value, 'id': identity, 'revision': row[1], 'created': row[2], 'updated': row[3],
                    'code_sha256': source_hash(value['code']), 'input_sha256': source_hash(value['input_csv'])}
        except (KeyError, TypeError, ValueError, UnicodeError):
            raise ArtifactError('代码文档无法读取，请核对本地数据库备份', 500) from None

    def list(self):
        with self.connect() as db:
            self._ensure(db)
            ids = [row[0] for row in db.execute('SELECT id FROM code_artifacts ORDER BY updated DESC,id LIMIT 50')]
            values = [self._read(db, identity) for identity in ids]
        return [{key: value[key] for key in ('id', 'title', 'language', 'revision', 'created', 'updated')}
                | {'has_result': value.get('result') is not None} for value in values]

    def read(self, identity):
        identity = _identity(identity)
        with self.connect() as db:
            self._ensure(db)
            return self._read(db, identity)

    def save(self, body, id=None, result_only=False):
        body = _object(body)
        if id is not None:
            _identity(id)
        elif result_only:
            raise ArtifactError('代码标识缺失')
        with self.connect() as db:
            self._begin(db)
            self._ensure(db)
            previous = self._read(db, id) if id is not None else None
            if previous and (type(body.get('expected_revision')) is not int or body['expected_revision'] != previous['revision']):
                raise ArtifactError('代码已更新，请重新载入后再保存', 409)
            if result_only:
                value = {key: previous[key] for key in ('title', 'language', 'code', 'input_csv')}
                value['result'] = validate_result(body.get('result'), value['code'], value['input_csv'])
                value['last_local_run'] = previous.get('last_local_run')
            else:
                value = {**validate_code(body), 'result': None, 'last_local_run': None}
            if _bytes(value) > 700000:
                raise ArtifactError('代码与结果总计超过700KB')
            if not previous and db.execute('SELECT COUNT(*) FROM code_artifacts').fetchone()[0] >= 50:
                raise ArtifactError('最多保留50份代码文档')
            identity = id or str(uuid.uuid4())
            revision = (previous['revision'] if previous else 0) + 1
            stamp = int(time.time() * 1000)
            if previous:
                cursor = db.execute('UPDATE code_artifacts SET payload=?,revision=?,updated=? WHERE id=? AND revision=?',
                                    (_json(value), revision, stamp, identity, previous['revision']))
                if cursor.rowcount != 1:
                    raise ArtifactError('代码正在被其他操作更新，请重新载入', 409)
            else:
                db.execute('INSERT INTO code_artifacts VALUES(?,?,?,?,?)', (_identity(identity), _json(value), revision, stamp, stamp))
            return self._read(db, identity)

    def record_local_run(self, identity, source_revision, job_id):
        """Attach an actual local job, without accepting a caller's success claim."""
        identity = _identity(identity)
        if not isinstance(job_id, str) or not re.fullmatch(r'[a-f0-9]{12}', job_id):
            raise ArtifactError('本地任务标识无效')
        with self.connect() as db:
            self._begin(db)
            self._ensure(db)
            current = self._read(db, identity)
            if type(source_revision) is not int or current['revision'] != source_revision:
                raise ArtifactError('运行期间代码已更新；实际任务已保留，未向新版本附加旧结果', 409)
            row = db.execute('SELECT state,plan FROM jobs WHERE id=?', (job_id,)).fetchone()
            if row is None or row[0] not in ('SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'):
                raise ArtifactError('本地任务尚未结束或记录不存在', 409)
            binding = {'id': identity, 'source_revision': source_revision,
                       'code_sha256': current['code_sha256'], 'input_sha256': current['input_sha256']}
            try:
                if json.loads(row[1]).get('code_artifact') != binding:
                    raise ArtifactError('任务与代码/CSV版本不一致，未附加运行记录', 409)
            except (TypeError, ValueError, AttributeError) as error:
                if isinstance(error, ArtifactError):
                    raise
                raise ArtifactError('本地任务记录无法校验', 409) from None
            value = {key: current[key] for key in ('title', 'language', 'code', 'input_csv', 'result')}
            value['last_local_run'] = {**binding, 'job_id': job_id, 'state': row[0],
                                       'provenance': 'local_process_record',
                                       'physical_accuracy': 'not_established'}
            if _bytes(value) > 700000:
                raise ArtifactError('文档已达到700KB；实际任务已保留，运行关联未附加')
            db.execute('UPDATE code_artifacts SET payload=?,revision=revision+1,updated=? WHERE id=? AND revision=?',
                       (_json(value), int(time.time() * 1000), identity, source_revision))
            return self._read(db, identity)

    def delete(self, identity):
        identity = _identity(identity)
        with self.connect() as db:
            self._begin(db)
            self._ensure(db)
            self._read(db, identity)
            db.execute('DELETE FROM code_artifacts WHERE id=?', (identity,))
        return {'deleted': True}


def router(connect):
    api = APIRouter()
    store = Store(connect)
    prefix = '/api/research/code/artifacts'

    async def body(request):
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 750000:
                raise HTTPException(413, '请求超过750KB')
        try:
            return _object(json.loads(raw))
        except (ValueError, UnicodeError):
            raise HTTPException(422, '请求不是合法JSON对象') from None

    def call(operation, *args, **kwargs):
        try:
            return operation(*args, **kwargs)
        except ArtifactError as error:
            raise HTTPException(error.status, str(error)) from None

    @api.get(prefix)
    def list_artifacts():
        return call(store.list)

    @api.post(prefix)
    async def create_artifact(request: Request):
        return call(store.save, await body(request))

    @api.get(prefix+'/{identity}')
    def read_artifact(identity: str):
        return call(store.read, identity)

    @api.post(prefix+'/{identity}')
    async def save_artifact(identity: str, request: Request):
        return call(store.save, await body(request), id=identity)

    @api.delete(prefix+'/{identity}')
    def delete_artifact(identity: str):
        return call(store.delete, identity)

    @api.post(prefix+'/{identity}/results')
    async def save_result(identity: str, request: Request):
        return call(store.save, await body(request), id=identity, result_only=True)

    return api
