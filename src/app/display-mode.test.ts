import { describe, expect, it } from "vitest";
import { isStandalone, STANDALONE_DISPLAY_MODES } from "./display-mode";

function environment(
  activeMode: string | null,
  standalone?: boolean,
): Parameters<typeof isStandalone>[0] {
  return {
    matchMedia: (query) => ({
      matches: activeMode !== null && query === `(display-mode: ${activeMode})`,
    }),
    navigator: { standalone },
  };
}

describe("isStandalone", () => {
  it.each(STANDALONE_DISPLAY_MODES)("is true in %s display mode", (mode) => {
    expect(isStandalone(environment(mode))).toBe(true);
  });

  it("is true when navigator.standalone is true", () => {
    expect(isStandalone(environment(null, true))).toBe(true);
  });

  it("is false in browser display mode", () => {
    expect(isStandalone(environment("browser", false))).toBe(false);
  });

  it("is false when navigator.standalone is undefined", () => {
    expect(isStandalone(environment(null))).toBe(false);
  });
});
