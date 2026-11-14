# vgi-tides

Read NOAA CO-OPS tides, water levels and tidal currents from SQL. **TypeScript / Bun**, using VGI and Arrow batches. No API key required.

Six table functions expose station discovery, tide predictions, observed water levels, predicted currents, observed currents and current-meter depth bins. The `products` reference table documents the supported NOAA products and output units.

## Run

Requires Bun 1.3+; development checks also use `make`, Python 3 and `uv`.

```sh
cd vgi-tides
make build
```

Attach from stock DuckDB **2.0.0** with the signed Query Farm extension (use your actual absolute project path):

```sql
SET allow_extension_repositories = 'allowed';
CREATE EXTENSION REPOSITORY IF NOT EXISTS query_farm
  WITH PREFIX 'https://duckdb-extensions.query.farm';
INSTALL vgi FROM query_farm;
LOAD vgi FROM query_farm;
INSTALL icu FROM core;
LOAD icu;
SET TimeZone = 'UTC';
ATTACH 'tides' (TYPE vgi,
  LOCATION '/absolute/path/vgi-tides/bin/vgi-tides-worker');
```

```sql
-- High and low tides at The Battery for tomorrow (UTC).
SELECT time, height_m, event_type, datum
FROM tides.main.tide_predictions(
  '8518750', CAST(current_date + 1 AS VARCHAR), CAST(current_date + 1 AS VARCHAR))
ORDER BY time;

-- Predicted slack, flood and ebb are a separate product from tide height.
SELECT time, event_type, velocity_major_mps, depth_m
FROM tides.main.current_predictions(
  'ACT0956', CAST(current_date + 1 AS VARCHAR), CAST(current_date + 1 AS VARCHAR))
ORDER BY time;

-- Discover observation-capable stations.
SELECT station_id, name, latitude, longitude
FROM tides.main.stations(station_kind := 'waterlevels')
WHERE state = 'NY' ORDER BY name;

-- Storm-surge residual: observed water level minus the six-minute tide
-- prediction, per day at The Battery.
SELECT CAST(o.time AS DATE) AS obs_day,
       round(max(o.height_m - p.height_m), 3) AS max_residual_m,
       round(min(o.height_m - p.height_m), 3) AS min_residual_m,
       count(o.height_m) AS samples
FROM tides.main.water_levels('8518750', '2026-01-01', '2026-01-07') AS o
JOIN tides.main.tide_predictions('8518750', '2026-01-01', '2026-01-07', step := '6') AS p
  USING (time)
GROUP BY obs_day ORDER BY obs_day;
```

Run [demo.sql](demo.sql) from the project directory after `make build`; it uses the local `bin/` launcher.

## Release binaries

