import { expect, test } from "bun:test";
import { type Fetcher, getText, retryDelay } from "../src/http.ts";

test("429 and 503 are retried, honoring Retry-After seconds and HTTP dates", async () => {
  const delays: number[] = [];
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    if (calls === 1) return new Response("busy", { status: 429, headers: { "Retry-After": "2" } });
    if (calls === 2) return new Response("busy", { status: 503 });
    return new Response("ok");
  }) as Fetcher;
  expect(
    await getText("https://example.invalid/data", {
      fetcher,
      sleep: async (ms) => {
        delays.push(ms);
      },
    }),
  ).toBe("ok");
  expect(calls).toBe(3);
  expect(delays).toEqual([2000, 1000]);
  expect(retryDelay("Thu, 01 Jan 2026 00:00:05 GMT", 0, Date.parse("2026-01-01T00:00:00Z"))).toBe(5000);
});

test("404 fails immediately with status; excessive Retry-After fails without early retry", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response("missing", { status: 404 });
  }) as Fetcher;
  await expect(getText("https://example.invalid/data", { fetcher })).rejects.toThrow("HTTP 404");
  expect(calls).toBe(1);
  const limited = (async () => new Response("busy", { status: 429, headers: { "Retry-After": "60" } })) as Fetcher;
  await expect(getText("https://example.invalid/data", { fetcher: limited })).rejects.toThrow("retry after 60 seconds");
});

test("network failures are bounded to four attempts and responses are size limited", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    throw new Error("network down");
  }) as Fetcher;
  await expect(getText("https://example.invalid/data", { fetcher, sleep: async () => {} })).rejects.toThrow(
    "after 4 attempts",
  );
  expect(calls).toBe(4);
  const oversized = (async () => new Response("123456")) as Fetcher;
  await expect(getText("https://example.invalid/data", { fetcher: oversized, maxBytes: 5 })).rejects.toThrow(
    "exceeds 5 bytes",
  );
});

test("every attempt has an abort signal and a timed-out read fails", async () => {
  let calls = 0;
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    calls++;
    const signal = init.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    return await new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    });
  }) as Fetcher;
  await expect(
    getText("https://example.invalid/data", { fetcher, timeoutMs: 5, sleep: async () => {} }),
  ).rejects.toThrow("after 4 attempts");
  expect(calls).toBe(4);
});
