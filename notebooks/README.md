# Tides notebooks

[How far did measured water level sit from the tide prediction?](01_compare_observed_and_predicted_heights.ipynb)
aligns NOAA water levels with astronomical predictions, audits coverage/quality,
and varies a descriptive absolute-residual threshold.

## Setup

Install uv; no Bun runtime or worker checkout is required for the native release.

```sh
cd notebooks
uv sync --locked
uv run python execute.py
uv run python -m ipykernel install --user --name vgi-tides-notebooks --display-name 'Python (Tides notebooks)'
uv run --with jupyterlab jupyter lab
```

Select that kernel interactively. The runner uses a temporary kernel spec and
notebook-directory cwd; only successful execution atomically replaces outputs.
Published Haybarn **2.0.0rc11** has a separate lock. Literal SQL attaches
`github-auto://Query-farm/vgi-tides@v0.1.0`, verified with the macOS arm64 native
asset. First launch needs network for the asset and extension. No source build,
local worker binary or parent environment is used. Update the release pin
explicitly and revalidate before upgrading.

## NOAA records, units and time

Two unchanged actual NOAA responses are stored in `recordings/`, with exact URLs,
request parameters, separate UTC capture times and SHA-256 in `provenance.json`.
They describe The Battery (station **8518750**) on **2026-10-01 UTC**, captured on
14 November 2026. Each has 240 six-minute rows. Both requests use metric units
and **MLLW** vertical datum; predictions explicitly use interval 6. The NOAA API
uses inclusive days; the notebook aligns [2026-10-01 00:00, 2026-10-02 00:00) UTC.

Replay verifies checksums and serves only the exact path/query combinations on
loopback through supported `TIDES_API_BASE_URL`. Inherited data and metadata
base URLs are cleared first and restored at cleanup. Live makes direct NOAA
requests and creates no replay server; errors are never replaced with replay.
The exact replay audit requires one request per product. Worker `fetched_at` is
this run's read time, which is a local replay read in replay mode, not upstream
capture time. Replay `source_url` is local; original NOAA URLs are in provenance.

Sources: [NOAA CO-OPS API](https://api.tidesandcurrents.noaa.gov/api/prod/) and
[response fields](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html).
No NOAA endorsement is implied. This historical descriptive example is not a
navigation or flood-warning product. Heights are relative to MLLW; high/low water
does not establish slack current. Observed-minus-predicted height is not pure
storm surge and this response set cannot attribute its physical causes.

SQL makes an expected grid, joins exact station/time/datum keys, reports missing
rows/heights, and keeps only quality `v` with flags exactly `0,0,0,0`. Other rows
are excluded explicitly. Missing values are never filled with zero. There is no
nearest-time join or interpolation. The exceedance percentage counts available
paired samples, not continuous duration or a probability of danger.

## Experiments

```sh
uv run python execute.py --parameters '{"RESIDUAL_THRESHOLD_M":0.20}' --output-dir artifacts/threshold-020
uv run python execute.py --parameters '{"DATA_MODE":"live"}' --output-dir artifacts/live
```

Threshold is finite 0–1 metre; equality belongs at/below the threshold. DATA_MODE
is replay/live. Overrides require separate destinations with complete companion
assets, recordings, docs, helper and environment. Change only the threshold for
the focused experiment; restore 0.15 afterward. A live source revision is a
separate variable from this fixed-response sensitivity comparison.

## Validation

Verified 14 November 2026 with the pinned native release and published Haybarn:
15 code cells, seven SQL cells, two charts, 12 SQL invariants and the exact
request audit. Default took 12.2 s; a notebook-only detached directory completed
the 0.20 m experiment in 12.2 s and direct NOAA retrieval in 1.8 s. All six
charts were inspected. Three invalid-input/destination guards preserved defaults.

The threshold experiment reduced exceedances from **82/240 (34.2%)** to
**32/240 (13.3%)**. All 240 residual values, their distribution and validation
results were identical; live returned the same analytical values for this day.

Repository `make check` passed: 14 Bun tests, 115 stdio / 115 launcher / 78 HTTP
SQL assertions, Biome, strict TypeScript, and full executing metadata lint
**100/100, L2, zero findings**. Notebook Ruff and structural review passed.
Root source, dependency locks and the two recorded response bytes are unchanged.
