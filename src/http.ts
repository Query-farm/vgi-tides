/** Bounded, timeout-protected HTTP reads for NOAA's public services. */
export class UpstreamError extends Error {}

export type Fetcher = (url: URL | string, options: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetcher?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
}

export function retryDelay(value: string | null, attempt: number, now = Date.now()): number {
  if (value) {
    const seconds = Number(value);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
    if (Number.isFinite(delay)) return Math.max(0, delay);
  }
  return 500 * 2 ** attempt;
}

export function endpoint(env: string, fallback: string, path: string): URL {
  const base = process.env[env] || fallback;
  const url = new URL(`${base.replace(/\/+$/, "")}/${path}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${env} must be an HTTP(S) URL without credentials`);
  }
  return url;
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new UpstreamError(`NOAA response exceeds ${maxBytes} bytes`);
  }
  if (!response.body) throw new UpstreamError("NOAA returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new UpstreamError(`NOAA response exceeds ${maxBytes} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function getText(url: URL | string, options: HttpOptions = {}): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  for (let attempt = 0; attempt < 4; attempt++) {
    let delay: number;
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
        headers: {
          "User-Agent": "QueryFarm-vgi-marine/0.1.0",
          Accept: "application/json, text/plain, application/xml",
        },
      });
      if (response.ok) return await boundedText(response, maxBytes);
      await response.body?.cancel();
      if ((response.status !== 429 && response.status < 500) || attempt === 3) {
        throw new UpstreamError(`NOAA request failed with HTTP ${response.status} (${new URL(url).pathname})`);
      }
      delay = retryDelay(response.headers.get("Retry-After"), attempt);
      // Do not retry earlier than NOAA requests; fail when that would exceed our wait budget.
      if (delay > 30_000) throw new UpstreamError(`NOAA HTTP ${response.status}: retry after ${delay / 1000} seconds`);
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      if (attempt === 3) throw new UpstreamError(`NOAA request failed after 4 attempts: ${String(error)}`);
      delay = retryDelay(null, attempt);
    }
    await sleep(delay);
  }
  throw new UpstreamError("NOAA request exhausted retries");
}

export async function getJson(url: URL | string): Promise<unknown> {
  const text = await getText(url);
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError("NOAA returned invalid JSON");
  }
}
