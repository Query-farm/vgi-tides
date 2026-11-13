import {
  type Arguments,
  batchFromColumns,
  bool,
  defineTableFunction,
  float64,
  int32,
  schema,
  type TableFunctionConfig,
  timestampMicros,
  utf8,
  type VgiDataType,
  type VgiSchema,
} from "@query-farm/vgi";
import { column, objectTags } from "./meta.ts";

export type Cell = string | number | bigint | boolean | null;
export type Row = Record<string, Cell>;
export type SqlType = "VARCHAR" | "DOUBLE" | "INTEGER" | "BOOLEAN" | "TIMESTAMPTZ";
export type Column = readonly [name: string, type: SqlType, description: string, nullable?: boolean];
const TYPES: Record<SqlType, () => VgiDataType> = {
  VARCHAR: utf8,
  DOUBLE: float64,
  INTEGER: () => int32,
  BOOLEAN: () => bool,
  TIMESTAMPTZ: () => timestampMicros("UTC"),
};

export function outputSchema(columns: readonly Column[]): VgiSchema {
  return schema(
    columns.map(([name, type, description, nullable = true]) => column(name, TYPES[type](), description, nullable)),
  );
}

export function rowsBatch(rows: Row[], output: VgiSchema) {
  if (rows.length > 50_000) throw new Error("NOAA response exceeds 50,000 rows per batch");
  return batchFromColumns(
    Object.fromEntries(output.fields.map((f) => [f.name, rows.map((r) => r[f.name] ?? null)])),
    output,
  );
}

export interface TableDocs {
  name: string;
  title: string;
  description: string;
  columns: readonly Column[];
  docs: string;
  keywords: string;
  examples: { sql: string; description: string }[];
}

export function tableMeta(spec: TableDocs) {
  return {
    name: spec.name,
    description: spec.description,
    examples: spec.examples,
    tags: {
      ...objectTags({
        title: spec.title,
        category: "api",
        keywords: spec.keywords,
        docLlm: spec.docs,
        docMd:
          `## ${spec.title}\n\n${spec.docs}\n\n### Result columns\n\n` +
          "| Column | Meaning |\n| --- | --- |\n" +
          spec.columns.map(([name, _type, description]) => `| ${name} | ${description} |`).join("\n"),
      }),
      "vgi.result_columns_schema": JSON.stringify(
        spec.columns.map(([name, type, description]) => ({ name, type, description })),
      ),
    },
  };
}

type OneShotConfig<A> = TableDocs &
  Pick<TableFunctionConfig<A>, "args" | "argDocs" | "argDefaults" | "argConstraints"> & {
    validate?: (args: A) => void;
    load: (args: A) => Promise<Row[]>;
  };

export function oneShot<A>(spec: OneShotConfig<A>) {
  const output = outputSchema(spec.columns);
  return defineTableFunction<A, { done: boolean }>({
    ...tableMeta(spec),
    args: spec.args,
    argDocs: spec.argDocs,
    argDefaults: spec.argDefaults,
    argConstraints: spec.argConstraints,
    onBind: ({ args, bindCall }) => {
      rejectNullArguments(bindCall.arguments);
      spec.validate?.(args);
      return { outputSchema: output };
    },
    initialState: () => ({ done: false }),
    process: async (params, state, out) => {
      if (state.done) {
        out.finish();
        return;
      }
      out.emit(rowsBatch(await spec.load(params.args), params.outputSchema));
      state.done = true;
    },
  });
}

export function object(value: unknown, label = "NOAA response"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`NOAA response is missing ${label} array`);
  return value.map((r) => object(r, label));
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "MM") return null;
  if (typeof value !== "number" && typeof value !== "string")
    throw new Error(`Invalid NOAA numeric value: ${String(value)}`);
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid NOAA numeric value: ${String(value)}`);
  return n;
}

export function textOrNull(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

export function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}

export function utcMicros(value: unknown): bigint {
  const text = requiredText(value, "NOAA timestamp");
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?Z?$/.test(text)) throw new Error(`Invalid UTC timestamp: ${text}`);
  const iso = text.replace(" ", "T").replace(/Z$/, "");
  const full = iso.length === 16 ? `${iso}:00` : iso;
  const ms = Date.parse(`${full}Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== full)
    throw new Error(`Invalid UTC timestamp: ${text}`);
  return BigInt(ms) * 1000n;
}

export function rejectNullArguments(args: Arguments): void {
  if (args.positional.some((v) => v === null) || [...args.named.values()].some((v) => v === null)) {
    throw new Error("NULL arguments are not supported; omit optional arguments to use their defaults");
  }
}
