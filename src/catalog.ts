import { referenceTable } from "./reference.ts";
/** Assemble NOAA readers and reference tables into the public catalog. */

import type { CatalogDescriptor, VgiFunction } from "@query-farm/vgi";
import type { Example } from "./composed.ts";
import { CATALOG_DOC_MD, CATALOG_NAME, CATALOG_TAGS, SCHEMA_DOC_MD, SCHEMA_TAGS, SOURCE_URL } from "./meta.ts";
import { FUNCTIONS } from "./noaa.ts";

export { FUNCTIONS } from "./noaa.ts";

/**
 * Publish each function's examples as `vgi.example_queries` (with descriptions).
 *
 * Overloads share one SQL name, so their examples are merged per name.
 * Returns every distinct example, for the schema-level list.
 */
function stampExampleQueries(functions: VgiFunction[]): Example[] {
  const byName = new Map<string, Example[]>();
  for (const fn of functions) {
    const bucket = byName.get(fn.meta.name) ?? [];
    byName.set(fn.meta.name, bucket);
    for (const ex of fn.meta.examples ?? []) {
      if (!bucket.some((e) => e.sql === ex.sql)) bucket.push({ description: ex.description, sql: ex.sql });
    }
  }
  for (const fn of functions) {
    fn.meta.tags = { ...fn.meta.tags, "vgi.example_queries": JSON.stringify(byName.get(fn.meta.name)) };
  }
  // A composed example appears on each object it drives (e.g. currents and current_bins); list it once here.
  const all: Example[] = [];
  for (const ex of [...byName.values()].flat()) if (!all.some((e) => e.sql === ex.sql)) all.push(ex);
  return all;
}

const ALL_EXAMPLES = stampExampleQueries(FUNCTIONS);

export const CATALOG: CatalogDescriptor = {
  name: CATALOG_NAME,
  comment: CATALOG_DOC_MD,
  sourceUrl: SOURCE_URL,
  tags: CATALOG_TAGS,
  schemas: [
    {
      path: ["main"],
      comment: SCHEMA_DOC_MD,
      functions: FUNCTIONS,
      tables: [referenceTable],
      tags: { ...SCHEMA_TAGS, "vgi.example_queries": JSON.stringify(ALL_EXAMPLES) },
    },
  ],
};
