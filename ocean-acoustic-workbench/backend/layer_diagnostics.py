"""Provenance wrapper for the existing, shared climatological layer algorithm.

Numerical definitions live in the seasonal-layer-diagnostics skill script.  This
module never maintains a second implementation of its crossings, GSW pressure
conversion, potential-temperature/density calculation, or duct detection.
"""
from functools import lru_cache
import hashlib
import importlib.util
import json
import math
from pathlib import Path


METHOD_ID = "seasonal-layer-diagnostics"
METHOD_VERSION = "1.0.0"
APP_ROOT = Path(__file__).resolve().parents[1]
IMPLEMENTATION_SOURCE = "skills/seasonal-layer-diagnostics/scripts/analyze_profiles.py"
IMPLEMENTATION_PATH = APP_ROOT / IMPLEMENTATION_SOURCE


def _json_bytes(value, label):
    try:
        return json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{label} must contain only finite JSON values") from exc


def _finite_number(value, label, *, minimum=None, maximum=None, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a finite number")
    try:
        number = float(value)
    except (ValueError, OverflowError) as exc:
        raise ValueError(f"{label} must be a finite number") from exc
    if not math.isfinite(number):
        raise ValueError(f"{label} must be a finite number")
    if positive and number <= 0:
        raise ValueError(f"{label} must be positive")
    if minimum is not None and number < minimum:
        raise ValueError(f"{label} is below its valid range")
    if maximum is not None and number > maximum:
        raise ValueError(f"{label} is above its valid range")
    return number


@lru_cache(maxsize=4)
def _load_algorithm(source_bytes):
    # Compile the exact trusted repository bytes that we hash, so a cached .pyc
    # or a later file edit cannot silently disagree with the reported SHA.
    spec = importlib.util.spec_from_file_location(
        "_ocean_seasonal_layer_algorithm", IMPLEMENTATION_PATH,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Layer diagnostic implementation could not be loaded")
    module = importlib.util.module_from_spec(spec)
    exec(compile(source_bytes, str(IMPLEMENTATION_PATH), "exec"), module.__dict__)
    if not callable(getattr(module, "diagnose", None)):
        raise RuntimeError("Layer diagnostic implementation has no diagnose function")
    return module


def _validated_profile(profile):
    if not isinstance(profile, dict):
        raise ValueError("Each profile must be a JSON object")
    encoded = _json_bytes(profile, "Profile")
    # A private snapshot also keeps the caller's input untouched by this adapter
    # or by future changes to the shared algorithm.
    value = json.loads(encoded)
    position = value.get("selected")
    if not isinstance(position, dict) or not {"lon", "lat"} <= position.keys():
        raise ValueError("Profile selected must include the actual grid lon and lat")
    _finite_number(position["lon"], "Selected longitude", minimum=-180, maximum=180)
    _finite_number(position["lat"], "Selected latitude", minimum=-90, maximum=90)
    rows = value.get("rows")
    if not isinstance(rows, list) or len(rows) < 2:
        raise ValueError("Profile must contain at least two rows")
    fields = ("depth_m", "temperature_c", "practical_salinity", "sound_speed_m_s")
    for row in rows:
        if not isinstance(row, dict) or not set(fields) <= row.keys():
            raise ValueError("Profile rows must include depth, temperature, salinity and sound speed")
        for field in fields:
            _finite_number(
                row[field], f"Profile {field}",
                minimum=0 if field in ("depth_m", "practical_salinity") else None,
                positive=field == "sound_speed_m_s",
            )
    missing = value.get("missing_depths_m", [])
    if not isinstance(missing, list):
        raise ValueError("Profile missing_depths_m must be a list")
    for depth in missing:
        _finite_number(depth, "Missing depth", minimum=0)
    return value, hashlib.sha256(encoded).hexdigest()


def diagnose_profiles(
    profiles, reference_depth_m=10., density_threshold=0.03,
    temperature_threshold=0.2,
):
    """Diagnose existing ocean-data profiles without filling or extrapolating.

    ``profiles`` uses the ``ocean_data.profile`` JSON protocol, especially its
    actual ``selected`` grid, ``rows`` and declared ``missing_depths_m``.  Invalid
    data raises ValueError; scientifically unavailable results retain the shared
    algorithm's explicit statuses, never a fabricated depth or a zero value.
    """
    reference = _finite_number(reference_depth_m, "Reference depth", minimum=0)
    density = _finite_number(density_threshold, "Density threshold", positive=True)
    temperature = _finite_number(temperature_threshold, "Temperature threshold", positive=True)
    if not isinstance(profiles, (list, tuple)) or not profiles:
        raise ValueError("profiles must be a nonempty list")
    implementation_bytes = IMPLEMENTATION_PATH.read_bytes()
    algorithm = _load_algorithm(implementation_bytes)
    results = []
    source_keys = (
        "temperature_file", "salinity_file", "method", "dataset", "dataset_version",
        "version", "bottom", "grid_bottom", "depth_limit_m", "warnings",
    )
    for profile in profiles:
        value, input_sha = _validated_profile(profile)
        diagnostic = algorithm.diagnose(
            value, reference=reference, density_threshold=density,
            temperature_threshold=temperature,
        )
        depths = [row["depth_m"] for row in value["rows"]]
        cutoff = diagnostic["internal_missing_cutoff_m"]
        diagnostic.update(
            input_sha256=input_sha,
            input_summary={
                "row_count": len(depths),
                "depth_min_m": float(depths[0]),
                "depth_max_m": float(depths[-1]),
                "rows_before_internal_gap": sum(depth < cutoff for depth in depths)
                if cutoff is not None else len(depths),
            },
            source={key: value[key] for key in source_keys if key in value},
            missing_data={
                "missing_depths_m": value.get("missing_depths_m", []),
                "missing_or_excluded_layers": value.get("missing_or_excluded_layers"),
                "surface_present": depths[0] == 0,
                "internal_missing_cutoff_m": cutoff,
                "filled_missing": False,
                "extrapolated": False,
            },
        )
        results.append(diagnostic)
    output = {
        "method_id": METHOD_ID,
        "method_version": METHOD_VERSION,
        "implementation_source": IMPLEMENTATION_SOURCE,
        "implementation_sha256": hashlib.sha256(implementation_bytes).hexdigest(),
        "dependency_versions": {
            "gsw": str(algorithm.gsw.__version__),
            "numpy": str(algorithm.np.__version__),
        },
        "parameters": {
            "reference_depth_m": reference,
            "density_threshold_kg_m3": density,
            "temperature_threshold_c": temperature,
        },
        "definitions": {
            "density_mld": "First linearly interpolated sigma0 increase from the interpolated reference depth.",
            "temperature_mld": "First linearly interpolated absolute potential-temperature departure from the interpolated reference depth.",
            "pressure": "GSW p_from_z(-depth_m, selected.lat); input pressure is not substituted for this conversion.",
            "surface_duct": "First surface-connected sound-speed local maximum; candidate only, not proof of trapping or modal cutoff.",
            "missing_data": "Stop before the first declared internal missing depth; no filling or extrapolation.",
            "not_crossed": "Threshold not crossed within available observations; no exact MLD is asserted.",
        },
        "profile_count": len(results),
        "results": results,
    }
    # Reject any unexpected NaN introduced by a dependency before API serialization.
    return json.loads(_json_bytes(output, "Diagnostic output"))
