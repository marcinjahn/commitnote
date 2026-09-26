import { describe, expect, it } from "vitest";
import type { SyncError } from "../../sync/sync-engine";
import type { SyncState } from "../../sync/sync-state";
import {
  describeSyncError,
  describeSyncState,
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
