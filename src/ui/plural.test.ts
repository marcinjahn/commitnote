import { describe, expect, it } from "vitest";
import { describeMinutes, plural } from "./plural";

describe("plural", () => {
  it("uses the many form for 0 and for counts above 1", () => {
    expect(plural(0, "note", "notes")).toBe("0 notes");
    expect(plural(2, "note", "notes")).toBe("2 notes");
  });

  it("uses the one form for exactly 1", () => {
    expect(plural(1, "note", "notes")).toBe("1 note");
  });
});

describe("describeMinutes", () => {
  it("rounds up to at least one minute", () => {
    expect(describeMinutes(0)).toBe("1 minute");
    expect(describeMinutes(1)).toBe("1 minute");
    expect(describeMinutes(60_000)).toBe("1 minute");
  });

  it("rounds partial minutes up", () => {
    expect(describeMinutes(60_001)).toBe("2 minutes");
    expect(describeMinutes(150_000)).toBe("3 minutes");
  });
});
