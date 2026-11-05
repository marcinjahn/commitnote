import { describe, expect, it } from "vitest";
import { buildSettingsCopy } from "./settings-copy";

describe("buildSettingsCopy", () => {
  it("offers Vim mode on Linux and names only the animated caret as unavailable", () => {
    const copy = buildSettingsCopy("linux");
    expect(copy.editorUnavailable).toBe(
      "The animated caret is not available on Linux. Its setting stays as it is for your other devices.",
    );
    expect(copy.vimMode).toEqual({
      label: "Vim mode",
      hint: "Edit notes with Vim keys: Normal, Insert and Visual modes.",
    });
  });
});
