"""Scientific storage invariants for the publisher, using small synthetic NetCDF files."""
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import gsw
import numpy as np
from netCDF4 import Dataset

spec = importlib.util.spec_from_file_location('export_ocean', Path(__file__).parents[1] / 'scripts/export_ocean_data.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExportTests(unittest.TestCase):
    def test_native_elevation_conversion_is_lossless_or_rejected(self):
        a = np.array([[-12000, -1, 0], [1, 9000, 32767]], dtype='i4')
        np.testing.assert_array_equal(np.frombuffer(module.numeric_i16(a), dtype='<i2').reshape(a.shape), a)
        for bad in [np.array([32768]), np.array([1.1]), np.ma.masked_array([0], mask=[True])]:
            with self.assertRaises(ValueError):
                module.numeric_i16(bad)

    def test_nearest_ties_and_dateline_are_first_index(self):
        self.assertEqual(module.nearest([-1, 1], 0), 0)
        self.assertEqual(module.nearest([-179.5, 179.5], -180, True), 0)
        self.assertEqual(module.nearest([-179.5, 179.5], 180, True), 0)
        self.assertEqual(module.nearest([-179.5, 179.5], 179.9, True), 1)

    def test_small_export_preserves_raw_masks_and_gsw(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / 'source', Path(tmp) / 'output'
            (source / 'terrain').mkdir(parents=True)
            (source / 'ssp').mkdir()
            with Dataset(str(source / 'terrain/ETOPO1_Bed_g_gmt4.grd'), 'w') as ds:
                ds.createDimension('x', 7); ds.createDimension('y', 5)
                ds.createVariable('x', 'f8', ('x',))[:] = np.arange(-3, 4)
                ds.createVariable('y', 'f8', ('y',))[:] = np.arange(-2, 3)
                z = np.full((5, 7), -50, dtype='i4'); z[2, 3] = 20
                ds.createVariable('z', 'i4', ('y', 'x'))[:] = z
            for var, values in [('t', [25, 20, 10]), ('s', [35, 35, 35])]:
                with Dataset(str(source / f'ssp/woa18_A5B7_{var}00_01.nc'), 'w') as ds:
                    for key, count in [('time', 1), ('depth', 3), ('lat', 3), ('lon', 3)]:
                        ds.createDimension(key, count)
                    ds.createVariable('lon', 'f4', ('lon',))[:] = [-1, 0, 1]
                    ds.createVariable('lat', 'f4', ('lat',))[:] = [-1, 0, 1]
                    ds.createVariable('depth', 'f4', ('depth',))[:] = [0, 10, 100]
                    data = np.broadcast_to(np.array(values, dtype='f4')[None, :, None, None], (1, 3, 3, 3)).copy()
                    data[0, 1, 0, 0] = -9999
                    ds.createVariable(var + '_an', 'f4', ('time', 'depth', 'lat', 'lon'), fill_value=-9999)[:] = data
            manifest = module.export(source, output, periods=[0], preview_strides=(2, 4))
            self.assertFalse(manifest['complete'])
            self.assertLess((output / 'manifest.json').stat().st_size, 100_000)
            tile = json.loads(gzip.decompress((output / 'profiles/p00/y00_x00.json.gz').read_bytes()))
            self.assertIsNone(tile['cells']['0']['temperature_c'][1])
            self.assertEqual(tile['cells']['0']['missing_depths_m'], [10])
            self.assertIn('不足', tile['cells']['0']['error'])
            self.assertIn('陆地', tile['cells']['4']['error'])
            cell = tile['cells']['8']
            self.assertEqual(cell['temperature_c'], [25, 20, 10])
            self.assertEqual([row[0] for row in cell['rows']], [0, 10])
            self.assertEqual(cell['missing_or_excluded_layers'], 1)
            pressure = gsw.p_from_z(-np.array([0., 10.]), 1.)
            absolute = gsw.SA_from_SP(np.array([35., 35.]), pressure, 1., 1.)
            speed = gsw.sound_speed_t_exact(absolute, np.array([25., 20.]), pressure)
            np.testing.assert_array_equal(np.asarray(cell['rows'])[:, 3], pressure)
            np.testing.assert_array_equal(np.asarray(cell['rows'])[:, 4], absolute)
            np.testing.assert_array_equal(np.asarray(cell['rows'])[:, 5], speed)
            original = (source / 'terrain/ETOPO1_Bed_g_gmt4.grd').read_bytes()
            self.assertEqual(module.sha256_file(source / 'terrain/ETOPO1_Bed_g_gmt4.grd'), manifest['terrain']['source_sha256'])
            self.assertGreater(len(original), 0)


if __name__ == '__main__':
    unittest.main()
