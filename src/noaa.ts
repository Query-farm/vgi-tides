import { defineTableFunction, int64, utf8, type VgiFunction } from "@query-farm/vgi";
import { endpoint, getJson, UpstreamError } from "./http.ts";
import {
  type Column,
  numberOrNull,
  object,
  oneShot,
  outputSchema,
  type Row,
  records,
  rejectNullArguments,
  requiredText,
  rowsBatch,
  tableMeta,
  textOrNull,
  utcMicros,
} from "./table.ts";

export const DAY = 86_400_000;
const DATA_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod";
const META_BASE = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi";
export const DATUMS = ["MLLW", "MHHW", "MHW", "MTL", "MSL", "MLW", "NAVD", "STND", "IGLD", "LWD", "CRD"];
const KINDS = ["waterlevels", "tidepredictions", "currents", "currentpredictions"];
const PROVENANCE: Column[] = [
  ["source_url", "VARCHAR", "Exact NOAA request URL; identifies the data product and request parameters.", false],
  ["fetched_at", "TIMESTAMPTZ", "UTC time the NOAA response was retrieved; not the observation time.", false],
];
const STATION: Column = [
  "station_id",
  "VARCHAR",
  "NOAA station identifier; retain as text, including leading zeroes.",
  false,
];

export function stationId(value: unknown): string {
  const id = requiredText(value, "station_id");
  if (!/^[A-Za-z0-9]{4,12}$/.test(id)) throw new Error("station_id must contain 4–12 letters or digits");
  return id;
}

export function dateMs(value: unknown): number {
  const date = requiredText(value, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Dates must use YYYY-MM-DD");
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date)
    throw new Error(`Invalid date: ${date}`);
  return ms;
}

export function dateRange(start: unknown, end: unknown): { start: number; end: number } {
  const result = { start: dateMs(start), end: dateMs(end) };
  if (result.end < result.start) throw new Error("end_date must be on or after start_date");
  if (result.end - result.start >= 366 * DAY) throw new Error("A request may span at most 366 inclusive UTC days");
  return result;
}

function choice(value: unknown, values: string[], name: string): string {
  if (typeof value !== "string" || !values.includes(value))
    throw new Error(`${name} must be one of: ${values.join(", ")}`);
  return value;
}

function binNumber(value: unknown, allowZero: boolean): number {
  const n = typeof value === "number" || typeof value === "bigint" ? Number(value) : Number.NaN;
  if (!Number.isInteger(n) || n < (allowZero ? 0 : 1) || n > 1000)
    throw new Error("bin must be an integer within the documented range");
  return n;
}

export function noaaBody(body: unknown): Record<string, unknown> {
  const parsed = object(body);
  if (parsed.error) {
    const message = typeof parsed.error === "string" ? parsed.error : object(parsed.error).message;
    if (typeof message === "string" && /^No data was found\b/i.test(message))
      return { data: [], predictions: [], current_predictions: { cp: [] } };
    throw new UpstreamError(`NOAA: ${String(message ?? "unknown API error")}`);
  }
  return parsed;
}

function withSource(rows: Row[], url: URL): Row[] {
  const fetched = BigInt(Date.now()) * 1000n;
  return rows.map((row) => ({ ...row, source_url: url.toString(), fetched_at: fetched }));
}

export const STATION_COLUMNS: Column[] = [
  STATION,
  ["name", "VARCHAR", "Station name supplied by NOAA."],
  ["latitude", "DOUBLE", "Latitude in decimal degrees, north positive."],
  ["longitude", "DOUBLE", "Longitude in decimal degrees, east positive."],
  ["state", "VARCHAR", "US state or territory abbreviation when supplied."],
  [
    "station_kind",
    "VARCHAR",
    "Requested collection: waterlevels, tidepredictions, currents, or currentpredictions.",
    false,
  ],
  [
    "station_type",
    "VARCHAR",
    "NOAA station type code, when supplied; subordinate stations have restricted prediction intervals.",
  ],
  ...PROVENANCE,
];

export function parseStations(body: unknown, kind: string): Row[] {
  const data = noaaBody(body);
  return records(data.stations ?? data.stationList, "stations").map((s) => ({
    station_id: requiredText(s.id, "station id"),
    name: textOrNull(s.name),
    latitude: numberOrNull(s.lat),
    longitude: numberOrNull(s.lng),
    state: textOrNull(s.state),
    station_kind: kind,
    station_type: textOrNull(s.type),
  }));
}

