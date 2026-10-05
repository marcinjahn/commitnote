import { describe, expect, it } from "vitest";
import type { StructureError } from "../../sync/sync-engine";
import { describeMovedTo, describeStructureError } from "./structure-messages";

describe("describeStructureError", () => {
  it("describes an invalid name via the name error message", () => {
    const error: StructureError = {
      kind: "invalidName",
      error: { kind: "duplicate" },
    };
    expect(describeStructureError(error)).toBe(
      "A note or folder with this name already exists here.",
    );
  });

  it("describes a conflicted item", () => {
    const error: StructureError = { kind: "conflicted" };
    expect(describeStructureError(error)).toBe(
      "Resolve the conflict in this note first.",
    );
  });

  it("describes a missing item", () => {
    const error: StructureError = { kind: "notFound" };
    expect(describeStructureError(error)).toBe("This item no longer exists.");
  });

  it("describes an invalid move target", () => {
    const error: StructureError = { kind: "invalidTarget" };
    expect(describeStructureError(error)).toBe(
      "A folder can't be moved into itself.",
    );
  });

  it("describes unreadable stored tags", () => {
    const error: StructureError = { kind: "tagsUnavailable" };
    expect(describeStructureError(error)).toBe(
      "Color tags can't be changed because the stored tags can't be read.",
    );
  });
});

describe("describeMovedTo", () => {
  it("names the folder an item was moved into", () => {
    expect(describeMovedTo("Ideas", ["Projects", "commitnote"])).toBe(
      "“Ideas” moved to “commitnote”",
    );
  });

  it("names the top level", () => {
    expect(describeMovedTo("Ideas", [])).toBe("“Ideas” moved to the top level");
  });
});
