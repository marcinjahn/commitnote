import { describe, expect, it } from "vitest";
import type { SyncError } from "../../sync/sync-engine";
import type { SyncState } from "../../sync/sync-state";
import {
  describeOffline,
  describeSaveShortcutResult,
  describeSyncError,
  describeSyncState,
  describeSyncStatus,
  describeUndecryptableFiles,
} from "./sync-messages";

describe("describeSyncState", () => {
  it("describes synced", () => {
    const state: SyncState = { kind: "synced" };
    expect(describeSyncState(state)).toBe("Synced");
  });

  it("describes saving", () => {
    const state: SyncState = { kind: "syncing" };
    expect(describeSyncState(state)).toBe("Saving");
  });

  it("describes out-of-sync pending", () => {
    const state: SyncState = { kind: "out-of-sync", reason: "pending" };
    expect(describeSyncState(state)).toBe("Out of sync: waiting to save");
  });

  it("describes out-of-sync failed", () => {
    const state: SyncState = { kind: "out-of-sync", reason: "failed" };
    expect(describeSyncState(state)).toBe(
      "Out of sync: saving failed, will retry",
    );
  });

  it("describes out-of-sync conflict", () => {
    const state: SyncState = { kind: "out-of-sync", reason: "conflict" };
    expect(describeSyncState(state)).toBe(
      "Out of sync: conflict, needs your decision",
    );
  });
});

describe("describeSyncError", () => {
  it("describes an unauthorized error", () => {
    const error: SyncError = { kind: "unauthorized" };
    expect(describeSyncError(error, "GitHub")).toBe(
      "Your access token is no longer valid. Log out and log in again.",
    );
  });

  it("describes a forbidden error", () => {
    const error: SyncError = { kind: "forbidden" };
    expect(describeSyncError(error, "GitHub")).toBe(
      "The notes repo is no longer accessible with this access token.",
    );
  });

  it("describes a notFound error", () => {
    const error: SyncError = { kind: "notFound" };
    expect(describeSyncError(error, "GitHub")).toBe(
      "The notes repo is no longer accessible with this access token.",
    );
  });

  it("describes a network error", () => {
    const error: SyncError = { kind: "network" };
    expect(describeSyncError(error, "GitHub")).toBe(
      "Could not reach GitHub. Showing the last loaded notes.",
    );
  });

  it("describes a server error", () => {
    const error: SyncError = { kind: "server" };
    expect(describeSyncError(error, "GitHub")).toBe(
      "GitHub returned an error. Try Refresh again later.",
    );
  });

  it("describes a treeTruncated error", () => {
    const error: SyncError = { kind: "treeTruncated" };
    expect(describeSyncError(error, "GitHub")).toBe(
      "This notes repo is too large to load.",
    );
  });

  it("describes an undecryptable error", () => {
    const error: SyncError = { kind: "undecryptable" };
    expect(describeSyncError(error, "GitHub")).toBe("This note could not be decrypted.");
  });

  it("describes a keyChanged error", () => {
    const error: SyncError = { kind: "keyChanged" };
    expect(describeSyncError(error, "GitHub")).toBe(
      "The passphrase was changed on another device. Log in again.",
    );
  });

  it("rounds up to whole minutes for rateLimited", () => {
    const error: SyncError = { kind: "rateLimited", retryAfterMs: 61_000 };
    expect(describeSyncError(error, "GitHub")).toBe(
      "GitHub's rate limit was reached. Refresh again in 2 minutes.",
    );
  });

  it("floors to a minimum of one minute for rateLimited", () => {
    const error: SyncError = { kind: "rateLimited", retryAfterMs: 1_000 };
    expect(describeSyncError(error, "GitHub")).toBe(
      "GitHub's rate limit was reached. Refresh again in 1 minute.",
    );
  });

  it("uses the singular form for exactly one minute", () => {
    const error: SyncError = { kind: "rateLimited", retryAfterMs: 60_000 };
    expect(describeSyncError(error, "GitHub")).toBe(
      "GitHub's rate limit was reached. Refresh again in 1 minute.",
    );
  });

  it("uses the plural form for exactly two minutes", () => {
    const error: SyncError = { kind: "rateLimited", retryAfterMs: 120_000 };
    expect(describeSyncError(error, "GitHub")).toBe(
      "GitHub's rate limit was reached. Refresh again in 2 minutes.",
    );
  });
});

