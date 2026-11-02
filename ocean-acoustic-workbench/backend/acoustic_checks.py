"""Deterministic, bounded ROI checks on two saved TL fields, without a solver.

NPZ convention: tl_db[depth, range], z_m[depth], r_km[range]. Nonfinite
TL is masked, never filled. A stable result describes one local two-level
comparison, not mathematical convergence or physical/observational accuracy.
"""
from __future__ import annotations

import hashlib
import io
import math
import re
import zipfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np

SCHEMA_VERSION = "1.0"
TOOL_NAME = "evaluate_acoustic_checks"
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_EXPANDED_BYTES = 128 * 1024 * 1024
MAX_FIELD_POINTS = 2_000_000
CONTROL_FIELDS = (
    "frequency_hz", "source_depth_m", "environment_id", "tl_reference",
    "field_type", "model",
)
ROI_KEYS = ("depth_min_m", "depth_max_m", "range_min_km", "range_max_km")
SPEC_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["baseline_file", "refined_file", "roi"],
    "properties": {
        "baseline_file": {"type": "string", "pattern": r"^[A-Za-z0-9][A-Za-z0-9_.-]*\.npz$"},
        "refined_file": {"type": "string", "pattern": r"^[A-Za-z0-9][A-Za-z0-9_.-]*\.npz$"},
        "comparison_kind": {"type": "string", "enum": ["refinement"], "default": "refinement"},
        "roi": {"type": "object", "additionalProperties": False, "required": list(ROI_KEYS),
                "properties": {key: {"type": "number", "minimum": 0} for key in ROI_KEYS}},
        "threshold_db": {"type": "number", "exclusiveMinimum": 0, "default": 1.0},
        "min_common_valid_ratio": {"type": "number", "exclusiveMinimum": 0, "maximum": 1, "default": 0.9},
        "min_common_points": {"type": "integer", "minimum": 1, "default": 20},
    },
}


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} 必须为有限数值")
    try:
        value = float(value)
    except OverflowError:
        raise ValueError(f"{label} 必须为有限数值") from None
    if not math.isfinite(value):
        raise ValueError(f"{label} 必须为有限数值")
    return value


def _load(folder: Path, filename: Any) -> dict[str, Any]:
    if (not isinstance(filename, str) or len(filename) > 180
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*\.npz", filename)
            or ".." in filename):
        raise ValueError("输入必须是任务目录内的普通 .npz 文件名，不能含路径")
    path = folder / filename
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(folder):
        raise ValueError("输入必须是任务目录内的普通文件，不能是符号链接")
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("输入文件超过 64 MiB 限制")
    raw = path.read_bytes()
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError("输入文件超过 64 MiB 限制")
    try:
        # Inspect headers before numpy allocates arrays: reject pickle data,
        # compressed bombs and declared huge shapes even in truncated files.
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) > 24 or sum(e.file_size for e in entries) > MAX_EXPANDED_BYTES:
                raise ValueError("NPZ 解压后数据过大")
            names = [e.filename for e in entries]
            if len(names) != len(set(names)):
                raise ValueError("NPZ 不允许重复字段")
            for entry in entries:
                if "/" in entry.filename or "\\" in entry.filename or not entry.filename.endswith(".npy"):
                    raise ValueError("NPZ 必须只包含普通 NPY 字段")
                with archive.open(entry) as stream:
                    version = np.lib.format.read_magic(stream)
                    if version == (1, 0):
                        shape, _, dtype = np.lib.format.read_array_header_1_0(stream)
                    elif version == (2, 0):
                        shape, _, dtype = np.lib.format.read_array_header_2_0(stream)
                    else:
                        raise ValueError("NPZ 只支持 NPY 1.0/2.0 数值字段")
                if dtype.hasobject or dtype.kind not in "iufUS":
                    raise ValueError("NPZ 不允许对象、复数或非数值场")
                if math.prod(shape) > MAX_FIELD_POINTS or len(shape) > 2:
                    raise ValueError("NPZ 字段形状超过限制")
        with np.load(io.BytesIO(raw), allow_pickle=False) as data:
            if not {"tl_db", "z_m", "r_km"}.issubset(data.files):
                raise ValueError("NPZ 必须包含 tl_db、z_m、r_km")
            arrays = {key: data[key] for key in ("tl_db", "z_m", "r_km")}
            if any(v.dtype.kind not in "iuf" for v in arrays.values()):
                raise ValueError("声场与坐标必须为实数数组")
            tl = np.asarray(arrays["tl_db"], dtype=np.float64)
            z = np.asarray(arrays["z_m"], dtype=np.float64)
            r = np.asarray(arrays["r_km"], dtype=np.float64)
            if (tl.ndim != 2 or z.ndim != 1 or r.ndim != 1
                    or not z.size or not r.size or tl.shape != (z.size, r.size)):
                raise ValueError("tl_db 轴顺序必须为 (depth, range)，与一维 z_m/r_km 相符")
            if (not np.isfinite(z).all() or not np.isfinite(r).all()
                    or np.any(z < 0) or np.any(r < 0)
                    or np.any(np.diff(z) <= 0) or np.any(np.diff(r) <= 0)):
                raise ValueError("坐标必须有限、非负且严格递增")
            metadata = {}
            for key in (*CONTROL_FIELDS, "axis_order"):
                if key not in data.files:
                    continue
                field = data[key]
                if field.ndim != 0:
                    raise ValueError(f"{key} 必须为标量元数据")
                value = field.item()
                if key in ("frequency_hz", "source_depth_m"):
                    value = _number(value, key)
                    if value < 0 or key == "frequency_hz" and value == 0:
                        raise ValueError(f"{key} 超出范围")
                elif not isinstance(value, str) or not value.strip() or len(value) > 256:
                    raise ValueError(f"{key} 必须为非空短字符串")
                metadata[key] = value
            if metadata.get("axis_order", "depth,range") != "depth,range":
                raise ValueError("NPZ axis_order 必须为 depth,range")
    except (OSError, EOFError, KeyError, TypeError, zipfile.BadZipFile) as exc:
        raise ValueError("无法读取有效的 NPZ 数值场") from exc
    return {"tl": tl, "z": z, "r": r, "metadata": metadata,
            "input": {"file": filename, "sha256": hashlib.sha256(raw).hexdigest(), "size_bytes": len(raw)}}


