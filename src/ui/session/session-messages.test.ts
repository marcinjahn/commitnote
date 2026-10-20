import { describe, expect, it } from "vitest";
import { describeLogoutUnsaved, exportNotesLabel } from "./session-messages";

describe("session messages", () => {
  it("describes a single unsaved item in the singular", () => {
    expect(describeLogoutUnsaved(1)).toBe(
      "1 note or folder is not saved yet. If you log out now, these changes are lost.",
    );
  });

  it("describes several unsaved items in the plural", () => {
    expect(describeLogoutUnsaved(3)).toBe(
      "3 notes or folders are not saved yet. If you log out now, these changes are lost.",
    );
  });

  it("labels the export button by unsaved count", () => {
    expect(exportNotesLabel(2)).toBe("Export unsaved notes");
    expect(exportNotesLabel(0)).toBe("Export notes");
  });
});
