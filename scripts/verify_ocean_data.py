"""Read an exported object set independently and compare with the original reader."""
from __future__ import annotations
import argparse
import gzip
import importlib.util
import json
import os
from pathlib import Path
import sys
import hashlib

import numpy as np
from netCDF4 import Dataset


def read_json_gzip(path):
    return json.loads(gzip.decompress(Path(path).read_bytes()))


def nearest(axis, value, circular=False):
    axis = np.asarray(axis)
    return int(np.argmin(np.abs((axis - value + 180) % 360 - 180) if circular else np.abs(axis - value)))


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for data in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(data)
    return digest.hexdigest()


class ExportReader:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.manifest = json.loads((self.folder / 'manifest.json').read_text(encoding='utf-8'))
        self.axes = read_json_gzip(self.folder / self.manifest['terrain']['axes_key'])
        self.cache = {}

    def terrain(self, lon, lat):
        meta = self.manifest['terrain']
        ix, iy = nearest(self.axes['lons'], lon), nearest(self.axes['lats'], lat)
        tile_size = meta['tile_size']
        by, bx = iy // tile_size, ix // tile_size
        key = meta['key_template'].format(tile_y=by, tile_x=bx)
        if key not in self.cache:
            height = min(tile_size, meta['shape'][0] - by * tile_size)
            width = min(tile_size, meta['shape'][1] - bx * tile_size)
            self.cache[key] = np.frombuffer((self.folder / key).read_bytes(), dtype='<i2').reshape(height, width)
        value = self.cache[key][iy % tile_size, ix % tile_size]
        return {'lon': self.axes['lons'][ix], 'lat': self.axes['lats'][iy], 'elevation_m': float(value)}

    def profile(self, lon, lat, period):
        lon = -180.0 if lon == 180 else lon
        bottom = self.terrain(lon, lat)
        if bottom['elevation_m'] >= 0:
            raise ValueError('该坐标的 ETOPO1 网格为陆地，请选择海洋位置')
        meta = self.manifest['profile']
        cell, ix, iy = self.profile_cell(lon, lat, period)
        if cell.get('error'):
            raise ValueError(cell['error'])
        source = next(item for item in meta['source_files'] if item['period_id'] == period)
        return {'requested': {'lon': lon, 'lat': lat}, 'selected': {'lon': meta['lons'][ix], 'lat': meta['lats'][iy]},
                'period': next(p['label'] for p in meta['periods'] if p['id'] == period), 'period_id': period,
                'rows': [dict(zip(meta['row_fields'], row)) for row in cell['rows']],
                'missing_depths_m': cell['missing_depths_m'], 'bottom': bottom, 'grid_bottom': cell['grid_bottom'],
                'depth_limit_m': cell['depth_limit_m'], 'missing_or_excluded_layers': cell['missing_or_excluded_layers'],
                'temperature_file': source['temperature_file'], 'salinity_file': source['salinity_file'],
                'method': meta['method'], 'warnings': meta['warnings']}

    def profile_cell(self, lon, lat, period):
        meta = self.manifest['profile']
        ix, iy = nearest(meta['lons'], lon, True), nearest(meta['lats'], lat)
        by, bx = iy // meta['tile_size'], ix // meta['tile_size']
        key = meta['key_template'].format(period=period, tile_y=by, tile_x=bx)
        if key not in self.cache:
            self.cache[key] = read_json_gzip(self.folder / key)
        cell = self.cache[key]['cells'][str(iy * meta['shape'][1] + ix)]
        return cell, ix, iy


def verify(folder, source, reader_path, points=None, check_hashes=True):
    """Force local comparison even when the caller normally uses the cloud service."""
    previous_url = os.environ.pop('OCEAN_DATA_URL', None)
    backend = str(Path(reader_path).absolute().parent)
    sys.path.insert(0, backend)
    try:
        return _verify_local(folder, source, reader_path, points, check_hashes)
    finally:
        sys.path.remove(backend)
        if previous_url is not None:
            os.environ['OCEAN_DATA_URL'] = previous_url


