import { describe, expect, it } from "vitest";
import { delegateAdapter } from "./delegating-adapter";
import { FakeForgeAdapter } from "./fake-forge-adapter";

describe("delegateAdapter", () => {
  it("forwards the observed rate limit unless overridden", () => {
    const limit = { remaining: 1, resetAt: 2 };
    const inner = new FakeForgeAdapter();
    inner.observedRateLimit = () => limit;
    expect(delegateAdapter(inner).observedRateLimit?.()).toBe(limit);
    expect(
      delegateAdapter(inner, { observedRateLimit: () => null })
        .observedRateLimit?.(),
    ).toBeNull();
  });

  it("leaves other optional members absent", () => {
    expect(delegateAdapter(new FakeForgeAdapter()).sweepAbandoned).toBeUndefined();
  });
});
