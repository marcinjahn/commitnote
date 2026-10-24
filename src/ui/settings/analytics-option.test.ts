import { describe, expect, it } from "vitest";
import { describeAnalytics } from "./analytics-option";

describe("describeAnalytics", () => {
  it("explains what is counted", () => {
    expect(describeAnalytics(false)).toBe(
      "Counts one anonymous visit per app start: page and platform only, no cookies or identifiers.",
    );
  });

  it("explains that the browser setting turns counting off", () => {
    expect(describeAnalytics(true)).toBe(
      "Off because your browser asks sites not to track you (Do Not Track or Global Privacy Control).",
    );
  });
});
