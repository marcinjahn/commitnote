import { describe, expect, it, vi } from "vitest";
import type { HostServices } from "../host-services";
import { createConsole } from "./console";

function setup() {
  const log = vi.fn();
  return { log, console: createConsole(() => ({ log: { log } }) as unknown as HostServices) };
}

describe("console", () => {
  it("forwards only the method name with its level", () => {
    const { log, console } = setup();
    console.debug("a");
    console.log("b");
    console.info("c");
    console.warn("d");
    console.error("e");
    expect(log.mock.calls).toEqual([
      ["debug", "debug"],
      ["info", "log"],
      ["info", "info"],
      ["warn", "warn"],
      ["error", "error"],
    ]);
  });

  it("adds only the name of an Error first argument", () => {
    const { log, console } = setup();
    console.error(new RangeError("notes/private.md failed"), "also notes/x.md");
    console.warn(new TypeError("t"));
    expect(log.mock.calls).toEqual([
      ["error", "error RangeError"],
      ["warn", "warn TypeError"],
    ]);
  });

  it("never leaks arguments, messages or unusual error names", () => {
    const { log, console } = setup();
    console.log("notes/private.md", { name: "secret" });
    const odd = new Error("m");
    odd.name = "my note.md";
    console.error(odd);
    console.info({ name: "Error", message: "x" });
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toMatch(/private|secret|note\.md/);
    expect(log.mock.calls[1]).toEqual(["error", "error Error"]);
    expect(log.mock.calls[2]).toEqual(["info", "info"]);
  });

  it("drops calls while no host is bound and when the host throws", () => {
    const unbound = createConsole(() => {
      throw new Error("not bound");
    });
    expect(() => unbound.log("x")).not.toThrow();
    const throwing = createConsole(
      () => ({ log: { log: () => { throw new Error("boom"); } } }) as unknown as HostServices,
    );
    expect(() => throwing.error("x")).not.toThrow();
  });
});
