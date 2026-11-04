"""Publish an exported private course bundle with a dedicated, hidden token."""
import argparse
import base64
import getpass
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlsplit
import warnings
import zlib

import httpx

MAX_PACKED = 6 * 1024 * 1024
MAX_RAW = 16 * 1024 * 1024
MAX_REQUEST = 8 * 1024 * 1024
VERSION = re.compile(r'[a-z0-9][a-z0-9-]{0,79}')
SHA = re.compile(r'[a-f0-9]{64}')
MANIFEST_FIELDS = {'schema_version', 'version', 'chunks_key', 'chunks_sha256',
                   'compressed_bytes', 'uncompressed_bytes', 'chunks', 'indexed_sources',
                   'indexed_pages', 'source_coverage', 'ingestion_version', 'created_at',
                   'text_policy', 'math_layout_verified'}


class PublishError(ValueError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        # An accidentally supplied --token must not be reflected in diagnostics.
        self.exit(2, '参数无效，请使用 --help 查看选项。\n')


def integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def site_origin(value):
    try:
        if not isinstance(value, str) or any(c.isspace() for c in value) or '\\' in value:
            raise ValueError()
        parsed = urlsplit(value)
        port = parsed.port
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.path not in ('', '/')
                or parsed.query or parsed.fragment or port is not None and not 1 <= port <= 65535):
            raise ValueError()
        origin = 'https://' + parsed.netloc
        httpx.URL(origin)
        return origin
    except (ValueError, TypeError, httpx.InvalidURL):
        raise PublishError('站点地址须为不含账号、路径、查询参数和片段的HTTPS源站。') from None


def _json(raw):
    return json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError()))


