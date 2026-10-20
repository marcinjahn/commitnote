import { describe, expect, it } from "vitest";
import { toCoreError, toCoreErrorFromForge } from "./core-errors";

describe("toCoreError", () => {
  it("maps a login error with the login copy and transience", () => {
    expect(
      toCoreError({ kind: "rateLimited", retryAfterMs: 120_000 }, { source: "login", forgeName: "GitHub" }),
    ).toEqual({
      kind: "rateLimited",
      message: "GitHub's rate limit was reached. Try again in 2 minutes.",
      transient: true,
      retryAfterMs: 120_000,
    });
  });

  it("maps a sync error of a kind shared with login errors with the sync copy", () => {
    expect(toCoreError({ kind: "unauthorized" }, { source: "sync", forgeName: "GitHub" })).toEqual({
      kind: "unauthorized",
      message: "Your access token is no longer valid. Log out and log in again.",
      transient: false,
    });
  });

  it("treats network, server and rate-limit sync errors as transient", () => {
    expect(toCoreError({ kind: "server" }, { source: "sync", forgeName: "GitLab" }).transient).toBe(true);
    expect(toCoreError({ kind: "keyChanged" }, { source: "sync", forgeName: "GitLab" }).transient).toBe(false);
  });

  it("maps an error of another source's kind or an unknown error to internal", () => {
    const internal = { kind: "internal", message: "Something went wrong. Try again.", transient: false };
    expect(toCoreError({ kind: "keyChanged" }, { source: "login", forgeName: "GitHub" })).toEqual(internal);
    expect(toCoreError(new Error("boom"), { source: "sync", forgeName: "GitHub" })).toEqual(internal);
  });

  it("maps a failed repository listing as a login error", () => {
    expect(toCoreErrorFromForge({ kind: "failed", error: { kind: "network" } }, "GitHub")).toEqual({
      kind: "network",
      message: "Could not reach GitHub. Check your connection and try again.",
      transient: true,
    });
  });
});
