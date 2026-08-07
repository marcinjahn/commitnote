import { describe, expect, it } from "vitest";
import type { SyncError } from "../../sync/sync-engine";
import { describeSyncError } from "./sync-messages";

describe("describeSyncError", () => {
  it("describes an unauthorized error", () => {
    const error: SyncError = { kind: "unauthorized" };
    expect(describeSyncError(error)).toBe(
      "Your access token is no longer valid. Log out and log in again.",
    );
  });

  it("describes a forbidden error", () => {
    const error: SyncError = { kind: "forbidden" };
    expect(describeSyncError(error)).toBe(
      "The notes repo is no longer accessible with this access token.",
    );
  });

  it("describes a notFound error", () => {
    const error: SyncError = { kind: "notFound" };
    expect(describeSyncError(error)).toBe(
      "The notes repo is no longer accessible with this access token.",
    );
  });

  it("describes a network error", () => {
    const error: SyncError = { kind: "network" };
    expect(describeSyncError(error)).toBe(
      "Could not reach GitHub. Showing the last loaded notes.",
    );
  });

  it("describes a server error", () => {
    const error: SyncError = { kind: "server" };
    expect(describeSyncError(error)).toBe(
      "GitHub returned an error. Try Refresh again later.",
    );
  });

  it("describes a treeTruncated error", () => {
    const error: SyncError = { kind: "treeTruncated" };
    expect(describeSyncError(error)).toBe(
      "This notes repo is too large to load.",
    );
  });

  it("describes an undecryptable error", () => {
    const error: SyncError = { kind: "undecryptable" };
    expect(describeSyncError(error)).toBe("This note could not be decrypted.");
  });

  it("rounds up to whole minutes for rateLimited", () => {
    const error: SyncError = { kind: "rateLimited", retryAfterMs: 61_000 };
    expect(describeSyncError(error)).toBe(
      "GitHub's rate limit was reached. Refresh again in 2 minutes.",
    );
  });

  it("floors to a minimum of one minute for rateLimited", () => {
    const error: SyncError = { kind: "rateLimited", retryAfterMs: 1_000 };
    expect(describeSyncError(error)).toBe(
      "GitHub's rate limit was reached. Refresh again in 1 minute.",
    );
  });

  it("uses the singular form for exactly one minute", () => {
    const error: SyncError = { kind: "rateLimited", retryAfterMs: 60_000 };
    expect(describeSyncError(error)).toBe(
      "GitHub's rate limit was reached. Refresh again in 1 minute.",
    );
  });

  it("uses the plural form for exactly two minutes", () => {
    const error: SyncError = { kind: "rateLimited", retryAfterMs: 120_000 };
    expect(describeSyncError(error)).toBe(
      "GitHub's rate limit was reached. Refresh again in 2 minutes.",
    );
  });
});
