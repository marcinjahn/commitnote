import { describe, expect, it } from "vitest";
import { flushBeforeLogOut } from "./log-out";

describe("flushBeforeLogOut", () => {
  it("flushes settings before the engine", async () => {
    const calls: string[] = [];
    await flushBeforeLogOut({
      settingsSaver: { flush: () => void calls.push("settings") },
      engine: {
        flush: async () => {
          calls.push("engine");
          return { kind: "saved" };
        },
      },
    });
    expect(calls).toEqual(["settings", "engine"]);
  });

  it("passes the saved result through", async () => {
    const result = await flushBeforeLogOut({
      settingsSaver: { flush: () => {} },
      engine: { flush: async () => ({ kind: "saved" }) },
    });
    expect(result).toEqual({ kind: "saved" });
  });

  it("passes the unsaved result through", async () => {
    const result = await flushBeforeLogOut({
      settingsSaver: { flush: () => {} },
      engine: { flush: async () => ({ kind: "unsaved", count: 3 }) },
    });
    expect(result).toEqual({ kind: "unsaved", count: 3 });
  });
});
