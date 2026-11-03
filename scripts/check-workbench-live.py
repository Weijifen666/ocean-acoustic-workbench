#!/usr/bin/env python3
"""Validate an anonymous public workbench; no paid model calls or computation submissions."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from http.cookiejar import MozillaCookieJar
import json
import math
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPCookieProcessor, ProxyHandler, Request, build_opener
import uuid

ROOT = Path(__file__).resolve().parents[1]
MAX_RESPONSE = 8 * 1024 * 1024


class CheckError(Exception):
    pass


def require(value, message):
    if not value:
        raise CheckError(message)


class SameOriginRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        before, after = urlsplit(request.full_url), urlsplit(newurl)
        if (before.scheme, before.netloc) != (after.scheme, after.netloc):
            raise CheckError('Cross-origin redirect refused; sign-in is not part of anonymous validation')
        return super().redirect_request(request, fp, code, message, headers, newurl)


class Visitor:
    def __init__(self, site, cookie_path, timeout, legacy_sse=False):
        self.site, self.timeout, self.cookie_path = site, timeout, cookie_path
        self.jar = MozillaCookieJar(str(cookie_path))
        # ProxyHandler() uses the OS/urllib environment settings. No caller
        # cookies, platform identity headers or private runtime config are read.
        self.opener = build_opener(ProxyHandler(), HTTPCookieProcessor(self.jar), SameOriginRedirect())
        self.legacy_sse = legacy_sse

    def request(self, path, method='GET', body=None, headers=None):
        require(path.startswith('/api/') and not path.startswith('//'), 'Only same-origin API paths are allowed')
        if method != 'GET':
            allowed = (method == 'POST' and (path == '/api/research/chat' or re.fullmatch(r'/api/research/runs/[A-Za-z0-9_-]{8,100}/(?:step|stop)', path)))
            allowed = allowed or (method in ('PATCH', 'DELETE') and re.fullmatch(r'/api/research/sessions/[A-Za-z0-9_-]{8,100}', path))
            allowed = allowed or (self.legacy_sse and method == 'POST' and path == '/api/chat')
            require(allowed, 'Mutation is outside the no-computation validation allowlist')
            if path in ('/api/research/chat', '/api/chat') or path.endswith('/step'):
                self.no_key()
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        request = Request(self.site + path, data=data, method=method, headers={
            'User-Agent': 'Ocean-course-functional-validation/1.0', 'Accept': 'application/json, text/event-stream',
            **({'Origin': self.site} if method != 'GET' else {}),
            **({'Content-Type': 'application/json'} if data is not None else {}), **(headers or {})})
        for attempt in range(3):
            try:
                try:
                    with self.opener.open(request, timeout=self.timeout) as response:
                        raw, status, kind = response.read(MAX_RESPONSE + 1), response.status, response.headers.get_content_type()
                except HTTPError as error:
                    raw, status, kind = error.read(MAX_RESPONSE + 1), error.code, error.headers.get_content_type()
                require(len(raw) <= MAX_RESPONSE, 'Response exceeds the validation size limit')
                self.jar.save(ignore_discard=True, ignore_expires=True)
                return status, raw, kind
            except (URLError, TimeoutError, OSError):
                if attempt == 2:
                    raise CheckError('HTTP transport failed after bounded retries') from None
                time.sleep(1)

    def json(self, path, method='GET', body=None, expected=(200,), headers=None):
        status, raw, _ = self.request(path, method, body, headers)
        require(status in expected, f'Expected HTTP {"/".join(map(str, expected))}, received {status}')
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise CheckError('API returned a non-JSON response') from None
        return value

    def no_key(self):
        config = self.json('/api/config')
        require(config.get('api_key_set') is False, 'Safety gate: fresh visitor unexpectedly has a configured model key')
        require(not config.get('api_key'), 'Config exposed a plaintext model key')
        return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', required=True)
    parser.add_argument('--report', type=Path, help='Optional sanitized JSON summary')
    parser.add_argument('--timeout', type=float, default=40)
    parser.add_argument('--legacy-sse', action='store_true', help='Also exercise the legacy no-key SSE chat; never calls a provider')
    args = parser.parse_args()
    parsed = urlsplit(args.site)
    if (parsed.scheme not in ('https', 'http') or not parsed.netloc or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment
            or (parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'))):
        parser.error('--site must be an HTTPS origin or HTTP loopback origin without path or credentials')
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 120:
        parser.error('--timeout must be between 1 and 120 seconds')
    site, nonce = args.site.rstrip('/'), uuid.uuid4().hex
    private = ROOT / '.local' / 'validation' / ('workbench-live-' + nonce)
    private.mkdir(parents=True)
    visitors = [Visitor(site, private / ('visitor-' + name + '.cookies'), args.timeout, args.legacy_sse) for name in ('a', 'b')]
    a, b = visitors
    receipt = {'session': 'validation-' + nonce, 'request_id': 'validation-' + uuid.uuid4().hex}
    receipt_path = private / 'receipt.json'
    receipt_path.write_text(json.dumps(receipt), encoding='utf-8')
    report = {'site': site, 'checked_at_utc': datetime.now(timezone.utc).isoformat(),
              'scope': 'Fresh anonymous visitors; no-key research, public catalogs and ownership. No paid generation, MATLAB submission or signed-in account test.',
              'compute_submissions': 0, 'paid_generation_requests': 0, 'checks': [],
              'tool_pagination': {'live_http_tested': False, 'reason': 'HTTP file endpoints return complete snapshots; model-tool pagination is covered separately by repository regression tests.'}}

    def check(name, operation):
        try:
            detail = operation()
            report['checks'].append({'name': name, 'passed': True, **(detail if isinstance(detail, dict) else {})})
            return detail
        except Exception as error:
            message = str(error) if isinstance(error, CheckError) else type(error).__name__
            report['checks'].append({'name': name, 'passed': False, 'error': message[:180]})
            return None

    def anonymous():
        for visitor in visitors:
            config = visitor.no_key()
            account = visitor.json('/api/account')
            require(account.get('authenticated') is False and account.get('storage_scope') == 'browser_visitor', 'Visitor is not anonymous')
            require(config.get('storage') == 'cloud_encrypted', 'Model configuration does not report encrypted cloud storage')
        cookie_values = [{(c.name, c.value) for c in v.jar if c.name == 'ocean_visitor'} for v in visitors]
        require(all(cookie_values) and cookie_values[0].isdisjoint(cookie_values[1]), 'Two independent visitor cookies were not established')
        return {'visitors': 2, 'configured_keys': 0, 'plaintext_keys': 0}

    def graph():
        data = a.json('/api/graph')
        count = sum(node.get('kind') == 'knowledge' for node in data.get('nodes', []))
        require(count == 69 and len(data.get('edges', [])) == 180 and len(data.get('chapters', [])) == 6, 'Graph is not the current 69-card/180-edge/6-chapter snapshot')
        return {'knowledge_cards': count, 'edges': len(data['edges'])}

    def catalogs():
        skills = a.json('/api/research-skills').get('skills', [])
        models = a.json('/api/model-workflows').get('models', [])
        supported = sum(model.get('recipe_supported') is True for model in models)
        require(len(skills) == 12 and len(models) == 9 and supported == 8, 'Skill/model/recipe catalog counts differ from current source')
        return {'skills': len(skills), 'models': len(models), 'supported_recipes': supported}

    def shared_files():
        data = a.json('/api/project/files')
        files = data.get('files', [])
        require(files and len(files) == data.get('total'), 'HTTP shared file directory must be complete under its existing contract')
        target = next((f['path'] for f in files if f.get('path', '').endswith('/skills/at-environment/scripts/summarize_model.m')), None)
        require(target, 'Registered shared MATLAB postprocessor is missing')
        value = a.json('/api/project/file?' + urlencode({'path': target}))
        content = value.get('content')
        require(isinstance(content, str) and 'read_shd' in content, 'Shared MATLAB source is not readable')
        require(hashlib.sha256(content.encode('utf-8')).hexdigest() == value.get('sha256'), 'Shared file SHA256 does not match actual returned content')
        require(value.get('read_only') is True, 'Shared source must remain read-only')
        status, _, _ = a.request('/api/project/file?' + urlencode({'path': '@workbench/../../.local/config.json'}))
        require(status in (404, 422), 'Shared file traversal was not rejected')
        return {'files': len(files), 'matlab_source_verified': True, 'sha256_verified': True}

    ready = check('anonymous_and_no_plaintext_keys', anonymous)
    check('graph_snapshot', graph)
    check('skill_and_model_catalogs', catalogs)
    check('shared_files_and_matlab_source', shared_files)
    body = {'session': receipt['session'], 'request_id': receipt['request_id'],
            'message': 'Munk声道是什么？请简要解释并给出资料出处，不要运行仿真。',
            'backend': 'api', 'rounds': 1, 'context_budget': 'unlimited'}

    def research():
        require(ready is not None, 'No-key safety gate did not pass; research was not submitted')
        created = a.json('/api/research/chat', 'POST', body, expected=(200, 202))
        receipt['run_id'] = created['id']
        receipt_path.write_text(json.dumps(receipt), encoding='utf-8')
        # Reading status is free and cannot advance the model or submit tasks.
        before = a.json('/api/research/runs/' + receipt['run_id'])
        require(before.get('state') == 'running', 'New no-key research request is not resumable before step')
        done = a.json('/api/research/runs/' + receipt['run_id'] + '/step', 'POST', {})
        require(done.get('state') == 'done' and done.get('trace') == [], 'No-key step did not finish without executing tools')
        reply = done.get('reply')
        require(isinstance(reply, str) and 0 < len(reply) <= 4000, 'No-key response is missing or dumps excessive source text')
        require('API Key' in reply and ('未调用模型' in reply or '未配置' in reply), 'No-key response did not declare its limited provenance')
        history = a.json('/api/research/history?' + urlencode({'session': receipt['session']}))
        require(len(history) == 2 and history[0].get('role') == 'user' and history[1].get('role') == 'assistant', 'Research exchange was not durably persisted')
        require(history[1].get('model_used') is False and history[1].get('text') == reply, 'Stored answer does not confirm no model generation')
        replay = a.json('/api/research/chat', 'POST', body)
        require(replay.get('id') == receipt['run_id'] and replay.get('reused') is True, 'Request replay created another research run')
        require(len(a.json('/api/research/history?' + urlencode({'session': receipt['session']}))) == 2, 'Idempotent replay duplicated messages')
        return {'history_messages': 2, 'model_used': False, 'reply_characters': len(reply), 'idempotent_replay': True}

    def isolation():
        require('run_id' in receipt, 'Research prerequisite did not create a test run')
        require(b.json('/api/research/history?' + urlencode({'session': receipt['session']})) == [], 'Another visitor read test research history')
        for path, method, payload in [('/api/research/runs/' + receipt['run_id'], 'GET', None),
                                      ('/api/research/runs/' + receipt['run_id'] + '/step', 'POST', {}),
                                      ('/api/research/sessions/' + receipt['session'], 'PATCH', {'title': 'foreign'}),
                                      ('/api/research/sessions/' + receipt['session'], 'DELETE', None)]:
            status, _, _ = b.request(path, method, payload)
            require(status == 404, 'Another visitor accessed or changed owned research')
        return {'foreign_actions_rejected': 4, 'foreign_history_empty': True}

    def rename():
        require('run_id' in receipt, 'Research prerequisite did not create a test run')
        title = '验收专用临时会话'
        a.json('/api/research/sessions/' + receipt['session'], 'PATCH', {'title': title})
        sessions = a.json('/api/research/sessions')
        require(any(row.get('id') == receipt['session'] and row.get('title') == title and row.get('count') == 2 for row in sessions), 'Renamed session did not persist')
        require(a.json('/api/research/runs/' + receipt['run_id']).get('state') == 'done', 'Reading persisted run changed its state')
        return {'patch_persisted': True}

    def legacy_sse():
        require(ready is not None, 'No-key safety gate did not pass')
        status, raw, kind = a.request('/api/chat', 'POST', {'message': 'Munk声道是什么？', 'mode': 'chat', 'knowledge_mode': 'course', 'stream': True}, {'Idempotency-Key': 'validation-' + uuid.uuid4().hex})
        require(status == 200 and kind == 'text/event-stream', 'Legacy chat did not return SSE')
        events = []
        for block in raw.decode('utf-8').replace('\r\n', '\n').split('\n\n'):
            event = next((line[6:].strip() for line in block.split('\n') if line.startswith('event:')), 'message')
            payload = '\n'.join(line[5:].lstrip() for line in block.split('\n') if line.startswith('data:'))
            if event == 'done' and payload:
                events.append(json.loads(payload))
        require(len(events) == 1 and events[0].get('model_used') is False, 'Legacy SSE did not confirm one complete no-key answer')
        return {'model_used': False, 'done_events': 1, 'private_test_history_retained': True}

    try:
        check('no_key_research_persistence_and_replay', research)
        check('visitor_research_isolation', isolation)
        check('research_session_rename_persistence', rename)
        if args.legacy_sse:
            check('legacy_no_key_sse', legacy_sse)
    finally:
        def cleanup():
            # Only the unique session generated by this invocation is touched.
            if 'run_id' in receipt:
                value = a.json('/api/research/runs/' + receipt['run_id'], expected=(200, 404))
                if value.get('state') == 'running':
                    a.json('/api/research/runs/' + receipt['run_id'] + '/stop', 'POST', {})
            a.json('/api/research/sessions/' + receipt['session'], 'DELETE', expected=(200, 404))
            require(a.json('/api/research/history?' + urlencode({'session': receipt['session']})) == [], 'Own temporary research history was not removed')
            if 'run_id' in receipt:
                status, _, _ = a.request('/api/research/runs/' + receipt['run_id'])
                require(status == 404, 'Own temporary run was not removed')
            receipt['cleaned_up'] = True
            receipt_path.write_text(json.dumps(receipt), encoding='utf-8')
            return {'own_research_session_removed': True}
        check('cleanup_own_temporary_research', cleanup)
    report['passed'] = sum(item['passed'] for item in report['checks'])
    report['total'] = len(report['checks'])
    report['legacy_sse_requested'] = args.legacy_sse
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, separators=(',', ':'), allow_nan=False))
    return 0 if report['passed'] == report['total'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
