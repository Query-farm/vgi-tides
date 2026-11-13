import { constraintRecord, type TableDescriptor } from "@query-farm/vgi";
import { type Column, oneShot, outputSchema } from "./table.ts";

const COLUMNS: Column[] = [
  ["sql_function", "VARCHAR", "Worker function to call.", false],
  ["noaa_product", "VARCHAR", "NOAA product or metadata resource.", false],
  ["output_units", "VARCHAR", "Primary measurement units returned by the worker.", false],
];
const ROWS = [
  {
    sql_function: "stations",
    noaa_product: "stations",
    output_units: "degrees",
  },
  {
    sql_function: "tide_predictions",
    noaa_product: "predictions",
    output_units: "m",
  },
  {
    sql_function: "water_levels",
    noaa_product: "water_level",
    output_units: "m",
  },
  {
    sql_function: "current_predictions",
    noaa_product: "currents_predictions",
    output_units: "m/s",
  },
  {
    sql_function: "currents",
    noaa_product: "currents",
    output_units: "m/s",
  },
  {
    sql_function: "current_bins",
    noaa_product: "bins",
    output_units: "m",
  },
];
const scan = oneShot<Record<string, never>>({
  name: "products_scan",
  title: "Products Reference",
  description: "Read products reference rows",
  columns: COLUMNS,
  args: {},
  argDocs: {},
  load: async () => ROWS,
  keywords: "reference, noaa, units, tides",
  docs: "A built-in reference of the supported NOAA CO-OPS product mappings. Query sql_function, noaa_product and output_units to discover the right reader. This table is deterministic, requires no arguments and makes no network requests. Water heights also carry a datum; a unit alone is not enough to compare vertical references.",
  examples: [
    {
      sql: "SELECT sql_function, output_units FROM tides.main.products WHERE output_units = 'm/s' ORDER BY sql_function",
      description: "Supported CO-OPS products and the units returned by this worker",
    },
  ],
});
export const referenceTable: TableDescriptor = {
  name: "products",
  columns: outputSchema(COLUMNS),
  function: scan,
  comment: "Supported CO-OPS products and the units returned by this worker",
  columnComments: Object.fromEntries(COLUMNS.map(([n, _t, d]) => [n, d])),
  constraints: [
    ...COLUMNS.map(([name]) =>
      constraintRecord({
        schemaPath: ["main"],
        table: "products",
        id: `${name}_not_null`,
        kind: "NOT_NULL",
        columns: [[name]],
        enforcement: "ENFORCED",
        validation: "ALL_ROWS",
      }),
    ),
    constraintRecord({
      schemaPath: ["main"],
      table: "products",
      id: "primary_key",
      kind: "PRIMARY_KEY",
      columns: [["sql_function"]],
      enforcement: "ENFORCED",
      validation: "ALL_ROWS",
    }),
  ],
  tags: {
    domain: "marine",
    ...scan.meta.tags,
    "vgi.executable_examples": JSON.stringify([
      {
        sql: "SELECT sql_function, output_units FROM tides.main.products WHERE output_units = 'm/s' ORDER BY sql_function",
        description: "Supported CO-OPS products and the units returned by this worker",
        expected_result: [
          ["current_predictions", "m/s"],
          ["currents", "m/s"],
        ],
      },
    ]),
    "vgi.example_queries": JSON.stringify([
      {
        sql: "SELECT sql_function, output_units FROM tides.main.products WHERE output_units = 'm/s' ORDER BY sql_function",
        description: "Supported CO-OPS products and the units returned by this worker",
      },
    ]),
  },
};
