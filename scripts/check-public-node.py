#!/usr/bin/env python3
"""Check the public node; only --simulate explicitly submits one durable smoke test.

Uses the standard library. Runtime configuration contributes only site_origin
and outbound_proxy. Cookies, receipts and reports stay in the ignored .local
validation directory. No gateway, bridge, MATLAB or other process is started.
"""
from __future__ import annotations

import argparse
from contextlib import AbstractContextManager
from datetime import datetime, timezone
import hashlib
from http.cookiejar import MozillaCookieJar
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, ProxyHandler, HTTPCookieProcessor, HTTPRedirectHandler, build_opener
import zipfile

PLAN = {'solver': 'kraken', 'scenario': 'single', 'template': 'munk_5000m',
        'frequencies_hz': [50.0], 'source_depths_m': [1000.0],
        'receiver_depth_m': 1000.0, 'range_min_km': 1.0, 'range_max_km': 2.0,
        'range_points': 51, 'depth_points': 51, 'mode_addition': 'incoherent',
        'water_depth_m': 5000.0, 'bottom_speed_m_s': 1600.0,
        'bottom_density_g_cm3': 1.8, 'bottom_attenuation': 0.8}
TEMPLATE = '@project/at/tests/Munk/MunkK.env'
TERMINAL = {'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'}


class CheckError(Exception):
    """Fixed public diagnosis, never a raw network exception or response body."""


class RequestFailed(CheckError):
    def __init__(self, status: int | None):
        self.status = status
        super().__init__('Public HTTP request did not complete' if status is None else f'Public HTTP returned {status}')


def require(condition, label):
    if not condition:
        raise CheckError(label)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def origin_url(value):
    try:
        parsed = urlsplit(value)
        require(parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username
                and not parsed.password and parsed.path in ('', '/') and not parsed.query
                and not parsed.fragment and parsed.port in (None, 443), 'Invalid public HTTPS origin')
    except (ValueError, TypeError, AttributeError):
        raise CheckError('Invalid public HTTPS origin') from None
    return 'https://' + parsed.netloc.rstrip('/')


def proxy_url(value):
    if value is None or value == '':
        return None
    try:
        parsed = urlsplit(value)
        require(parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost')
                and not parsed.username and not parsed.password and parsed.path in ('', '/')
                and not parsed.query and not parsed.fragment and parsed.port is not None
                and 1 <= parsed.port <= 65535, 'Invalid explicit loopback proxy')
    except (ValueError, TypeError, AttributeError):
        raise CheckError('Invalid explicit loopback proxy') from None
    return f'http://{parsed.hostname}:{parsed.port}'


