import { describe, expect, it } from "vitest";
import type { NameError } from "../../tree/note-names";
import { describeNameError } from "./name-messages";

describe("describeNameError", () => {
  it("describes an empty name", () => {
    const error: NameError = { kind: "empty" };
    expect(describeNameError(error)).toBe("Enter a name.");
  });

  it("describes a name containing a slash", () => {
    const error: NameError = { kind: "containsSlash" };
    expect(describeNameError(error)).toBe("Names can't contain “/”.");
  });

  it("describes a dot name", () => {
    const error: NameError = { kind: "dotName" };
    expect(describeNameError(error)).toBe(
      "“.” and “..” can't be used as names.",
    );
  });

  it("describes a name that is too long, naming the byte cap", () => {
    const error: NameError = { kind: "tooLong", maxBytes: 150 };
    expect(describeNameError(error)).toBe(
      "Names can be at most 150 bytes. Some characters, like accented letters or emoji, count as more than one byte.",
    );
  });

  it("describes a duplicate name", () => {
    const error: NameError = { kind: "duplicate" };
    expect(describeNameError(error)).toBe(
      "A note or folder with this name already exists here.",
    );
  });
});