def _field_stats(values: np.ndarray) -> dict[str, Any] | None:
    if not values.size:
        return None
    # Shift before exponentiation to avoid overflow/underflow for very large
    # finite TL. This is mean intensity converted to dB, not mean dB.
    smallest = float(values.min())
    with np.errstate(over="ignore", under="ignore"):
        intensity_ratio = np.exp(-(values - smallest) * (math.log(10) / 10))
    result = {
        "n": int(values.size),
        "arithmetic_mean_db": float(np.sum(values / values.size)),
        "energy_mean_tl_db": smallest - 10 * math.log10(float(np.mean(intensity_ratio))),
        "median_db": float(np.median(values / 2) * 2),
    }
    if not all(math.isfinite(value) for value in result.values()):
        raise ValueError("声场汇总超出数值范围，无法给出可靠统计")
    return result


def evaluate(folder: str | Path, spec: Mapping[str, Any]) -> dict[str, Any]:
    """Compare two task-local NPZ fields in an explicit ROI, or raise ValueError.

    All field summaries use the same common-finite samples. No resampling,
    smoothing, zero/NaN filling, paid API, filesystem writes, or solver runs.
    """
    if not isinstance(spec, Mapping) or set(spec) - set(SPEC_SCHEMA["properties"]):
        raise ValueError("检查参数无效或包含不允许的字段（例如 passed）")
    if any(key not in spec for key in SPEC_SCHEMA["required"]):
        raise ValueError("必须提供 baseline_file、refined_file 与明确的 roi")
    if spec.get("comparison_kind", "refinement") != "refinement":
        raise ValueError("首版仅支持 refinement 两级局部差异，不能用于跨模型稳定性认证")
    if spec["baseline_file"] == spec["refined_file"]:
        raise ValueError("baseline_file 与 refined_file 必须不同，不能与自身比较")
    roi = spec["roi"]
    if not isinstance(roi, Mapping) or set(roi) != set(ROI_KEYS):
        raise ValueError("ROI 必须显式提供四个深度/距离边界")
    roi = {key: _number(roi[key], key) for key in ROI_KEYS}
    if min(roi.values()) < 0 or roi["depth_min_m"] > roi["depth_max_m"] or roi["range_min_km"] > roi["range_max_km"]:
        raise ValueError("ROI 边界必须非负，且下界不能大于上界")
    threshold = _number(spec.get("threshold_db", 1.0), "threshold_db")
    min_ratio = _number(spec.get("min_common_valid_ratio", 0.9), "min_common_valid_ratio")
    min_points = spec.get("min_common_points", 20)
    if threshold <= 0 or not 0 < min_ratio <= 1 or isinstance(min_points, bool) or not isinstance(min_points, int) or min_points < 1:
        raise ValueError("阈值必须为正、覆盖率在 (0,1]、最少点数为正整数")
    folder = Path(folder).resolve(strict=True)
    if not folder.is_dir():
        raise ValueError("任务目录不存在")
    baseline, refined = (_load(folder, spec[key]) for key in ("baseline_file", "refined_file"))
    if baseline["input"]["sha256"] == refined["input"]["sha256"]:
        raise ValueError("两个文件内容完全相同，不能用输入副本认证两级稳定性")
    for axis in ("z", "r"):
        if not np.array_equal(baseline[axis], refined[axis]):
            raise ValueError("两个声场坐标不一致；不会隐式插值或按数组索引比较")
    missing = []
    for key in CONTROL_FIELDS:
        a, b = baseline["metadata"].get(key), refined["metadata"].get(key)
        if a is None and b is None:
            missing.append(key)
        elif a is None or b is None or a != b:
            raise ValueError(f"控制元数据 {key} 缺失或不同，不能作为同一配置的两级差异比较")
    z, r = baseline["z"], baseline["r"]
    if (roi["depth_min_m"] < z[0] or roi["depth_max_m"] > z[-1]
            or roi["range_min_km"] < r[0] or roi["range_max_km"] > r[-1]):
        raise ValueError("请求 ROI 超出共同坐标范围，不会静默裁剪")
    zi = (z >= roi["depth_min_m"]) & (z <= roi["depth_max_m"])
    ri = (r >= roi["range_min_km"]) & (r <= roi["range_max_km"])
    if not zi.any() or not ri.any():
        raise ValueError("ROI 内没有采样点")
    a = baseline["tl"][np.ix_(zi, ri)]
    b = refined["tl"][np.ix_(zi, ri)]
    av, bv = np.isfinite(a), np.isfinite(b)
    common = av & bv
    n, total = int(common.sum()), int(common.size)
    valid_ratio = n / total
    notes = ["仅检验指定 ROI 的两级数值差异，不证明数学收敛、物理正确性或真实海洋精度。",
             "NaN/Inf 仅作掩膜；统计使用共同有限点，不填充、不平滑、不插值。",
             "NPZ 固定轴顺序为 depth,range；元数据由产物声明，工具不能证明其描述真实。"]
    difference = None
    if n:
        with np.errstate(over="ignore", invalid="ignore"):
            signed = b[common] - a[common]
        if not np.isfinite(signed).all():
            raise ValueError("有限 TL 的差值超出数值范围，无法给出可靠统计")
        absolute = np.abs(signed)
        difference = {"median_db": float(np.median(absolute / 2) * 2), "p95_db": float(np.quantile(absolute / 2, .95) * 2),
                      "p99_db": float(np.quantile(absolute / 2, .99) * 2), "max_db": float(absolute.max()),
                      "mean_db": float(np.sum(absolute / n)), "signed_mean_db": float(np.sum(signed / n)),
                      "threshold_db": threshold, "exceedance_count": int((absolute > threshold).sum()),
                      "exceedance_ratio": float(np.mean(absolute > threshold))}
        if not all(math.isfinite(value) for value in difference.values()):
            raise ValueError("差值汇总超出数值范围，无法给出可靠统计")
    reasons = []
    if missing:
        reasons.append("缺少控制元数据，comparability 未核实：" + ", ".join(missing))
    if valid_ratio < min_ratio:
        reasons.append("共同有限覆盖比例不足")
    if n < min_points:
        reasons.append("共同有限点数不足")
    if reasons:
        status = "inconclusive"
    else:
        status = "stable" if difference["p95_db"] <= threshold and difference["exceedance_ratio"] <= .05 else "not_stable"
    return {
        "schema_version": SCHEMA_VERSION, "kind": "local_two_level_difference", "comparison_kind": "refinement",
        "status": status, "reasons": reasons, "physical_accuracy_proven": False,
        "inputs": {"baseline": baseline["input"], "refined": refined["input"]},
        "roi": roi, "sampled_roi": {"depth_min_m": float(z[zi][0]), "depth_max_m": float(z[zi][-1]),
                                     "range_min_km": float(r[ri][0]), "range_max_km": float(r[ri][-1])},
        "axis_order": ["depth", "range"],
        "comparability": {"status": "verified_declared_metadata" if not missing else "unverified",
                          "missing_fields": missing, "matched_metadata": {k: baseline["metadata"][k] for k in CONTROL_FIELDS if k not in missing}},
        "criteria": {"threshold_db": threshold, "percentile": 95, "max_exceedance_ratio": .05,
                     "min_common_valid_ratio": min_ratio, "min_common_points": min_points},
        "coverage": {"roi_points": total, "baseline_finite_points": int(av.sum()), "refined_finite_points": int(bv.sum()),
                     "common_finite_points": n, "common_valid_ratio": valid_ratio,
                     "baseline_only_points": int((av & ~bv).sum()), "refined_only_points": int((bv & ~av).sum()),
                     "both_nonfinite_points": int((~av & ~bv).sum())},
        "abs_difference": difference,
        "baseline_stats": _field_stats(a[common]), "refined_stats": _field_stats(b[common]), "notes": notes,
    }
