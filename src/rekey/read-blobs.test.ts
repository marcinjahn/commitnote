import { describe, expect, it } from "vitest";
import { ForgeError } from "../forge/errors";
import { MAX_RATE_LIMIT_WAIT_MS, readBlobs } from "./read-blobs";

function adapterWith(failures: Map<string, ForgeError[]>) {
  const reads: string[] = [];
  let active = 0;
  let maxActive = 0;
  return {
    reads,
    maxActive: () => maxActive,
    async readBlob(sha: string): Promise<string> {
      reads.push(sha);
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      const failure = failures.get(sha)?.shift();
      if (failure !== undefined) throw failure;
      return `text of ${sha}`;
    },
  };
}

describe("readBlobs", () => {
  it("reads each distinct blob once, a few at a time", async () => {
    const adapter = adapterWith(new Map());
    const shas = Array.from({ length: 20 }, (_, i) => `sha${i % 10}`);

    const contents = await readBlobs(adapter, shas, {
      sleep: async () => {},
      concurrency: 3,
    });

    expect(contents.size).toBe(10);
    expect(contents.get("sha4")).toBe("text of sha4");
    expect(adapter.reads).toHaveLength(10);
    expect(adapter.maxActive()).toBeLessThanOrEqual(3);
  });

  it("waits out a rate limit and retries", async () => {
    const adapter = adapterWith(
      new Map([
        ["a", [new ForgeError("RateLimited", { retryAfterMs: 30_000 })]],
      ]),
    );
    const sleeps: number[] = [];

    const contents = await readBlobs(adapter, ["a"], {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(contents.get("a")).toBe("text of a");
    expect(sleeps).toEqual([30_000]);
  });

  it("gives up on a rate limit longer than it is willing to wait", async () => {
    const adapter = adapterWith(
      new Map([
        [
          "a",
          [
            new ForgeError("RateLimited", {
              retryAfterMs: MAX_RATE_LIMIT_WAIT_MS + 1,
            }),
          ],
        ],
      ]),
    );

    await expect(
      readBlobs(adapter, ["a"], { sleep: async () => {} }),
    ).rejects.toMatchObject({ kind: "RateLimited" });
  });

  it("fails after repeated network errors and reports progress up to then", async () => {
    const adapter = adapterWith(
      new Map([
        ["b", Array.from({ length: 10 }, () => new ForgeError("Network"))],
      ]),
    );
    const progress: number[] = [];

    await expect(
      readBlobs(adapter, ["a", "b"], {
        sleep: async () => {},
        concurrency: 1,
        onProgress: (done) => progress.push(done),
      }),
    ).rejects.toMatchObject({ kind: "Network" });
    expect(progress).toEqual([0, 1]);
  });

  it("does not retry a missing blob", async () => {
    const adapter = adapterWith(new Map([["a", [new ForgeError("NotFound")]]]));

    await expect(
      readBlobs(adapter, ["a"], { sleep: async () => {} }),
    ).rejects.toMatchObject({ kind: "NotFound" });
    expect(adapter.reads).toEqual(["a"]);
  });
});