const stations = oneShot<{ station_kind: string }>({
  name: "stations",
  title: "NOAA Tide and Current Stations",
  description: "Discover NOAA stations by observation or prediction capability",
  columns: STATION_COLUMNS,
  args: { station_kind: utf8() },
  argDefaults: { station_kind: "tidepredictions" },
  argDocs: {
    station_kind: "NOAA collection: tidepredictions (default), waterlevels, currentpredictions, or currents.",
  },
  argConstraints: { station_kind: { choices: KINDS } },
  validate: (a) => {
    choice(a.station_kind, KINDS, "station_kind");
  },
  load: async (a) => {
    const url = endpoint("TIDES_METADATA_BASE_URL", META_BASE, "stations.json");
    url.searchParams.set("type", a.station_kind);
    return withSource(parseStations(await getJson(url), a.station_kind), url);
  },
  keywords: "noaa, station, tides, currents, latitude, longitude, discovery",
  docs:
    "List stations for one NOAA CO-OPS product family. Use station_id with the corresponding tide or current function. " +
    "The named station_kind defaults to tidepredictions; use waterlevels for observations and currentpredictions/currents for current stations. " +
    "Returns station names, coordinates, state and NOAA station type. Filter in SQL; a tide station does not necessarily provide current predictions. " +
    "No API key is needed. Missing metadata is NULL; NULL arguments are rejected. Data is fetched at query execution and includes source_url and fetched_at.",
  examples: [
    {
      sql: "SELECT station_id, name, latitude, longitude FROM tides.main.stations() WHERE state = 'NY' ORDER BY name",
      description: "Find tide prediction stations in New York",
    },
  ],
});

const WATER_COLUMNS: Column[] = [
  STATION,
  ["time", "TIMESTAMPTZ", "UTC timestamp of the predicted tide or observed water level.", false],
  ["height_m", "DOUBLE", "Water level in metres relative to the datum column; NULL for a missing value."],
  ["datum", "VARCHAR", "Requested vertical reference, such as MLLW; compare heights only on compatible datums.", false],
  ["event_type", "VARCHAR", "H for high tide, L for low tide; NULL for interval samples or observations."],
  ["sigma_m", "DOUBLE", "Standard deviation in metres for observed water levels; NULL for predictions."],
  ["quality", "VARCHAR", "NOAA observation quality code: p preliminary or v verified; NULL for predictions."],
  ["flags", "VARCHAR", "Unmodified NOAA comma-separated observation quality flags; NULL when absent."],
  ...PROVENANCE,
];

const PREDICTED_CURRENT_COLUMNS: Column[] = [
  STATION,
  ["time", "TIMESTAMPTZ", "UTC timestamp of the current prediction.", false],
  [
    "velocity_major_mps",
    "DOUBLE",
    "Signed velocity along the major axis in m/s: positive flood, negative ebb; NOAA cm/s divided by 100.",
  ],
  [
    "event_type",
    "VARCHAR",
    "NOAA event type, typically flood, ebb, or slack for max_slack; NULL for interval samples.",
  ],
  ["flood_direction_deg", "DOUBLE", "Mean flood direction in degrees from true north; not an instantaneous bearing."],
  ["ebb_direction_deg", "DOUBLE", "Mean ebb direction in degrees from true north; not an instantaneous bearing."],
  ["bin", "INTEGER", "Depth-bin identifier supplied by NOAA."],
  ["depth_m", "DOUBLE", "NOAA prediction-bin depth in metres."],
  ...PROVENANCE,
];

const CURRENT_COLUMNS: Column[] = [
  STATION,
  ["time", "TIMESTAMPTZ", "UTC timestamp of the current observation.", false],
  ["speed_mps", "DOUBLE", "Observed current speed in m/s, converted from NOAA cm/s."],
  ["direction_deg", "DOUBLE", "Direction toward which the current flows, degrees from true north."],
  ["bin", "INTEGER", "Observed depth-bin identifier; use current_bins for deployed sensor depths."],
  ["flags", "VARCHAR", "Unmodified NOAA quality flags, when available."],
  ...PROVENANCE,
];

export interface SeriesArgs {
  station_id: string;
  start_date: string;
  end_date: string;
  datum?: string;
  step?: string;
  bin?: bigint;
}

type Product = "predictions" | "water_level" | "currents_predictions" | "currents";

