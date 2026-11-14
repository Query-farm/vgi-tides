/**
 * Discovery metadata: the one file to edit when you rename or extend the worker.
 *
 * DuckDB, coding agents and the `vgi-lint` metadata checker all read these
 * tags. Keep every object documented and `make lint-explain` stays at 100.
 *
 * - Catalog-level tags (title, license, author, links, long description) live in
 *   `CATALOG_TAGS` below.
 * - Every function carries `objectTags(...)`: a title, a category from
 *   `SCHEMA_CATEGORIES`, search keywords, and LLM- and human-facing docs.
 */

import { field, type VgiDataType, type VgiField } from "@query-farm/vgi";

export const CATALOG_NAME = "tides";
export const VERSION = "0.1.0";

export const SOURCE_URL = "https://github.com/Query-farm/vgi-tides";

/**
 * Categories group functions in docs and agent tools. Every object's
 * `vgi.category` must name one of these.
 */
export const SCHEMA_CATEGORIES = [
  { name: "api", title: "REST APIs", description: "Table functions that read from HTTP APIs." },
] as const;

export type Category = (typeof SCHEMA_CATEGORIES)[number]["name"];

/** Turn `"a, b, c"` into the JSON array string `vgi.keywords` requires. */
export function keywordsArray(keywords: string): string {
  return JSON.stringify(
    keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
}

/** Build the standard per-object discovery tags. */
export function objectTags(opts: {
  title: string;
  category: Category;
  keywords: string;
  docLlm: string;
  docMd: string;
}): Record<string, string> {
  return {
    "vgi.title": opts.title,
    "vgi.category": opts.category,
    "vgi.keywords": keywordsArray(opts.keywords),
    "vgi.doc_llm": opts.docLlm,
    "vgi.doc_md": opts.docMd,
  };
}

/** Build an Arrow field whose `comment` shows up in DuckDB's `DESCRIBE` and agent tools. */
export function column(name: string, type: VgiDataType, comment: string, nullable = true): VgiField {
  return field(name, type, nullable, new Map([["comment", comment]]));
}

export const CATALOG_DOC_LLM =
  "NOAA CO-OPS tide and current stations, predictions and observations in SQL. Table functions return typed Arrow columns with UTC timestamps, source URLs and retrieval times. No API key is needed. Missing measurements become NULL; invalid arguments and unexpected upstream responses fail explicitly. Data is retrieved when a query executes. Use SQL to filter, aggregate and join stations to measurements. Water levels are metres relative to the returned datum, default MLLW. Current velocities are converted from cm/s to m/s. Time-series dates are inclusive UTC days, at most 366 days; requests are automatically chunked. Tide predictions are astronomical and current slack is a separate product.";
export const CATALOG_DOC_MD =
  "# NOAA Tides\n\n" +
  CATALOG_DOC_LLM +
  "\n\n## Data access\n\nUse the main schema to discover stations and retrieve observations. Each response preserves its source URL and UTC retrieval time. Missing sensor values remain NULL.";
export const SCHEMA_DOC_LLM = `The main schema exposes tides station discovery, measurements and reference information. ${CATALOG_DOC_LLM}`;
export const SCHEMA_DOC_MD =
  "## Marine functions\n\n" +
  SCHEMA_DOC_LLM +
  "\n\n### Query patterns\n\nDiscover station IDs first, retrieve measurements, then join or aggregate the resulting rows. Use the reference table for measurement units and supported products.";
export const AGENT_TEST_TASKS = [
  {
    name: "reference_units",
    prompt: "List sql_function and output_units for products measured in m/s, ordered by sql_function.",
  },
  {
    name: "stations_query",
    prompt: "Using tides.main.stations, list the first five station IDs and names ordered by station ID.",
  },
  {
    name: "tide_predictions_query",
    prompt:
      "Using tides.main.tide_predictions, show time and height_m for station 8518750 for January 1\u20132, 2026, ordered by time.",
  },
  {
    name: "water_levels_query",
    prompt:
      "Using tides.main.water_levels, show time and height_m for station 8518750 for January 1\u20132, 2026, ordered by time.",
  },
  {
    name: "current_predictions_query",
    prompt:
      "Using tides.main.current_predictions, show time and velocity_major_mps for station ACT0956 for January 1\u20132, 2026, ordered by time.",
  },
  {
    name: "currents_query",
    prompt:
      "Using tides.main.currents, show time and speed_mps for station cb0102 for January 1\u20132, 2026, ordered by time.",
  },
  {
    name: "current_bins_query",
    prompt: "Using tides.main.current_bins, list bin and depth_m for current station cb0102 ordered by bin.",
  },
  {
    name: "composed_battery_peak_residual",
    prompt:
      "At The Battery (NOAA station 8518750), from 2026-01-08 through 2026-01-14 (inclusive UTC days), at which six-minute time did the observed water level " +
      "exceed the six-minute tide prediction by the most, and by how much (observed minus predicted, metres, default MLLW datum)? " +
      "Save the answer with CREATE TEMP TABLE battery_peak_residual AS SELECT ... with exactly one row and columns time (TIMESTAMPTZ) and residual_m (DOUBLE).",
  },
  {
    name: "composed_cape_henry_slowest_depth",
    prompt:
      "At NOAA current-meter station cb0102 (Cape Henry), averaging every observed current speed from 2026-01-02 through 2026-01-03 (inclusive UTC days) per depth bin, " +
      "which sensor depth had the lowest mean speed? Report the depth in metres from the station's bin metadata. " +
      "Save the answer with CREATE TEMP TABLE slowest_depth AS SELECT ... with exactly one row and columns depth_m (DOUBLE) and mean_speed_mps (DOUBLE).",
  },
];
export const CATALOG_TAGS: Record<string, string> = {
  ...{
    "vgi.title": "NOAA Tides",
    "vgi.subtitle": "NOAA CO-OPS tide and current stations, predictions and observations for marine analysis.",
    "vgi.source_url": "https://github.com/Query-farm/vgi-tides",
    "vgi.icon_url": "https://query.farm/media-kit/products/vgi/vgi-logo.png",
    "vgi.license": "0BSD",
    "vgi.author": "Query.Farm",
    "vgi.copyright": "Copyright 2026 Query.Farm LLC",
    "vgi.support_contact": "https://github.com/Query-farm/vgi-tides/issues",
    "vgi.support_policy_url": "https://github.com/Query-farm/vgi-tides#support",
    "vgi.keywords": '["noaa", "tides", "marine", "sql", "observations", "stations"]',
  },
  "vgi.doc_llm": CATALOG_DOC_LLM,
  "vgi.doc_md": CATALOG_DOC_MD,
  "vgi.agent_test_tasks": JSON.stringify(AGENT_TEST_TASKS),
};
export const SCHEMA_TAGS: Record<string, string> = {
  "vgi.title": "Marine Data",
  domain: "marine",
  "vgi.keywords": keywordsArray("noaa, tides, marine, observations"),
  "vgi.doc_llm": SCHEMA_DOC_LLM,
  "vgi.doc_md": SCHEMA_DOC_MD,
  "vgi.categories": JSON.stringify(SCHEMA_CATEGORIES),
};
