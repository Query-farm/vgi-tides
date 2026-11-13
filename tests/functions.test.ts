import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Arguments, VgiClient } from "@query-farm/vgi";
import { subprocessConnect } from "@query-farm/vgi-rpc";

const ROOT = join(import.meta.dir, "..");
describe("NOAA fixtures through the worker transport", () => {
  let client: VgiClient;
  let mock: ReturnType<typeof Bun.spawn>;
  beforeAll(async () => {
    mock = Bun.spawn(["python3", join(ROOT, "test/mock_api/server.py")], {
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env, MOCK_API_FLAKY: "1" },
    });
    const reader = (mock.stdout as ReadableStream<Uint8Array>).getReader();
    let text = "";
    while (!text.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    const port = text.match(/^PORT:(\d+)/)?.[1];
    if (!port) throw new Error(`mock did not report port: ${text}`);
    const mockUrl = `http://127.0.0.1:${port}`;
    client = new VgiClient(
      subprocessConnect([process.execPath, "run", join(ROOT, "src/worker.ts")], {
        env: { TIDES_API_BASE_URL: mockUrl, TIDES_METADATA_BASE_URL: mockUrl },
        stderr: "inherit",
      }),
    );
  });
  afterAll(() => {
    client?.close();
    mock?.kill();
  });
  async function table(name: string, positional: unknown[] = [], named: Record<string, unknown> = {}) {
    const rows: Record<string, unknown>[] = [];
    for await (const batch of client.tableFunctionRows({
      functionName: name,
      arguments: new Arguments(positional, new Map(Object.entries(named))),
      int64: "bigint",
    }))
      rows.push(...batch);
    return rows;
  }
  test("stations and bins expose typed records", async () => {
    expect(await table("stations")).toHaveLength(2);
    expect((await table("current_bins", ["cb0102"]))[0]).toMatchObject({ bin: 1, depth_m: 1.8 });
  });
  test("tides chunk 16 days without overlap, retrying initial rate limits", async () => {
    const rows = await table("tide_predictions", ["8518750", "2026-01-01", "2026-01-16"]);
    expect(rows).toHaveLength(64);
    expect(new Set(rows.map((r) => String(r.time))).size).toBe(64);
    expect(new Set(rows.map((r) => r.source_url)).size).toBe(3);
    expect(rows[0]).toMatchObject({ height_m: 1.2, event_type: "H", datum: "MLLW" });
  });
  test("named step and datum reach NOAA; NULL heights and QC survive Arrow", async () => {
    expect(
      await table("tide_predictions", ["8518750", "2026-01-01", "2026-01-01"], { step: "h", datum: "MSL" }),
    ).toHaveLength(24);
    const rows = await table("water_levels", ["8518750", "2026-01-01", "2026-01-01"]);
    expect(rows.map((r) => r.height_m)).toEqual([1.2, 0, null, -0.3]);
    expect(rows[0]).toMatchObject({ quality: "p", flags: "1,0,0,0" });
  });
  test("current predictions preserve ebb and slack; observations support all bins", async () => {
    const pred = await table("current_predictions", ["ACT0956", "2026-01-01", "2026-01-01"], { bin: 2n });
    expect(pred.map((r) => r.velocity_major_mps)).toEqual([0.25, 0, -0.125, 0]);
    expect(pred[0]).toMatchObject({ bin: 2, depth_m: 1.8 });
    const obs = await table("currents", ["cb0102", "2026-01-01", "2026-01-02"]);
    expect(obs).toHaveLength(4);
    expect(obs.map((r) => r.speed_mps)).toEqual([0.25, 0.5, 0.25, 0.5]);
  });
  test("empty data and bins are empty streams; malformed responses and errors are visible", async () => {
    expect(await table("water_levels", ["0000000", "2026-01-01", "2026-01-02"])).toHaveLength(0);
    expect(await table("current_bins", ["0000000"])).toHaveLength(0);
    await expect(table("tide_predictions", ["9999999", "2026-01-01", "2026-01-01"])).rejects.toThrow("Invalid station");
    await expect(table("water_levels", ["8888888", "2026-01-01", "2026-01-01"])).rejects.toThrow("array");
    await expect(table("water_levels", ["HTTP001", "2026-01-01", "2026-01-01"])).rejects.toThrow("HTTP 404");
  });
  test("bind rejects invalid dates, NULL and unsupported intervals", async () => {
    await expect(table("water_levels", [null, "2026-01-01", "2026-01-01"])).rejects.toThrow();
    await expect(table("tide_predictions", ["8518750", "2026-02-30", "2026-03-01"])).rejects.toThrow();
    await expect(table("tide_predictions", ["8518750", "2026-01-01", "2026-01-01"], { step: "2" })).rejects.toThrow();
  });
});
