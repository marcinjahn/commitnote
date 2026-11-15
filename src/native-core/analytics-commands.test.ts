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
  it("returns the exact Linux visit URL with the screen width", async () => {
    ctx = await createCoreTestContext({ analyticsEndpoint: FAKE_ENDPOINT });
    const core = ctx.startCore();
    expect(
      await ctx.call(core, "analytics.visit", { screenWidth: 1920 }),
    ).toEqual({
      url: `${FAKE_ENDPOINT}?p=%2Fapp%2Flinux&t=App%20(Linux)&s=1920`,
    });
  });

  it("leaves the screen width out when the host can't tell", async () => {
    ctx = await createCoreTestContext({ analyticsEndpoint: FAKE_ENDPOINT });
    const core = ctx.startCore();
    expect(
      await ctx.call(core, "analytics.visit", { screenWidth: null }),
    ).toEqual({
      url: `${FAKE_ENDPOINT}?p=%2Fapp%2Flinux&t=App%20(Linux)`,
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ["a missing width", {}],
    ["a zero width", { screenWidth: 0 }],
    ["a fractional width", { screenWidth: 390.5 }],
    ["a string width", { screenWidth: "390" }],
  ])("rejects %s", async (_name, params) => {
    ctx = await createCoreTestContext({ analyticsEndpoint: FAKE_ENDPOINT });
    const core = ctx.startCore();
    expect(await ctx.send(core, "analytics.visit", params)).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
  });

  it("returns null without an endpoint", async () => {
    ctx = await createCoreTestContext({ analyticsEndpoint: null });
    const core = ctx.startCore();
    expect(
      await ctx.call(core, "analytics.visit", { screenWidth: 390 }),
    ).toEqual({ url: null });
  });

  it("works with a running session as well as without one", async () => {
    ctx = await createCoreTestContext({ analyticsEndpoint: FAKE_ENDPOINT });
    const core = ctx.startCore();
    const before = await ctx.call(core, "analytics.visit", {
      screenWidth: 390,
    });
    await ctx.logIn(core);
    expect(
      await ctx.call(core, "analytics.visit", { screenWidth: 390 }),
    ).toEqual(before);
  });
});