class LocalLock(AbstractContextManager):
    def __init__(self, path):
        self.path, self.stream = path, None

    def __enter__(self):
        self.stream = self.path.open('a+b')
        self.stream.seek(0, 2)
        if not self.stream.tell():
            self.stream.write(b'0')
            self.stream.flush()
        self.stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.stream.close()
            raise CheckError('Another public validation is already running') from None
        return self

    def __exit__(self, *args):
        if self.stream:
            self.stream.close()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class PublicClient:
    def __init__(self, site, proxy, cookie_path):
        self.site, self.cookie_path = site, cookie_path
        self.jar = MozillaCookieJar(str(cookie_path))
        if cookie_path.is_file():
            try:
                self.jar.load(ignore_discard=True, ignore_expires=True)
            except (OSError, ValueError):
                raise CheckError('Saved validation cookies could not be read; keep the existing receipt and restore the cookie file') from None
        # Explicitly ignore all ambient HTTP(S)_PROXY variables.
        self.opener = build_opener(ProxyHandler({'http': proxy, 'https': proxy} if proxy else {}),
                                   HTTPCookieProcessor(self.jar), NoRedirect())

    def save_cookies(self):
        temporary = self.cookie_path.with_suffix('.tmp')
        self.jar.save(str(temporary), ignore_discard=True, ignore_expires=True)
        temporary.replace(self.cookie_path)

    def cookie_fingerprint(self):
        host = urlsplit(self.site).hostname
        values = sorted((c.domain, c.path, c.name, c.value) for c in self.jar
                        if c.name == 'ocean_visitor' and c.domain.lstrip('.') == host)
        require(bool(values), 'Public site did not establish a persistent visitor cookie')
        return sha(json.dumps(values, separators=(',', ':')).encode())

    def request(self, path, method='GET', body=None, request_key=None, limit=5_000_000, timeout=60):
        require(path.startswith('/api/') and not path.startswith('//') and '://' not in path
                and '\\' not in path, 'Validation attempted an unapproved public route')
        headers = {'Accept': 'application/json', 'Origin': self.site,
                   'User-Agent': 'OceanPublicNodeValidation/1.0'}
        payload = None
        if body is not None:
            payload = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
            headers['Content-Type'] = 'application/json'
        if request_key:
            headers['Idempotency-Key'] = request_key
        request = Request(self.site + path, data=payload, method=method, headers=headers)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                data = response.read(limit + 1)
                require(len(data) <= limit, 'Public response exceeded the validation size limit')
                result = data, dict(response.headers), response.status
        except HTTPError as error:
            error.close()
            raise RequestFailed(error.code) from None
        except (URLError, TimeoutError, OSError):
            raise RequestFailed(None) from None
        finally:
            self.save_cookies()
        return result

    def json(self, path, method='GET', body=None, request_key=None, timeout=60):
        data, _, _ = self.request(path, method, body, request_key, timeout=timeout)
        try:
            return json.loads(data)
        except (ValueError, UnicodeError):
            raise CheckError('Public response was not valid JSON') from None


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def near(a, b, tolerance=0.05):
    return finite(a) and finite(b) and abs(a - b) <= tolerance


def validate_field(result, plan):
    """Independent input/SHD-derived JSON consistency checks, not physics proof."""
    require(isinstance(result, dict), 'Result must be an object')
    ranges, depths = result.get('ranges_m'), result.get('depths_m')
    require(isinstance(ranges, list) and isinstance(depths, list), 'Result axes are missing')
    require(len(ranges) == plan['range_points'] and len(depths) == plan['depth_points'], 'Result axis lengths differ from the submitted grid')
    for axis in (ranges, depths):
        require(all(finite(v) for v in axis) and all(a < b for a, b in zip(axis, axis[1:])), 'Result axes are nonfinite or not strictly increasing')
    for i, value in enumerate(ranges):
        expected = (plan['range_min_km'] + i * (plan['range_max_km'] - plan['range_min_km']) / (len(ranges) - 1)) * 1000
        require(near(value, expected), 'Range grid does not match requested kilometre-to-metre conversion')
    for i, value in enumerate(depths):
        require(near(value, i * 5000.0 / (len(depths) - 1)), 'Munk depth grid does not span 0 to 5000 metres')
    matrix, curve = result.get('tl_db'), result.get('curve_tl_db')
    require(result.get('shape') == [len(depths), len(ranges)], 'Declared field shape is inconsistent')
    require(isinstance(matrix, list) and len(matrix) == len(depths) and all(isinstance(row, list) and len(row) == len(ranges) for row in matrix), 'TL matrix has wrong axes or shape')
    require(all(v is None or finite(v) for row in matrix for v in row), 'TL values must be finite numbers or explicit masked nulls')
    values = [v for row in matrix for v in row if finite(v)]
    require(bool(values), 'There are no finite TL samples')
    ratio = len(values) / (len(depths) * len(ranges))
    require(near(result.get('valid_ratio'), ratio, 1e-7), 'Reported valid_ratio disagrees with actual finite samples')
    require(near(result.get('frequency_hz'), plan['frequencies_hz'][0], 1e-4), 'Actual frequency differs from submitted frequency')
    require(near(result.get('source_depth_m'), plan['source_depths_m'][0], 0.01), 'Actual source depth differs from submitted source depth')
    require(near(result.get('water_depth_m'), 5000.0), 'Actual water depth differs from the Munk template')
    require(near(result.get('requested_receiver_depth_m'), plan['receiver_depth_m'], 0.01), 'Recorded receiver request differs from submitted depth')
    nearest = min(range(len(depths)), key=lambda i: abs(depths[i] - plan['receiver_depth_m']))
    require(near(result.get('actual_receiver_depth_m'), depths[nearest]), 'Receiver was not selected from the nearest actual depth grid')
    require(near(result.get('receiver_depth_error_m'), abs(depths[nearest] - plan['receiver_depth_m']), 0.01), 'Receiver grid error is inconsistent')
    require(isinstance(curve, list) and len(curve) == len(ranges), 'Receiver curve length is inconsistent')
    for a, b in zip(curve, matrix[nearest]):
        require(a is None and b is None or near(a, b, 1e-5), 'Receiver curve is not the actual reported TL row')
    require(result.get('solver') == 'kraken' and result.get('environment_type') == 'munk_5000m', 'Solver or environment identity is incorrect')
    require(result.get('mode_addition') == plan['mode_addition'] and result.get('field_options') == 'RCOI', 'Modal addition or FIELD options differ from the submitted mode')
    require(isinstance(result.get('mode_count'), int) and result['mode_count'] > 0, 'KRAKEN returned no valid modes')
    return {'passed': True, 'shape': [len(depths), len(ranges)], 'finite_samples': len(values),
            'valid_ratio': ratio, 'receiver_depth_error_m': result['receiver_depth_error_m'],
            'mode_count': result['mode_count'], 'scope': 'Input/output consistency only; no convergence or physical-accuracy claim'}


