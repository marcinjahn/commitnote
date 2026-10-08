import { beforeAll, describe, expect, it } from "vitest";
import type { Change, NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { encryptNote } from "../crypto/note-cipher";
import { testKeyring } from "../crypto/testing/test-keyring";
import type { TreeEntry } from "../forge/forge-adapter";
import { SHARES_PATH } from "../format/v1";
import {
  applyChangeToShares,
  decryptShareIndex,
  EMPTY_SHARES,
  encryptShareIndex,
  isNoteShared,
  newShareId,
  parseShareIndex,
  readShareIndex,
  serializeShareIndex,
  sharesIn,
  sharesOfNote,
  sortedShares,
  type ShareEntry,
  type ShareIndex,
  type ShareNoteLocation,
} from "./share-index";

function entry(
  id: string,
  note: ShareNoteLocation,
  overrides: Partial<ShareEntry> = {},
): ShareEntry {
  return {
    id,
    locator: { provider: "github", gistId: `gist-${id}` },
    linkSecret: "secret",
    password: null,
    name: "Note",
    sharedAt: "2026-01-01T00:00:00.000Z",
    note,
    source: { commit: "c", storedPath: "s", blobSha: "b" },
    updatedAt: null,
    ...overrides,
  };
}

function active(...path: string[]): ShareNoteLocation {
  return { state: "active", path };
}

function trashed(entryId: string, ...path: string[]): ShareNoteLocation {
  return { state: "trashed", entryId, path };
}

function indexOf(...entries: ShareEntry[]): ShareIndex {
  return { writable: true, entries: new Map(entries.map((e) => [e.id, e])) };
}

function notes(index: ShareIndex): Record<string, ShareNoteLocation> {
  return Object.fromEntries(
    [...index.entries].map(([id, e]) => [id, e.note]),
  );
}

describe("newShareId", () => {
  it("is 16 random bytes in base64url", () => {
    const id = newShareId((n) => new Uint8Array(n).fill(255));

    expect(id).toBe("_____________________w");
    expect(newShareId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("parseShareIndex", () => {
  it("serializes deterministically regardless of insertion order", () => {
    const a = entry("a", active("x"));
    const b = entry("b", trashed("t"), {
      locator: { provider: "gitlab", snippetId: "42" },
      password: "pw",
      source: null,
    });

    const first = serializeShareIndex(indexOf(a, b));
    const second = serializeShareIndex(indexOf(b, a));

    expect(first).toBe(second);
    expect(serializeShareIndex(parseShareIndex(first))).toBe(first);
    expect(parseShareIndex(first).entries.get("b")).toEqual(b);
    const keys = Object.keys(JSON.parse(first).shares.a);
    expect(keys).toEqual([...keys].sort());
  });

  it("round-trips the update time as the last key", () => {
    const a = entry("a", active("x"), { updatedAt: "2026-02-01T00:00:00.000Z" });

    const text = serializeShareIndex(indexOf(a));
    const stored = JSON.parse(text).shares.a;

    expect(stored.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(Object.keys(stored).at(-1)).toBe("updatedAt");
    expect(parseShareIndex(text).entries.get("a")).toEqual(a);
  });

  it("reads a missing or mistyped update time as never updated", () => {
    const stored = JSON.parse(
      serializeShareIndex(indexOf(entry("a", active("x")), entry("b", active("y")))),
    );
    delete stored.shares.a.updatedAt;
    stored.shares.b.updatedAt = 5;

    const index = parseShareIndex(JSON.stringify(stored));

    expect(index.entries.get("a")?.updatedAt).toBeNull();
    expect(index.entries.get("b")?.updatedAt).toBeNull();
  });

  it("ignores a leftover revision on a GitHub locator and drops it on write", () => {
    const good = entry("a", active("x"));
    const stored = JSON.parse(serializeShareIndex(indexOf(good)));
    stored.shares.a.locator = {
      gistId: "gist-a",
      provider: "github",
      revision: "old",
    };

    const index = parseShareIndex(JSON.stringify(stored));

    expect(index.entries.get("a")?.locator).toEqual({
      provider: "github",
      gistId: "gist-a",
    });
    expect(JSON.parse(serializeShareIndex(index)).shares.a.locator).toEqual({
      gistId: "gist-a",
      provider: "github",
    });
  });

  it("drops malformed entries", () => {
    const good = entry("good", active("x"));
    const text = JSON.stringify({
      version: 1,
      shares: {
        good: JSON.parse(serializeShareIndex(indexOf(good))).shares.good,
        notObject: "x",
        badLocator: { ...good, locator: { provider: "github", gistId: 1 } },
        badGitlab: { ...good, locator: { provider: "gitlab", snippetId: 1 } },
        unknownProvider: { ...good, locator: { provider: "x" } },
        badSecret: { ...good, linkSecret: 1 },
        badName: { ...good, name: null },
        badSharedAt: { ...good, sharedAt: 1 },
        badPassword: { ...good, password: 1 },
        emptyActive: { ...good, note: { state: "active", path: [] } },
        emptySegment: { ...good, note: { state: "active", path: ["a", ""] } },
        badTrashed: { ...good, note: { state: "trashed", path: [] } },
        badState: { ...good, note: { state: "gone" } },
        badSource: { ...good, source: { commit: "c" } },
        undefinedSource: { ...good, source: undefined },
      },
    });

    const index = parseShareIndex(text);

    expect(index.writable).toBe(true);
    expect([...index.entries.keys()]).toEqual(["good"]);
  });

  it("accepts an empty path for a trashed note", () => {
    const index = indexOf(entry("a", trashed("t")));

    expect(parseShareIndex(serializeShareIndex(index)).entries.get("a")?.note)
      .toEqual(trashed("t"));
  });

  it("marks an index it can't understand as not writable", () => {
    for (const text of [
      "not json",
      "[]",
      JSON.stringify({ version: 2, shares: {} }),
      JSON.stringify({ shares: {} }),
      JSON.stringify({ version: 1, shares: [] }),
    ]) {
      const index = parseShareIndex(text);
      expect(index.writable).toBe(false);
      expect(index.entries.size).toBe(0);
    }
  });
});

describe("encrypted share index", () => {
  let keyring: Keyring;
  beforeAll(async () => {
    keyring = await testKeyring("shares passphrase");
  });

  it("reads back an encrypted index", async () => {
    const index = indexOf(entry("a", active("Docs", "a"), { password: "pw" }));

    const stored = await encryptShareIndex(keyring, index);

    expect(stored).not.toContain("Docs");
    expect(serializeShareIndex(await decryptShareIndex(keyring, stored))).toBe(
      serializeShareIndex(index),
    );
  });

  it("marks an index encrypted with another key as not writable", async () => {
    const other = await testKeyring("another passphrase");
    const stored = await encryptShareIndex(other, indexOf(entry("a", active("x"))));

    const index = await decryptShareIndex(keyring, stored);

    expect(index.writable).toBe(false);
    expect(index.entries.size).toBe(0);
  });

  it("marks an index of a newer version as not writable", async () => {
    const stored = await encryptNote(
      keyring,
      JSON.stringify({ version: 2, shares: {} }),
    );

    expect((await decryptShareIndex(keyring, stored)).writable).toBe(false);
  });

  it("marks a corrupt payload as not writable", async () => {
    const stored = await encryptNote(keyring, "{ corrupt");

    expect((await decryptShareIndex(keyring, stored)).writable).toBe(false);
    expect((await decryptShareIndex(keyring, "garbage")).writable).toBe(false);
  });

  it("leaves an unreadable index unchanged when applying changes", async () => {
    const unreadable = await decryptShareIndex(keyring, "garbage");

    for (const change of [
      { kind: "add-share", entry: entry("a", active("a")) },
      { kind: "update-share", entry: entry("a", active("a")) },
      { kind: "remove-share", id: "a" },
      { kind: "delete-note", path: ["a"] },
    ] satisfies Change[]) {
      expect(applyChangeToShares(unreadable, change)).toBe(unreadable);
    }
  });

  describe("readShareIndex", () => {
    const blob = (path: string, sha: string): TreeEntry =>
      ({ type: "blob", path, sha }) as TreeEntry;

    it("is empty and writable when there is no shares file", async () => {
      const index = await readShareIndex(
        [blob(".commitnote/tags", "t")],
        keyring,
        async () => {
          throw new Error("unexpected read");
        },
      );

      expect(index).toBe(EMPTY_SHARES);
      expect(index.writable).toBe(true);
    });

    it("decrypts the shares file", async () => {
      const stored = await encryptShareIndex(
        keyring,
        indexOf(entry("a", active("x"))),
      );

      const index = await readShareIndex(
        [blob(SHARES_PATH, "s")],
        keyring,
        async (sha) => {
          expect(sha).toBe("s");
          return stored;
        },
      );

      expect([...index.entries.keys()]).toEqual(["a"]);
    });
  });
});

describe("applyChangeToShares", () => {
  it("adds and replaces an entry", () => {
    const a = entry("a", active("x"));

    const added = applyChangeToShares(EMPTY_SHARES, { kind: "add-share", entry: a });
    const replaced = applyChangeToShares(added, {
      kind: "add-share",
      entry: { ...a, source: null },
    });

    expect(added.entries.get("a")).toBe(a);
    expect(replaced.entries.size).toBe(1);
    expect(replaced.entries.get("a")?.source).toBeNull();
  });

  it("replaces an entry on update, and ignores an unknown one", () => {
    const index = indexOf(entry("a", active("x")), entry("b", active("y")));
    const updated = entry("a", active("x"), {
      linkSecret: "new",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    const result = applyChangeToShares(index, { kind: "update-share", entry: updated });

    expect(result.entries.get("a")).toBe(updated);
    expect(result.entries.get("b")).toBe(index.entries.get("b"));
    expect(
      applyChangeToShares(index, { kind: "update-share", entry: entry("zzz", active("x")) }),
    ).toBe(index);
  });

  it("removes an entry, and ignores an absent one", () => {
    const index = indexOf(entry("a", active("x")), entry("b", active("y")));

    const removed = applyChangeToShares(index, { kind: "remove-share", id: "a" });

    expect([...removed.entries.keys()]).toEqual(["b"]);
    expect(applyChangeToShares(removed, { kind: "remove-share", id: "zzz" })).toBe(
      removed,
    );
  });

  it("follows a rename in a folder and a move to another folder", () => {
    const index = indexOf(
      entry("a", active("Docs", "a")),
      entry("b", active("Docs", "b")),
    );

    const renamed = applyChangeToShares(index, {
      kind: "rename-note",
      from: ["Docs", "a"],
      to: ["Docs", "c"],
    });
    const moved = applyChangeToShares(renamed, {
      kind: "rename-note",
      from: ["Docs", "c"],
      to: ["Other", "c"],
    });

    expect(notes(renamed)).toEqual({ a: active("Docs", "c"), b: active("Docs", "b") });
    expect(notes(moved)).toEqual({ a: active("Other", "c"), b: active("Docs", "b") });
  });

  it("follows a folder rename and move with nested notes", () => {
    const index = indexOf(
      entry("a", active("Docs", "a")),
      entry("b", active("Docs", "Notes", "deep", "b")),
      entry("c", active("Docsx", "c")),
    );

    const renamed = applyChangeToShares(index, {
      kind: "rename-folder",
      from: ["Docs"],
      to: ["Papers"],
    });
    const moved = applyChangeToShares(renamed, {
      kind: "rename-folder",
      from: ["Papers"],
      to: ["Archive", "Papers"],
    });

    expect(notes(renamed)).toEqual({
      a: active("Papers", "a"),
      b: active("Papers", "Notes", "deep", "b"),
      c: active("Docsx", "c"),
    });
    expect(notes(moved)).toEqual({
      a: active("Archive", "Papers", "a"),
      b: active("Archive", "Papers", "Notes", "deep", "b"),
      c: active("Docsx", "c"),
    });
  });

  it("trashes and fully restores a note", () => {
    const index = indexOf(entry("a", active("Docs", "a")));

    const inTrash = applyChangeToShares(index, {
      kind: "trash-note",
      path: ["Docs", "a"],
      entryId: "t1",
    });
    const restored = applyChangeToShares(inTrash, {
      kind: "restore-trash",
      entryId: "t1",
      subPath: [],
      target: "note",
      to: ["Docs", "a"],
    });

    expect(notes(inTrash)).toEqual({ a: trashed("t1") });
    expect(notes(restored)).toEqual({ a: active("Docs", "a") });
  });

  it("trashes and fully restores a folder", () => {
    const index = indexOf(
      entry("a", active("Docs", "a")),
      entry("b", active("Docs", "Notes", "deep", "b")),
      entry("c", active("Other", "c")),
    );

    const inTrash = applyChangeToShares(index, {
      kind: "trash-folder",
      path: ["Docs"],
      entryId: "t1",
    });
    const restored = applyChangeToShares(inTrash, {
      kind: "restore-trash",
      entryId: "t1",
      subPath: [],
      target: "folder",
      to: ["Docs"],
    });

    expect(notes(inTrash)).toEqual({
      a: trashed("t1", "a"),
      b: trashed("t1", "Notes", "deep", "b"),
      c: active("Other", "c"),
    });
    expect(notes(restored)).toEqual(notes(index));
  });

  it("restores one note of a trashed folder and keeps the rest trashed", () => {
    const inTrash = indexOf(
      entry("a", trashed("t1", "a")),
      entry("b", trashed("t1", "Notes", "b")),
      entry("c", trashed("t2", "a")),
    );

    const restored = applyChangeToShares(inTrash, {
      kind: "restore-trash",
      entryId: "t1",
      subPath: ["a"],
      target: "note",
      to: ["Back", "a"],
    });
    const subfolder = applyChangeToShares(inTrash, {
      kind: "restore-trash",
      entryId: "t1",
      subPath: ["Notes"],
      target: "folder",
      to: ["Back", "Notes"],
    });

    expect(notes(restored)).toEqual({
      a: active("Back", "a"),
      b: trashed("t1", "Notes", "b"),
      c: trashed("t2", "a"),
    });
    expect(notes(subfolder)).toEqual({
      a: trashed("t1", "a"),
      b: active("Back", "Notes", "b"),
      c: trashed("t2", "a"),
    });
  });

  it("restores to the renamed conflict destination", () => {
    const inTrash = indexOf(entry("a", trashed("t1")));

    const restored = applyChangeToShares(inTrash, {
      kind: "restore-trash",
      entryId: "t1",
      subPath: [],
      target: "note",
      to: ["Docs", "a (conflict)"],
    });

    expect(notes(restored)).toEqual({ a: active("Docs", "a (conflict)") });
  });

  it("marks shares of purged trash entries deleted and keeps them", () => {
    const index = indexOf(
      entry("a", trashed("t1")),
      entry("b", trashed("t2", "x")),
      entry("c", trashed("t3")),
      entry("d", active("n")),
    );

    const purged = applyChangeToShares(index, {
      kind: "purge-trash",
      entryIds: ["t1", "t2"],
    });

    expect(notes(purged)).toEqual({
      a: { state: "deleted" },
      b: { state: "deleted" },
      c: trashed("t3"),
      d: active("n"),
    });
  });

  it("marks shares of a deleted note or folder deleted", () => {
    const index = indexOf(
      entry("a", active("Docs", "a")),
      entry("b", active("Docs", "Notes", "b")),
      entry("c", active("Other", "c")),
    );

    const noteDeleted = applyChangeToShares(index, {
      kind: "delete-note",
      path: ["Docs", "a"],
    });
    const folderDeleted = applyChangeToShares(index, {
      kind: "delete-folder",
      path: ["Docs"],
    });

    expect(notes(noteDeleted)).toEqual({
      a: { state: "deleted" },
      b: active("Docs", "Notes", "b"),
      c: active("Other", "c"),
    });
    expect(notes(folderDeleted)).toEqual({
      a: { state: "deleted" },
      b: { state: "deleted" },
      c: active("Other", "c"),
    });
  });

  it("leaves the index unchanged for other kinds", () => {
    const index = indexOf(entry("a", active("a")));

    for (const change of [
      { kind: "create-note", path: ["a"], content: "x" },
      { kind: "update-note", path: ["a"], content: "x" },
      { kind: "create-folder", path: ["f"] },
      { kind: "set-order", parent: [], positions: [] },
      { kind: "set-settings", values: {} },
      { kind: "set-color-tag", path: ["a"], color: "red" },
    ] satisfies Change[]) {
      expect(applyChangeToShares(index, change)).toBe(index);
    }
  });
});

describe("share queries", () => {
  const index = indexOf(
    entry("b", active("Docs", "a"), { sharedAt: "2026-01-02T00:00:00.000Z" }),
    entry("a", active("Docs", "a"), { sharedAt: "2026-01-02T00:00:00.000Z" }),
    entry("c", active("Docs", "a"), { sharedAt: "2026-01-03T00:00:00.000Z" }),
    entry("d", active("Docs", "other")),
    entry("e", trashed("t1")),
    entry("f", { state: "deleted" }),
    entry("g", active("Docsy")),
    entry("h", trashed("t2", "x")),
  );

  it("tells whether a note is shared by an active entry", () => {
    expect(isNoteShared(index, ["Docs", "a"])).toBe(true);
    expect(isNoteShared(index, ["Docs"])).toBe(false);
    expect(isNoteShared(index, ["nothing"])).toBe(false);
  });

  it("lists the shares of a note newest first, ties by id", () => {
    const ids = (path: NotePath) => sharesOfNote(index, path).map((e) => e.id);

    expect(ids(["Docs", "a"])).toEqual(["c", "a", "b"]);
    expect(ids(["Docs", "other"])).toEqual(["d"]);
  });

  it("lists every share newest first", () => {
    expect(sortedShares(index).map((e) => e.id)).toEqual([
      "c",
      "a",
      "b",
      "d",
      "e",
      "f",
      "g",
      "h",
    ]);
  });

  it("lists the active shares at or within a path", () => {
    const ids = (path: NotePath) =>
      sharesIn(index, { kind: "within", path }).map((e) => e.id);

    expect(ids(["Docs"])).toEqual(["c", "a", "b", "d"]);
    expect(ids(["Docs", "other"])).toEqual(["d"]);
    expect(ids(["Missing"])).toEqual([]);
  });

  it("lists the shares of trashed notes in the given trash entries", () => {
    const ids = (entryIds: readonly string[] | "all") =>
      sharesIn(index, { kind: "trashed", entryIds }).map((e) => e.id);

    expect(ids(["t2"])).toEqual(["h"]);
    expect(ids(["t3"])).toEqual([]);
    expect(ids("all")).toEqual(["e", "h"]);
  });
});
