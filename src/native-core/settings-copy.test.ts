import { describe, expect, it } from "vitest";
import { buildSettingsCopy } from "./settings-copy";

describe("buildSettingsCopy", () => {
  it("keeps the iOS copy without Vim mode", () => {
    const copy = buildSettingsCopy("ios");
    expect(copy.editorUnavailable).toBe(
      "Vim mode and the animated caret are not available on iOS. Their settings stay as they are for your other devices.",
    );
    expect("vimMode" in copy).toBe(false);
  });

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

  it("differs between the platforms only in the Vim copy", () => {
    const { editorUnavailable: _ios, ...ios } = buildSettingsCopy("ios");
    const { editorUnavailable: _linux, vimMode: _vim, ...linux } =
      buildSettingsCopy("linux");
    expect(linux).toEqual(ios);
  });
});
