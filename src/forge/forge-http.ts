import { fromBase64 } from "../crypto/base64";
import { ForgeError } from "./errors";

export async function sendForgeRequest(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string,
  init: { method: string; body?: unknown },
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...extraHeaders,
  };
  const requestInit: RequestInit = {
    method: init.method,
    headers,
    cache: "no-store",
  };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(init.body);
  }

  try {
    return await fetchImpl(url, requestInit);
  } catch (cause) {
    throw new ForgeError("Network", { cause });
  }
}

export function retryAfterMs(
  response: Response,
  now: () => number,
  resetHeader: string,
): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return seconds * 1000;
    }
  }
  const reset = response.headers.get(resetHeader);
  if (reset !== null) {
    const resetSeconds = Number(reset);
    if (Number.isFinite(resetSeconds)) {
      return Math.max(0, resetSeconds * 1000 - now());
    }
  }
  return 60_000;
}

// Browsers reject `fetch` called with a non-Window receiver (Illegal
// invocation), so the default resolves and calls globalThis.fetch unbound, at
// call time.
export const defaultFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, init);

export function parseCommittedAt(date: string | undefined): number {
  const time = date === undefined ? NaN : Date.parse(date);
  return Number.isFinite(time) ? time : 0;
}

export function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

// Non-fatal UTF-8 decoding: arbitrary git blobs need not be valid UTF-8.
export function decodeBase64Text(content: string): string {
  return new TextDecoder("utf-8").decode(
    fromBase64(content.replace(/\s+/g, "")),
  );
}

export function localDateStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
