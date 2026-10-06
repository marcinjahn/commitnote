import { beforeAll, describe, expect, it } from "vitest";
import type { Change, NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { encryptNote } from "../crypto/note-cipher";
import { testKeyring } from "../crypto/testing/test-keyring";
import type { TreeEntry } from "../forge/forge-adapter";
import { TAGS_PATH } from "../format/v1";
import type { ColorTag } from "./color-tag";
import {
  applyChangeToTags,
  colorTagOf,
  decryptTagIndex,
  EMPTY_TAGS,
  encryptTagIndex,
  parseTagIndex,
  readTagIndex,
  serializeTagIndex,
  tagKey,
  type TagIndex,
} from "./tag-index";

const NOTE = tagKey(["Docs", "a"]);
const NESTED = tagKey(["Docs", "Notes", "deep", "b"]);

function indexOf(
  notes: Record<string, string> = {},
  trash: Record<string, Record<string, string>> = {},
): TagIndex {
  return parseTagIndex(
    JSON.stringify({
      version: 1,
      notes: Object.fromEntries(
        Object.entries(notes).map(([k, color]) => [k, { color }]),
      ),
      trash: Object.fromEntries(
        Object.entries(trash).map(([id, entry]) => [
          id,
          Object.fromEntries(
            Object.entries(entry).map(([k, color]) => [k, { color }]),
          ),
        ]),
      ),
    }),
  );
}

function asObject(index: TagIndex): {
  notes: Record<string, { color: string }>;
  trash: Record<string, Record<string, { color: string }>>;
} {
  const { notes, trash } = JSON.parse(serializeTagIndex(index));
  return { notes, trash };
}

function colors(index: TagIndex, ...paths: NotePath[]): (ColorTag | null)[] {
  return paths.map((path) => colorTagOf(index, path));
}

describe("parseTagIndex", () => {
  it("reads notes and trash and serializes them in a stable order", () => {
    const text = JSON.stringify({
      version: 1,
      notes: { [tagKey(["b"])]: { color: "red" }, [NOTE]: { color: "blue" } },
      trash: { z: { [tagKey([])]: { color: "green" } }, a: { [tagKey(["x"])]: { color: "red" } } },
    });

    const index = parseTagIndex(text);

    expect(index.writable).toBe(true);
    expect(colorTagOf(index, ["Docs", "a"])).toBe("blue");
    expect(serializeTagIndex(index)).toBe(
      JSON.stringify({
        version: 1,
        notes: { [NOTE]: { color: "blue" }, [tagKey(["b"])]: { color: "red" } },
        trash: {
          a: { [tagKey(["x"])]: { color: "red" } },
          z: { [tagKey([])]: { color: "green" } },
        },
      }),
    );
  });

  it("serializes identically regardless of insertion order", () => {
    const one = indexOf({ [tagKey(["a"])]: "red", [tagKey(["b"])]: "blue" });
    const other = indexOf({ [tagKey(["b"])]: "blue", [tagKey(["a"])]: "red" });

    expect(serializeTagIndex(one)).toBe(serializeTagIndex(other));
  });

  it("omits empty trash entries", () => {
    expect(asObject(indexOf({}, { gone: {} })).trash).toEqual({});
  });

  it("drops malformed records and unknown colors and keeps the rest", () => {
    const index = parseTagIndex(
      JSON.stringify({
        version: 1,
        notes: {
          "not json": { color: "red" },
          [JSON.stringify("string")]: { color: "red" },
          [JSON.stringify([1])]: { color: "red" },
          [JSON.stringify(["a", ""])]: { color: "red" },
          [tagKey([])]: { color: "red" },
          [tagKey(["bad-record"])]: "red",
          [tagKey(["unknown"])]: { color: "pink" },
          [tagKey(["no-color"])]: {},
          [tagKey(["good"])]: { color: "green" },
        },
        trash: {
          bad: "nope",
          mixed: { [tagKey(["x"])]: { color: "teal" }, [tagKey(["y"])]: { color: "red" } },
          allBad: { [tagKey(["x"])]: { color: "teal" } },
        },
      }),
    );

    expect(index.writable).toBe(true);
    expect(asObject(index)).toEqual({
      notes: { [tagKey(["good"])]: { color: "green" } },
      trash: { mixed: { [tagKey(["y"])]: { color: "red" } } },
    });
  });

  it("marks an index it can't understand as not writable", () => {
    for (const text of [
      "not json",
      "[]",
      JSON.stringify({ version: 2, notes: {} }),
      JSON.stringify({ notes: {} }),
      JSON.stringify({ version: 1, notes: [] }),
    ]) {
      const index = parseTagIndex(text);
      expect(index.writable).toBe(false);
      expect(index.notes.size).toBe(0);
      expect(index.trash.size).toBe(0);
    }
  });
});

describe("encrypted tag index", () => {
  let keyring: Keyring;
  beforeAll(async () => {
    keyring = await testKeyring("tags passphrase");
  });

  it("reads back an encrypted index", async () => {
    const index = indexOf({ [NOTE]: "blue" }, { id: { [tagKey([])]: "red" } });

    const stored = await encryptTagIndex(keyring, index);

    expect(stored).not.toContain("Docs");
    expect(serializeTagIndex(await decryptTagIndex(keyring, stored))).toBe(
      serializeTagIndex(index),
    );
  });

  it("marks an index encrypted with another key as not writable", async () => {
    const other = await testKeyring("another passphrase");
    const stored = await encryptTagIndex(other, indexOf({ [NOTE]: "blue" }));

    const index = await decryptTagIndex(keyring, stored);

    expect(index.writable).toBe(false);
    expect(index.notes.size).toBe(0);
  });

  it("marks an index of a newer version as not writable", async () => {
    const stored = await encryptNote(
      keyring,
      JSON.stringify({ version: 2, notes: {} }),
    );

    expect((await decryptTagIndex(keyring, stored)).writable).toBe(false);
  });

  it("marks a corrupt payload as not writable", async () => {
    const stored = await encryptNote(keyring, "{ corrupt");

    expect((await decryptTagIndex(keyring, stored)).writable).toBe(false);
    expect((await decryptTagIndex(keyring, "garbage")).writable).toBe(false);
  });

  it("leaves an unreadable index unchanged when applying changes", async () => {
    const unreadable = await decryptTagIndex(keyring, "garbage");

    for (const change of [
      { kind: "set-color-tag", path: ["a"], color: "red" },
      { kind: "delete-note", path: ["a"] },
    ] satisfies Change[]) {
      expect(applyChangeToTags(unreadable, change)).toBe(unreadable);
    }
  });

  describe("readTagIndex", () => {
    const blob = (path: string, sha: string): TreeEntry =>
      ({ type: "blob", path, sha }) as TreeEntry;

    it("is empty and writable when there is no tags file", async () => {
      const index = await readTagIndex(
        [blob(".commitnote/order", "o")],
        keyring,
        async () => {
          throw new Error("unexpected read");
        },
      );

      expect(index).toBe(EMPTY_TAGS);
      expect(index.writable).toBe(true);
    });

    it("decrypts the tags file", async () => {
      const stored = await encryptTagIndex(keyring, indexOf({ [NOTE]: "blue" }));

      const index = await readTagIndex(
        [blob(TAGS_PATH, "t")],
        keyring,
        async (sha) => {
          expect(sha).toBe("t");
          return stored;
        },
      );

      expect(colorTagOf(index, ["Docs", "a"])).toBe("blue");
    });
  });
});

describe("applyChangeToTags", () => {
  it("sets and clears a color", () => {
    const set = applyChangeToTags(EMPTY_TAGS, {
      kind: "set-color-tag",
      path: ["Docs", "a"],
      color: "red",
    });
    const recolored = applyChangeToTags(set, {
      kind: "set-color-tag",
      path: ["Docs", "a"],
      color: "blue",
    });
    const cleared = applyChangeToTags(recolored, {
      kind: "set-color-tag",
      path: ["Docs", "a"],
      color: null,
    });

    expect(colors(set, ["Docs", "a"])).toEqual(["red"]);
    expect(colors(recolored, ["Docs", "a"])).toEqual(["blue"]);
    expect(asObject(cleared)).toEqual({ notes: {}, trash: {} });
  });

  it("keeps the tag of a note renamed in its folder", () => {
    const after = applyChangeToTags(indexOf({ [NOTE]: "blue" }), {
      kind: "rename-note",
      from: ["Docs", "a"],
      to: ["Docs", "b"],
    });

    expect(colors(after, ["Docs", "a"], ["Docs", "b"])).toEqual([null, "blue"]);
  });

  it("keeps the tag of a note moved to another folder", () => {
    const after = applyChangeToTags(indexOf({ [NOTE]: "blue" }), {
      kind: "rename-note",
      from: ["Docs", "a"],
      to: ["Other", "a"],
    });

    expect(colors(after, ["Docs", "a"], ["Other", "a"])).toEqual([null, "blue"]);
  });

  it("replaces the tag at the destination of a rename", () => {
    const after = applyChangeToTags(
      indexOf({ [NOTE]: "blue", [tagKey(["Docs", "b"])]: "red" }),
      { kind: "rename-note", from: ["Docs", "a"], to: ["Docs", "b"] },
    );

    expect(colors(after, ["Docs", "b"])).toEqual(["blue"]);
  });

  it("rebases tagged notes at every depth when a folder is renamed", () => {
    const index = indexOf({
      [NOTE]: "blue",
      [NESTED]: "green",
      [tagKey(["Docsy", "c"])]: "red",
    });

    const after = applyChangeToTags(index, {
      kind: "rename-folder",
      from: ["Docs"],
      to: ["Guides"],
    });

    expect(
      colors(
        after,
        ["Guides", "a"],
        ["Guides", "Notes", "deep", "b"],
        ["Docsy", "c"],
        ["Docs", "a"],
      ),
    ).toEqual(["blue", "green", "red", null]);
  });

  it("rebases tagged notes when a folder is moved", () => {
    const after = applyChangeToTags(indexOf({ [NOTE]: "blue", [NESTED]: "green" }), {
      kind: "rename-folder",
      from: ["Docs"],
      to: ["Archive", "Old", "Docs"],
    });

    expect(
      colors(
        after,
        ["Archive", "Old", "Docs", "a"],
        ["Archive", "Old", "Docs", "Notes", "deep", "b"],
        ["Docs", "a"],
      ),
    ).toEqual(["blue", "green", null]);
  });

  it("moves the tag into the trash with a note and back on restore", () => {
    const index = indexOf({ [NOTE]: "blue" });

    const trashed = applyChangeToTags(index, {
      kind: "trash-note",
      path: ["Docs", "a"],
      entryId: "e1",
    });
    expect(colors(trashed, ["Docs", "a"])).toEqual([null]);
    expect(asObject(trashed).trash).toEqual({
      e1: { [tagKey([])]: { color: "blue" } },
    });

    const restored = applyChangeToTags(trashed, {
      kind: "restore-trash",
      entryId: "e1",
      subPath: [],
      target: "note",
      to: ["Docs", "a"],
    });
    expect(serializeTagIndex(restored)).toBe(serializeTagIndex(index));
  });

  it("moves the tags into the trash with a folder and back on restore", () => {
    const index = indexOf({
      [NOTE]: "blue",
      [NESTED]: "green",
      [tagKey(["Other", "x"])]: "red",
    });

    const trashed = applyChangeToTags(index, {
      kind: "trash-folder",
      path: ["Docs"],
      entryId: "e1",
    });
    expect(asObject(trashed)).toEqual({
      notes: { [tagKey(["Other", "x"])]: { color: "red" } },
      trash: {
        e1: {
          [tagKey(["a"])]: { color: "blue" },
          [tagKey(["Notes", "deep", "b"])]: { color: "green" },
        },
      },
    });

    const restored = applyChangeToTags(trashed, {
      kind: "restore-trash",
      entryId: "e1",
      subPath: [],
      target: "folder",
      to: ["Docs"],
    });
    expect(serializeTagIndex(restored)).toBe(serializeTagIndex(index));
  });

  it("restores one note of a trashed folder and keeps the rest in the entry", () => {
    const trash = {
      e1: {
        [tagKey(["a"])]: "blue",
        [tagKey(["Notes", "deep", "b"])]: "green",
      },
    };

    const after = applyChangeToTags(indexOf({}, trash), {
      kind: "restore-trash",
      entryId: "e1",
      subPath: ["Notes", "deep", "b"],
      target: "note",
      to: ["Elsewhere", "b"],
    });

    expect(asObject(after)).toEqual({
      notes: { [tagKey(["Elsewhere", "b"])]: { color: "green" } },
      trash: { e1: { [tagKey(["a"])]: { color: "blue" } } },
    });
  });

  it("restores a subfolder of a trashed folder under its new path", () => {
    const after = applyChangeToTags(
      indexOf(
        {},
        { e1: { [tagKey(["Notes", "b"])]: "green", [tagKey(["a"])]: "blue" } },
      ),
      {
        kind: "restore-trash",
        entryId: "e1",
        subPath: ["Notes"],
        target: "folder",
        to: ["Back", "Notes"],
      },
    );

    expect(colors(after, ["Back", "Notes", "b"])).toEqual(["green"]);
    expect(Object.keys(asObject(after).trash.e1)).toEqual([tagKey(["a"])]);
  });

  it("restores under a conflict path and drops an emptied entry", () => {
    const after = applyChangeToTags(
      indexOf({ [NOTE]: "red" }, { e1: { [tagKey([])]: "blue" } }),
      {
        kind: "restore-trash",
        entryId: "e1",
        subPath: [],
        target: "note",
        to: ["Docs", "a (conflict)"],
      },
    );

    expect(asObject(after)).toEqual({
      notes: {
        [NOTE]: { color: "red" },
        [tagKey(["Docs", "a (conflict)"])]: { color: "blue" },
      },
      trash: {},
    });
  });

  it("drops the trash entries that are purged", () => {
    const index = indexOf(
      {},
      {
        e1: { [tagKey([])]: "blue" },
        e2: { [tagKey([])]: "red" },
        e3: { [tagKey([])]: "green" },
      },
    );

    const after = applyChangeToTags(index, {
      kind: "purge-trash",
      entryIds: ["e1", "e3", "unknown"],
    });

    expect(Object.keys(asObject(after).trash)).toEqual(["e2"]);
  });

  it("drops the tag of a deleted note", () => {
    const after = applyChangeToTags(
      indexOf({ [NOTE]: "blue", [tagKey(["Docs", "b"])]: "red" }),
      { kind: "delete-note", path: ["Docs", "a"] },
    );

    expect(colors(after, ["Docs", "a"], ["Docs", "b"])).toEqual([null, "red"]);
  });

  it("drops the tags under a deleted folder", () => {
    const after = applyChangeToTags(
      indexOf({ [NOTE]: "blue", [NESTED]: "green", [tagKey(["Other", "x"])]: "red" }),
      { kind: "delete-folder", path: ["Docs"] },
    );

    expect(asObject(after).notes).toEqual({
      [tagKey(["Other", "x"])]: { color: "red" },
    });
  });

  it("drops a stale tag when a note is created at its path", () => {
    const after = applyChangeToTags(indexOf({ [NOTE]: "blue" }), {
      kind: "create-note",
      path: ["Docs", "a"],
      content: "",
    });

    expect(colors(after, ["Docs", "a"])).toEqual([null]);
  });

  it("leaves the index alone for changes that don't affect tags", () => {
    const index = indexOf({ [NOTE]: "blue" });

    for (const change of [
      { kind: "update-note", path: ["Docs", "a"], content: "x" },
      { kind: "create-folder", path: ["New"] },
      { kind: "set-order", parent: [], positions: [] },
      { kind: "set-settings", values: {} },
    ] satisfies Change[]) {
      expect(applyChangeToTags(index, change)).toBe(index);
    }
  });
});
