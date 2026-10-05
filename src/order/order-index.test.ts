import { beforeAll, describe, expect, it } from "vitest";
import type { Change, NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { encryptNote } from "../crypto/note-cipher";
import { testKeyring } from "../crypto/testing/test-keyring";
import {
  applyChangeToOrder,
  decryptOrderIndex,
  EMPTY_ORDER,
  encryptOrderIndex,
  folderKey,
  parseOrderIndex,
  serializeOrderIndex,
  siblingComparator,
  withKeys,
  type OrderIndex,
} from "./order-index";

const keyringFor = testKeyring;

function orderKeyOf(index: OrderIndex, path: NotePath): string | undefined {
  return index.folders
    .get(folderKey(path.slice(0, -1)))
    ?.get(path[path.length - 1]);
}

function indexOf(
  folders: Record<string, Record<string, string>>,
): OrderIndex {
  return parseOrderIndex(JSON.stringify({ version: 1, folders }));
}

function asObject(index: OrderIndex): Record<string, Record<string, string>> {
  return JSON.parse(serializeOrderIndex(index)).folders;
}

const ROOT = JSON.stringify([]);
const DOCS = JSON.stringify(["Docs"]);
const DOCS_NOTES = JSON.stringify(["Docs", "Notes"]);

describe("parseOrderIndex", () => {
  it("reads positions by folder and serializes them back in a stable order", () => {
    const text = JSON.stringify({
      version: 1,
      folders: { [ROOT]: { Docs: "V" }, [DOCS]: { b: "V", a: "k" } },
    });

    const index = parseOrderIndex(text);

    expect(index.writable).toBe(true);
    expect(orderKeyOf(index, ["Docs", "a"])).toBe("k");
    expect(orderKeyOf(index, ["Docs"])).toBe("V");
    expect(serializeOrderIndex(index)).toBe(
      JSON.stringify({
        version: 1,
        folders: { [DOCS]: { a: "k", b: "V" }, [ROOT]: { Docs: "V" } },
      }),
    );
  });

  it("skips malformed entries and keeps the rest", () => {
    const index = parseOrderIndex(
      JSON.stringify({
        version: 1,
        folders: {
          "not json": { a: "V" },
          [JSON.stringify([1])]: { a: "V" },
          [DOCS]: { good: "V", trailingZero: "V0", number: 3, empty: "" },
          [ROOT]: "not an object",
        },
      }),
    );

    expect(index.writable).toBe(true);
    expect(asObject(index)).toEqual({ [DOCS]: { good: "V" } });
  });

  it("marks an index it can't understand as not writable", () => {
    for (const text of [
      "not json",
      "[]",
      JSON.stringify({ version: 2, folders: {} }),
      JSON.stringify({ folders: {} }),
      JSON.stringify({ version: 1, folders: [] }),
    ]) {
      const index = parseOrderIndex(text);
      expect(index.writable).toBe(false);
      expect(index.folders.size).toBe(0);
    }
  });
});

describe("decryptOrderIndex", () => {
  let keyring: Keyring;
  beforeAll(async () => {
    keyring = await keyringFor("order passphrase");
  });

  it("reads back an encrypted index", async () => {
    const index = indexOf({ [DOCS]: { a: "V" } });

    const stored = await encryptOrderIndex(keyring, index);

    expect(stored).not.toContain("Docs");
    expect(asObject(await decryptOrderIndex(keyring, stored))).toEqual({
      [DOCS]: { a: "V" },
    });
  });

  it("marks an index encrypted with another key as not writable", async () => {
    const other = await keyringFor("another passphrase");
    const stored = await encryptOrderIndex(other, indexOf({ [DOCS]: { a: "V" } }));

    const index = await decryptOrderIndex(keyring, stored);

    expect(index.writable).toBe(false);
    expect(index.folders.size).toBe(0);
  });

  it("marks an index of a newer version as not writable", async () => {
    const stored = await encryptNote(
      keyring,
      JSON.stringify({ version: 2, folders: {} }),
    );

    expect((await decryptOrderIndex(keyring, stored)).writable).toBe(false);
  });
});

describe("siblingComparator", () => {
  const children = [
    { kind: "note", name: "b" },
    { kind: "folder", name: "Zed" },
    { kind: "note", name: "a" },
    { kind: "folder", name: "Alpha" },
    { kind: "note", name: "c" },
  ] as const;

  function sortedNames(index: OrderIndex, parent: NotePath): string[] {
    return [...children]
      .sort(siblingComparator(index, parent))
      .map((child) => child.name);
  }

  it("sorts folders first and then by name when the folder has no positions", () => {
    expect(sortedNames(EMPTY_ORDER, ["Docs"])).toEqual([
      "Alpha",
      "Zed",
      "a",
      "b",
      "c",
    ]);
  });

  it("puts positioned children first by key, notes and folders mixed, then the rest", () => {
    const index = indexOf({ [DOCS]: { c: "F", Zed: "V", a: "k", gone: "a" } });

    expect(sortedNames(index, ["Docs"])).toEqual(["c", "Zed", "a", "Alpha", "b"]);
  });

  it("orders children with equal keys by name", () => {
    const index = indexOf({ [DOCS]: { c: "V", a: "V" } });

    expect(sortedNames(index, ["Docs"]).slice(0, 2)).toEqual(["a", "c"]);
  });
});

describe("withKeys", () => {
  it("sets positions in one folder and keeps the others", () => {
    const index = indexOf({ [DOCS]: { a: "V", b: "k" } });

    const updated = withKeys(index, ["Docs"], [{ name: "b", key: "F" }]);

    expect(asObject(updated)).toEqual({ [DOCS]: { a: "V", b: "F" } });
    expect(asObject(index)).toEqual({ [DOCS]: { a: "V", b: "k" } });
  });

  it("leaves an index that isn't writable unchanged", () => {
    const unreadable = parseOrderIndex("not json");

    expect(withKeys(unreadable, [], [{ name: "a", key: "V" }])).toBe(unreadable);
  });
});

describe("applyChangeToOrder", () => {
  const index = indexOf({
    [ROOT]: { Docs: "V", Welcome: "k" },
    [DOCS]: { Guide: "V", Notes: "k" },
    [DOCS_NOTES]: { Todo: "V", Done: "k" },
  });

  function applied(change: Change): Record<string, Record<string, string>> {
    return asObject(applyChangeToOrder(index, change));
  }

  it("keeps the position of an item renamed within its folder", () => {
    expect(
      applied({ kind: "rename-note", from: ["Welcome"], to: ["Hello"] })[ROOT],
    ).toEqual({ Docs: "V", Hello: "k" });
  });

  it("drops the position of an item moved to another folder", () => {
    const result = applied({
      kind: "rename-note",
      from: ["Docs", "Guide"],
      to: ["Guide"],
    });

    expect(result[DOCS]).toEqual({ Notes: "k" });
    expect(result[ROOT]).toEqual({ Docs: "V", Welcome: "k" });
  });

  it("carries the positions inside a renamed or moved folder", () => {
    const renamed = applied({
      kind: "rename-folder",
      from: ["Docs", "Notes"],
      to: ["Docs", "Tasks"],
    });
    expect(renamed[DOCS]).toEqual({ Guide: "V", Tasks: "k" });
    expect(renamed[JSON.stringify(["Docs", "Tasks"])]).toEqual({
      Todo: "V",
      Done: "k",
    });
    expect(renamed[DOCS_NOTES]).toBeUndefined();

    const moved = applied({ kind: "rename-folder", from: ["Docs"], to: ["Archive", "Docs"] });
    expect(moved[ROOT]).toEqual({ Welcome: "k" });
    expect(moved[JSON.stringify(["Archive", "Docs"])]).toEqual({
      Guide: "V",
      Notes: "k",
    });
    expect(moved[JSON.stringify(["Archive", "Docs", "Notes"])]).toEqual({
      Todo: "V",
      Done: "k",
    });
  });

  it("removes a deleted or trashed folder's position and the positions inside it", () => {
    for (const change of [
      { kind: "delete-folder", path: ["Docs"] },
      { kind: "trash-folder", path: ["Docs"], entryId: "20260930T100000Z-1-aaaaaaaa" },
    ] as const) {
      expect(applied(change)).toEqual({ [ROOT]: { Welcome: "k" } });
    }
  });

  it("removes a deleted or trashed note's position", () => {
    for (const change of [
      { kind: "delete-note", path: ["Docs", "Guide"] },
      { kind: "trash-note", path: ["Docs", "Guide"], entryId: "20260930T100000Z-2-aaaaaaaa" },
    ] as const) {
      expect(applied(change)[DOCS]).toEqual({ Notes: "k" });
    }
  });

  it("gives a created or restored item no position, even where a stale one was left", () => {
    const stale = indexOf({ [ROOT]: { New: "V", Welcome: "k" } });
    for (const change of [
      { kind: "create-note", path: ["New"], content: "" },
      { kind: "create-folder", path: ["New"] },
      {
        kind: "restore-trash",
        entryId: "20260930T100000Z-1-aaaaaaaa",
        subPath: [],
        target: "note",
        to: ["New"],
      },
    ] as const) {
      expect(asObject(applyChangeToOrder(stale, change))).toEqual({
        [ROOT]: { Welcome: "k" },
      });
    }
  });

  it("leaves the index unchanged for content edits and purges", () => {
    expect(
      applyChangeToOrder(index, { kind: "update-note", path: ["Welcome"], content: "x" }),
    ).toBe(index);
    expect(applyChangeToOrder(index, { kind: "purge-trash", entryIds: [] })).toBe(
      index,
    );
  });

  it("leaves an index that isn't writable unchanged", () => {
    const unreadable = parseOrderIndex("not json");

    expect(
      applyChangeToOrder(unreadable, { kind: "create-note", path: ["a"], content: "" }),
    ).toBe(unreadable);
  });
});
