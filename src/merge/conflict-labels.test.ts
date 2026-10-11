import { describe, expect, it } from "vitest";
import { conflictSideLabel, PLAIN_CONFLICT_LABELS } from "./conflict-labels";

describe("conflictSideLabel", () => {
  it("gives plain labels without a device name", () => {
    expect(conflictSideLabel("mine", null)).toBe("This device");
    expect(conflictSideLabel("theirs", null)).toBe("Other device");
  });

  it("appends the device name after a middle dot", () => {
    expect(conflictSideLabel("mine", "Laptop")).toBe("This device · Laptop");
    expect(conflictSideLabel("theirs", "Pixel app")).toBe(
      "Other device · Pixel app",
    );
  });

  it("matches the plain label constants", () => {
    expect(PLAIN_CONFLICT_LABELS).toEqual({
      mine: conflictSideLabel("mine", null),
      theirs: conflictSideLabel("theirs", null),
    });
  });
});
