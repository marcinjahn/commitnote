import { describe, expect, it } from "vitest";
import {
  CONFLICT_BANNER_TEXT,
  CONFLICT_EDIT_HINT,
  CONFLICT_EDIT_MERGED_LABEL,
  conflictBannerHeading,
  conflictLegendLabel,
  keepOtherDeviceLabel,
  keepThisDeviceLabel,
} from "./conflict-copy";

const NAME = "Firefox on Linux";

describe("conflict-copy", () => {
  it("words the banner heading with and without a device name", () => {
    expect(conflictBannerHeading(null)).toBe(
      "This note was changed on another device too",
    );
    expect(conflictBannerHeading(NAME)).toBe(
      `This note was also changed on ${NAME}`,
    );
  });

  it("pins the banner text", () => {
    expect(CONFLICT_BANNER_TEXT).toBe(
      "This device and the other device changed the same lines. Choose which version to keep, or edit the merged text.",
    );
  });

  it("words the buttons with and without device names", () => {
    expect(keepThisDeviceLabel(null)).toBe("Keep this device's version");
    expect(keepThisDeviceLabel(NAME)).toBe(
      `Keep this device's version (${NAME})`,
    );
    expect(keepOtherDeviceLabel(null)).toBe("Keep other device's version");
    expect(keepOtherDeviceLabel(NAME)).toBe(
      `Keep other device's version (${NAME})`,
    );
    expect(CONFLICT_EDIT_MERGED_LABEL).toBe("Edit merged");
  });

  it("words the legend with and without device names", () => {
    expect(conflictLegendLabel("mine", NAME)).toBe(`This device · ${NAME}`);
    expect(conflictLegendLabel("theirs", null)).toBe("Other device");
    expect(conflictLegendLabel("theirs", NAME)).toBe(`Other device · ${NAME}`);
  });

  it("pins the edit-merged hint", () => {
    expect(CONFLICT_EDIT_HINT).toBe(
      "Remove every conflict marker line (<<<<<<<, =======, >>>>>>>) to finish. Changes are saved once no markers remain.",
    );
  });

  it("never exposes mine or theirs wording", () => {
    const outputs = [
      CONFLICT_BANNER_TEXT,
      CONFLICT_EDIT_HINT,
      CONFLICT_EDIT_MERGED_LABEL,
      ...[null, NAME].flatMap((name) => [
        conflictBannerHeading(name),
        keepThisDeviceLabel(name),
        keepOtherDeviceLabel(name),
        conflictLegendLabel("mine", name),
        conflictLegendLabel("theirs", name),
      ]),
    ];
    for (const text of outputs) {
      expect(text).not.toMatch(/\bmine\b|\btheirs\b/i);
    }
  });
});
