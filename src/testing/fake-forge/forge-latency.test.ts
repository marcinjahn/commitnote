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

  it("delays history reads by their own latencies", async () => {
    const adapter = withLatency(new FakeForgeAdapter(), {
      ...GITHUB_LIKE_LATENCY,
      listCommitsMs: 300,
      readFileAtMs: 200,
    });
    const settled: string[] = [];
    void adapter
      .listCommits({ from: "unknown", path: "a.md", limit: 1 })
      .catch(() => settled.push("listCommits"));
    void adapter.readFileAt("unknown", "a.md").then(() => settled.push("readFileAt"));

    await vi.advanceTimersByTimeAsync(199);
    expect(settled).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual(["readFileAt"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toEqual(["readFileAt", "listCommits"]);
  });

  it("forwards the observed rate limit without delay", () => {
    const limit = { remaining: 5, resetAt: 99 };
    const inner = new FakeForgeAdapter();
    inner.observedRateLimit = () => limit;
    const adapter = withLatency(inner, {
      ...GITHUB_LIKE_LATENCY,
      getHeadMs: 1000,
    });
    expect(adapter.observedRateLimit?.()).toBe(limit);
  });
});