def _verify_local(folder, source, reader_path, points=None, check_hashes=True):
    export = ExportReader(folder)
    spec = importlib.util.spec_from_file_location('original_ocean_reader', reader_path)
    original = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(original)
    original.ROOT = Path(source)
    report = {'version': export.manifest['version'], 'complete': export.manifest['complete'], 'object_hashes_verified': 0, 'source_hashes_verified': 0,
              'raw_temperature_salinity_checks': 0, 'profiles': [], 'terrain': [], 'preview_samples': 0}
    if check_hashes:
        inventory_data = (Path(folder) / export.manifest['objects_manifest_key']).read_bytes()
        assert hashlib.sha256(inventory_data).hexdigest() == export.manifest['objects_manifest_sha256']
        inventory = json.loads(inventory_data)
        for item in inventory['objects']:
            data = (Path(folder) / item['key']).read_bytes()
            assert len(data) == item['bytes'], item['key']
            assert hashlib.sha256(data).hexdigest() == item['sha256'], item['key']
            report['object_hashes_verified'] += 1
        terrain_meta = export.manifest['terrain']
        assert sha256_file(Path(source) / terrain_meta['source_file']) == terrain_meta['source_sha256']
        report['source_hashes_verified'] += 1
        for source_meta in export.manifest['profile']['source_files']:
            for kind in ['temperature', 'salinity']:
                assert sha256_file(Path(source) / source_meta[kind + '_file']) == source_meta[kind + '_sha256']
                report['source_hashes_verified'] += 1
    points = points or [(120, 20), (120.2, 20.2), (119.8, 19.8), (120.5, 20.5)]
    for lon, lat in points:
        expected = original.terrain(lon, lat)
        assert export.terrain(lon, lat) == expected, (lon, lat)
        report['terrain'].append({'lon': lon, 'lat': lat, 'exact': True})
        for source_meta in export.manifest['profile']['source_files']:
            period = source_meta['period_id']
            cell, ix, iy = export.profile_cell(lon, lat, period)
            for name, field, variable in [('temperature_file', 'temperature_c', 't_an'), ('salinity_file', 'practical_salinity', 's_an')]:
                with Dataset(str(Path(source) / source_meta[name])) as ds:
                    raw = np.ma.filled(ds[variable][0, :, iy, ix], np.nan)
                np.testing.assert_array_equal(raw, np.asarray(cell[field], dtype=float))
                report['raw_temperature_salinity_checks'] += 1
            try:
                expected = original.profile(lon, lat, period)
            except ValueError as exc:
                try:
                    export.profile(lon, lat, period)
                except ValueError as actual_exc:
                    assert str(exc) == str(actual_exc), (lon, lat, period, str(exc), str(actual_exc))
                    report['profiles'].append({'lon': lon, 'lat': lat, 'period': period, 'expected_error': str(exc), 'exact': True})
                else:
                    raise AssertionError('Export did not reject an invalid original profile')
                continue
            actual = export.profile(lon, lat, period)
            assert expected == actual, (lon, lat, period, 'Profile JSON values differ')
            report['profiles'].append({'lon': lon, 'lat': lat, 'period': period, 'layers': len(actual['rows']), 'max_abs_difference': 0, 'exact': True})
    with Dataset(str(Path(source) / 'terrain/ETOPO1_Bed_g_gmt4.grd')) as ds:
        for level in export.manifest['terrain']['preview_levels']:
            axes = read_json_gzip(Path(folder) / level['axes_key'])
            ny, nx = level['shape']
            for iy, ix in [(0, 0), (ny // 2, nx // 2), (ny - 1, nx - 1)]:
                by, bx = iy // level['tile_size'], ix // level['tile_size']
                h, w = min(level['tile_size'], ny - by * level['tile_size']), min(level['tile_size'], nx - bx * level['tile_size'])
                key = level['key_template'].format(tile_y=by, tile_x=bx)
                data = np.frombuffer((Path(folder) / key).read_bytes(), dtype='<i2').reshape(h, w)
                x = nearest(export.axes['lons'], axes['lons'][ix])
                y = nearest(export.axes['lats'], axes['lats'][iy])
                assert data[iy % level['tile_size'], ix % level['tile_size']] == ds['z'][y, x]
                report['preview_samples'] += 1
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    repo = Path(__file__).absolute().parents[1]
    app = repo / 'ocean-acoustic-workbench'
    parser.add_argument('folder', type=Path)
    parser.add_argument('--source', type=Path, help='Original data path, or OCEAN_DATA_DIR/local application config')
    parser.add_argument('--reader', type=Path, default=app / 'backend/ocean_data.py')
    parser.add_argument('--global-points', action='store_true')
    parser.add_argument('--skip-hashes', action='store_true')
    args = parser.parse_args()
    points = [(120, 20), (120.2, 20.2), (-30, 40), (150, -30), (0, 0), (180, 0), (-180, 0), (0.5, 0.5), (116, 40), (0, 90), (0, -90)] if args.global_points else None
    # Import the portable locator only after argparse, so --help needs no data.
    from export_ocean_data import source_directory
    try:
        source = source_directory(args.source)
    except ValueError as error:
        parser.error(str(error))
    result = verify(args.folder, source, args.reader, points, not args.skip_hashes)
    (args.folder / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
