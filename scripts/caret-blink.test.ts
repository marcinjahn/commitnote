import { describe, expect, it } from "vitest";
import {
  CARET_BLINK_MS,
  CARET_HOLD_MS,
  CARET_SOFT_EDGE_MS,
} from "../src/editor/caret-style";
import { caretBlinkCss, caretBlinkTimeline } from "./caret-blink";

describe("caret blink", () => {
  it("derives duration and delay from the caret constants", () => {
    const timeline = caretBlinkTimeline();

    expect(timeline.durationMs).toBe(2 * CARET_BLINK_MS);
    expect(timeline.delayMs).toBe(CARET_HOLD_MS);
  });

  it("fades off and on over the soft edge", () => {
    const { keyframes } = caretBlinkTimeline();

    expect(keyframes.map((k) => k.percent)).toEqual([0, 10, 50, 60, 100]);
    expect(keyframes.map((k) => k.opacity)).toEqual([1, 0, 0, 1, 1]);
    expect(keyframes[1]?.percent).toBe(
      (CARET_SOFT_EDGE_MS / (2 * CARET_BLINK_MS)) * 100,
    );
  });

  it("emits infinite blink CSS with a reduced-motion override", () => {
    const css = caretBlinkCss(".caret");
    const text = css.join("\n");

    for (const part of [
      "@keyframes caret-blink",
      "infinite",
      "1600ms",
      "650ms",
      "ease-in-out",
    ]) {
      expect(text).toContain(part);
    }
    const media = css.find((line) =>
      line.includes("@media (prefers-reduced-motion: reduce)"),
    );
    expect(media).toContain(".caret { animation: none; }");
    expect(css).toEqual([
      ".caret { animation: caret-blink 1600ms ease-in-out 650ms infinite; }",
      "@keyframes caret-blink { 0% { opacity: 1; } 10% { opacity: 0; } 50% { opacity: 0; } 60% { opacity: 1; } 100% { opacity: 1; } }",
      "@media (prefers-reduced-motion: reduce) { .caret { animation: none; } }",
    ]);
  });
});
