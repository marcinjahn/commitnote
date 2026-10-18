import { describe, expect, it } from "vitest";
import { keyboardInset, startKeyboardInset } from "./keyboard-inset";

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

function setup(layoutHeight = 800) {
  const viewport = new FakeViewport();
  const writes: Array<[string, string]> = [];
  const target = {
    style: {
      setProperty: (name: string, value: string | null) => {
        writes.push([name, String(value)]);
      },
    },
  };
  const stop = startKeyboardInset({
    viewport,
    layoutHeight: () => layoutHeight,
    target,
  });
  return { viewport, writes, stop };
}

describe("keyboardInset", () => {
  it("is the layout height minus the visual viewport bottom", () => {
    expect(keyboardInset(800, { height: 500, offsetTop: 0 })).toBe(300);
    expect(keyboardInset(800, { height: 500, offsetTop: 100 })).toBe(200);
  });
});

describe("startKeyboardInset", () => {
  it("writes 0px when there is no viewport", () => {
    const writes: Array<[string, string]> = [];
    startKeyboardInset({
      viewport: null,
      layoutHeight: () => 800,
      target: {
        style: { setProperty: (n, v) => void writes.push([n, String(v)]) },
      },
    });
    expect(writes).toEqual([["--keyboard-inset", "0px"]]);
  });

  it("writes the initial value immediately", () => {
    const viewport = new FakeViewport();
    viewport.height = 500;
    const writes: Array<[string, string]> = [];
    startKeyboardInset({
      viewport,
      layoutHeight: () => 800,
      target: {
        style: { setProperty: (n, v) => void writes.push([n, String(v)]) },
      },
    });
    expect(writes).toEqual([["--keyboard-inset", "300px"]]);
  });

  it("updates on resize", () => {
    const { viewport, writes } = setup();
    viewport.height = 450;
    viewport.dispatchEvent(new Event("resize"));
    expect(writes.at(-1)).toEqual(["--keyboard-inset", "350px"]);
  });

  it("accounts for offsetTop on scroll", () => {
    const { viewport, writes } = setup();
    viewport.height = 500;
    viewport.dispatchEvent(new Event("resize"));
    viewport.offsetTop = 120;
    viewport.dispatchEvent(new Event("scroll"));
    expect(writes.at(-1)).toEqual(["--keyboard-inset", "180px"]);
  });

  it("clamps at 0 when the visual viewport exceeds the layout height", () => {
    const { viewport, writes } = setup();
    viewport.height = 900;
    viewport.dispatchEvent(new Event("resize"));
    expect(writes.at(-1)).toEqual(["--keyboard-inset", "0px"]);
  });

  it("rounds fractional values", () => {
    const { viewport, writes } = setup();
    viewport.height = 500.4;
    viewport.dispatchEvent(new Event("resize"));
    expect(writes.at(-1)).toEqual(["--keyboard-inset", "300px"]);
    viewport.height = 499.6;
    viewport.dispatchEvent(new Event("resize"));
    expect(writes.at(-1)).toEqual(["--keyboard-inset", "300px"]);
  });

  it("does not write when the value is unchanged", () => {
    const { viewport, writes } = setup();
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
    expect(writes).toHaveLength(1);
  });

  it("stops writing after stop and keeps the last value", () => {
    const { viewport, writes, stop } = setup();
    stop();
    viewport.height = 400;
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
    expect(writes).toEqual([["--keyboard-inset", "0px"]]);
  });
});
