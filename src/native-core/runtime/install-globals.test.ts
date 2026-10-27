import { describe, expect, it, vi } from "vitest";
import type { HostServices } from "../host-services";
import { installBareHostGlobals } from "./install-globals";

describe("installBareHostGlobals", () => {
  it("installs every global on an empty target without touching the host", () => {
    const getHost = vi.fn(() => ({}) as HostServices);
    const target: Record<string, unknown> = {};
    installBareHostGlobals(target, getHost);
    for (const name of [
      "TextEncoder", "TextDecoder", "btoa", "atob", "setTimeout", "clearTimeout",
      "queueMicrotask", "URL", "URLSearchParams", "Headers", "Response", "fetch", "console",
    ]) {
      expect(target[name], name).toBeDefined();
    }
    expect(target.globalThis).toBe(target);
    expect(getHost).not.toHaveBeenCalled();
  });

  it("overrides existing globals and keeps an existing globalThis", () => {
    const existing = {};
    const target: Record<string, unknown> = { URL: "old", globalThis: existing };
    installBareHostGlobals(target, () => ({}) as HostServices);
    expect(target.URL).not.toBe("old");
    expect(target.globalThis).toBe(existing);
  });

  it("binds the host lazily", async () => {
    let host: HostServices | undefined;
    const target: Record<string, unknown> = {};
    installBareHostGlobals(target, () => {
      if (host === undefined) throw new Error("not bound");
      return host;
    });
    const log = vi.fn();
    (target.console as { log(m: string): void }).log("early");
    expect(log).not.toHaveBeenCalled();
    host = { log: { log } } as unknown as HostServices;
    (target.console as { log(m: string): void }).log("late");
    expect(log).toHaveBeenCalledWith("info", "log");
  });
});
