import { describe, expect, it } from "vitest";
import type { NoteHistory, VersionContent } from "../history/note-history";
import type { ShareEntry } from "../share/share-index";
import { describeSyncError } from "../ui/browse/sync-messages";
import {
  describeShareDate,
  SHARED_VERSION_GONE_MESSAGE,
  SHARED_VERSION_PASSPHRASE_CHANGED_MESSAGE,
} from "../ui/share/share-messages";
import { readSharedVersion } from "./shared-version";

function entry(overrides: Partial<ShareEntry> = {}): ShareEntry {
  return {
    id: "s1",
    locator: { provider: "github", gistId: "g1" },
    linkSecret: "secret",
    password: null,
    name: "Stored",
    label: null,
    sharedAt: "2026-01-01T00:00:00.000Z",
    note: { state: "active", path: ["Live"] },
    source: { commit: "abc", storedPath: ["x", "y"] },
    updatedAt: null,
    ...overrides,
  } as ShareEntry;
}

function history(
  result: VersionContent | Error,
  calls: unknown[] = [],
): Pick<NoteHistory, "readVersion"> {
  return {
    readVersion: async (version) => {
      calls.push(version);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const forgeName = "GitHub";

describe("readSharedVersion", () => {
  it("reads the shared commit and returns the content with its date", async () => {
    const calls: unknown[] = [];
    const shared = entry();
    const outcome = await readSharedVersion(
      {
        noteHistory: history({ kind: "readable", content: "text", name: "N" }, calls),
        forgeName,
      },
      shared,
    );
    expect(outcome).toEqual({
      kind: "readable",
      name: "N",
      content: "text",
      date: describeShareDate(shared),
    });
    expect(calls).toEqual([
      {
        sha: "abc",
        storedPath: ["x", "y"],
        committedAt: 0,
        name: null,
        events: [],
      },
    ]);
  });

  it("explains a changed passphrase without reading when there is no source", async () => {
    const calls: unknown[] = [];
    const outcome = await readSharedVersion(
      { noteHistory: history({ kind: "undecryptable", name: null }, calls), forgeName },
      entry({ source: null }),
    );
    expect(outcome).toEqual({
      kind: "message",
      message: SHARED_VERSION_PASSPHRASE_CHANGED_MESSAGE,
    });
    expect(calls).toEqual([]);
  });

  it("reports an undecryptable version as gone", async () => {
    const outcome = await readSharedVersion(
      { noteHistory: history({ kind: "undecryptable", name: null }), forgeName },
      entry(),
    );
    expect(outcome).toEqual({ kind: "message", message: SHARED_VERSION_GONE_MESSAGE });
  });

  it("reports a missing commit as gone", async () => {
    const outcome = await readSharedVersion(
      {
        noteHistory: history({ kind: "failed", error: { kind: "notFound" } }),
        forgeName,
      },
      entry(),
    );
    expect(outcome).toEqual({ kind: "message", message: SHARED_VERSION_GONE_MESSAGE });
  });

  it("describes any other failure", async () => {
    const outcome = await readSharedVersion(
      {
        noteHistory: history({ kind: "failed", error: { kind: "network" } }),
        forgeName,
      },
      entry(),
    );
    expect(outcome).toEqual({
      kind: "failed",
      message: describeSyncError({ kind: "network" }, forgeName),
    });
  });

  it("treats a thrown read as a server failure", async () => {
    const outcome = await readSharedVersion(
      { noteHistory: history(new Error("boom")), forgeName },
      entry(),
    );
    expect(outcome).toEqual({
      kind: "failed",
      message: describeSyncError({ kind: "server" }, forgeName),
    });
  });
});
