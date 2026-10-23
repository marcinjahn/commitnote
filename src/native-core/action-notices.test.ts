import { describe, expect, it } from "vitest";
import type { SyncEngine } from "../sync/sync-engine";
import { createActionNotices } from "./action-notices";
import type { CoreEvents } from "./api";
import type { AppSession, NativeRunningApp } from "./app-session";

function setup() {
  const owner = {} as NativeRunningApp;
  let listener: ((engine: SyncEngine | null) => void) | null = null;
  const app = {
    current: () => owner,
    onEngineState(next: (engine: SyncEngine | null) => void) {
      listener = next;
      return () => {
        listener = null;
      };
    },
  } as unknown as AppSession;
  const emitted: { event: string; payload: unknown }[] = [];
  const notices = createActionNotices({
    app,
    emit: (event, payload) => emitted.push({ event, payload }),
  });
  return {
    owner,
    notices,
    emitted,
    endSession: () => listener?.(null),
    posted: () =>
      emitted
        .filter(({ event }) => event === "notice")
        .map(({ payload }) => payload as CoreEvents["notice"]),
    cleared: () =>
      emitted
        .filter(({ event }) => event === "noticeCleared")
        .map(({ payload }) => (payload as { id: string }).id),
  };
}

describe("action notices", () => {
  it("shows plain notices with the toast persistence of their tone", () => {
    const { owner, notices, posted } = setup();

    const info = notices.show(owner, "image", "info", "Adding image…");
    const success = notices.show(owner, "share", "success", "Link revoked");
    const error = notices.show(owner, "history", "error", "Failed");

    expect(posted()).toEqual([
      {
        id: info,
        tone: "info",
        message: "Adding image…",
        persistent: false,
        action: null,
      },
      {
        id: success,
        tone: "success",
        message: "Link revoked",
        persistent: false,
        action: null,
      },
      {
        id: error,
        tone: "error",
        message: "Failed",
        persistent: true,
        action: null,
      },
    ]);
    expect(new Set([info, success, error]).size).toBe(3);
  });

  it("lets the caller choose persistence", () => {
    const { owner, notices, posted } = setup();

    notices.show(owner, "share", "success", "Updated", { persistent: true });

    expect(posted()[0]!.persistent).toBe(true);
  });

  it("replaces the previous notice of the channel only", () => {
    const { owner, notices, cleared } = setup();
    const first = notices.show(owner, "image", "info", "Adding image…");
    const other = notices.show(owner, "share", "success", "Link revoked");

    notices.show(owner, "image", "error", "This file is not an image.");

    expect(cleared()).toEqual([first]);
    expect(cleared()).not.toContain(other);
  });

  it("clears a channel, or only the given notice when an id is passed", () => {
    const { owner, notices, cleared } = setup();
    const busy = notices.show(owner, "image", "info", "Adding image…");
    const outcome = notices.show(owner, "image", "error", "Not an image");

    notices.clear("image", busy);
    expect(cleared()).toEqual([busy]);

    notices.clear("image");
    notices.clear("image");
    expect(cleared()).toEqual([busy, outcome]);
  });

  it("dismisses plain notices and does nothing when performing them", async () => {
    const { owner, notices, cleared, posted } = setup();
    const id = notices.show(owner, "history", "success", "Restored");

    await notices.perform(id);
    expect(cleared()).toEqual([]);

    expect(notices.dismiss(id)).toBe(true);
    expect(cleared()).toEqual([id]);
    expect(posted()).toHaveLength(1);
  });

  it("forgets held notices when the session ends", () => {
    const { owner, notices, cleared, endSession } = setup();
    notices.show(owner, "image", "info", "Adding image…");

    endSession();
    notices.clear("image");

    expect(cleared()).toEqual([]);
  });
});
