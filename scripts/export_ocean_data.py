"""Create immutable, browser-queryable WOA18/ETOPO1 objects from local originals.

No source files are modified. Output stays outside the repository by default.
See ocean_format.md for the independent Worker/browser contract.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time

import gsw
import numpy as np
from netCDF4 import Dataset

REPO = Path(__file__).absolute().parents[1]
DEFAULT_OUTPUT = REPO / '.local/ocean-cloud-export'
VERSION = 'woa18-etopo1-v1'
ROW_FIELDS = ['depth_m', 'temperature_c', 'practical_salinity', 'pressure_dbar',
              'absolute_salinity_g_kg', 'sound_speed_m_s']
WARNINGS = ['2005—2017年温盐气候平均场，非实时观测。',
            '采用最近1°温盐格点，不进行空间插值；地形来自1角分ETOPO1基岩版本。',
            '只保留有效且不深于温盐格点海底的层；未填补缺测，未外推到海底。',
            '单点环境剖面不包含传播路径、海底声学参数和声源接收设置，尚不能直接代替完整仿真环境。']
PERIODS = [{'id': 0, 'label': '年平均'}] + [{'id': m, 'label': f'{m}月'} for m in range(1, 13)] + [
    {'id': m, 'label': label} for m, label in [(13, '1—3月'), (14, '4—6月'), (15, '7—9月'), (16, '10—12月')]]


def source_directory(explicit=None, repo=None, environ=None):
    """Locate the owner's originals without depending on a particular checkout path."""
    repo = REPO if repo is None else Path(repo)
    environ = os.environ if environ is None else environ
    value = explicit if explicit is not None else environ.get('OCEAN_DATA_DIR')
    if value:
        if not isinstance(value, (str, os.PathLike)):
            raise ValueError('The original data path must be a string or filesystem path')
        return Path(value).expanduser().absolute()
    app = repo / 'ocean-acoustic-workbench'
    config = app / '.local/config.json'
    if config.is_file():
        try:
            settings = json.loads(config.read_text(encoding='utf-8'))
            if not isinstance(settings, dict):
                raise ValueError('Configuration must be an object')
            value = settings.get('ocean_data_path')
        except (OSError, ValueError, TypeError):
            raise ValueError('Cannot read local data configuration; pass --source explicitly') from None
        if value:
            if not isinstance(value, str):
                raise ValueError('ocean_data_path must be a filesystem path string; pass --source explicitly')
            path = Path(value).expanduser()
            return (path if path.is_absolute() else app / path).absolute()
    raise ValueError('Set --source, OCEAN_DATA_DIR, or ocean_data_path in ocean-acoustic-workbench/.local/config.json')


