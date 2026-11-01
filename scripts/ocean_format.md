# Ocean data export v1

All keys below are relative to the configured R2 prefix. `manifest.json` is the small query manifest; `objects.json` is the upload/verification inventory and is not needed for each profile request. Version: `woa18-etopo1-v1`.

## Profile tile

Key: `profiles/p{period:02d}/y{tileY:02d}_x{tileX:02d}.json.gz`, raw gzip bytes (decompress then JSON parse). `tileY=floor(iy/10)`, `tileX=floor(ix/10)`. No HTTP Content-Encoding assumption: the object bytes themselves are gzip.

```json
{
  "schema_version": 1,
  "period_id": 13,
  "tile_y": 11,
  "tile_x": 30,
  "cells": {
    "39900": {
      "rows": [[0, 25.2, 34.5, 0, 34.66, 1531.2]],
      "temperature_c": [25.2, null],
      "practical_salinity": [34.5, null],
      "missing_depths_m": [5],
      "missing_or_excluded_layers": 1,
      "depth_limit_m": 0,
      "grid_bottom": {"lon":120.5,"lat":20.5,"elevation_m":-3500},
      "error": null
    }
  }
}
```

Example numbers only. Cell key is `String(iy * profile.shape[1] + ix)`, NOT tile-local. Coordinates use `profile.lons[ix]`, `profile.lats[iy]` in manifest. Depth axis is `profile.source_files[period].depths_m`. `rows` field order is `profile.row_fields` (six existing API fields). Original temperature/salinity values are IEEE float32 converted losslessly to JSON numeric values, with null for original masked/nonfinite values. Rows retain only paired finite layers at/before grid-point seabed, matching the original Python reader; no extrapolation. Cells with land/insufficient layers have `error` text and empty rows; their original raw arrays are still preserved. Worker must check requested-location seabed first, then cell.error.

The output profile response adds requested coordinates and requested-location `bottom` separately from this stored `grid_bottom`; they may differ. Requested +180 longitude is normalized to -180 for profile API exactly as before.

## Terrain native numeric tiles

Axes: `terrain/axes.json.gz` containing `{ "lons": [...], "lats": [...] }`, full original float64 coordinate values, ascending. Load once/cache. Binary tile: `terrain/native/y{tileY:03d}_x{tileX:03d}.i16.bin`. Tile shape is 300x300, except right/top edge: `height=min(300, nlat-tileY*300)`, `width=min(300,nlon-tileX*300)`. Row-major, signed little-endian int16, elevation metres. No header, no gzip. Value index is `(iy % 300) * width + (ix % 300)`. Read with DataView.getInt16(offset*2, true). Export refuses values outside int16 range, masks or non-integer elevation. Coordinates must not be inferred by arithmetic rounding for exact tie consistency.

Nearest terrain axis: first index that minimizes `abs(axis-value)`, i.e. exact tie takes lower global index. WOA longitude uses circular distance `abs((axis-value+180)%360-180)` and chooses first index on ties; latitude ordinary absolute distance. This includes wrap boundary tie between first/last WOA longitude.

## Terrain preview levels

Levels are in `terrain.preview_levels` (sorted fine to coarse). Each has `stride`, `shape`, `axes_key`, `tile_size`, `key_template`. `axes_key` points at `terrain/preview/s{stride:03d}/axes.json.gz`, a gzip JSON object `{lons,lats}`; axes are NOT embedded in the small main manifest. It samples exact source values at `axis[::stride]` with the final endpoint appended if missing; levels do NOT alter native numeric tiles. Level tile paths: `terrain/preview/s{stride:03d}/y{tileY:03d}_x{tileX:03d}.i16.bin`, same row-major edge rules as native. Default strides: 4, 16, 64, 128; tile_size=256. The global stride128 grid fits in one tile. Choose a level that produces about <=240x160 output and limit source tile count. Requested `terrain` endpoint can return these coarser preview coordinates and elevations, while clicked point always uses native.

## Main manifest

`manifest.json` fields:

- schema_version, version, complete, created_at, source_dataset, objects_manifest_key, totals.
- profile: shape=[nlat,nlon], tile_size=10, lons, lats, row_fields, key_template, periods, source_files (list of period_id, temperature_file, salinity_file, depths_m, sha256 for source files), method, warnings.
- terrain: shape, tile_size=300, dtype='int16', byte_order='little', axes_key, key_template, preview_levels (as above), source_file, source_sha256, units, source.
- gsw_version, numpy_version, exporter_sha256, export_parameters.

`objects.json`: `{schema_version,version,objects:[{key,bytes,sha256,content_type}],total_bytes,total_objects}`. It excludes itself and manifest to avoid circular hashes. Provenance source hashes cover original files; no machine paths are published.

Partial exports set `complete=false`, may contain missing tile objects, and are for local verification only. Production health must require complete=true. All exported fields are deterministic apart from created_at.
