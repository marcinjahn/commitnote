import { describe, expect, it } from "vitest";
import { createOnceGate } from "./once-gate";

describe("createOnceGate", () => {
  it("lets only the first take win", () => {
    const gate = createOnceGate();

    expect(gate.take()).toBe(true);
    expect(gate.take()).toBe(false);
    expect(gate.take()).toBe(false);
  });

  it("is available until the first take", () => {
    const gate = createOnceGate();

    expect(gate.available).toBe(true);
    gate.take();
    expect(gate.available).toBe(false);
  });

  it("keeps independent gates independent", () => {
    const first = createOnceGate();
    const second = createOnceGate();

    first.take();

    expect(second.available).toBe(true);
    expect(second.take()).toBe(true);
  });
});
