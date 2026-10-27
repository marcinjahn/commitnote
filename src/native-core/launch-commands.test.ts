import { afterEach, describe, expect, it } from "vitest";
import type { NativeCoreHandle } from "./api";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

let ctx: CoreTestContext;

afterEach(() => {
  ctx.dispose();
});

async function started(): Promise<NativeCoreHandle> {
  ctx = await createCoreTestContext();
  return ctx.startCore();
}

function emitted(): unknown[] {
  return ctx.events("launchAction");
}

describe("launch commands", () => {
  it("holds a delivered action until an accepting attach", async () => {
    const core = await started();

    await ctx.call(core, "launch.deliver", { action: "search" });
    expect(emitted()).toEqual([]);

    await ctx.call(core, "launch.attach", { accepts: ["new-note", "search"] });
    expect(emitted()).toEqual([{ action: "search" }]);

    await ctx.call(core, "launch.attach", { accepts: ["new-note", "search"] });
    expect(emitted()).toHaveLength(1);
  });

  it("emits at once when the attached handler accepts the action", async () => {
    const core = await started();

    await ctx.call(core, "launch.attach", { accepts: ["new-note", "search"] });
    await ctx.call(core, "launch.deliver", { action: "new-note" });

    expect(emitted()).toEqual([{ action: "new-note" }]);
  });

  it("keeps an action the attachment does not accept pending", async () => {
    const core = await started();

    await ctx.call(core, "launch.deliver", { action: "new-note" });
    await ctx.call(core, "launch.attach", { accepts: ["new-note"] });
    expect(emitted()).toEqual([{ action: "new-note" }]);

    await ctx.call(core, "launch.deliver", { action: "search" });
    expect(emitted()).toHaveLength(1);

    await ctx.call(core, "launch.attach", { accepts: ["new-note", "search"] });
    expect(emitted()).toEqual([{ action: "new-note" }, { action: "search" }]);
  });

  it("accepts nothing with an empty accepts list", async () => {
    const core = await started();

    await ctx.call(core, "launch.attach", { accepts: [] });
    await ctx.call(core, "launch.deliver", { action: "new-note" });
    expect(emitted()).toEqual([]);

    await ctx.call(core, "launch.attach", { accepts: ["new-note"] });
    expect(emitted()).toEqual([{ action: "new-note" }]);
  });

  it("emits only the latest of two actions delivered before attach", async () => {
    const core = await started();

    await ctx.call(core, "launch.deliver", { action: "new-note" });
    await ctx.call(core, "launch.deliver", { action: "search" });
    await ctx.call(core, "launch.attach", { accepts: ["new-note", "search"] });

    expect(emitted()).toEqual([{ action: "search" }]);
  });

  it("holds actions after detach until the next attach", async () => {
    const core = await started();

    await ctx.call(core, "launch.attach", { accepts: ["new-note", "search"] });
    await ctx.call(core, "launch.detach");
    await ctx.call(core, "launch.detach");
    await ctx.call(core, "launch.deliver", { action: "search" });
    expect(emitted()).toEqual([]);

    await ctx.call(core, "launch.attach", { accepts: ["new-note", "search"] });
    expect(emitted()).toEqual([{ action: "search" }]);
  });

  it("rejects invalid params", async () => {
    const core = await started();

    for (const [command, params] of [
      ["launch.deliver", { action: "open" }],
      ["launch.deliver", {}],
      ["launch.attach", { accepts: "search" }],
      ["launch.attach", {}],
      ["launch.attach", { accepts: ["search", "open"] }],
    ] as const) {
      expect(await ctx.send(core, command, params)).toMatchObject({
        ok: false,
        error: { kind: "invalidParams" },
      });
    }
    expect(emitted()).toEqual([]);
  });

  it("emits a pending action delivered before login after login and attach", async () => {
    const core = await started();

    await ctx.call(core, "launch.deliver", { action: "new-note" });
    await ctx.logIn(core);
    expect(emitted()).toEqual([]);

    await ctx.call(core, "launch.attach", { accepts: ["new-note", "search"] });
    expect(emitted()).toEqual([{ action: "new-note" }]);
  });

  it("keeps a pending action across logout", async () => {
    const core = await started();

    await ctx.logIn(core);
    await ctx.call(core, "launch.deliver", { action: "search" });
    await ctx.call(core, "session.logout", { anyway: true });
    expect(emitted()).toEqual([]);

    await ctx.call(core, "launch.attach", { accepts: ["search"] });
    expect(emitted()).toEqual([{ action: "search" }]);
  });

  it("delivers to an attachment made before login", async () => {
    const core = await started();

    await ctx.call(core, "launch.attach", { accepts: ["search"] });
    await ctx.call(core, "launch.deliver", { action: "search" });
    expect(emitted()).toEqual([{ action: "search" }]);
  });
});
