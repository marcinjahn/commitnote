import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeForgeAdapter } from "../../forge/fake/fake-forge-adapter";
import { GITHUB_LIKE_LATENCY, withLatency } from "./forge-latency";

describe("withLatency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a call only after its configured delay", async () => {
    const adapter = withLatency(new FakeForgeAdapter(), {
      ...GITHUB_LIKE_LATENCY,
      inspectMs: 400,
    });
    let settled = false;
    const inspection = adapter.inspect().then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(399);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await inspection).toEqual({ kind: "empty", canWrite: true });
  });
});
