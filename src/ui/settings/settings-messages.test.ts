import { describe, expect, it } from "vitest";
import {
  ACCENT_COLOR_LABEL,
  animatedCaretHint,
  APPEARANCE_SECTION,
  CHANGE_PASSPHRASE_LABEL,
  COLOR_MODE_LABEL,
  DATA_SECURITY_SECTION,
  describeSystemAccent,
  EDITOR_SECTION,
  EXPORT_NOTES_LABEL,
  EXPORTING_LABEL,
  IMPORT_NOTES_LABEL,
  NEW_FOLDERS_LABEL,
  NEW_NOTES_LABEL,
  NOTE_FONT_LABEL,
  NOTE_FONT_PREVIEW_BODY,
  NOTE_FONT_PREVIEW_CODE,
  NOTE_FONT_PREVIEW_HEADING,
  NOTES_SECTION,
  SCOPE_DEVICE_LABEL,
  SCOPE_SYNCED_LABEL,
  scopeToggleLabel,
  SETTINGS_EXPORT_FAILED_MESSAGE,
  SETTINGS_INTRO,
  SETTINGS_RETRY_LABEL,
  SETTINGS_TITLE,
  THIS_DEVICE_SECTION,
} from "./settings-messages";

describe("describeSystemAccent", () => {
  it("names the closest OS accent color in the browser and the installed app", () => {
    for (const standalone of [false, true]) {
      expect(describeSystemAccent({ label: "Blue", fromOs: true, standalone })).toBe(
        "Blue, closest to your OS accent color",
      );
    }
  });

  it("blames the browser when the OS accent color is unavailable in the browser", () => {
    expect(describeSystemAccent({ label: "Blue", fromOs: false, standalone: false })).toBe(
      "Blue, because the browser doesn't share your OS accent color",
    );
  });

  it("does not mention a browser in the installed app", () => {
    expect(describeSystemAccent({ label: "Blue", fromOs: false, standalone: true })).toBe(
      "Blue, because the OS accent color isn't available here",
    );
  });
});

describe("animatedCaretHint", () => {
  it("mentions the browser's caret in the browser", () => {
    expect(animatedCaretHint(false)).toBe(
      "A thicker accent caret that blinks softly and tints the letters just before it. Turn it off for the browser’s standard caret.",
    );
  });

  it("mentions only the standard caret in the installed app", () => {
    expect(animatedCaretHint(true)).toBe(
      "A thicker accent caret that blinks softly and tints the letters just before it. Turn it off for the standard caret.",
    );
  });
});

describe("settings copy", () => {
  it("keeps the dialog wording", () => {
    expect(SETTINGS_TITLE).toBe("Settings");
    expect(SETTINGS_INTRO).toBe(
      "Settings apply to all your devices unless marked This device.",
    );
    expect([
      APPEARANCE_SECTION,
      EDITOR_SECTION,
      NOTES_SECTION,
      THIS_DEVICE_SECTION,
      DATA_SECURITY_SECTION,
    ]).toEqual(["Appearance", "Editor", "Notes", "This device", "Data & security"]);
    expect([COLOR_MODE_LABEL, ACCENT_COLOR_LABEL, NOTE_FONT_LABEL]).toEqual([
      "Color mode",
      "Accent color",
      "Note font",
    ]);
    expect([NEW_NOTES_LABEL, NEW_FOLDERS_LABEL, SETTINGS_RETRY_LABEL]).toEqual([
      "New notes",
      "New folders",
      "Retry",
    ]);
  });

  it("labels the scope toggle", () => {
    expect(SCOPE_SYNCED_LABEL).toBe("All devices");
    expect(SCOPE_DEVICE_LABEL).toBe("This device");
    expect(scopeToggleLabel("Note font")).toBe("Note font only on this device");
  });

  it("keeps the note font preview and data actions wording", () => {
    expect(NOTE_FONT_PREVIEW_HEADING).toBe("Weekly notes");
    expect(NOTE_FONT_PREVIEW_BODY).toBe("A **clear** list keeps a week _calm_.");
    expect(NOTE_FONT_PREVIEW_CODE).toBe("Run `cargo clippy` before you push.");
    expect([
      EXPORT_NOTES_LABEL,
      EXPORTING_LABEL,
      IMPORT_NOTES_LABEL,
      CHANGE_PASSPHRASE_LABEL,
      SETTINGS_EXPORT_FAILED_MESSAGE,
    ]).toEqual([
      "Export notes",
      "Exporting…",
      "Import notes",
      "Change passphrase",
      "Export failed. Try again later.",
    ]);
  });
});