describe("describeUndecryptableFiles", () => {
  it("counts the files left out of the tree", () => {
    expect(describeUndecryptableFiles(1)).toBe(
      "1 file can't be decrypted with this passphrase and is not shown.",
    );
    expect(describeUndecryptableFiles(3)).toBe(
      "3 files can't be decrypted with this passphrase and are not shown.",
    );
  });
});

describe("describeOffline", () => {
  it("tells the user to keep the tab open when changes are unsaved", () => {
    expect(describeOffline(true)).toBe(
      "Offline. Changes will save when you're back online. Keep this tab open.",
    );
  });

  it("is just Offline when everything is saved", () => {
    expect(describeOffline(false)).toBe("Offline");
  });
});

describe("describeSyncStatus", () => {
  it("prefers the offline copy over the sync state", () => {
    const state: SyncState = { kind: "out-of-sync", reason: "failed" };
    expect(describeSyncStatus({ state, offline: true, hasUnsaved: true })).toBe(
      describeOffline(true),
    );
    expect(describeSyncStatus({ state, offline: true, hasUnsaved: false })).toBe(
      "Offline",
    );
  });

  it("describes the sync state when online", () => {
    const state: SyncState = { kind: "out-of-sync", reason: "pending" };
    expect(describeSyncStatus({ state, offline: false, hasUnsaved: true })).toBe(
      "Out of sync: waiting to save",
    );
  });
});

describe("describeSaveShortcutResult", () => {
  const settled = {
    stopped: false,
    suspended: false,
    unsavedCount: 0,
    settingsPending: false,
    offline: false,
    waitingForRateBudget: false,
  };

  it("says nothing when sync is stopped", () => {
    expect(describeSaveShortcutResult({ ...settled, stopped: true })).toBeNull();
  });

  it("says nothing when sync is suspended", () => {
    expect(describeSaveShortcutResult({ ...settled, suspended: true })).toBeNull();
  });

  it("reports everything saved", () => {
    expect(describeSaveShortcutResult(settled)).toBe("All saved");
  });

  it("reports everything saved while offline with nothing unsaved", () => {
    expect(describeSaveShortcutResult({ ...settled, offline: true })).toBe("All saved");
  });

  it("does not report saved while settings are pending", () => {
    expect(describeSaveShortcutResult({ ...settled, settingsPending: true })).toBeNull();
  });

  it("describes unsaved changes offline", () => {
    expect(
      describeSaveShortcutResult({ ...settled, unsavedCount: 2, offline: true }),
    ).toBe(describeOffline(true));
  });

  it("describes pending settings offline", () => {
    expect(
      describeSaveShortcutResult({ ...settled, settingsPending: true, offline: true }),
    ).toBe(describeOffline(true));
  });

  it("describes waiting for the rate budget", () => {
    expect(
      describeSaveShortcutResult({
        ...settled,
        unsavedCount: 1,
        waitingForRateBudget: true,
      }),
    ).toBe("Saving soon (commit limit reached)");
  });

  it("prefers the offline copy over the rate budget copy", () => {
    expect(
      describeSaveShortcutResult({
        ...settled,
        unsavedCount: 1,
        offline: true,
        waitingForRateBudget: true,
      }),
    ).toBe(describeOffline(true));
  });

  it("says nothing for unsaved changes that remain after the attempt", () => {
    expect(describeSaveShortcutResult({ ...settled, unsavedCount: 1 })).toBeNull();
  });

  it("lets stopped win over everything else", () => {
    expect(
      describeSaveShortcutResult({ ...settled, stopped: true, offline: true }),
    ).toBeNull();
  });
});