def load_bundle(folder):
    """Read bounded files and verify the exact compressed bytes before input."""
    try:
        folder = Path(folder)
        manifest_file, chunks_file = folder/'manifest.json', folder/'chunks.json.gz'
        if (manifest_file.is_symlink() or chunks_file.is_symlink()
                or manifest_file.stat().st_size > 128 * 1024
                or not 18 <= chunks_file.stat().st_size <= MAX_PACKED):
            raise ValueError()
        with manifest_file.open('rb') as stream:
            manifest_raw = stream.read(128 * 1024 + 1)
        with chunks_file.open('rb') as stream:
            packed = stream.read(MAX_PACKED + 1)
        if len(manifest_raw) > 128 * 1024 or len(packed) > MAX_PACKED:
            raise ValueError()
        manifest = _json(manifest_raw)
        if (not isinstance(manifest, dict) or set(manifest)-MANIFEST_FIELDS
                or manifest.get('schema_version') != 1
                or not isinstance(manifest.get('version'), str)
                or not VERSION.fullmatch(manifest['version'])
                or manifest.get('chunks_key') != 'chunks.json.gz'
                or not isinstance(manifest.get('chunks_sha256'), str)
                or not SHA.fullmatch(manifest['chunks_sha256'])
                or not integer(manifest.get('compressed_bytes'), 18, MAX_PACKED)
                or not integer(manifest.get('uncompressed_bytes'), 1, MAX_RAW)
                or not integer(manifest.get('chunks'), 1, 12000)
                or not integer(manifest.get('indexed_sources'), 1, 200)
                or not integer(manifest.get('indexed_pages'), 0, 12000)
                or not integer(manifest.get('ingestion_version'), 2, 100)
                or not isinstance(manifest.get('source_coverage'), list)
                or len(manifest['source_coverage']) != manifest['indexed_sources']
                or len(packed) != manifest['compressed_bytes']
                or hashlib.sha256(packed).hexdigest() != manifest['chunks_sha256']):
            raise ValueError()
        with gzip.GzipFile(fileobj=io.BytesIO(packed)) as stream:
            raw = stream.read(MAX_RAW + 1)
        payload = _json(raw)
        if (len(raw) != manifest['uncompressed_bytes'] or not isinstance(payload, dict)
                or set(payload) != {'schema_version', 'version', 'chunks'}
                or payload['schema_version'] != 1 or payload['version'] != manifest['version']
                or not isinstance(payload['chunks'], list) or len(payload['chunks']) != manifest['chunks']):
            raise ValueError()
        body = json.dumps({'manifest': manifest, 'body': base64.b64encode(packed).decode('ascii')},
                          ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
        if len(body) > MAX_REQUEST:
            raise ValueError()
        return manifest, body
    except (OSError, EOFError, zlib.error, ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        raise PublishError('资料包无法读取或校验失败，请重新检查导出目录、版本、大小和SHA256。') from None


def public_result(data, manifest, token):
    """Only bounded, source-bound summary values may reach stdout."""
    try:
        if not isinstance(data, dict) or data.get('ok') is not True or data.get('version') != manifest['version']:
            raise ValueError()
        for field in ('chunks', 'indexed_sources', 'indexed_pages'):
            if type(data.get(field)) is not int or data[field] != manifest[field]:
                raise ValueError()
        size = data.get('compressed_bytes', data.get('bytes'))
        if type(size) is not int or size != manifest['compressed_bytes']:
            raise ValueError()
        if (type(data.get('reused')) is not bool or not isinstance(data.get('manifest_sha256'), str)
                or not SHA.fullmatch(data['manifest_sha256'])):
            raise ValueError()
        result = {key: data[key] for key in ('ok', 'version', 'chunks', 'indexed_sources',
                                             'indexed_pages', 'manifest_sha256', 'reused')}
        result['bytes'] = size
        if token in json.dumps(result, ensure_ascii=False):
            raise ValueError()
        return result
    except (ValueError, TypeError, KeyError):
        raise PublishError('发布响应无法核对，请保留原版本并稍后查询状态。') from None


def publish(origin, manifest, payload, token, *, client_factory=None, sleep=time.sleep):
    if not isinstance(token, str) or not re.fullmatch(r'[\x21-\x7e]{1,4096}', token):
        raise PublishError('发布令牌格式无效。')
    factory = client_factory or httpx.Client
    try:
        with factory(trust_env=False, timeout=90, follow_redirects=False) as client:
            for attempt in range(3):
                try:
                    response = client.post(origin + '/_knowledge-admin/import', content=payload,
                                           headers={'Content-Type': 'application/json',
                                                    'Authorization': 'Bearer ' + token})
                except httpx.TransportError:
                    if attempt == 2:
                        raise PublishError('连接中断，发布状态未确认；请使用同一资料包和版本重试。') from None
                    sleep(.25 * (attempt + 1))
                    continue
                status = response.status_code
                if status in (502, 503, 504) and attempt < 2:
                    sleep(.25 * (attempt + 1))
                    continue
                if status != 200:
                    raise PublishError('发布未完成，请检查站点配置或资料包，并保留原版本重试。', status)
                try:
                    data = _json(response.content)
                except (ValueError, UnicodeError, RecursionError):
                    raise PublishError('发布响应无法核对，请保留原版本并稍后查询状态。', status) from None
                return public_result(data, manifest, token)
    except PublishError:
        raise
    except (httpx.HTTPError, ValueError, OSError, TypeError):
        # Do not include exception text: transports and servers may reflect secrets.
        raise PublishError('发布请求未完成，请使用同一资料包和版本重试。') from None


def main(argv=None, *, stdin=None, stdout=None, stderr=None, client_factory=None, sleep=time.sleep):
    stdin, stdout, stderr = stdin or sys.stdin, stdout or sys.stdout, stderr or sys.stderr
    parser = SafeParser(description=__doc__)
    parser.add_argument('--site-url', required=True, help='HTTPS origin of the deployed workbench')
    parser.add_argument('--bundle', required=True, help='Private exporter directory')
    parser.add_argument('--token-stdin', action='store_true', help='Read one token line from a secure pipe')
    args = parser.parse_args(argv)
    try:
        origin = site_origin(args.site_url)
        manifest, payload = load_bundle(args.bundle)
        print('准备完成，等待发布令牌。', file=stdout, flush=True)
        if args.token_stdin:
            token = stdin.readline(4098).rstrip('\r\n')
        else:
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                token = getpass.getpass('发布令牌（隐藏输入）：')
        result = publish(origin, manifest, payload, token, client_factory=client_factory, sleep=sleep)
        print(json.dumps(result, ensure_ascii=False), file=stdout, flush=True)
        return 0
    except PublishError as error:
        status = ' status=' + str(error.status) if type(error.status) is int else ''
        print('发布失败：' + str(error) + status, file=stderr, flush=True)
        return 1
    except (EOFError, getpass.GetPassWarning):
        print('无法读取隐藏令牌，请在终端运行或使用 --token-stdin 安全管道。', file=stderr, flush=True)
        return 1
    except KeyboardInterrupt:
        print('发布已取消。', file=stderr, flush=True)
        return 130
    except Exception:
        print('发布请求未完成，请保留原资料包和版本后重试。', file=stderr, flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
