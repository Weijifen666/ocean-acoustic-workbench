"""Offline ROI checks: saved synthetic fields, no MATLAB or model service."""
import hashlib
import json
import tempfile
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from acoustic_checks import evaluate


class AcousticChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.metadata = {"frequency_hz": 1000., "source_depth_m": 10.,
                         "environment_id": "synthetic-identical-env", "tl_reference": "1m pressure",
                         "field_type": "coherent", "model": "BELLHOP"}
        self.a = np.full((5, 5), 80.)
        self.b = self.a + .2
        self.write("base.npz", self.a)
        self.write("fine.npz", self.b)
        self.spec = {"baseline_file": "base.npz", "refined_file": "fine.npz",
                     "roi": {"depth_min_m": 0, "depth_max_m": 40, "range_min_km": 0, "range_max_km": 4}}

    def write(self, name, values, metadata=None, **extra):
        np.savez(self.folder / name, tl_db=values, z_m=np.arange(5)*10., r_km=np.arange(5)*1.,
                 **(self.metadata if metadata is None else metadata), **extra)

    def run_check(self, **overrides):
        return evaluate(self.folder, dict(self.spec, **overrides))

    def test_stable_is_deterministic_local_difference_with_hashed_inputs(self):
        report = self.run_check()
        self.assertEqual(report, self.run_check())
        self.assertEqual(report["status"], "stable")
        self.assertFalse(report["physical_accuracy_proven"])
        self.assertAlmostEqual(report["abs_difference"]["p95_db"], .2)
        self.assertEqual(report["coverage"]["common_finite_points"], 25)
        self.assertEqual(report["inputs"]["baseline"]["sha256"], hashlib.sha256((self.folder/"base.npz").read_bytes()).hexdigest())
        self.assertNotIn("passed", report)
        json.dumps(report, allow_nan=False)

    def test_surface_roi_fails_even_when_whole_field_median_is_small(self):
        self.b[0, :] += 10
        self.write("fine.npz", self.b)
        whole = self.run_check()
        self.assertAlmostEqual(whole["abs_difference"]["median_db"], .2)
        self.assertEqual(whole["status"], "not_stable")
        surface = self.run_check(roi=dict(self.spec["roi"], depth_max_m=0), min_common_points=5)
        self.assertEqual(surface["status"], "not_stable")
        self.assertAlmostEqual(surface["abs_difference"]["median_db"], 10.2)
        self.assertEqual(surface["abs_difference"]["exceedance_ratio"], 1)

    def test_only_common_finite_points_feed_both_means_and_errors(self):
        self.a[0, 0] = np.nan
        self.b[0, 1] = np.inf
        self.write("base.npz", self.a)
        self.write("fine.npz", self.b)
        report = self.run_check()
        self.assertEqual(report["status"], "stable")
        self.assertEqual(report["coverage"]["common_finite_points"], 23)
        self.assertAlmostEqual(report["coverage"]["common_valid_ratio"], 23/25)
        self.assertEqual(report["coverage"]["baseline_only_points"], 1)
        self.assertEqual(report["coverage"]["refined_only_points"], 1)
        self.assertEqual(report["baseline_stats"]["n"], 23)
        self.assertEqual(report["refined_stats"]["n"], 23)
        self.assertAlmostEqual(report["baseline_stats"]["arithmetic_mean_db"], 80)
        json.dumps(report, allow_nan=False)

    def test_insufficient_and_zero_common_coverage_are_inconclusive(self):
        self.b[:4] = np.nan
        self.write("fine.npz", self.b)
        report = self.run_check()
        self.assertEqual(report["status"], "inconclusive")
        self.assertEqual(report["coverage"]["common_valid_ratio"], .2)
        self.assertAlmostEqual(report["abs_difference"]["median_db"], .2)
        self.b[:] = np.nan
        self.write("fine.npz", self.b)
        report = self.run_check()
        self.assertIsNone(report["abs_difference"])
        self.assertIsNone(report["baseline_stats"])
        self.assertEqual(report["status"], "inconclusive")
        json.dumps(report, allow_nan=False)

    def test_db_mean_is_distinguished_from_mean_intensity_tl(self):
        self.a[:, 2:] = 100
        self.b = self.a + .2
        self.write("base.npz", self.a)
        self.write("fine.npz", self.b)
        stats = self.run_check()["baseline_stats"]
        self.assertAlmostEqual(stats["arithmetic_mean_db"], 92)
        self.assertAlmostEqual(stats["energy_mean_tl_db"], -10*np.log10(.4*10**-8+.6*10**-10))
        self.assertNotAlmostEqual(stats["arithmetic_mean_db"], stats["energy_mean_tl_db"])

    def test_missing_controls_describe_values_without_certifying_stability(self):
        self.write("base.npz", self.a, metadata={})
        self.write("fine.npz", self.b, metadata={})
        report = self.run_check()
        self.assertEqual(report["status"], "inconclusive")
        self.assertEqual(report["comparability"]["status"], "unverified")
        self.assertAlmostEqual(report["abs_difference"]["median_db"], .2)
        self.assertEqual(len(report["comparability"]["missing_fields"]), 6)

    def test_different_or_unpaired_metadata_is_rejected(self):
        for field, bad in [("frequency_hz", 500.), ("source_depth_m", 50.), ("environment_id", "other"), ("model", "KRAKEN")]:
            with self.subTest(field=field):
                self.write("fine.npz", self.b, metadata=dict(self.metadata, **{field: bad}))
                with self.assertRaisesRegex(ValueError, field):
                    self.run_check()
        missing = dict(self.metadata)
        missing.pop("source_depth_m")
        self.write("fine.npz", self.b, metadata=missing)
        with self.assertRaisesRegex(ValueError, "source_depth_m"):
            self.run_check()

    def test_mismatched_coordinate_or_transpose_is_rejected(self):
        np.savez(self.folder/"fine.npz", tl_db=self.b, z_m=np.arange(5)*10.+1, r_km=np.arange(5)*1., **self.metadata)
        with self.assertRaisesRegex(ValueError, "坐标不一致"):
            self.run_check()
        np.savez(self.folder/"fine.npz", tl_db=np.ones((3, 5)), z_m=np.arange(5)*10., r_km=np.arange(3)*1., **self.metadata)
        with self.assertRaisesRegex(ValueError, "轴顺序"):
            self.run_check()
        self.write("fine.npz", self.b, axis_order="range,depth")
        with self.assertRaisesRegex(ValueError, "axis_order"):
            self.run_check()

    def test_roi_is_required_bounded_and_nonempty(self):
        missing = dict(self.spec)
        missing.pop("roi")
        with self.assertRaisesRegex(ValueError, "roi"):
            evaluate(self.folder, missing)
        for roi in [{}, dict(self.spec["roi"], depth_max_m=41), dict(self.spec["roi"], depth_min_m=1, depth_max_m=2)]:
            with self.subTest(roi=roi), self.assertRaises(ValueError):
                self.run_check(roi=roi)

    def test_no_arbitrary_paths_self_comparison_or_agent_asserted_pass(self):
        for name in ["../base.npz", "checks/base.npz", "C:/base.npz", "base.json"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.run_check(baseline_file=name)
        with self.assertRaisesRegex(ValueError, "自身"):
            self.run_check(refined_file="base.npz")
        (self.folder/"copy.npz").write_bytes((self.folder/"base.npz").read_bytes())
        with self.assertRaisesRegex(ValueError, "副本"):
            self.run_check(refined_file="copy.npz")
        with self.assertRaisesRegex(ValueError, "passed"):
            self.run_check(passed=True)

    def test_pickle_and_invalid_thresholds_are_rejected(self):
        self.write("fine.npz", np.full((5,5), {"untrusted": "object"}, dtype=object))
        with self.assertRaisesRegex(ValueError, "对象"):
            self.run_check()
        self.write("fine.npz", self.b)
        for params in [{"threshold_db": 0}, {"threshold_db": float("nan")}, {"min_common_valid_ratio": 0}, {"min_common_points": True}, {"comparison_kind": "cross_model"}]:
            with self.subTest(params=params), self.assertRaises(ValueError):
                self.run_check(**params)

    def test_symlink_is_not_a_task_input(self):
        try:
            (self.folder/"link.npz").symlink_to(self.folder/"fine.npz")
        except OSError:
            self.skipTest("Creating symlinks is unavailable on this Windows account")
        with self.assertRaisesRegex(ValueError, "符号链接"):
            self.run_check(refined_file="link.npz")

    def test_symlink_guard_without_os_privilege(self):
        with patch.object(Path, "is_symlink", return_value=True):
            with self.assertRaisesRegex(ValueError, "符号链接"):
                self.run_check()

    def test_extreme_finite_fields_never_emit_nonfinite_json(self):
        self.a[:] = 1e300
        self.b[:] = 1e300 + 1e290
        self.write("base.npz", self.a)
        self.write("fine.npz", self.b)
        json.dumps(self.run_check(), allow_nan=False)
        self.a[:] = -1e308
        self.b[:] = 1e308
        self.write("base.npz", self.a)
        self.write("fine.npz", self.b)
        with self.assertRaisesRegex(ValueError, "差值超出"):
            self.run_check()


if __name__ == "__main__":
    unittest.main()
