# Changelog

## 0.2.0 (2026-11-25)

- VGI protocol 3.4: bump @query-farm/vgi to 0.52.3 and @query-farm/vgi-rpc to 0.30.3. **Requires the
  3.4 vgi extension**: DuckDB 2.0 (`INSTALL vgi FROM query_farm`) or Haybarn 2.0.1+; Haybarn 2.0.0
  still serves the 3.3 extension, which cannot attach this worker.
- The Docker image supports Orchard hosted mode (`VGI_ORCHARD_HOSTED=1`): HTTP only, Orchard Pass
  authentication, large values through the Orchard blob vendor; the HEALTHCHECK uses `HEAD /health`.
- CI and `make` run the SQL tests on haybarn-unittest 2.0.1rc3.

## 0.1.3 (2026-11-16)

- Bump @query-farm/vgi to 0.50.1.
- CI tooling (haybarn-unittest, lint helpers) runs on Python 3.14.

## 0.1.2

- Docs link to upstream sources: the catalog `vgi.doc_md` now links NOAA Tides & Currents, the CO-OPS Data Retrieval and Metadata APIs, and the tidal datum definitions (VGI183).
- The `main` schema comment is now a short plain-text line instead of repeating the schema `vgi.doc_md` (VGI102).

## 0.1.1 (unreleased)

- The catalog comment is now one plain-text sentence (under 300 characters) describing the worker's data, instead of the Markdown overview. The full overview remains in the catalog's `vgi.doc_md` and `vgi.doc_llm` tags.

## 0.1.0 (unreleased)

Initial worker generated from the VGI starter template.

Targets: @query-farm/vgi 0.50 · VGI protocol 3.3 · Haybarn 2.0.1rc3 · vgi-lint-check 2.x (unpinned)
