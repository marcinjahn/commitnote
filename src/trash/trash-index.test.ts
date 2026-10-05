import { beforeAll, describe, expect, it } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { encryptName, encryptPath } from "../crypto/name-cipher";
import { testKeyring } from "../crypto/testing/test-keyring";
import type { TreeEntry } from "../forge/forge-adapter";
import { FOLDER_MARKER, REPO_CONFIG_PATH, TRASH_DIR } from "../format/v1";
import { buildTrashIndex, type TrashEntry } from "./trash-index";

const keyringFor = testKeyring;

function blob(path: string, sha: string): TreeEntry {
  return { path, type: "blob", sha };
}

function readable(entry: TrashEntry | undefined) {
  if (entry === undefined || entry.undecryptable) {
    throw new Error("expected a readable entry");
  }
  return entry;
}

const NOTE_ID = "20260901T080000Z-2-aaaaaaaa";
const FOLDER_ID = "20260815T120000Z-1-bbbbbbbb";

let keyring: Keyring;
let otherKeyring: Keyring;

beforeAll(async () => {
  keyring = await keyringFor("correct horse battery staple");
  otherKeyring = await keyringFor("another passphrase");
});

describe("buildTrashIndex", () => {
  it("reads a trashed note whose blob sits exactly at the entry root", async () => {
    const stored = await encryptPath(keyring, ["Projects", "Ideas"]);
    const path = `${TRASH_DIR}/${NOTE_ID}/${stored}`;

    const [entry] = await buildTrashIndex([blob(path, "sha-ideas")], keyring);

    expect(entry).toEqual({
      id: NOTE_ID,
      deletedAt: Date.UTC(2026, 8, 1, 8, 0, 0),
      undecryptable: false,
      kind: "note",
      originalPath: ["Projects", "Ideas"],
      storedRoot: stored,
      files: [{ storedPath: path, sha: "sha-ideas" }],
      tree: {
        kind: "note",
        name: "Ideas",
        path: ["Projects", "Ideas"],
        storedPath: stored,
        blobSha: "sha-ideas",
      },
    });
  });

  it("reads a trashed folder with nested notes and empty subfolders", async () => {
    const archive = await encryptName(keyring, "Archive");
    const old = await encryptName(keyring, "Old");
    const empty = await encryptName(keyring, "Empty");
    const prefix = `${TRASH_DIR}/${FOLDER_ID}`;
    const listing = [
      { path: TRASH_DIR, type: "tree" as const, sha: "t1" },
      { path: prefix, type: "tree" as const, sha: "t2" },
      blob(`${prefix}/${archive}/${old}`, "sha-old"),
      blob(`${prefix}/${archive}/${empty}/${FOLDER_MARKER}`, "sha-keep"),
    ];

    const entry = readable((await buildTrashIndex(listing, keyring))[0]);

    expect(entry.kind).toBe("folder");
    expect(entry.originalPath).toEqual(["Archive"]);
    expect(entry.storedRoot).toBe(archive);
    expect(entry.files.map((f) => f.sha).sort()).toEqual([
      "sha-keep",
      "sha-old",
    ]);
    if (entry.tree.kind !== "folder") throw new Error("expected folder");
    expect(entry.tree.path).toEqual(["Archive"]);
    expect(entry.tree.children.map((c) => [c.kind, c.name])).toEqual([
      ["folder", "Empty"],
      ["note", "Old"],
    ]);
  });

  it("uses the depth in the id to find the root of a trashed folder", async () => {
    const stored = await encryptPath(keyring, ["A", "B"]);
    const inner = await encryptName(keyring, "C");
    const id = "20260815T120000Z-2-cccccccc";

    const entry = readable(
      (
        await buildTrashIndex(
          [blob(`${TRASH_DIR}/${id}/${stored}/${inner}`, "sha-c")],
          keyring,
        )
      )[0],
    );

    expect(entry.kind).toBe("folder");
    expect(entry.originalPath).toEqual(["A", "B"]);
    expect(entry.storedRoot).toBe(stored);
  });

  it("returns entries oldest first and ignores everything outside the trash", async () => {
    const note = await encryptName(keyring, "Note");
    const listing = [
      blob(`${TRASH_DIR}/20260901T080000Z-1-dddddddd/${note}`, "s1"),
      blob(`${TRASH_DIR}/20260801T080000Z-1-eeeeeeee/${note}`, "s2"),
      blob(`${TRASH_DIR}/20260901T080000Z-1-cccccccc/${note}`, "s3"),
      blob(note, "live"),
      blob(REPO_CONFIG_PATH, "config"),
      blob(`${TRASH_DIR}/stray-file`, "stray"),
    ];

    const entries = await buildTrashIndex(listing, keyring);

    expect(entries.map((e) => e.id)).toEqual([
      "20260801T080000Z-1-eeeeeeee",
      "20260901T080000Z-1-cccccccc",
      "20260901T080000Z-1-dddddddd",
    ]);
  });

  it("skips entries whose id does not parse", async () => {
    const note = await encryptName(keyring, "Note");
    const listing = [
      blob(`${TRASH_DIR}/not-an-entry/${note}`, "s1"),
      blob(`${TRASH_DIR}/20260901T080000Z-0-aaaaaaaa/${note}`, "s2"),
    ];

    expect(await buildTrashIndex(listing, keyring)).toEqual([]);
  });

  it("keeps an entry encrypted with another key, flagged undecryptable", async () => {
    const stored = await encryptPath(otherKeyring, ["Projects", "Ideas"]);
    const path = `${TRASH_DIR}/${NOTE_ID}/${stored}`;

    const entries = await buildTrashIndex([blob(path, "sha")], keyring);

    expect(entries).toEqual([
      {
        id: NOTE_ID,
        deletedAt: Date.UTC(2026, 8, 1, 8, 0, 0),
        undecryptable: true,
        files: [{ storedPath: path, sha: "sha" }],
      },
    ]);
  });

  it("flags entries whose files do not share one root of the id's depth", async () => {
    const a = await encryptName(keyring, "A");
    const b = await encryptName(keyring, "B");
    const shallowId = "20260901T080000Z-3-aaaaaaaa";
    const splitId = "20260901T080000Z-1-bbbbbbbb";
    const listing = [
      blob(`${TRASH_DIR}/${shallowId}/${a}/${b}`, "s1"),
      blob(`${TRASH_DIR}/${splitId}/${a}`, "s2"),
      blob(`${TRASH_DIR}/${splitId}/${b}`, "s3"),
    ];

    const entries = await buildTrashIndex(listing, keyring);

    expect(entries.map((e) => [e.id, e.undecryptable])).toEqual([
      [splitId, true],
      [shallowId, true],
    ]);
    expect(entries[0].files).toHaveLength(2);
  });
});