def progress(event, **values):
    print(json.dumps({'event': event, **values}, ensure_ascii=False), flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def encode_json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


def nearest(axis, value, circular=False):
    """Reference argmin semantics, including first-index ties and circular longitude."""
    axis = np.asarray(axis)
    distance = np.abs((axis - value + 180) % 360 - 180) if circular else np.abs(axis - value)
    return int(np.argmin(distance))


def selected_tiles(axis, lower, upper, tile_size):
    # Include nearest boundary cells too; this is a test subset, not a new grid.
    lo = max(0, min(nearest(axis, lower), int(np.searchsorted(axis, lower))))
    hi = min(len(axis) - 1, max(nearest(axis, upper), int(np.searchsorted(axis, upper))))
    return range(lo // tile_size, hi // tile_size + 1)


def preview_indices(length, stride):
    indices = np.arange(0, length, stride, dtype=int)
    if indices[-1] != length - 1:
        indices = np.append(indices, length - 1)
    return indices


def numeric_i16(values):
    values = np.ma.asarray(values)
    if np.ma.getmaskarray(values).any():
        raise ValueError('ETOPO contains masked samples; i16 v1 has no missing-value sentinel')
    data = np.asarray(values)
    if not np.isfinite(data).all() or (data < -32768).any() or (data > 32767).any() or (data != np.trunc(data)).any():
        raise ValueError('ETOPO elevations cannot be represented losslessly as int16')
    return data.astype('<i2', copy=False).tobytes(order='C')


class ObjectWriter:
    def __init__(self, output):
        self.output = Path(output)
        self.objects = []
        self.total_bytes = 0

    def write(self, key, data, content_type):
        path = self.output / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self.objects.append({'key': key, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'content_type': content_type})
        self.total_bytes += len(data)

    def json_gzip(self, key, value):
        self.write(key, gzip.compress(encode_json(value), compresslevel=6, mtime=0), 'application/gzip')


def raw_list(values):
    return [float(v) if np.isfinite(v) else None for v in values]


def export(source=None, output=DEFAULT_OUTPUT, periods=None, bounds=None,
           preview_strides=(4, 16, 64, 128), force=False, native_only=False):
    source, output = source_directory(source), Path(output).absolute()
    # Resolve only for path safety. NetCDF gets the original ASCII junction path.
    src_check, out_check = source.resolve(), output.resolve()
    if out_check == src_check or src_check in out_check.parents or out_check in src_check.parents:
        raise ValueError('Output must be separate from the original data directory')
    if not source.is_dir():
        raise FileNotFoundError(f'Data source does not exist: {source}')
    if (output / 'manifest.json').exists() and not force:
        raise FileExistsError('Output manifest already exists; use a fresh directory or --force')
    output.mkdir(parents=True, exist_ok=True)
    periods = list(range(17)) if periods is None else sorted(set(periods))
    if not periods or any(p not in range(17) for p in periods):
        raise ValueError('periods must contain integers in 0..16')
    if bounds is not None:
        west, east, south, north = bounds
        if not np.isfinite(bounds).all() or not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError('bounds must be west,east,south,north within the globe')
    if any(s < 1 for s in preview_strides):
        raise ValueError('Preview strides must be positive')
    start = time.monotonic()
    writer = ObjectWriter(output)
    terrain_path = source / 'terrain/ETOPO1_Bed_g_gmt4.grd'
    progress('source_hashing', file='terrain/ETOPO1_Bed_g_gmt4.grd')
    terrain_hash = sha256_file(terrain_path)
    terrain_meta = {'shape': None, 'tile_size': 300, 'dtype': 'int16', 'byte_order': 'little',
                    'axes_key': 'terrain/axes.json.gz', 'key_template': 'terrain/native/y{tile_y:03d}_x{tile_x:03d}.i16.bin',
                    'preview_levels': [], 'source_file': 'terrain/ETOPO1_Bed_g_gmt4.grd', 'source_sha256': terrain_hash,
                    'units': 'm', 'source': 'ETOPO1 基岩高程（m，相对海平面）'}
    profile_meta = {'shape': None, 'tile_size': 10, 'lons': None, 'lats': None,
                    'row_fields': ROW_FIELDS, 'key_template': 'profiles/p{period:02d}/y{tile_y:02d}_x{tile_x:02d}.json.gz',
                    'periods': PERIODS, 'source_files': [], 'method': 'TEOS-10 / GSW sound_speed_t_exact', 'warnings': WARNINGS}

    with Dataset(str(terrain_path)) as terrain_ds:
        tx = np.asarray(terrain_ds['x'][:], dtype=float)
        ty = np.asarray(terrain_ds['y'][:], dtype=float)
        if (np.diff(tx) <= 0).any() or (np.diff(ty) <= 0).any():
            raise ValueError('Terrain coordinates must be strictly increasing')
        terrain_meta['shape'] = [len(ty), len(tx)]
        writer.json_gzip(terrain_meta['axes_key'], {'lons': tx.tolist(), 'lats': ty.tolist()})
        native_ys = range(math.ceil(len(ty) / 300)) if bounds is None else selected_tiles(ty, south, north, 300)
        native_xs = range(math.ceil(len(tx) / 300)) if bounds is None else selected_tiles(tx, west, east, 300)
        total = len(native_ys) * len(native_xs)
        completed = 0
        for by in native_ys:
            for bx in native_xs:
                data = terrain_ds['z'][by * 300:min((by + 1) * 300, len(ty)), bx * 300:min((bx + 1) * 300, len(tx))]
                writer.write(f'terrain/native/y{by:03d}_x{bx:03d}.i16.bin', numeric_i16(data), 'application/octet-stream')
                completed += 1
                if completed % 150 == 0 or completed == total:
                    progress('terrain_native', completed=completed, total=total, bytes=writer.total_bytes)

        if not native_only:
            for stride in sorted(set(preview_strides)):
                xi, yi = preview_indices(len(tx), stride), preview_indices(len(ty), stride)
                level = {'stride': stride, 'shape': [len(yi), len(xi)],
                         'axes_key': f'terrain/preview/s{stride:03d}/axes.json.gz',
                         'tile_size': 256, 'key_template': f'terrain/preview/s{stride:03d}/y{{tile_y:03d}}_x{{tile_x:03d}}.i16.bin'}
                terrain_meta['preview_levels'].append(level)
                writer.json_gzip(level['axes_key'], {'lons': tx[xi].tolist(), 'lats': ty[yi].tolist()})
                # Previews are always global, even in a local verification export.
                for by in range(math.ceil(len(yi) / 256)):
                    for bx in range(math.ceil(len(xi) / 256)):
                        ys, xs = yi[by * 256:(by + 1) * 256], xi[bx * 256:(bx + 1) * 256]
                        data = terrain_ds['z'][ys, xs]
                        writer.write(f'terrain/preview/s{stride:03d}/y{by:03d}_x{bx:03d}.i16.bin', numeric_i16(data), 'application/octet-stream')
                progress('terrain_preview', stride=stride, shape=level['shape'])

        expected_lons = expected_lats = None
        grid_bottom = grid_bottom_lon = grid_bottom_lat = None
        for period in periods:
            tp = list(source.rglob(f'woa18_A5B7_t{period:02d}_01.nc'))
            sp = list(source.rglob(f'woa18_A5B7_s{period:02d}_01.nc'))
            if len(tp) != 1 or len(sp) != 1:
                raise ValueError(f'Missing or duplicate temperature/salinity source for period {period}')
            source_files = {'period_id': period, 'temperature_file': tp[0].relative_to(source).as_posix(),
                            'salinity_file': sp[0].relative_to(source).as_posix(),
                            'temperature_sha256': sha256_file(tp[0]), 'salinity_sha256': sha256_file(sp[0])}
            with Dataset(str(tp[0])) as t, Dataset(str(sp[0])) as s:
                lons, lats, depth = (np.asarray(t[name][:], dtype=float) for name in ['lon', 'lat', 'depth'])
                if not all(np.array_equal(t[name][:], s[name][:]) for name in ['lon', 'lat', 'depth']):
                    raise ValueError(f'Temperature/salinity axes mismatch in period {period}')
                if expected_lons is None:
                    expected_lons, expected_lats = lons, lats
                    profile_meta.update(shape=[len(lats), len(lons)], lons=lons.tolist(), lats=lats.tolist())
                    xi = np.array([nearest(tx, lon) for lon in lons])
                    yi = np.array([nearest(ty, lat) for lat in lats])
                    grid_bottom = np.asarray(terrain_ds['z'][yi, xi])
                    grid_bottom_lon, grid_bottom_lat = tx[xi], ty[yi]
                elif not np.array_equal(lons, expected_lons) or not np.array_equal(lats, expected_lats):
                    raise ValueError('WOA coordinate grid changes across periods')
                source_files['depths_m'] = depth.tolist()
                profile_meta['source_files'].append(source_files)
                ytiles = range(math.ceil(len(lats) / 10)) if bounds is None else selected_tiles(lats, south, north, 10)
                xtiles = range(math.ceil(len(lons) / 10)) if bounds is None else selected_tiles(lons, west, east, 10)
                ntiles = len(ytiles) * len(xtiles)
                completed = 0
                for by in ytiles:
                    for bx in xtiles:
                        y0, x0 = by * 10, bx * 10
                        ys, xs = slice(y0, min(y0 + 10, len(lats))), slice(x0, min(x0 + 10, len(lons)))
                        tv = np.ma.filled(t['t_an'][0, :, ys, xs], np.nan)
                        sv = np.ma.filled(s['s_an'][0, :, ys, xs], np.nan)
                        seabed = grid_bottom[ys, xs]
                        paired = np.isfinite(tv) & np.isfinite(sv)
                        valid = paired & (depth[:, None, None] <= -seabed[None, :, :]) & (seabed[None, :, :] < 0)
                        pressure = np.broadcast_to(gsw.p_from_z(-depth[:, None, None], lats[ys][None, :, None]), tv.shape)
                        absolute = np.full(tv.shape, np.nan, dtype=float)
                        sound = np.full(tv.shape, np.nan, dtype=float)
                        if valid.any():
                            latitude = np.broadcast_to(lats[ys][None, :, None], tv.shape)
                            longitude = np.broadcast_to(lons[xs][None, None, :], tv.shape)
                            absolute[valid] = gsw.SA_from_SP(sv[valid], pressure[valid], longitude[valid], latitude[valid])
                            sound[valid] = gsw.sound_speed_t_exact(absolute[valid], tv[valid], pressure[valid])
                        cells = {}
                        for ly in range(tv.shape[1]):
                            for lx in range(tv.shape[2]):
                                iy, ix = y0 + ly, x0 + lx
                                mask = valid[:, ly, lx]
                                error = None
                                if seabed[ly, lx] >= 0:
                                    error = '最近的1°温盐网格位于陆地，未自动跨海岸寻找其他剖面'
                                elif mask.sum() < 2:
                                    error = '最近的温盐网格有效层不足，可能位于陆地或沿岸缺测区'
                                elif not np.isfinite(sound[:, ly, lx][mask]).all():
                                    error = '声速计算存在无效值'
                                rows = [] if error else np.column_stack((depth[mask], tv[:, ly, lx][mask], sv[:, ly, lx][mask],
                                    pressure[:, ly, lx][mask], absolute[:, ly, lx][mask], sound[:, ly, lx][mask])).tolist()
                                cells[str(iy * len(lons) + ix)] = {'rows': rows,
                                    'temperature_c': raw_list(tv[:, ly, lx]), 'practical_salinity': raw_list(sv[:, ly, lx]),
                                    'missing_depths_m': depth[~paired[:, ly, lx]].tolist(),
                                    'missing_or_excluded_layers': int(len(depth) - mask.sum()),
                                    'depth_limit_m': float(depth[mask][-1]) if rows else None,
                                    'grid_bottom': {'lon': float(grid_bottom_lon[ix]), 'lat': float(grid_bottom_lat[iy]), 'elevation_m': float(seabed[ly, lx])},
                                    'error': error}
                        writer.json_gzip(f'profiles/p{period:02d}/y{by:02d}_x{bx:02d}.json.gz',
                                         {'schema_version': 1, 'period_id': period, 'tile_y': by, 'tile_x': bx, 'cells': cells})
                        completed += 1
                        if completed % 150 == 0:
                            progress('profiles_tiles', period=period, completed=completed, total=ntiles, seconds=round(time.monotonic() - start, 1))
                progress('profiles_period', period=period, tiles=completed, total_bytes=writer.total_bytes, seconds=round(time.monotonic() - start, 1))

    inventory = {'schema_version': 1, 'version': VERSION, 'objects': writer.objects,
                 'total_bytes': writer.total_bytes, 'total_objects': len(writer.objects)}
    (output / 'objects.json').write_bytes(encode_json(inventory))
    manifest = {'schema_version': 1, 'version': VERSION, 'complete': bounds is None and periods == list(range(17)) and not native_only,
                'created_at': datetime.now(timezone.utc).isoformat(), 'source_dataset': 'WOA18 A5B7 2005—2017 + ETOPO1 Bedrock',
                'objects_manifest_key': 'objects.json', 'objects_manifest_sha256': sha256_file(output / 'objects.json'),
                'totals': {'bytes': writer.total_bytes, 'objects': len(writer.objects)},
                'profile': profile_meta, 'terrain': terrain_meta, 'gsw_version': gsw.__version__, 'numpy_version': np.__version__,
                'exporter_sha256': sha256_file(__file__), 'export_parameters': {'periods': periods, 'bounds': bounds, 'preview_strides': list(preview_strides)}}
    manifest_bytes = encode_json(manifest)
    if len(manifest_bytes) >= 100_000:
        raise ValueError(f'Query manifest grew beyond 100 KB: {len(manifest_bytes)}')
    (output / 'manifest.json').write_bytes(manifest_bytes)
    progress('finished', version=VERSION, complete=manifest['complete'], objects=len(writer.objects), bytes=writer.total_bytes,
             manifest_bytes=len(manifest_bytes), seconds=round(time.monotonic() - start, 1), output=str(output))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Original data directory; otherwise use OCEAN_DATA_DIR or the local application config')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT, help='Export directory (default: this repository/.local/ocean-cloud-export)')
    parser.add_argument('--periods', help='Comma-separated periods in 0..16; omitted means all')
    parser.add_argument('--bounds', help='west,east,south,north test bounds; omitted means global')
    parser.add_argument('--preview-strides', default='4,16,64,128')
    parser.add_argument('--force', action='store_true', help='Replace exported objects, never original data')
    parser.add_argument('--native-only', action='store_true', help='Skip previews for an explicit incomplete test export')
    args = parser.parse_args()
    try:
        export(args.source, args.output, None if not args.periods else [int(x) for x in args.periods.split(',')],
               None if not args.bounds else [float(x) for x in args.bounds.split(',')],
               tuple(int(x) for x in args.preview_strides.split(',')), args.force, args.native_only)
    except (ValueError, FileNotFoundError, FileExistsError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