def env_tokens(text):
    result = []
    for line in text.replace('\r\n', '\n').splitlines():
        line = line.split('!', 1)[0].strip()
        if not line:
            continue
        quoted = re.findall(r"'([^']*)'", line)
        numeric = re.sub(r"'[^']*'", '', line).replace('/', ' ').split()
        try:
            values = [float(v) for v in numeric]
        except ValueError:
            raise CheckError('ENV contains unexpected nonnumeric controls') from None
        require(all(math.isfinite(v) for v in values), 'ENV contains nonfinite controls')
        result.append([*quoted, *values])
    return result


def validate_env(case_text, reference_text, plan):
    original_lines = [line for line in reference_text.replace('\r\n', '\n').splitlines() if line.strip()]
    source_lines = [i for i, line in enumerate(original_lines) if re.search(r'!\s*NSD\b', line)]
    require(len(source_lines) == 1, 'Published Munk reference has no unique source-depth marker')
    require('Munk' in original_lines[0], 'Published reference is not the Munk template')
    modified = original_lines[:]
    modified[1] = str(plan['frequencies_hz'][0])
    index = source_lines[0]
    modified[index] = '1 ! NSD'
    modified[index + 1] = str(plan['source_depths_m'][0]) + ' / ! SD'
    require(env_tokens(case_text) == env_tokens('\n'.join(modified)), 'Computed ENV differs from the public Munk SSP/bottom/reference beyond the allowed frequency/source edits')
    return {'passed': True, 'reference': TEMPLATE, 'only_allowed_edits': ['frequency_hz', 'NSD=1', 'source_depth_m'],
            'ssp_and_bottom_unchanged': True, 'water_depth_m': 5000.0, 'case_env_sha256': sha(case_text.encode())}


