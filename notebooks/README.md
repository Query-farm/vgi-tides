# NOAA Tides notebooks

| Story | Question | Fixed-input experiment |
|---|---|---|
| [01 · Compare heights](01_compare_observed_and_predicted_heights.ipynb) | How far were verified observations from astronomical predictions at The Battery? | Raise the absolute-residual threshold from 0.15 to 0.20 m. |
| [02 · Compare current measurements](02_same_station_different_current_measurements.ipynb) | Do station, bin, time and measurement definitions permit a current residual at Cherry Point? | Select observation bin 20 instead of bin 1. |

Read executed results on GitHub or use each notebook's **Open in Colab** button.
The notebooks install the base shared tools and download hash-verified companions;
no manual repository clone is needed in Colab. Hosted Colab itself has not been tested.
The local publication environment adds the optional runner:

```sh
cd notebooks
uv sync --locked --extra runner
uv run --locked --extra runner vgi-notebooks
uv run --locked --extra runner python -m ipykernel install --user --name vgi-tides-notebooks --display-name 'Python (NOAA Tides)'
uv run --locked --extra runner --with jupyterlab jupyter lab
```

Select that kernel in Jupyter. The shared [standard and runner](https://github.com/Query-farm/vgi-example-notebooks/blob/v0.3.36/docs/standard.md)
replace duplicate local infrastructure. Shared tools are pinned to **v0.3.36**, with
published **Haybarn 2.0.0rc11** and a separate exact local lock. Compatible preloaded
plotting/data/kernel libraries are preserved by the base install.

Visible SQL attaches `github-auto://Query-farm/vgi-tides@v0.1.0`.
The native macOS arm64 release was verified; first setup needs internet for packages,
companions, VGI and the platform worker asset. No Bun, source checkout or source build
is needed. Update the release explicitly and revalidate when upgrading. The shared
connection creates an empty temporary SQL-secret directory, disables persistence and
JupySQL default-INI autoload, verifies an empty inventory, and closes it at cleanup.
NOAA requires no key; no saved credentials are read or secrets created.

## Sources and boundaries

The default `DATA_MODE="replay"` serves **unchanged original NOAA HTTP-response bytes**
on loopback, checks SHA-256, and accepts only the recorded path/query combinations.
The released worker parses those bytes through its supported `TIDES_API_BASE_URL`
and `TIDES_METADATA_BASE_URL` overrides. Source settings are scoped and restored.
`DATA_MODE="live"` clears inherited overrides and reads official NOAA endpoints;
no replay service is created and there is no automatic fallback.

- [Height provenance](recordings/provenance.json): two independent NOAA responses
  captured 14 November 2026, for The Battery **8518750**, **1 October 2026 UTC**,
  metric heights relative to **MLLW**. All 240 six-minute observation/prediction
  positions are retained; observations require quality `v` and flags `0,0,0,0`.
- [Current provenance](current_recordings/provenance.json): six original responses
  captured 14 November 2026. Complete current/current-prediction station collections,
  Cherry Point **cp0101** bin metadata, observations at bins **1 and 20**, and
  predictions at bin **20** for **13 November 2026 UTC**. Both observation series and
  the prediction contain 240 samples; metadata reflects capture time, not a proved
  historical sensor deployment. The full prediction-station response is retained.

Worker `fetched_at` is this run's read time; in replay it describes local retrieval,
not NOAA acquisition. Replay `source_url` is local. The provenance files retain each
original NOAA URL, request parameters, capture time and byte hash. Requests are
materialized once before local capture/display: exactly two in 01 and six in 02.
Dates in the API are inclusive; SQL checks the corresponding half-open UTC day.

01 joins exact station/time/datum keys without interpolation. Its residual is not
pure storm surge; available paired samples are not a continuous duration or danger
probability. Raising the threshold changes the count **82/240 → 32/240**, while the
source heights, residuals and empirical distribution stay fixed.

02 preserves **30 NULL observation-bin depths** and missing current flags. A bin
identifier is not depth; an unrelated raw distance is not substituted. The released
`stations()` lacks current main's added `bin` column, so visible SQL reads the captured
raw metadata to explain the chosen prediction bin. Current main also improves HTTP
error details and metadata; the selected release and current interface are documented
separately in [coverage](coverage.json). This is not a claim that their output schemas
are identical.

Observed scalar speed and predicted signed major-axis velocity are both **m/s**, but
have different meanings. Raw cm/s values independently check the worker's conversion.
Mean flood/ebb bearings are not instantaneous observed directions. Selecting bin 20
changes station-and-bin matches **0 → 240**, while exact timestamp matches stay **0**:
observations occur at :03/:09/… and predictions at :00/:06/…. Observation depth remains
unknown. No current residual, nearest-time join or interpolated value is invented.

Sources: [NOAA CO-OPS API](https://api.tidesandcurrents.noaa.gov/api/prod/),
[response fields](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html), and
[station metadata](https://api.tidesandcurrents.noaa.gov/mdapi/prod/).
No NOAA endorsement is implied. These historical examples are not navigation,
current-warning or flood-warning products.

## Separate experiments and live reads

```sh
uv run --locked --extra runner vgi-notebooks 01_compare_observed_and_predicted_heights.ipynb --parameters '{"RESIDUAL_THRESHOLD_M":0.20}' --output-dir validation/threshold-020
uv run --locked --extra runner vgi-notebooks 02_same_station_different_current_measurements.ipynb --parameters '{"OBSERVATION_BIN":20}' --output-dir validation/bin-20
uv run --locked --extra runner vgi-notebooks 01_compare_observed_and_predicted_heights.ipynb --parameters '{"DATA_MODE":"live"}' --output-dir validation/live-heights
uv run --locked --extra runner vgi-notebooks 02_same_station_different_current_measurements.ipynb --parameters '{"DATA_MODE":"live"}' --output-dir validation/live-currents
```

Overrides require a separate destination; failed execution preserves saved successful
outputs. Copies include companions and the environment. Restart and Run All when
changing parameters interactively. Replay isolates the single intended change. Live
metadata/observations may be revised or unavailable; 02's comparison against the frozen
raw unit reference then fails visibly rather than treating revisions as conversion
errors silently. A live run is a separate acquisition check, not the fixed-input
experiment. The notebooks make no account writes.

## Validation and coverage

Both default notebooks and their detached experiments use the published native worker.
01 retains its original analytical SQL and 12 checks. 02 adds 16 SQL checks for keys,
UTC day, populations, missing metadata, timing and unit conversions. A fresh notebook-only
Python 3.12 environment with already imported compatible libraries tests the common
base-install/companion path; this is separate from a hosted-Colab session.

[Coverage evidence](coverage.json) records all **seven** logical names: six functions
and the `products` reference table. Complete actual released/current function, table
and view exports, source drift, final execution receipts and explicit editorial review
are retained. Release executions verify the demonstrated operations; current-interface
coverage does not claim execution of current main's new `stations.bin` field.

For unchanged worker source, this notebook-only update reuses successful
[source CI 43615217454](https://github.com/Query-farm/vgi-tides/actions/runs/43615217454)
at `fb22d6626686e621b85a30faf2305f3e225da601`, including metadata, unit/typecheck,
stock contract and transport tests. No worker rebuild or source-suite rerun was needed.
Final defaults completed in 3.7/2.9 s and detached experiments in 15.9/2.7 s.
The fresh preloaded base-only run took 24.4 s and retained all five tested library
versions. Both complete live runs also passed (17.9/2.8 s), reproducing replay
analytical values, with no replay requests. Five runner guards preserved successful
outputs. All four default, four experiment and four live figures were reviewed.
Notebook presentation, Ruff/format, coverage and fixed-input invariants passed;
anonymous GitHub SVG rendering is verified after publication.
