#!/usr/bin/env python3
"""Read-only live ocean-data smoke test; never sends cookies, keys or source files."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', required=True, help='Public Site origin, without path or credentials')
    parser.add_argument('--lon', type=float, default=120)
    parser.add_argument('--lat', type=float, default=20)
    parser.add_argument('--timeout', type=float, default=30)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=3)
    parser.add_argument('--report', type=Path, help='Optional summary JSON; no full profiles are written')
    args = parser.parse_args()
    parsed = urlsplit(args.site)
    if (parsed.scheme not in ('https', 'http') or not parsed.netloc or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ('', '/')
            or (parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'))):
        parser.error('--site must be an HTTPS origin or an HTTP loopback origin, without credentials or path')
    if (not math.isfinite(args.lon) or not math.isfinite(args.lat) or not -180 <= args.lon <= 180
            or not -90 <= args.lat <= 90 or not math.isfinite(args.timeout) or not 1 <= args.timeout <= 120):
        parser.error('Coordinates or timeout are outside their allowed range')
    base = args.site.rstrip('/') + '/api/ocean-data'

    def fetch(path):
        try:
            with urlopen(Request(base + path, headers={'User-Agent': 'Ocean-course-functional-validation/1.0'}), timeout=args.timeout) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                status = response.status
        except HTTPError as error:
            status = error.code
            raw = error.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError('Response exceeded 8 MiB')
        return status, json.loads(raw), raw

    report = {'site': args.site.rstrip('/'), 'checked_at_utc': datetime.now(timezone.utc).isoformat(),
              'scope': 'One selected ocean point across 17 climatological periods; map and error-route smoke checks, not global scientific validation.',
              'checks': [], 'passed': 0, 'total': 23}
    try:
        catalog = None
        for attempt in range(3):
            try:
                status, catalog, _ = fetch('')
                assert status == 200 and catalog.get('available') is True, 'Ocean catalog is unavailable'
                assert sorted(p['id'] for p in catalog['periods']) == list(range(17)), 'Catalog does not expose all 17 periods'
                assert isinstance(catalog.get('dataset_version'), str) and catalog['dataset_version'], 'Data version is missing'
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(1)
        version = catalog['dataset_version']
        report['dataset_version'] = version
        queries = [(f'period_{i}', '/profile?' + urlencode({'lon': args.lon, 'lat': args.lat, 'period': i, 'version': version}), 200) for i in range(17)]
        queries += [('land', '/profile?lon=108.9&lat=34.2&period=0', 422),
                    ('invalid_lat', '/profile?lon=120&lat=91&period=0', 422),
                    ('old_version', '/profile?lon=120&lat=20&period=0&version=smoke-invalid-version', 409),
                    ('map_region', '/terrain?west=95&east=145&south=-5&north=45', 200),
                    ('map_global', '/terrain?west=-180&east=180&south=-90&north=90', 200),
                    ('map_close', '/terrain?west=119.9&east=120.1&south=19.9&north=20.1', 200)]

        def check(item):
            name, query, expected = item
            for attempt in range(3):
                try:
                    status, data, raw = fetch(query)
                    assert status == expected, f'Expected HTTP {expected}, received {status}'
                    result = {'name': name, 'status': status, 'passed': True}
                    if name.startswith('period_'):
                        rows = data['rows']
                        assert len(rows) >= 2 and data['period_id'] == int(name.split('_')[1]), 'Profile layers or period mismatch'
                        assert data['dataset_version'] == version, 'Profile data version changed'
                        assert all(all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in row.values()) for row in rows), 'Non-finite profile value'
                        assert all(a['depth_m'] < b['depth_m'] for a, b in zip(rows, rows[1:])), 'Depth axis is not increasing'
                        assert rows[-1]['depth_m'] <= -data['grid_bottom']['elevation_m'], 'Profile extends below its grid seabed'
                        result.update(layers=len(rows), max_depth_m=rows[-1]['depth_m'], sha256=hashlib.sha256(raw).hexdigest())
                    elif name.startswith('map_'):
                        assert len(data['elevation_m']) == len(data['lats']), 'Terrain latitude size mismatch'
                        assert data['lats'] and data['lons'] and all(len(row) == len(data['lons']) for row in data['elevation_m']), 'Terrain grid is empty or ragged'
                        assert len(data['lats']) <= 160 and len(data['lons']) <= 240, 'Terrain response exceeds its grid budget'
                        result.update(shape=[len(data['lats']), len(data['lons'])], stride=data.get('preview_stride'))
                    return result
                except Exception as error:
                    if attempt == 2:
                        detail = str(error)[:160] if isinstance(error, (AssertionError, ValueError, KeyError)) else type(error).__name__
                        return {'name': name, 'passed': False, 'error': detail}
                    time.sleep(1)

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            report['checks'] = list(pool.map(check, queries))
        report['passed'] = sum(item['passed'] for item in report['checks'])
    except Exception as error:
        report['catalog_error'] = str(error)[:160] if isinstance(error, (AssertionError, ValueError, KeyError)) else type(error).__name__
    output = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output, encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, separators=(',', ':'), allow_nan=False))
    return 0 if report['passed'] == report['total'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
