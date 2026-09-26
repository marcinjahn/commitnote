import { isForgeError } from "../forge/errors";
import type { ForgeAdapter } from "../forge/forge-adapter";

export const READ_CONCURRENCY = 4;
export const MAX_READ_ATTEMPTS = 4;
const RETRY_BASE_MS = 1_000;
/** Longer rate-limit waits fail the read instead of stalling the change. */
export const MAX_RATE_LIMIT_WAIT_MS = 120_000;

export interface ReadBlobsOptions {
  readonly sleep: (ms: number) => Promise<void>;
  readonly concurrency?: number;
  readonly onProgress?: (done: number, total: number) => void;
}

function retryDelay(error: unknown, attempt: number): number | null {
  if (!isForgeError(error) || attempt >= MAX_READ_ATTEMPTS) return null;
  switch (error.kind) {
    case "RateLimited": {
      const wait = error.retryAfterMs ?? RETRY_BASE_MS;
      return wait > MAX_RATE_LIMIT_WAIT_MS ? null : wait;
    }
    case "Network":
    case "Server":
      return RETRY_BASE_MS * 2 ** (attempt - 1);
    default:
      return null;
  }
}

/** Reads each distinct blob once, a few at a time, retrying transient failures. */
export async function readBlobs(
  adapter: Pick<ForgeAdapter, "readBlob">,
  shas: Iterable<string>,
  options: ReadBlobsOptions,
): Promise<Map<string, string>> {
  const queue = [...new Set(shas)];
  const total = queue.length;
  const contents = new Map<string, string>();
  let failure: { readonly error: unknown } | null = null;

  async function readOne(sha: string): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await adapter.readBlob(sha);
      } catch (error) {
        const delay = retryDelay(error, attempt);
        if (delay === null || failure !== null) throw error;
        await options.sleep(delay);
      }
    }
  }

  async function worker(): Promise<void> {
    while (failure === null) {
      const sha = queue.shift();
      if (sha === undefined) return;
      try {
        contents.set(sha, await readOne(sha));
      } catch (error) {
        failure ??= { error };
        return;
      }
      options.onProgress?.(contents.size, total);
    }
  }

  options.onProgress?.(0, total);
  const workers = Math.max(
    1,
    Math.min(options.concurrency ?? READ_CONCURRENCY, total),
  );
  await Promise.all(Array.from({ length: workers }, worker));
  if (failure !== null) throw (failure as { readonly error: unknown }).error;
  return contents;
}