export function parseSeries(body: unknown, product: Product, args: SeriesArgs): Row[] {
  const data = noaaBody(body);
  const values =
    product === "currents_predictions"
      ? records(object(data.current_predictions).cp, "current_predictions.cp")
      : records(product === "predictions" ? data.predictions : data.data, product);
  return values.map((r) => {
    const base = { station_id: args.station_id, time: utcMicros(r.t ?? r.Time) };
    if (product === "predictions" || product === "water_level")
      return {
        ...base,
        height_m: numberOrNull(r.v),
        datum: args.datum ?? "MLLW",
        event_type: textOrNull(r.type),
        sigma_m: numberOrNull(r.s),
        quality: textOrNull(r.q),
        flags: textOrNull(r.f),
      };
    const velocity = numberOrNull(product === "currents" ? r.s : r.Velocity_Major);
    if (product === "currents")
      return {
        ...base,
        speed_mps: velocity === null ? null : velocity / 100,
        direction_deg: numberOrNull(r.d),
        bin: numberOrNull(r.b),
        flags: textOrNull(r.f),
      };
    return {
      ...base,
      velocity_major_mps: velocity === null ? null : velocity / 100,
      event_type: textOrNull(r.Type),
      flood_direction_deg: numberOrNull(r.meanFloodDir),
      ebb_direction_deg: numberOrNull(r.meanEbbDir),
      bin: numberOrNull(r.Bin),
      depth_m: numberOrNull(r.Depth),
    };
  });
}

function series(product: Product, name: string, title: string, description: string): VgiFunction {
  const water = product === "predictions" || product === "water_level";
  const predicted = product === "predictions" || product === "currents_predictions";
  const steps = water
    ? ["hilo", "h", "1", "5", "6", "10", "15", "30", "60"]
    : ["max_slack", "h", "1", "6", "10", "30", "60"];
  const args = {
    station_id: utf8(),
    start_date: utf8(),
    end_date: utf8(),
    ...(water ? { datum: utf8() } : { bin: int64() }),
    ...(predicted ? { step: utf8() } : {}),
  };
  const columns = water ? WATER_COLUMNS : product === "currents" ? CURRENT_COLUMNS : PREDICTED_CURRENT_COLUMNS;
  const output = outputSchema(columns);
  const argDocs: Record<string, string> = {
    station_id: "NOAA station identifier from the matching stations collection; preserve any leading zeroes.",
    start_date: "First UTC day, inclusive, formatted YYYY-MM-DD.",
    end_date: "Last UTC day, inclusive, formatted YYYY-MM-DD; must be on or after start_date.",
  };
  if (water)
    argDocs.datum =
      "Vertical datum; default MLLW. Subordinate predictions require MLLW. Supported datums vary by station.";
  else
    argDocs.bin =
      product === "currents"
        ? "Depth-bin identifier; 0 (default) requests all observation bins."
        : "Prediction depth-bin identifier, default 1; availability is station-specific.";
  if (predicted)
    argDocs.step = water
      ? "Prediction interval: hilo (default), h, or 1/5/6/10/15/30/60 minutes. Subordinate stations require hilo."
      : "Prediction interval: max_slack (default), h, or 1/6/10/30/60 minutes. Subordinate stations require max_slack.";
  const defaults = {
    ...(water ? { datum: "MLLW" } : { bin: product === "currents" ? 0 : 1 }),
    ...(predicted ? { step: water ? "hilo" : "max_slack" } : {}),
  };
  const sample = water ? "8518750" : product === "currents" ? "cb0102" : "ACT0956";
  const measure = water ? "height_m" : product === "currents" ? "speed_mps" : "velocity_major_mps";
  return defineTableFunction<SeriesArgs, { nextDay: number; endDay: number }>({
    ...tableMeta({
      name,
      title,
      description,
      columns,
      keywords: `noaa, ${name}, marine, time series, UTC`,
      docs:
        `${description}. Requires station_id, start_date and end_date (inclusive UTC dates, YYYY-MM-DD). ` +
        `Returns ${measure} with typed UTC timestamps, station_id, source_url and fetched_at. ` +
        (water
          ? "Heights are metres relative to the named datum (default MLLW). Predictions are astronomical, not weather-adjusted water levels. "
          : "Speeds are m/s converted from NOAA cm/s. Current predictions describe flow, and slack must not be inferred from high or low tide. ") +
        (product === "currents_predictions"
          ? "velocity_major_mps is signed along the major axis; mean flood/ebb directions are not instantaneous bearings. Default step=max_slack; bin=1. "
          : "") +
        " Requests are split into non-overlapping chunks of at most seven days; all-bin observations use one-day chunks. " +
        "Missing measurements become NULL and observation flags remain unmodified. Explicit NOAA no-data responses produce no rows; other API errors fail. NULL arguments are rejected. No API key required.",
      examples: [
        {
          sql: `SELECT time, ${measure} FROM tides.main.${name}('${sample}', '2026-01-01', '2026-01-02') ORDER BY time`,
          description: `Inspect ${title.toLowerCase()} in UTC`,
        },
      ],
    }),
    args,
    argDefaults: defaults,
    argDocs,
    argConstraints: {
      station_id: { pattern: "^[A-Za-z0-9]{4,12}$" },
      ...(water ? { datum: { choices: DATUMS } } : { bin: { ge: product === "currents" ? 0 : 1, le: 1000 } }),
      ...(predicted ? { step: { choices: steps } } : {}),
    },
    onBind: ({ args: a, bindCall }) => {
      rejectNullArguments(bindCall.arguments);
      stationId(a.station_id);
      dateRange(a.start_date, a.end_date);
      if (water) choice(a.datum, DATUMS, "datum");
      else binNumber(a.bin, product === "currents");
      if (predicted) choice(a.step, steps, "step");
      return { outputSchema: output };
    },
    initialState: ({ args: a }) => ({ nextDay: dateMs(a.start_date), endDay: dateMs(a.end_date) }),
    process: async (params, state, out) => {
      if (state.nextDay > state.endDay) {
        out.finish();
        return;
      }
      const a = params.args;
      const days = product === "currents" && Number(a.bin) === 0 ? 1 : 7;
      const end = Math.min(state.endDay, state.nextDay + (days - 1) * DAY);
      const compact = (ms: number) => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");
      const url = endpoint("TIDES_API_BASE_URL", DATA_BASE, "datagetter");
      url.search = new URLSearchParams({
        product,
        station: a.station_id,
        begin_date: compact(state.nextDay),
        end_date: compact(end),
        units: "metric",
        time_zone: "gmt",
        format: "json",
        application: "QueryFarm_vgi_tides",
        ...(water ? { datum: a.datum ?? "MLLW" } : { bin: String(a.bin) }),
        ...(predicted ? { interval: a.step ?? "" } : {}),
      }).toString();
      const rows = parseSeries(await getJson(url), product, a).filter(
        (r) => (r.time as bigint) >= BigInt(state.nextDay) * 1000n && (r.time as bigint) < BigInt(end + DAY) * 1000n,
      );
      out.emit(rowsBatch(withSource(rows, url), params.outputSchema));
      state.nextDay = end + DAY;
    },
  });
}

