import { describe, expect, it } from "vitest";
import {
  describeCarriedOver,
  describeChangeFailure,
  describeChangeStep,
  describePassphraseChanged,
  describeRekeySummary,
  HISTORY_NOT_REMOVED_MESSAGE,
  HISTORY_REMOVED_MESSAGE,
  HISTORY_WARNING,
  otherDevicesWarning,
  VERSION_HISTORY_NOTICE,
  PASSPHRASE_CHANGED_MESSAGE,
  PASSPHRASE_CHANGED_MISMATCH_MESSAGE,
} from "./passphrase-messages";

const SUMMARY = {
  notes: 3,
  folders: 1,
  trashEntries: 0,
  carriedTrashEntries: 0,
  carriedFiles: 0,
};

describe("passphrase change messages", () => {
  it("summarizes what is re-encrypted", () => {
    expect(describeRekeySummary(SUMMARY)).toBe(
      "Re-encrypts 3 notes and 1 folder with the new passphrase, saved as a single commit.",
    );
    expect(
      describeRekeySummary({ ...SUMMARY, notes: 1, trashEntries: 2 }),
    ).toBe(
      "Re-encrypts 1 note, 1 folder and 2 items in the trash with the new passphrase, saved as a single commit.",
    );
  });

  it("lists what is carried over unchanged", () => {
    expect(describeCarriedOver(SUMMARY)).toEqual([]);
    expect(
      describeCarriedOver({
        ...SUMMARY,
        carriedTrashEntries: 1,
        carriedFiles: 2,
      }),
    ).toEqual([
      "1 item in the trash can't be decrypted and is kept as it is.",
      "2 files that aren't notes, such as a README, are kept as they are.",
    ]);
  });

  it("shows read and re-encryption progress", () => {
    expect(describeChangeStep({ kind: "reading", done: 2, total: 9 })).toBe(
      "Reading notes (2 of 9)…",
    );
  });

  it("says nothing changed when a failure leaves the notes as they were", () => {
    expect(
      describeChangeFailure({ kind: "changedElsewhere" }, "GitHub", 0),
    ).toContain("Nothing was changed.");
    expect(
      describeChangeFailure(
        { kind: "forge", error: { kind: "network" } },
        "GitHub",
        0,
      ),
    ).toBe(
      "Could not reach GitHub. Check your connection and try again. Nothing was changed.",
    );
    expect(
      describeChangeFailure(
        { kind: "rateBudget", retryAt: 90_000 },
        "GitLab",
        0,
      ),
    ).toBe(
      "commitnote is pacing its requests to GitLab. Nothing was changed. Try again in 2 minutes.",
    );
  });

  it("does not claim nothing changed when the outcome is unknown", () => {
    expect(
      describeChangeFailure({ kind: "outcomeUnknown" }, "GitHub", 0),
    ).not.toContain("Nothing was changed");
  });

  it("tells whether the old history was deleted", () => {
    const notRemoved = `${PASSPHRASE_CHANGED_MESSAGE} ${HISTORY_NOT_REMOVED_MESSAGE}`;
    const mismatchNotRemoved = `${PASSPHRASE_CHANGED_MISMATCH_MESSAGE} ${HISTORY_NOT_REMOVED_MESSAGE}`;
    const cases = [
      ["matched", "kept", "success", PASSPHRASE_CHANGED_MESSAGE],
      ["matched", "removed", "success", HISTORY_REMOVED_MESSAGE],
      ["matched", "notRemoved", "warning", notRemoved],
      ["unchecked", "kept", "success", PASSPHRASE_CHANGED_MESSAGE],
      ["unchecked", "removed", "success", HISTORY_REMOVED_MESSAGE],
      ["unchecked", "notRemoved", "warning", notRemoved],
      ["mismatch", "kept", "warning", PASSPHRASE_CHANGED_MISMATCH_MESSAGE],
      ["mismatch", "removed", "warning", PASSPHRASE_CHANGED_MISMATCH_MESSAGE],
      ["mismatch", "notRemoved", "warning", mismatchNotRemoved],
    ] as const;
    for (const [check, history, tone, text] of cases) {
      expect(describePassphraseChanged(check, history)).toEqual({ tone, text });
    }
  });

  it("says version history can't reach back past the change", () => {
    expect(VERSION_HISTORY_NOTICE).toMatch(/can't show or restore versions/);
    expect(HISTORY_WARNING).toMatch(/no longer restore them/);
  });
});

describe("otherDevicesWarning", () => {
  it("names the tabs in the browser", () => {
    expect(otherDevicesWarning(false)).toBe(
      "Other devices are signed out and must log in with the new passphrase. Reload commitnote in any other open tabs.",
    );
  });

  it("does not mention tabs in the installed app", () => {
    expect(otherDevicesWarning(true)).toBe(
      "Other devices are signed out and must log in with the new passphrase. Reload commitnote wherever else it's open.",
    );
  });
});
