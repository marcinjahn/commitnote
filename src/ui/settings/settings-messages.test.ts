import { describe, expect, it } from "vitest";
import { animatedCaretHint, describeSystemAccent } from "./settings-messages";

describe("describeSystemAccent", () => {
  it("names the closest OS accent color in the browser and the installed app", () => {
    for (const standalone of [false, true]) {
      expect(describeSystemAccent({ label: "Blue", fromOs: true, standalone })).toBe(
        "Blue, closest to your OS accent color",
      );
    }
  });

  it("blames the browser when the OS accent color is unavailable in the browser", () => {
    expect(describeSystemAccent({ label: "Blue", fromOs: false, standalone: false })).toBe(
      "Blue, because the browser doesn't share your OS accent color",
    );
  });

  it("does not mention a browser in the installed app", () => {
    expect(describeSystemAccent({ label: "Blue", fromOs: false, standalone: true })).toBe(
      "Blue, because the OS accent color isn't available here",
    );
  });
});

describe("animatedCaretHint", () => {
  it("mentions the browser's caret in the browser", () => {
    expect(animatedCaretHint(false)).toBe(
      "A thicker accent caret that blinks softly and tints the letters just before it. Turn it off for the browser’s standard caret.",
    );
  });

  it("mentions only the standard caret in the installed app", () => {
    expect(animatedCaretHint(true)).toBe(
      "A thicker accent caret that blinks softly and tints the letters just before it. Turn it off for the standard caret.",
    );
  });
});
