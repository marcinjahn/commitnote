import { describe, expect, it } from "vitest";
import type { LoginError } from "../login/login";
import { KEY_CHANGED_MESSAGE } from "../ui/browse/sync-messages";
import { describeLoginError } from "../ui/login/login-messages";
import { describeSyncError } from "../ui/browse/sync-messages";
import { earlyDraftLoadStatus, type EarlyDraftLoadInputs } from "./early-draft-load-status";

const base: EarlyDraftLoadInputs = {
  resumeError: null,
  phase: "restoring",
  refreshError: null,
  treeLoaded: false,
  keyChanged: false,
  sessionRemembered: true,
  forgeName: "GitHub",
};

const failed = (
  message: string,
  actions: ("tryAgain" | "logIn")[],
  notSavedYet: boolean,
) => ({ kind: "failed", message, actions, notSavedYet });

describe("earlyDraftLoadStatus", () => {
  it("is loading while restoring", () => {
    expect(earlyDraftLoadStatus(base)).toEqual({ kind: "loading" });
  });

  it("is loading when the refresh failed but the tree is loaded", () => {
    expect(
      earlyDraftLoadStatus({
        ...base,
        phase: "app",
        treeLoaded: true,
        refreshError: { kind: "network" },
      }),
    ).toEqual({ kind: "loading" });
  });

  it("is loading when the refresh failed outside the app phase", () => {
    expect(earlyDraftLoadStatus({ ...base, refreshError: { kind: "network" } })).toEqual({
      kind: "loading",
    });
  });

  const transient: LoginError[] = [
    { kind: "network" },
    { kind: "server" },
    { kind: "rateLimited", retryAfterMs: 120_000 },
  ];
  it.each(transient)("offers try again and log in for transient resume error $kind", (error) => {
    expect(earlyDraftLoadStatus({ ...base, resumeError: error })).toEqual(
      failed(describeLoginError(error, "GitHub"), ["tryAgain", "logIn"], false),
    );
  });

  const nonTransient: LoginError[] = [
    { kind: "unauthorized" },
    { kind: "noAccess" },
    { kind: "wrongPassphrase" },
    { kind: "newerFormat", formatVersion: 9 },
  ];
  it.each(nonTransient)("offers only log in for non-transient resume error $kind", (error) => {
    expect(earlyDraftLoadStatus({ ...base, resumeError: error })).toEqual(
      failed(describeLoginError(error, "GitHub"), ["logIn"], true),
    );
  });

  it("reports a late refresh error without actions", () => {
    expect(
      earlyDraftLoadStatus({ ...base, phase: "app", refreshError: { kind: "server" } }),
    ).toEqual(failed(describeSyncError({ kind: "server" }, "GitHub"), [], false));
  });

  it("reports key changed with log in only, taking precedence over other errors", () => {
    expect(
      earlyDraftLoadStatus({
        ...base,
        keyChanged: true,
        resumeError: { kind: "network" },
        phase: "app",
        refreshError: { kind: "server" },
      }),
    ).toEqual(failed(KEY_CHANGED_MESSAGE, ["logIn"], false));
  });

  describe("notSavedYet", () => {
    const sessionless = { ...base, sessionRemembered: false };

    it("is set for key changed without a remembered session", () => {
      expect(earlyDraftLoadStatus({ ...sessionless, keyChanged: true })).toMatchObject({
        notSavedYet: true,
      });
    });

    it("is set for a transient resume error without a remembered session", () => {
      expect(
        earlyDraftLoadStatus({ ...sessionless, resumeError: { kind: "network" } }),
      ).toMatchObject({ notSavedYet: true });
    });

    it("is set for a late refresh error without a remembered session", () => {
      expect(
        earlyDraftLoadStatus({ ...sessionless, phase: "app", refreshError: { kind: "network" } }),
      ).toMatchObject({ notSavedYet: true });
    });

    it("stays set for a non-transient resume error even with a remembered session", () => {
      expect(
        earlyDraftLoadStatus({ ...base, resumeError: { kind: "unauthorized" } }),
      ).toMatchObject({ notSavedYet: true });
    });
  });
});