const bins = oneShot<{ station_id: string }>({
  name: "current_bins",
  title: "Current Observation Depth Bins",
  description: "Read NOAA current-meter bin depths and deployment metadata",
  args: { station_id: utf8() },
  argDocs: { station_id: "Current observation station ID from stations(station_kind := 'currents')." },
  argConstraints: { station_id: { pattern: "^[A-Za-z0-9]{4,12}$" } },
  validate: (a) => {
    stationId(a.station_id);
  },
  columns: [
    STATION,
    ["bin", "INTEGER", "Current-meter depth-bin identifier."],
    ["depth_m", "DOUBLE", "Bin depth in metres as supplied by NOAA; deployment-dependent."],
    ["qc_flag", "INTEGER", "NOAA bin quality-control flag."],
    ...PROVENANCE,
  ],
  load: async (a) => {
    const url = endpoint("TIDES_METADATA_BASE_URL", META_BASE, `stations/${a.station_id}/bins.json`);
    url.searchParams.set("units", "metric");
    const data = noaaBody(await getJson(url));
    const raw = data.bins ?? data.binList;
    if (raw === undefined && data.bins !== null) throw new Error("NOAA response is missing bins array");
    return withSource(
      records(raw ?? [], "bins").map((b) => ({
        station_id: a.station_id,
        bin: numberOrNull(b.bin ?? b.num),
        depth_m: numberOrNull(b.depth),
        qc_flag: numberOrNull(b.qc_flag),
      })),
      url,
    );
  },
  keywords: "noaa, current, bins, depth, observation, sensor",
  docs:
    "Read current-meter observation bins by required station_id. Returns bin, depth_m and qc_flag, plus source_url and fetched_at. " +
    "Depths are in metres and can change between deployments; this is current metadata, not a reconstruction of historical deployments. " +
    "Use with currents(), not as a complete prediction-station bin listing. NOAA stations with no bins return no rows. NULL station_id is rejected. No API key required.",
  examples: [
    {
      sql: "SELECT bin, depth_m FROM tides.main.current_bins('cb0102') ORDER BY bin",
      description: "Inspect the observation depths at Cape Henry",
    },
  ],
});

export const FUNCTIONS: VgiFunction[] = [
  stations,
  series(
    "predictions",
    "tide_predictions",
    "Tide Predictions",
    "Read predicted high/low tides or interval water levels from NOAA",
  ),
  series(
    "water_level",
    "water_levels",
    "Observed Water Levels",
    "Read preliminary or verified six-minute water levels with NOAA quality flags",
  ),
  series(
    "currents_predictions",
    "current_predictions",
    "Tidal Current Predictions",
    "Read predicted slack, flood and ebb events or interval major-axis currents",
  ),
  series(
    "currents",
    "currents",
    "Observed Currents",
    "Read current speed and direction from NOAA current-meter stations",
  ),
  bins,
];
