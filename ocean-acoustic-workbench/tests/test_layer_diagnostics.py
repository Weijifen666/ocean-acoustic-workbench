"""Scientific invariants for the shared, deterministic layer diagnostic wrapper."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import gsw
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import layer_diagnostics as layers


def profile(depths=(0., 10., 20., 40.), potential_temperature=None, salinity=None, lat=65.):
    """Build hydrostatically consistent synthetic inputs with known pt0/SA."""
    depths = np.asarray(depths, dtype=float)
    pt = np.full(len(depths), 20.) if potential_temperature is None else np.asarray(potential_temperature, dtype=float)
    sa = np.full(len(depths), 35.) if salinity is None else np.asarray(salinity, dtype=float)
    pressure = gsw.p_from_z(-depths, lat)
    practical = gsw.SP_from_SA(sa, pressure, 120.5, lat)
    temperature = gsw.t_from_CT(sa, gsw.CT_from_pt(sa, pt), pressure)
    sound = gsw.sound_speed_t_exact(sa, temperature, pressure)
    return {
        "requested": {"lon": 120., "lat": lat + .1},
        "selected": {"lon": 120.5, "lat": lat},
        "period_id": 16, "period": "10—12月",
        "rows": [dict(zip(
            ("depth_m", "temperature_c", "practical_salinity", "sound_speed_m_s"),
            map(float, values),
        )) for values in zip(depths, temperature, practical, sound)],
        "missing_depths_m": [], "missing_or_excluded_layers": 0,
        "temperature_file": "synthetic-temperature", "salinity_file": "synthetic-salinity",
        "method": "Synthetic constant-SA/known-potential-temperature test profile",
        "bottom": {"lon": 120., "lat": lat + .1, "elevation_m": -1500.},
        "grid_bottom": {"lon": 120.5, "lat": lat, "elevation_m": -1400.},
    }


class LayerDiagnosticsTests(unittest.TestCase):
    def diagnose(self, value, **parameters):
        return layers.diagnose_profiles([value], **parameters)["results"][0]

    def test_potential_temperature_crossing_interpolates_between_samples(self):
        value = profile(potential_temperature=[20., 20., 19.9, 19.7])
        result = self.diagnose(value)
        self.assertEqual(result["temperature_mld"]["status"], "crossed")
        self.assertAlmostEqual(result["temperature_mld"]["depth_m"], 30., places=7)
        self.assertNotIn(result["temperature_mld"]["depth_m"], [r["depth_m"] for r in value["rows"]])
        # A 10 m reference absent from the grid must itself be interpolated.
        value = profile(depths=[0., 20., 40.], potential_temperature=[20., 19.8, 19.6])
        result = self.diagnose(value)
        self.assertAlmostEqual(result["temperature_mld"]["depth_m"], 30., places=7)

    def test_density_crossing_uses_potential_density_and_declared_threshold(self):
        value = profile(salinity=[35., 35., 35.04, 35.12])
        p = gsw.p_from_z(-np.asarray([0., 10., 20., 40.]), 65.)
        sa = np.asarray([35., 35., 35.04, 35.12])
        t = gsw.t_from_CT(sa, gsw.CT_from_pt(sa, np.full(4, 20.)), p)
        sigma = gsw.sigma0(sa, gsw.CT_from_t(sa, t, p))
        threshold = float((sigma[2] + sigma[3]) / 2 - sigma[1])
        result = self.diagnose(value, density_threshold=threshold)
        self.assertEqual(result["density_mld"]["status"], "crossed")
        self.assertAlmostEqual(result["density_mld"]["depth_m"], 30., places=7)

    def test_no_crossing_preserves_observed_bound_and_does_not_invent_an_mld(self):
        result = self.diagnose(profile())
        for key in ("temperature_mld", "density_mld"):
            self.assertEqual(result[key], {"depth_m": None, "status": "not_crossed", "observed_to_m": 40.})

    def test_missing_surface_and_reference_have_distinct_explicit_statuses(self):
        result = self.diagnose(profile(depths=[5., 10., 20., 40.]))
        self.assertEqual(result["surface_duct"], {"depth_m": None, "status": "missing_surface"})
        self.assertEqual(result["temperature_mld"]["status"], "not_crossed")
        self.assertFalse(result["missing_data"]["surface_present"])
        for depths in ([20., 30., 40.], [0., 5., 10.]):
            with self.subTest(depths=depths):
                result = self.diagnose(profile(depths=depths))
                self.assertEqual(result["temperature_mld"]["status"], "insufficient_reference")
                self.assertEqual(result["density_mld"]["status"], "insufficient_reference")
                self.assertEqual(result["surface_duct"]["status"], "insufficient_profile")

    def test_declared_internal_gap_is_never_interpolated_across(self):
        value = profile(depths=[0., 5., 10., 20., 40.], potential_temperature=[20., 20., 20., 19., 18.])
        value["missing_depths_m"] = [15., 50.]
        value["missing_or_excluded_layers"] = 2
        result = self.diagnose(value)
        self.assertEqual(result["internal_missing_cutoff_m"], 15.)
        self.assertEqual(result["temperature_mld"]["status"], "insufficient_reference")
        self.assertEqual(result["input_summary"]["rows_before_internal_gap"], 3)
        self.assertEqual(result["missing_data"]["missing_depths_m"], [15., 50.])
        self.assertFalse(result["missing_data"]["filled_missing"])
        self.assertFalse(result["missing_data"]["extrapolated"])
        value = profile(potential_temperature=[20., 20., 19.9, 19.7])
        value["missing_depths_m"] = [30.]
        result = self.diagnose(value)
        self.assertEqual(result["temperature_mld"], {"depth_m": None, "status": "not_crossed", "observed_to_m": 20.})

    def test_gsw_pressure_uses_selected_latitude_and_depth_not_a_depth_equals_dbar_approximation(self):
        value = profile(depths=[0., 10., 500., 1000.], potential_temperature=[20., 20., 19.9, 19.7])
        for row in value["rows"]:
            row["pressure_dbar"] = 99999.  # This unrelated supplied value must not drive GSW.
        with patch.object(gsw, "p_from_z", wraps=gsw.p_from_z) as convert:
            result = self.diagnose(value)
        convert.assert_called_once()
        np.testing.assert_array_equal(convert.call_args.args[0], [0., -10., -500., -1000.])
        self.assertEqual(convert.call_args.args[1], 65.)
        self.assertAlmostEqual(result["temperature_mld"]["depth_m"], 750., places=6)

    def test_duct_is_first_surface_connected_local_maximum_not_a_later_global_peak(self):
        value = profile(depths=[0., 5., 10., 20., 40.])
        for row, speed in zip(value["rows"], [1500., 1500.2, 1500.1, 1500.3, 1499.]):
            row["sound_speed_m_s"] = speed
        result = self.diagnose(value)
        self.assertEqual(result["surface_duct"]["status"], "candidate_local_maximum")
        self.assertEqual(result["surface_duct"]["depth_m"], 5.)
        self.assertAlmostEqual(result["surface_duct"]["sound_speed_increase_m_s"], .2)
        value["rows"][1]["sound_speed_m_s"] = 1499.9
        result = self.diagnose(value)
        self.assertEqual(result["surface_duct"]["status"], "no_surface_connected_positive_gradient")
        for row, speed in zip(value["rows"], [1500., 1500.1, 1500.2, 1500.3, 1500.4]):
            row["sound_speed_m_s"] = speed
        result = self.diagnose(value)
        self.assertEqual(result["surface_duct"], {"depth_m": None, "status": "positive_gradient_unclosed", "observed_to_m": 40.})

    def test_provenance_is_reproducible_json_safe_and_does_not_mutate_profiles(self):
        value = profile()
        before = copy.deepcopy(value)
        output = layers.diagnose_profiles([value])
        json.dumps(output, allow_nan=False)
        self.assertEqual(value, before)
        self.assertEqual(output["profile_count"], 1)
        self.assertEqual(output["method_id"], "seasonal-layer-diagnostics")
        self.assertEqual(output["implementation_sha256"], hashlib.sha256(layers.IMPLEMENTATION_PATH.read_bytes()).hexdigest())
        result = output["results"][0]
        expected_sha = hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        self.assertEqual(result["input_sha256"], expected_sha)
        self.assertEqual(result["selected"], value["selected"])
        self.assertEqual(result["requested"], value["requested"])
        self.assertEqual(result["source"]["bottom"], value["bottom"])
        self.assertEqual(result["source"]["grid_bottom"], value["grid_bottom"])
        self.assertNotEqual(result["source"]["bottom"], result["source"]["grid_bottom"])
        reordered = dict(reversed(list(value.items())))
        self.assertEqual(self.diagnose(reordered)["input_sha256"], expected_sha)
        value["rows"][0]["sound_speed_m_s"] += .001
        self.assertNotEqual(self.diagnose(value)["input_sha256"], expected_sha)

    def test_invalid_inputs_and_parameters_fail_explicitly(self):
        invalid_parameters = [
            {"reference_depth_m": -1}, {"reference_depth_m": float("nan")},
            {"reference_depth_m": True}, {"density_threshold": 0},
            {"temperature_threshold": -1}, {"density_threshold": float("inf")},
        ]
        for parameters in invalid_parameters:
            with self.subTest(parameters=parameters), self.assertRaises(ValueError):
                self.diagnose(profile(), **parameters)
        for mutate in (
            lambda v: v["selected"].update(lat=91),
            lambda v: v["selected"].pop("lon"),
            lambda v: v["rows"][0].update(temperature_c=float("nan")),
            lambda v: v["rows"][0].update(sound_speed_m_s=0),
            lambda v: v["rows"][0].update(practical_salinity=-1),
            lambda v: v["rows"][1].update(depth_m=0),
            lambda v: v.update(missing_depths_m=[float("nan")]),
        ):
            value = profile(); mutate(value)
            with self.subTest(profile=value), self.assertRaises(ValueError):
                self.diagnose(value)
        for invalid in ([], None, {}, "profiles"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                layers.diagnose_profiles(invalid)


if __name__ == "__main__":
    unittest.main()
