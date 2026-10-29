import { afterEach, describe, expect, it } from "vitest";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const FAKE_ENDPOINT = "https://analytics.invalid/count";

let ctx: CoreTestContext;

afterEach(() => {
  ctx.dispose();
});

describe("analytics.visit", () => {
  it("returns the exact iOS visit URL for an endpoint", async () => {
    ctx = await createCoreTestContext({ analyticsEndpoint: FAKE_ENDPOINT });
    const core = ctx.startCore();
    expect(await ctx.call(core, "analytics.visit")).toEqual({
      url: "https://analytics.invalid/count?p=%2Fapp%2Fios&t=App%20(iOS)",
    });
  });

  it("returns the exact Linux visit URL for an endpoint", async () => {
    ctx = await createCoreTestContext({
      analyticsEndpoint: FAKE_ENDPOINT,
      platform: "linux",
    });
    const core = ctx.startCore();
    expect(await ctx.call(core, "analytics.visit")).toEqual({
      url: "https://analytics.invalid/count?p=%2Fapp%2Flinux&t=App%20(Linux)",
    });
  });

  it("returns null without an endpoint", async () => {
    ctx = await createCoreTestContext({ analyticsEndpoint: null });
    const core = ctx.startCore();
    expect(await ctx.call(core, "analytics.visit")).toEqual({ url: null });
  });

  it("returns null once the device opted out", async () => {
    ctx = await createCoreTestContext({ analyticsEndpoint: FAKE_ENDPOINT });
    ctx.host.deviceSettings.setItem("commitnote.analyticsOptOut", "1");
    const core = ctx.startCore();
    expect(await ctx.call(core, "analytics.visit")).toEqual({ url: null });
  });

  it("works with a running session as well as without one", async () => {
    ctx = await createCoreTestContext({ analyticsEndpoint: FAKE_ENDPOINT });
    const core = ctx.startCore();
    const before = await ctx.call(core, "analytics.visit");
    await ctx.logIn(core);
    expect(await ctx.call(core, "analytics.visit")).toEqual(before);
  });
});