def validate_zip(data, artifacts):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            require(len(entries) <= 1000 and sum(e.file_size for e in entries) <= 128_000_000, 'ZIP declared size exceeds the validation limit')
            require(all(e.filename and '/' not in e.filename and '\\' not in e.filename and e.filename not in ('.', '..') for e in entries), 'ZIP contains an unexpected path')
            require(len({e.filename for e in entries}) == len(entries), 'ZIP contains duplicate names')
            require(archive.testzip() is None, 'ZIP CRC validation failed')
            for name, expected in artifacts.items():
                require(name in archive.namelist() and archive.read(name) == expected, 'ZIP artifact differs from its direct download')
            return {'passed': True, 'file_count': len(entries), 'verified_direct_artifacts': sorted(artifacts), 'sha256': sha(data)}
    except (zipfile.BadZipFile, RuntimeError, OSError, KeyError):
        raise CheckError('Downloaded ZIP could not be verified') from None


def receipt_valid(value):
    return isinstance(value, dict) and isinstance(value.get('ids'), list) and len(value['ids']) == 1 and isinstance(value['ids'][0], str) and re.fullmatch(r'[a-f0-9]{12}', value['ids'][0]) and isinstance(value.get('batch_id'), str) and re.fullmatch(r'[a-f0-9]{32}', value['batch_id'])


