# Verification: vgi-tides

Verified locally on November 13, 2026, macOS ARM64.

## Implementation and provenance

- Language/runtime: TypeScript, Bun 1.3.14.
- Starter: [Query-farm/vgi-starter-typescript](https://github.com/Query-farm/vgi-starter-typescript), template 1.3.0.
- Starter revision: `145aedcb87ed8fadde6dfb8a26197d0d68112369`.
- SDK: `@query-farm/vgi` 0.50.0; RPC 0.29.7; Arrow 21.1.1.
- Both unmodified, initialized starter baselines passed `make check` before adaptation.
- Starter sample functions and their tests were replaced with NOAA domain functions and assertions. Generic recipe tests and all three transport lanes were retained.

## Results

| Check | Result |
| --- | --- |
| `make check`: Biome + strict TypeScript | Passed |
| Unit/parser/HTTP/worker tests | 14 passed, zero failures |
| Haybarn 2.0.0rc11, stdio | 115 assertions passed, including starter recipes |
| Haybarn 2.0.0rc11, Unix-socket launch | 115 assertions passed, including starter recipes |
| Haybarn 2.0.0rc11, HTTP | 78 assertions passed |
| Metadata | 100/100, L2 behavioral, zero errors or warnings |
| `make verify-stock`: stock DuckDB 2.0.0 | 13 result checks and 7 expected-error checks passed |
| Skill's bundled stock-DuckDB verifier | 13 checks passed |
| `make test-live`: live NOAA requests through stock DuckDB 2.0.0 | 6 checks passed |
| `demo.sql` | Executed against live NOAA successfully |

The signed VGI extension was **e75482339d**, installed from `query_farm`. The stock-DuckDB checks use an isolated repository directory and keep signature verification enabled. These are real SQL-engine checks, not only SDK tests.

Fixture tests cover units, UTC timestamps, missing versus zero values, valid negative measurements, empty outputs, invalid inputs, upstream errors, rate-limit retries, joins and large or multiple batches. Every fixture request initially receives HTTP 429 to exercise retries on all transport lanes.

The NOAA current-depth metadata uses `num` for the bin ID in current live responses; the reader accepts both `num` and the documented `bin` spelling, and tests cover both. Live current-observation verification uses Cape Henry, bin 4, on 2025-11-12. Recent sampled current requests returned NOAA no-data responses; this is represented as an empty result, not fabricated zero flow. Other live checks cover current-day tide and current predictions, previous-day observed water levels, station discovery and depth bins.

## Reproduce

```sh
make check
make verify-stock
make test-live
```

Positive assertions and launcher: [vgi-worker.json](vgi-worker.json).
Error assertions: [test/error-checks.json](test/error-checks.json).
Reports: [stock](verification-stock.json), [live](verification-live.json), [skill verifier](verification-skill.json).

The skill verifier was also run with the local fixture wrapper:

```sh
python3 scripts/with_fixtures.py env TZ=UTC \
  uv run --no-project --with duckdb==2.0.0 python \
  /path/to/vgi-worker/scripts/verify_worker.py \
  --project . --timeout 120 --output verification-skill.json
```

Run the [SQL demo](demo.sql) with stock DuckDB 2.0.0. When fetching TIMESTAMPTZ rows from the Python DuckDB driver, install its `pytz` dependency; the worker itself does not require Python or pytz.

## Scope

The results above describe the original local implementation verification, before publication. GitHub Actions, Docker and cross-platform release workflows were retained; their remote results are recorded in GitHub Actions. No hosted worker service was deployed. The HTTP and Unix-socket transports were tested locally. No unresolved implementation or required-check failures remain.

## Release preparation

The standalone macOS ARM64 binary was compiled with Bun, packed into a tar.gz with README and LICENSE, and extracted into a temporary directory outside the source tree. The full stock-DuckDB fixture contract (including expected errors) passed against that executable with the extraction directory as the working directory. See [verification-package.json](verification-package.json). `actionlint` and `ci/check-version.sh v0.1.0` also passed.
