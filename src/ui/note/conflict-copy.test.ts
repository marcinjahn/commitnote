import { describe, expect, it } from "vitest";
import {
  CONFLICT_BANNER_HEADING,
  CONFLICT_BANNER_TEXT,
  CONFLICT_EDIT_HINT,
  CONFLICT_EDIT_MERGED_LABEL,
  CONFLICT_KEEP_MINE_LABEL,
  CONFLICT_KEEP_THEIRS_LABEL,
} from "./conflict-copy";

describe("conflict-copy", () => {
  it("pins the banner heading and text", () => {
    expect(CONFLICT_BANNER_HEADING).toBe(
      "This note was changed on another device too",
    );
    expect(CONFLICT_BANNER_TEXT).toBe(
      "Your changes and the other device's changes overlap. Choose which version to keep, or edit the merged text.",
    );
  });

  it("pins the button labels", () => {
    expect(CONFLICT_KEEP_MINE_LABEL).toBe("Keep mine");
    expect(CONFLICT_KEEP_THEIRS_LABEL).toBe("Keep theirs");
    expect(CONFLICT_EDIT_MERGED_LABEL).toBe("Edit merged");
  });

  it("pins the edit-merged hint", () => {
    expect(CONFLICT_EDIT_HINT).toBe(
      "Remove every conflict marker line (<<<<<<<, =======, >>>>>>>) to finish. Changes are saved once no markers remain.",
    );
  });
});
