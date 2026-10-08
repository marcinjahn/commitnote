import { describe, expect, it } from "vitest";
import type { SyncError } from "../../sync/sync-engine";
import {
  autoRefreshFailureReport,
  INITIAL_AUTO_REFRESH_FAILURE_STATE,
  manualRefreshFailureState,
  type AutoRefreshFailureState,
} from "./auto-refresh-failure-report";

const network: SyncError = { kind: "network" };
const server: SyncError = { kind: "server" };
const unauthorized: SyncError = { kind: "unauthorized" };
const rateLimited: SyncError = { kind: "rateLimited", retryAfterMs: 1000 };

function step(
  state: AutoRefreshFailureState,
  error: SyncError | null,
  online = true,
) {
  return autoRefreshFailureReport(state, { error, online });
}

describe("autoRefreshFailureReport", () => {
  it("stays silent on the first transient failure and shows on the second", () => {
    const first = step(INITIAL_AUTO_REFRESH_FAILURE_STATE, network);
    expect(first.action).toEqual({ kind: "none" });
    const second = step(first.state, network);
    expect(second.action).toEqual({ kind: "show", error: network });
    expect(second.state.shownKind).toBe("network");
  });

  it("counts consecutive transient failures across kinds", () => {
    const first = step(INITIAL_AUTO_REFRESH_FAILURE_STATE, server);
    const second = step(first.state, network);
    expect(second.action).toEqual({ kind: "show", error: network });
  });

  it("does not repeat an identical failure", () => {
    let result = step(INITIAL_AUTO_REFRESH_FAILURE_STATE, network);
    result = step(result.state, network);
    result = step(result.state, network);
    expect(result.action).toEqual({ kind: "none" });
  });

  it("shows again when the kind changes", () => {
    let result = step(INITIAL_AUTO_REFRESH_FAILURE_STATE, network);
    result = step(result.state, network);
    result = step(result.state, server);
    expect(result.action).toEqual({ kind: "show", error: server });
    expect(result.state.shownKind).toBe("server");
  });

  it.each([rateLimited, unauthorized])(
    "shows $kind on the first failure",
    (error) => {
      const result = step(INITIAL_AUTO_REFRESH_FAILURE_STATE, error);
      expect(result.action).toEqual({ kind: "show", error });
    },
  );

  it("resets the transient count on a non-transient failure", () => {
    let result = step(INITIAL_AUTO_REFRESH_FAILURE_STATE, network);
    result = step(result.state, unauthorized);
    expect(result.state.transientFailures).toBe(0);
    result = step(result.state, network);
    expect(result.action).toEqual({ kind: "none" });
  });

  it("clears and resets on success after a shown failure", () => {
    let result = step(INITIAL_AUTO_REFRESH_FAILURE_STATE, network);
    result = step(result.state, network);
    result = step(result.state, null);
    expect(result.action).toEqual({ kind: "clear" });
    expect(result.state).toEqual(INITIAL_AUTO_REFRESH_FAILURE_STATE);
    result = step(result.state, network);
    expect(result.action).toEqual({ kind: "none" });
  });

  it("does nothing on success when no failure was shown", () => {
    const first = step(INITIAL_AUTO_REFRESH_FAILURE_STATE, network);
    const result = step(first.state, null);
    expect(result.action).toEqual({ kind: "none" });
    expect(result.state).toEqual(INITIAL_AUTO_REFRESH_FAILURE_STATE);
  });

  it("ignores failures while offline and keeps the state", () => {
    const first = step(INITIAL_AUTO_REFRESH_FAILURE_STATE, network);
    const result = step(first.state, network, false);
    expect(result.action).toEqual({ kind: "none" });
    expect(result.state).toBe(first.state);
  });
});

describe("manualRefreshFailureState", () => {
  const afterManual = manualRefreshFailureState(unauthorized);

  it("clears the shown toast on the next success", () => {
    expect(step(afterManual, null).action).toEqual({ kind: "clear" });
  });

  it("stays silent for the same non-transient failure", () => {
    expect(step(afterManual, unauthorized).action).toEqual({ kind: "none" });
  });

  it("shows a different non-transient failure", () => {
    expect(step(afterManual, rateLimited).action).toEqual({
      kind: "show",
      error: rateLimited,
    });
  });
});
