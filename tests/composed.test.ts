import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "../src/catalog.ts";
import {
  COMPOSED_EXAMPLES,
  DAILY_SURGE_RESIDUAL,
  type Example,
  HIGH_TIDE_VS_OBSERVED,
  PREDICTED_EVENTS_VS_OBSERVED,
  SPEED_BY_DEPTH,
} from "../src/composed.ts";

const SQL_TEST = readFileSync(join(import.meta.dir, "..", "test/sql/tides.test"), "utf8");
const schema = CATALOG.schemas[0];

function examples(tags: Record<string, string> | undefined): Example[] {
  return JSON.parse(tags?.["vgi.example_queries"] ?? "[]") as Example[];
}

function functionExamples(name: string): Example[] {
  return examples(schema?.functions?.find((f) => f.meta.name === name)?.meta.tags);
}

describe("composed examples", () => {
  const placements: [Example, string][] = [
    [DAILY_SURGE_RESIDUAL, "water_levels"],
    [HIGH_TIDE_VS_OBSERVED, "tide_predictions"],
    [SPEED_BY_DEPTH, "currents"],
    [SPEED_BY_DEPTH, "current_bins"],
    [PREDICTED_EVENTS_VS_OBSERVED, "current_predictions"],
  ];

  test("each sits within its driving function's first five examples", () => {
    for (const [example, name] of placements) {
      const index = functionExamples(name).findIndex((e) => e.sql === example.sql);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(5);
    }
  });

  test("each is in the schema-level list exactly once", () => {
    const all = examples(schema?.tags);
    for (const example of COMPOSED_EXAMPLES) {
      expect(all.filter((e) => e.sql === example.sql)).toHaveLength(1);
    }
  });

  test("each SQL is one statement and runs verbatim in the fixture SQL tests", () => {
    for (const example of COMPOSED_EXAMPLES) {
      expect(SQL_TEST).toContain(example.sql);
      expect(example.sql).not.toContain(";");
    }
  });
});