[Release v0.1.0](https://github.com/Query-farm/vgi-tides/releases/tag/v0.1.0) provides self-contained executables for Linux x86-64/ARM64, macOS ARM64, and Windows x86-64. Extract the archive for your platform and point `ATTACH` at the executable; Bun and node_modules are not required for these binaries.

```sql
ATTACH 'tides' (TYPE vgi,
  LOCATION '/absolute/path/vgi-tides-worker');
```

Archives include SHA-256 checksums, keyless signatures and GitHub build-provenance attestations.

## SQL interface

All functions are in `tides.main`. Required arguments are positional; optional arguments use `name := value`. Explicit NULL arguments are rejected; omit optional arguments to use defaults.

| Function / table | Parameters and behavior |
| --- | --- |
| `stations(station_kind := 'tidepredictions')` | Collections: `tidepredictions`, `waterlevels`, `currentpredictions`, `currents`. Coordinates, names and station type. `currentpredictions` lists a station once per prediction depth `bin` (pass it to `current_predictions`); `bin` is NULL for other collections. |
| `tide_predictions(station_id, start_date, end_date, datum := 'MLLW', step := 'hilo')` | Predicted heights in metres. `step`: `hilo`, `h`, or `1`, `5`, `6`, `10`, `15`, `30`, `60` minutes. H/L event labels exist only for high/low predictions. |
| `water_levels(station_id, start_date, end_date, datum := 'MLLW')` | Six-minute observed heights in metres, sigma, NOAA quality code and original flags. |
| `current_predictions(station_id, start_date, end_date, bin := 1, step := 'max_slack')` | Signed major-axis velocity in m/s, event type, mean flood/ebb directions and bin depth. `step`: `max_slack`, `h`, or `1`, `6`, `10`, `30`, `60` minutes. |
| `currents(station_id, start_date, end_date, bin := 0)` | Observed speed in m/s and flow direction. Zero requests all available depth bins. |
| `current_bins(station_id)` | Current-meter observation bin IDs, depth in metres and quality flags. Not a complete prediction-bin catalog. |
| `products` | Local reference table: SQL function, NOAA product, output units. No network access. |

Dates are **inclusive UTC calendar days** in `YYYY-MM-DD` format. A query may span at most 366 days. The worker splits requests into non-overlapping chunks of at most seven days; all-bin current observations use one-day chunks. Rows stream by request, with no dependence on process-local state between batches.

Subordinate tide stations require `step := 'hilo'` and `datum := 'MLLW'`; subordinate current stations require `step := 'max_slack'`. Other supported datums are `MHHW`, `MHW`, `MTL`, `MSL`, `MLW`, `NAVD`, `STND`, `IGLD`, `LWD`, and `CRD`, subject to station availability. NOAA errors for unsupported station/product combinations are preserved, including the message NOAA sends with an HTTP 400 (for example, the available current-prediction bins).

`height_m` is relative to the returned **datum**. Astronomical tide predictions do not include weather-driven water-level changes. Currents are a separate product: high/low water does not establish slack current. `velocity_major_mps` is signed (flood positive, ebb negative); mean flood/ebb directions are not instantaneous bearings. Observation-bin depths can change with deployments; the metadata endpoint describes current configuration, not historical deployment depth.

`quality` retains NOAA's `p` (preliminary) / `v` (verified) code; `flags` is unmodified. Missing measurements become `NULL`, including missing values in otherwise valid rows. An explicit NOAA “No data was found” response returns no rows. That can mean unavailable station/product/time coverage; it does not establish zero water level or zero current.

Every fetched row includes `source_url` and `fetched_at`. Measurement timestamps are `TIMESTAMPTZ` in UTC. Set DuckDB's display time zone to UTC when comparing textual output; timestamps retain the same instant in other session time zones.

## Requests and limits

Requests have 20-second timeouts, at most four attempts, and exponential backoff for network failures, HTTP 429 and HTTP 5xx. `Retry-After` seconds and HTTP dates are honored; waits beyond 30 seconds fail with a retry message rather than retrying too early. Other HTTP errors fail immediately. Each response is capped at 8 MiB and each emitted batch at 50,000 rows.

Upstream data is fetched at execution time; there is no persistent cache. Query results can change as NOAA updates its data. Unexpected response formats, unit changes, malformed numeric values and invalid timestamps fail explicitly.

For mirrors or fixture servers, set these environment variables **before launching the worker**:

- `TIDES_API_BASE_URL`: CO-OPS data API root; defaults to `https://api.tidesandcurrents.noaa.gov/api/prod`.
- `TIDES_METADATA_BASE_URL`: metadata API root; defaults to `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi`.

## Tests

```sh
make check          # Biome, strict TypeScript, unit tests, Haybarn SQL on all transports, metadata
make verify-stock   # Offline NOAA fixtures through stock DuckDB 2.0.0
make test-live      # Separate live NOAA requests through stock DuckDB 2.0.0
```

`make check` retains the starter's stdio, Unix-socket (`launch:`), HTTP and recipe checks, using Haybarn **2.0.0rc11**. SQL fixture tests validate values, empty responses, argument errors, joins and row counts beyond a single DuckDB batch. Live availability is deliberately separate. Tide-current live verification includes historical observations from November 12, 2025, because the sampled station may lack recent observations.

`vgi-worker.json` records the positive SQL assertions; `test/error-checks.json` records expected failures. `make verify-stock` and `make test-live` produce `verification-stock.json` and `verification-live.json`. [VERIFICATION.md](VERIFICATION.md) records tested versions and results.

## HTTP and Unix sockets

```sh
make run-http  # loopback HTTP on port 8000
```

```sql
ATTACH 'tides' (TYPE vgi, LOCATION 'http://127.0.0.1:8000');
-- Or let DuckDB manage the Unix-socket process:
ATTACH 'tides' (TYPE vgi, LOCATION 'launch:/absolute/path/vgi-tides/bin/vgi-tides-worker');
```

The worker also retains the starter's Dockerfile and release workflows. These files do not publish or deploy anything by themselves. Diagnostics go to stderr; stdout is reserved for the Arrow protocol in stdio mode.

## Sources

- [CO-OPS data API](https://api.tidesandcurrents.noaa.gov/api/prod/)
- [Response fields and quality flags](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html)
- [CO-OPS station metadata](https://api.tidesandcurrents.noaa.gov/mdapi/prod/)

## Starter and dependencies

Based on [Query-farm/vgi-starter-typescript](https://github.com/Query-farm/vgi-starter-typescript), template 1.3.0, commit `145aedcb87ed8fadde6dfb8a26197d0d68112369`. Resolved SDK: `@query-farm/vgi` **0.50.0**, RPC **0.29.7**, Arrow **21.1.1**. Pins and lockfiles are preserved; `tides` adds only its domain-specific implementation.

`make template-diff` reviews upstream starter changes. This project is independent of sibling workers and does not require their source trees.

## Support

Report issues with the query, worker version and NOAA source URL. Do not include credentials or unrelated private data. This implementation has no API credentials.

## License

[BSD Zero Clause](LICENSE), inherited from the Query Farm starter.

## Executed notebooks

See the [Tides notebook](notebooks/README.md) for a recorded observation/prediction comparison and threshold experiment.