def run_check(app_root, simulate=False, wait_seconds=300):
    app_root = app_root.resolve()
    folder = app_root / '.local/validation'
    folder.mkdir(parents=True, exist_ok=True)
    report_path = folder / 'public-node-report.json'
    report = {'schema_version': 1, 'created_at': datetime.now(timezone.utc).isoformat(),
              'mode': 'simulate' if simulate else 'check-only', 'submission_post_sent_this_invocation': False,
              'scope': 'Public connectivity and independent Munk input/output checks; not physical-accuracy certification'}
    try:
        with LocalLock(folder / 'public-node-check.lock'):
            try:
                settings = json.loads((app_root / '.local/public-runtime.json').read_text(encoding='utf-8-sig'))
                site, proxy = origin_url(settings.get('site_origin')), proxy_url(settings.get('outbound_proxy'))
            except (OSError, ValueError):
                raise CheckError('Public runtime configuration could not be read') from None
            client = PublicClient(site, proxy, folder / 'public-visitor.cookies.txt')
            report.update(site_origin=site, explicit_loopback_proxy=bool(proxy))
            health = client.json('/api/health')
            capabilities = client.json('/api/workbench/capabilities')
            require(isinstance(health, dict) and isinstance(capabilities, dict), 'Health/capability responses must be objects')
            online = capabilities.get('node_online') is True
            report['connectivity'] = {'public_http_ok': True, 'node_online': online,
                'matlab_available': health.get('matlab_available') is True,
                'solver_available': health.get('solver_available') is True,
                'script_execution': capabilities.get('script_execution'),
                'queue_admin': capabilities.get('queue_admin')}
            require(capabilities.get('script_execution') is False and capabilities.get('queue_admin') is False, 'Public execution boundary was not confirmed')
            require(online, 'Public site is reachable but its compute node is offline')
            require(health.get('matlab_available') is True and health.get('solver_available') is True, 'Node is connected but MATLAB/KRAKEN availability was not confirmed')
            if not simulate:
                report.update(passed=True, result='connectivity_passed', simulation={'executed': False, 'note': 'Read-only mode: no preview, submission or model call was sent'})
            else:
                fingerprint = client.cookie_fingerprint()
                plan_hash = sha(json.dumps(PLAN, sort_keys=True, separators=(',', ':')).encode())
                expected_key = 'public-munk-smoke-v1-' + plan_hash[:32]
                state_path = folder / 'public-munk-smoke-state.json'
                if state_path.is_file():
                    try:
                        state = json.loads(state_path.read_text(encoding='utf-8'))
                    except (OSError, ValueError):
                        raise CheckError('Existing validation receipt could not be read; no new task was submitted') from None
                    require(state.get('site_origin') == site and state.get('cookie_fingerprint') == fingerprint and state.get('plan_sha256') == plan_hash, 'Saved visitor or plan differs from the durable receipt; no new task was submitted')
                else:
                    state = {'version': 1, 'site_origin': site, 'cookie_fingerprint': fingerprint,
                             'plan_sha256': plan_hash, 'request_key': expected_key}
                    atomic_json(state_path, state)
                require(state.get('version') == 1 and state.get('request_key') == expected_key, 'Saved validation request identity is invalid; no new task was submitted')
                preview = client.json('/api/simulation/plans/preview', 'POST', PLAN)
                require(isinstance(preview, dict) and preview.get('case_count') == 1 and isinstance(preview.get('plan'), dict), 'Preview did not confirm exactly one validated case')
                require(all(preview['plan'].get(k) == v for k, v in PLAN.items()), 'Preview changed submitted parameters')
                receipt = state.get('receipt')
                if receipt is None:
                    for attempt in range(3):
                        try:
                            # The same saved visitor and key are used even if the
                            # node committed before an HTTP response was lost.
                            report['submission_post_sent_this_invocation'] = True
                            receipt = client.json('/api/simulation/jobs', 'POST', PLAN, state['request_key'])
                            break
                        except RequestFailed as error:
                            if attempt == 2 or error.status not in (None, 429, 500, 502, 503, 504):
                                raise
                            time.sleep(2)
                    require(receipt_valid(receipt), 'Node did not return one valid durable task receipt')
                    state['receipt'] = receipt
                    atomic_json(state_path, state)
                require(receipt_valid(receipt), 'Saved task receipt is invalid; no new task was submitted')
                require(client.cookie_fingerprint() == fingerprint, 'Visitor cookie changed during submission; keep the saved receipt for recovery')
                identity = receipt['ids'][0]
                deadline = time.monotonic() + min(300, wait_seconds)
                while True:
                    remaining = deadline - time.monotonic()
                    require(remaining > 0, 'Task did not reach a terminal state within the validation polling window; rerun with the same saved receipt')
                    try:
                        details = client.json('/api/jobs/' + identity, timeout=max(1, min(60, remaining)))
                    except RequestFailed as error:
                        if error.status not in (None, 429, 500, 502, 503, 504):
                            raise
                        time.sleep(min(2, max(0, deadline - time.monotonic())))
                        continue
                    require(isinstance(details, dict) and details.get('id') == identity, 'Task response does not match its durable receipt')
                    if details.get('state') in TERMINAL:
                        break
                    require(details.get('state') in ('QUEUED', 'RUNNING'), 'Task returned an unknown state')
                    time.sleep(min(2, max(0, deadline - time.monotonic())))
                report['simulation'] = {'id': identity, 'batch_id': receipt['batch_id'], 'state': details['state'], 'plan_sha256': plan_hash}
                require(details['state'] == 'SUCCEEDED', 'Validation task ended without success; its receipt was retained and it will not be resubmitted')
                require(isinstance(details.get('plan'), dict) and details['plan'].get('studio') is True and all(details['plan'].get(k) == v for k, v in PLAN.items()), 'Completed task plan differs from the submitted Studio plan')
                names = set(details.get('artifacts', []))
                require({'result.json', 'summary.json', 'case.env', 'case.json', 'case.prt', 'case.shd', 'run.log', 'tl_map.png', 'tl_curve.png', 'modes.json'} <= names, 'Completed task is missing required real solver artifacts')
                artifacts = {}
                for name in ('result.json', 'summary.json', 'case.env', 'case.json', 'run.log'):
                    artifacts[name] = client.request(f'/api/jobs/{identity}/artifact/{name}')[0]
                try:
                    result = json.loads(artifacts['result.json'].decode('utf-8-sig'))
                    summary = json.loads(artifacts['summary.json'].decode('utf-8-sig'))
                    case = json.loads(artifacts['case.json'].decode('utf-8-sig'))
                except (ValueError, UnicodeError):
                    raise CheckError('Downloaded solver JSON is invalid') from None
                require(isinstance(case, dict) and case.get('studio') is True and all(case.get(k) == v for k, v in PLAN.items()), 'Frozen case.json differs from the validated input')
                field_checks = validate_field(result, PLAN)
                require(isinstance(summary, dict) and near(summary.get('frequency_hz'), 50, 1e-4) and near(summary.get('source_depth_m'), 1000, 0.01) and summary.get('shape') == [51, 51], 'Summary identity or shape differs from actual results')
                require(isinstance(details.get('summary'), dict) and all(details['summary'].get(k) == v for k, v in summary.items()), 'Task details summary differs from the downloaded summary.json')
                log = artifacts['run.log'].decode('utf-8', errors='replace')
                require('OCEAN_STAGE: INPUT_VALIDATED' in log and 'OCEAN_STAGE: RESULT_VALIDATED 51 x 51' in log, 'Actual MATLAB validation markers are missing from run.log')
                reference = client.json('/api/project/file?' + urlencode({'path': TEMPLATE}))
                require(isinstance(reference, dict) and isinstance(reference.get('content'), str) and not reference.get('truncated'), 'Public Munk reference was unavailable or truncated')
                normalized_reference = reference['content'].replace('\r\n', '\n')
                require(reference.get('sha256') == sha(normalized_reference.encode()), 'Published Munk reference hash is inconsistent')
                env_checks = validate_env(artifacts['case.env'].decode('utf-8-sig'), normalized_reference, PLAN)
                archive, archive_headers, _ = client.request('/api/jobs/' + identity + '/download', limit=64_000_000)
                require('application/zip' in archive_headers.get('Content-Type', archive_headers.get('content-type', '')), 'Download endpoint did not return a ZIP')
                zip_checks = validate_zip(archive, artifacts)
                batch = client.json('/api/batches/' + receipt['batch_id'])
                require(isinstance(batch, dict) and batch.get('id') == receipt['batch_id'] and batch.get('complete') is True and {c.get('id') for c in batch.get('cases', [])} == {identity}, 'Visitor batch receipt differs from the completed task')
                output = folder / ('public-munk-' + identity)
                output.mkdir(exist_ok=True)
                for name, data in {**artifacts, 'task.zip': archive}.items():
                    (output / name).write_bytes(data)
                report['simulation'].update(field_checks=field_checks, env_checks=env_checks,
                    zip_checks=zip_checks, artifact_sha256={name: sha(data) for name, data in artifacts.items()},
                    artifact_bytes={name: len(data) for name, data in artifacts.items()}, batch_verified=True,
                    physical_accuracy_proven=False, note='Actual solver artifacts and coordinates checked; no convergence or experimental validation claimed')
                report.update(passed=True, result='simulation_verified')
    except CheckError as error:
        report.update(passed=False, result='not_verified', error=str(error))
        if isinstance(error, RequestFailed):
            report['http_status'] = error.status
    except Exception:
        # Never expose raw exceptions, headers, cookies or runtime configuration.
        report.update(passed=False, result='not_verified', error='Validation could not finish; existing cookies and receipts were retained')
    atomic_json(report_path, report)
    return report, report_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-root', type=Path, default=Path(__file__).resolve().parents[1] / 'ocean-acoustic-workbench')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check-only', action='store_true', help='Read-only health/capability check (default)')
    mode.add_argument('--simulate', action='store_true', help='Explicitly submit or resume the saved low-load Munk test')
    parser.add_argument('--wait-seconds', type=int, default=300, choices=range(1, 301), metavar='1..300')
    args = parser.parse_args()
    report, path = run_check(args.app_root, args.simulate, args.wait_seconds)
    print(json.dumps({'mode': report['mode'], 'passed': report['passed'], 'result': report['result'],
                      'node_online': report.get('connectivity', {}).get('node_online'),
                      'report': str(path)}, ensure_ascii=True))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
