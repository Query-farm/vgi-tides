import { expect, test } from "bun:test";
import { dateRange, noaaBody, parseSeries, parseStations, stationId } from "../src/noaa.ts";
import { numberOrNull, utcMicros } from "../src/table.ts";

test("strict UTC dates, range limits and station IDs reject invalid input", () => {
  expect(dateRange("2024-02-29", "2024-02-29").start).toBe(Date.parse("2024-02-29T00:00:00Z"));
  for (const [a, b] of [
    ["2026-02-29", "2026-03-01"],
    ["2026-01-02", "2026-01-01"],
    ["2026-01-01", "2027-01-02"],
    [null, "2026-01-01"],
  ]) {
    expect(() => dateRange(a, b)).toThrow();
  }
  expect(() => stationId("../private")).toThrow();
  expect(() => stationId(null)).toThrow();
  expect(() => utcMicros("2026-02-30 00:00")).toThrow();
  expect(utcMicros("2026-01-01 00:00")).toBe(1767225600000000n);
});

test("missing values stay NULL while zero, negative heights and QC flags are preserved", () => {
  const args = { station_id: "8518750", start_date: "2026-01-01", end_date: "2026-01-01", datum: "MSL" };
  const data = ["", "0", "-0.2"].map((v) => ({ t: "2026-01-01 00:00", v, s: "", q: "p", f: "1,0,0,0" }));
  const rows = parseSeries({ data }, "water_level", args);
  expect(rows.map((r) => r.height_m)).toEqual([null, 0, -0.2]);
  expect(rows[0]).toMatchObject({ datum: "MSL", sigma_m: null, quality: "p", flags: "1,0,0,0" });
  expect(() => numberOrNull("not-a-number")).toThrow();
});

test("currents normalize cm/s without losing ebb sign or slack zero", () => {
  const args = { station_id: "ACT0956", start_date: "2026-01-01", end_date: "2026-01-01" };
  const cp = [-25, 0, 100].map((Velocity_Major) => ({
    Time: "2026-01-01 00:00",
    Velocity_Major,
    Bin: "1",
    Depth: "1.8",
  }));
  expect(
    parseSeries({ current_predictions: { cp } }, "currents_predictions", args).map((r) => r.velocity_major_mps),
  ).toEqual([-0.25, 0, 1]);
});

test("only explicit no-data responses become empty; malformed and upstream errors fail", () => {
  expect(noaaBody({ error: { message: "No data was found. Try another range." } }).data).toEqual([]);
  expect(() => noaaBody({ error: { message: "Invalid station" } })).toThrow("Invalid station");
  expect(() => parseStations({ unexpected: [] }, "waterlevels")).toThrow("stations array");
  expect(parseStations({ stations: [] }, "waterlevels")).toEqual([]);
  // Current-prediction stations are listed once per depth bin; the bin keeps those rows distinct.
  const perBin = parseStations(
    {
      stations: [4, 9].map((currbin) => ({
        id: "cb0102",
        name: "Cape Henry",
        lat: 36.96,
        lng: -76.01,
        type: "H",
        currbin,
      })),
    },
    "currentpredictions",
  );
  expect(perBin.map((r) => r.bin)).toEqual([4, 9]);
  expect(parseStations({ stations: [{ id: "8518750" }] }, "waterlevels")[0]?.bin).toBeNull();
});
