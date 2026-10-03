import { beforeAll, describe, expect, it } from "vitest";
import type { Change, ChangeSet, NotePath } from "../changes/change";
import { encodeChangeSet } from "../changes/encode-change-set";
import { argon2idDirect } from "../crypto/argon2";
import { utf8Encode } from "../crypto/base64";
import { deriveKeyring, type Keyring } from "../crypto/keyring";
import { encryptPath } from "../crypto/name-cipher";
import { encryptNote } from "../crypto/note-cipher";
import type { RepoConfig } from "../crypto/repo-config";
import type { TreeEntry } from "../forge/forge-adapter";
import { FOLDER_MARKER, REPO_CONFIG_PATH, TRASH_DIR } from "../format/v1";
import { EMPTY_ORDER } from "../order/order-index";
import { buildWorkingTree } from "../sync/working-tree";
import { buildTrashIndex, type TrashEntry } from "../trash/trash-index";
import { buildNoteTree, type NoteTree } from "../tree/note-tree";
import {
  mergeChangeSet,
  type MergeChangeSetResult,
  type MergeNotice,
} from "./merge-change-set";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await deriveKeyring(
    "correct horse battery staple",
    {
      algorithm: "argon2id",
      memoryKiB: 64,
      iterations: 1,
      parallelism: 1,
      salt: Uint8Array.from({ length: 16 }, () => 7),
    },
    argon2idDirect,
  );
});

interface TrashSnapshot {
  /** Original paths; the entry id's depth selects the trashed item. */
  readonly notes?: Readonly<Record<string, string>>;
  readonly folders?: readonly string[];
}

interface Snapshot {
  readonly notes?: Readonly<Record<string, string>>;
  readonly folders?: readonly string[];
  readonly trash?: Readonly<Record<string, TrashSnapshot>>;
}

interface BuiltSnapshot {
  readonly listing: TreeEntry[];
  readonly tree: NoteTree;
  readonly trash: TrashEntry[];
  readonly read: (path: NotePath) => Promise<string>;
}

const fixedRandom = (length: number) => new Uint8Array(length);

function split(path: string): NotePath {
  return path.split("/");
}

async function blobSha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    utf8Encode(text) as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function build(snapshot: Snapshot): Promise<BuiltSnapshot> {
  const notes = snapshot.notes ?? {};
  const folders = new Set<string>(snapshot.folders ?? []);
  for (const path of Object.keys(notes)) {
    const segments = split(path);
    for (let i = 1; i < segments.length; i++) {
      folders.add(segments.slice(0, i).join("/"));
    }
  }
  for (const folder of [...folders]) {
    const segments = split(folder);
    for (let i = 1; i < segments.length; i++) {
      folders.add(segments.slice(0, i).join("/"));
    }
  }

  const listing: TreeEntry[] = [];
  for (const folder of [...folders].sort()) {
    const stored = await encryptPath(keyring, split(folder));
    listing.push({ path: stored, type: "tree", sha: `tree-${folder}` });
    listing.push({
      path: `${stored}/${FOLDER_MARKER}`,
      type: "blob",
      sha: await blobSha(""),
    });
  }
  for (const [path, content] of Object.entries(notes)) {
    const ciphertext = await encryptNote(keyring, content, fixedRandom);
    listing.push({
      path: await encryptPath(keyring, split(path)),
      type: "blob",
      sha: await blobSha(ciphertext),
    });
  }

  for (const [id, entry] of Object.entries(snapshot.trash ?? {})) {
    const depth = Number(id.split("-")[1]);
    const trashFolders = new Set(entry.folders ?? []);
    for (const path of Object.keys(entry.notes ?? {})) {
      const segments = split(path);
      for (let i = depth; i < segments.length; i++) {
        trashFolders.add(segments.slice(0, i).join("/"));
      }
    }
    for (const folder of trashFolders) {
      const stored = await encryptPath(keyring, split(folder));
      listing.push({
        path: `${TRASH_DIR}/${id}/${stored}/${FOLDER_MARKER}`,
        type: "blob",
        sha: await blobSha(""),
      });
    }
    for (const [path, content] of Object.entries(entry.notes ?? {})) {
      const ciphertext = await encryptNote(keyring, content, fixedRandom);
      listing.push({
        path: `${TRASH_DIR}/${id}/${await encryptPath(keyring, split(path))}`,
        type: "blob",
        sha: await blobSha(ciphertext),
      });
    }
  }

  const tree = await buildNoteTree(listing, keyring);
  const trash = await buildTrashIndex(listing, keyring);
  const read = async (path: NotePath): Promise<string> => {
    const content = notes[path.join("/")];
    if (content === undefined) {
      throw new Error(`No note at ${path.join("/")}`);
    }
    return content;
  };
  return { listing, tree, trash, read };
}

const REPO_CONFIG: RepoConfig = {
  formatVersion: 1,
  app: "commitnote",
  cipher: "AES-256-GCM",
  nameScheme: "AES-256-GCM-SIV-HMAC-SHA256/base64url",
  kdf: {
    algorithm: "argon2id",
    memoryKiB: 64,
    iterations: 1,
    parallelism: 1,
    salt: Uint8Array.from({ length: 16 }, () => 7),
  },
  keyCheck: `${"A".repeat(43)}=`,
  createdAt: "2026-01-02T03:04:05.000Z",
};

interface MergeCase {
  readonly name: string;
  readonly base: Snapshot;
  readonly remote: Snapshot;
  readonly changeSet: ChangeSet;
  readonly check: (result: MergeChangeSetResult) => void;
}

async function runCase(mergeCase: MergeCase): Promise<MergeChangeSetResult> {
  const base = await build(mergeCase.base);
  const remote = await build(mergeCase.remote);
  const result = await mergeChangeSet({
    base: base.tree,
    remote: remote.tree,
    changeSet: mergeCase.changeSet,
    baseTrash: base.trash,
    remoteTrash: remote.trash,
    readBaseContent: base.read,
    readRemoteContent: remote.read,
  });
  expect(() =>
    buildWorkingTree(remote.tree, result.changeSet, remote.trash),
  ).not.toThrow();
  await expect(
    encodeChangeSet({
      listing: [
        ...remote.listing,
        { path: REPO_CONFIG_PATH, type: "blob", sha: "sha-config" },
      ],
      changeSet: result.changeSet,
      order: EMPTY_ORDER,
      keyring,
      config: REPO_CONFIG,
    }),
  ).resolves.toBeDefined();
  return result;
}

const createNote = (path: string, content: string): Change => ({
  kind: "create-note",
  path: split(path),
  content,
});
const updateNote = (path: string, content: string): Change => ({
  kind: "update-note",
  path: split(path),
  content,
});
const deleteNote = (path: string): Change => ({
  kind: "delete-note",
  path: split(path),
});
const createFolder = (path: string): Change => ({
  kind: "create-folder",
  path: split(path),
});
const deleteFolder = (path: string): Change => ({
  kind: "delete-folder",
  path: split(path),
});
const renameNote = (from: string, to: string): Change => ({
  kind: "rename-note",
  from: split(from),
  to: split(to),
});
const renameFolder = (from: string, to: string): Change => ({
  kind: "rename-folder",
  from: split(from),
  to: split(to),
});

const trashNote = (path: string, entryId: string): Change => ({
  kind: "trash-note",
  path: split(path),
  entryId,
});
const trashFolder = (path: string, entryId: string): Change => ({
  kind: "trash-folder",
  path: split(path),
  entryId,
});
const restoreTrash = (
  entryId: string,
  to: string,
  target: "note" | "folder",
  subPath = "",
): Change => ({
  kind: "restore-trash",
  entryId,
  subPath: subPath === "" ? [] : split(subPath),
  target,
  to: split(to),
});
const purgeTrash = (...entryIds: string[]): Change => ({
  kind: "purge-trash",
  entryIds,
});

const setOrder = (parent: string, ...positions: [string, string][]): Change => ({
  kind: "set-order",
  parent: parent === "" ? [] : split(parent),
  positions: positions.map(([name, key]) => ({ name, key })),
});

const reorder = (
  moved: string,
  parent: string,
  ...positions: [string, string][]
): Change => ({
  kind: "set-order",
  parent: parent === "" ? [] : split(parent),
  positions: positions.map(([name, key]) => ({ name, key })),
  moved,
});

const entryId = (depth: number, suffix: string): string =>
  `20260930T154358Z-${depth}-${suffix.padEnd(8, "a")}`;
const E1 = entryId(1, "one");
const E2 = entryId(1, "two");
const E1_DEEP = entryId(2, "one");

const FILLER = createNote("filler.md", "filler content");

const BASE_TEXT = "first\nanchor one\nmiddle\nanchor two\nlast";
const MINE_TEXT = "FIRST mine\nanchor one\nmiddle\nanchor two\nlast";
const THEIRS_TEXT = "first\nanchor one\nmiddle\nanchor two\nLAST theirs";
const MERGED_TEXT = "FIRST mine\nanchor one\nmiddle\nanchor two\nLAST theirs";
const THEIRS_OVERLAP = "FIRST theirs\nanchor one\nmiddle\nanchor two\nlast";

const LONG_NAME = "é".repeat(74);

const cases: MergeCase[] = [
  {
    name: "passes the change set through unchanged when the remote did not move",
    base: { notes: { "n.md": BASE_TEXT, "f/x.md": "x" } },
    remote: { notes: { "n.md": BASE_TEXT, "f/x.md": "x" } },
    changeSet: [
      updateNote("n.md", MINE_TEXT),
      createNote("f/y.md", "y"),
      renameNote("f/x.md", "f/z.md"),
      createFolder("g"),
      createFolder("g/h"),
      createNote("g/h/i.md", "i"),
      updateNote("g/h/i.md", "i2"),
      deleteNote("f/y.md"),
      renameFolder("g", "k"),
      renameNote("f/z.md", "k/z.md"),
      deleteFolder("f"),
    ],
    check(result) {
      expect(result.changeSet).toEqual(this.changeSet);
      expect(result.notices).toEqual([]);
      expect(result.conflicts).toEqual([]);
    },
  },
  {
    name: "merges an edit with a remote edit on different lines",
    base: { notes: { "n.md": BASE_TEXT } },
    remote: { notes: { "n.md": THEIRS_TEXT } },
    changeSet: [updateNote("n.md", MINE_TEXT)],
    check(result) {
      expect(result.changeSet).toEqual([updateNote("n.md", MERGED_TEXT)]);
      expect(result.conflicts).toEqual([]);
    },
  },
  {
    name: "holds back overlapping edits as a conflict and still emits other notes",
    base: { notes: { "n.md": BASE_TEXT, "m.md": "m" } },
    remote: { notes: { "n.md": THEIRS_OVERLAP, "m.md": "m" } },
    changeSet: [updateNote("n.md", MINE_TEXT), updateNote("m.md", "m2")],
    check(result) {
      expect(result.changeSet).toEqual([updateNote("m.md", "m2")]);
      expect(result.conflicts).toHaveLength(1);
      const [conflict] = result.conflicts;
      expect(conflict.path).toEqual(["n.md"]);
      expect(conflict.base).toBe(BASE_TEXT);
      expect(conflict.mine).toBe(MINE_TEXT);
      expect(conflict.theirs).toBe(THEIRS_OVERLAP);
      expect(conflict.merged).toContain("<<<<<<< mine");
      expect(conflict.hunks).toEqual([
        { mine: "FIRST mine", base: "first", theirs: "FIRST theirs" },
      ]);
    },
  },
  {
    name: "treats identical edits on both sides as clean",
    base: { notes: { "n.md": BASE_TEXT } },
    remote: { notes: { "n.md": MINE_TEXT } },
    changeSet: [updateNote("n.md", MINE_TEXT)],
    check(result) {
      expect(result.changeSet).toEqual([updateNote("n.md", MINE_TEXT)]);
      expect(result.conflicts).toEqual([]);
    },
  },
  {
    name: "restores an edited note that was deleted remotely",
    base: { notes: { "n.md": BASE_TEXT } },
    remote: {},
    changeSet: [updateNote("n.md", MINE_TEXT)],
    check(result) {
      expect(result.changeSet).toEqual([createNote("n.md", MINE_TEXT)]);
      expect(result.notices).toEqual([
        { kind: "edit-restored", path: ["n.md"] },
      ]);
    },
  },
  {
    name: "restores an edited note that was renamed remotely",
    base: { notes: { "n.md": BASE_TEXT } },
    remote: { notes: { "renamed.md": BASE_TEXT } },
    changeSet: [updateNote("n.md", MINE_TEXT)],
    check(result) {
      expect(result.changeSet).toEqual([createNote("n.md", MINE_TEXT)]);
      expect(result.notices).toEqual([
        { kind: "edit-restored", path: ["n.md"] },
      ]);
    },
  },
  {
    name: "restores an edited note that was moved remotely",
    base: { notes: { "n.md": BASE_TEXT }, folders: ["f"] },
    remote: { notes: { "f/n.md": BASE_TEXT } },
    changeSet: [updateNote("n.md", MINE_TEXT)],
    check(result) {
      expect(result.changeSet).toEqual([createNote("n.md", MINE_TEXT)]);
      expect(result.notices).toEqual([
        { kind: "edit-restored", path: ["n.md"] },
      ]);
    },
  },
  {
    name: "recreates parents of an edited note under a remotely deleted folder",
    base: {
      notes: { "a/b/n.md": BASE_TEXT, "a/b/o.md": "o", "a/c.md": "c" },
    },
    remote: { notes: { "other.md": "other" } },
    changeSet: [
      createFolder("a/b/new"),
      renameNote("a/b/o.md", "a/b/p.md"),
      updateNote("a/b/n.md", MINE_TEXT),
    ],
    check(result) {
      expect(result.changeSet).toEqual([
        createFolder("a"),
        createFolder("a/b"),
        createNote("a/b/n.md", MINE_TEXT),
      ]);
      expect(result.notices).toEqual([
        {
          kind: "rename-skipped",
          from: ["a", "b", "o.md"],
          to: ["a", "b", "p.md"],
          reason: "source-missing",
        },
        { kind: "edit-restored", path: ["a", "b", "n.md"] },
      ]);
    },
  },
  {
    name: "holds back a conflict when both sides created the same note with different texts",
    base: {},
    remote: { notes: { "n.md": "theirs" } },
    changeSet: [createNote("n.md", "mine"), FILLER],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({
        path: ["n.md"],
        base: "",
        mine: "mine",
        theirs: "theirs",
      });
    },
  },
  {
    name: "merges cleanly when both sides created the same note with identical texts",
    base: {},
    remote: { notes: { "n.md": "same" } },
    changeSet: [createNote("n.md", "same")],
    check(result) {
      expect(result.changeSet).toEqual([updateNote("n.md", "same")]);
      expect(result.conflicts).toEqual([]);
    },
  },
  {
    name: "relocates a created note whose path is now a remote folder",
    base: {},
    remote: { notes: { "n/x.md": "x" } },
    changeSet: [createNote("n", "mine"), updateNote("n", "mine 2")],
    check(result) {
      expect(result.changeSet).toEqual([
        createNote("n (conflict)", "mine"),
        updateNote("n (conflict)", "mine 2"),
      ]);
      expect(result.notices).toEqual([
        {
          kind: "relocated",
          from: ["n"],
          to: ["n (conflict)"],
          target: "note",
        },
      ]);
    },
  },
  {
    name: "picks the next free conflict name when the first is taken",
    base: {},
    remote: { notes: { "n/x.md": "x", "n (conflict)": "taken" } },
    changeSet: [createNote("n", "mine")],
    check(result) {
      expect(result.changeSet).toEqual([createNote("n (conflict 2)", "mine")]);
    },
  },
  {
    name: "shortens a long relocated name to fit the name limit",
    base: {},
    remote: { notes: { [`${LONG_NAME}/x.md`]: "x" } },
    changeSet: [createNote(LONG_NAME, "mine")],
    check(result) {
      const expected = `${"é".repeat(69)} (conflict)`;
      expect(utf8Encode(expected).length).toBeLessThanOrEqual(150);
      expect(result.changeSet).toEqual([createNote(expected, "mine")]);
    },
  },
  {
    name: "relocates a created folder whose path is now a remote note, and its notes follow",
    base: {},
    remote: { notes: { f: "remote note" } },
    changeSet: [createFolder("f"), createNote("f/x.md", "x")],
    check(result) {
      expect(result.changeSet).toEqual([
        createFolder("f (conflict)"),
        createNote("f (conflict)/x.md", "x"),
      ]);
      expect(result.notices).toEqual([
        {
          kind: "relocated",
          from: ["f"],
          to: ["f (conflict)"],
          target: "folder",
        },
      ]);
    },
  },
  {
    name: "relocates a missing parent folder whose path is now a remote note",
    base: { notes: { "a/n.md": BASE_TEXT } },
    remote: { notes: { a: "remote note" } },
    changeSet: [updateNote("a/n.md", MINE_TEXT), updateNote("a/n.md", "v2")],
    check(result) {
      expect(result.changeSet).toEqual([
        createFolder("a (conflict)"),
        createNote("a (conflict)/n.md", MINE_TEXT),
        updateNote("a (conflict)/n.md", "v2"),
      ]);
      expect(result.notices).toEqual([
        {
          kind: "relocated",
          from: ["a"],
          to: ["a (conflict)"],
          target: "folder",
        },
        { kind: "edit-restored", path: ["a (conflict)", "n.md"] },
      ]);
    },
  },
  {
    name: "skips a local delete of a remotely edited note",
    base: { notes: { "n.md": BASE_TEXT } },
    remote: { notes: { "n.md": THEIRS_TEXT } },
    changeSet: [deleteNote("n.md"), FILLER],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.notices).toEqual([
        { kind: "delete-skipped", path: ["n.md"], target: "note" },
      ]);
    },
  },
  {
    name: "drops a local delete of a remotely deleted note silently",
    base: { notes: { "n.md": BASE_TEXT } },
    remote: {},
    changeSet: [deleteNote("n.md"), FILLER],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.notices).toEqual([]);
    },
  },
  {
    name: "skips a local folder delete when the remote added a note inside",
    base: { notes: { "f/x.md": "x" } },
    remote: { notes: { "f/x.md": "x", "f/new.md": "new" } },
    changeSet: [deleteFolder("f"), FILLER],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.notices).toEqual([
        { kind: "delete-skipped", path: ["f"], target: "folder" },
      ]);
    },
  },
  {
    name: "drops a local folder delete of a remotely deleted folder silently",
    base: { notes: { "f/x.md": "x" } },
    remote: {},
    changeSet: [deleteFolder("f"), FILLER],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.notices).toEqual([]);
    },
  },
  {
    name: "skips a rename whose target now exists remotely and keeps later edits at the original path",
    base: { notes: { "a.md": BASE_TEXT } },
    remote: { notes: { "a.md": BASE_TEXT, "b.md": "remote b" } },
    changeSet: [renameNote("a.md", "b.md"), updateNote("b.md", MINE_TEXT)],
    check(result) {
      expect(result.changeSet).toEqual([updateNote("a.md", MINE_TEXT)]);
      expect(result.notices).toEqual([
        {
          kind: "rename-skipped",
          from: ["a.md"],
          to: ["b.md"],
          reason: "target-exists",
        },
      ]);
    },
  },
  {
    name: "skips a rename whose source was deleted remotely and restores the edit",
    base: { notes: { "a.md": BASE_TEXT } },
    remote: {},
    changeSet: [renameNote("a.md", "b.md"), updateNote("b.md", MINE_TEXT)],
    check(result) {
      expect(result.changeSet).toEqual([createNote("a.md", MINE_TEXT)]);
      expect(result.notices).toEqual([
        {
          kind: "rename-skipped",
          from: ["a.md"],
          to: ["b.md"],
          reason: "source-missing",
        },
        { kind: "edit-restored", path: ["a.md"] },
      ]);
    },
  },
  {
    name: "moves a remotely edited note with a folder rename and merges a local edit",
    base: { notes: { "f/x.md": BASE_TEXT } },
    remote: { notes: { "f/x.md": THEIRS_TEXT } },
    changeSet: [renameFolder("f", "g"), updateNote("g/x.md", MINE_TEXT)],
    check(result) {
      expect(result.changeSet).toEqual([
        renameFolder("f", "g"),
        updateNote("g/x.md", MERGED_TEXT),
      ]);
      expect(result.conflicts).toEqual([]);
    },
  },
  {
    name: "treats a local folder create as a no-op when the folder exists remotely",
    base: {},
    remote: { notes: { "f/r.md": "r" } },
    changeSet: [createFolder("f"), createNote("f/y.md", "y")],
    check(result) {
      expect(result.changeSet).toEqual([createNote("f/y.md", "y")]);
      expect(result.notices).toEqual([]);
    },
  },
  {
    name: "holds back later changes of a conflicted note",
    base: { notes: { "n.md": BASE_TEXT } },
    remote: { notes: { "n.md": THEIRS_OVERLAP } },
    changeSet: [
      updateNote("n.md", MINE_TEXT),
      renameNote("n.md", "m.md"),
      deleteNote("m.md"),
      FILLER,
    ],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.conflicts.map((c) => c.path)).toEqual([["n.md"]]);
    },
  },
  {
    name: "drops the conflict when a later edit of the same note merges cleanly",
    base: { notes: { "n.md": BASE_TEXT } },
    remote: { notes: { "n.md": THEIRS_OVERLAP } },
    changeSet: [
      updateNote("n.md", MINE_TEXT),
      updateNote("n.md", `${BASE_TEXT} and more`),
    ],
    check(result) {
      expect(result.changeSet).toEqual([
        updateNote(
          "n.md",
          "FIRST theirs\nanchor one\nmiddle\nanchor two\nlast and more",
        ),
      ]);
      expect(result.conflicts).toEqual([]);
    },
  },
  {
    name: "holds back a folder delete containing a conflicted note",
    base: { notes: { "f/n.md": BASE_TEXT } },
    remote: { notes: { "f/n.md": THEIRS_OVERLAP } },
    changeSet: [updateNote("f/n.md", MINE_TEXT), deleteFolder("f"), FILLER],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.conflicts).toHaveLength(1);
      const [conflict] = result.conflicts;
      expect(conflict.path).toEqual(["f", "n.md"]);
      expect(conflict.mine).toBe(MINE_TEXT);
      expect(result.notices).toEqual([]);
    },
  },
  {
    name: "holds back a folder rename containing a conflicted note, and later edits follow the redirect",
    base: { notes: { "f/n.md": BASE_TEXT } },
    remote: { notes: { "f/n.md": THEIRS_OVERLAP } },
    changeSet: [
      updateNote("f/n.md", MINE_TEXT),
      renameFolder("f", "g"),
      updateNote("g/n.md", `${MINE_TEXT} v2`),
      FILLER,
    ],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.conflicts).toHaveLength(1);
      const [conflict] = result.conflicts;
      expect(conflict.path).toEqual(["f", "n.md"]);
      expect(conflict.mine).toBe(`${MINE_TEXT} v2`);
    },
  },
  {
    name: "re-merges a note create landing on a held note's path",
    base: {},
    remote: { notes: { "n.md": "theirs" } },
    changeSet: [
      createNote("n.md", "mine"),
      deleteNote("n.md"),
      createNote("n.md", "mine again"),
      FILLER,
    ],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.conflicts).toHaveLength(1);
      const [conflict] = result.conflicts;
      expect(conflict.path).toEqual(["n.md"]);
      expect(conflict.mine).toBe("mine again");
      expect(conflict.theirs).toBe("theirs");
    },
  },
  {
    name: "passes trash, restore and purge through when the remote did not move",
    base: {
      notes: { "n.md": "n", "f/x.md": "x" },
      trash: { [E2]: { notes: { "old.md": "old" } } },
    },
    remote: {
      notes: { "n.md": "n", "f/x.md": "x" },
      trash: { [E2]: { notes: { "old.md": "old" } } },
    },
    changeSet: [
      trashNote("n.md", E1),
      trashFolder("f", entryId(1, "three")),
      restoreTrash(E1, "back.md", "note"),
      updateNote("back.md", "n2"),
      createFolder("g"),
      restoreTrash(entryId(1, "three"), "g/x.md", "note", "x.md"),
      purgeTrash(E2),
    ],
    check(result) {
      expect(result.changeSet).toEqual(this.changeSet);
      expect(result.notices).toEqual([]);
    },
  },
  {
    name: "skips trashing a remotely edited note and keeps it",
    base: { notes: { "n.md": BASE_TEXT } },
    remote: { notes: { "n.md": THEIRS_TEXT } },
    changeSet: [FILLER, trashNote("n.md", E1)],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.notices).toEqual([
        { kind: "delete-skipped", path: ["n.md"], target: "note" },
      ]);
    },
  },
  {
    name: "skips trashing a folder the remote added a note to",
    base: { notes: { "f/x.md": "x" } },
    remote: { notes: { "f/x.md": "x", "f/new.md": "new" } },
    changeSet: [FILLER, trashFolder("f", E1)],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.notices).toEqual([
        { kind: "delete-skipped", path: ["f"], target: "folder" },
      ]);
    },
  },
  {
    name: "drops trashing a remotely renamed note silently",
    base: { notes: { "n.md": "n" } },
    remote: { notes: { "renamed.md": "n" } },
    changeSet: [FILLER, trashNote("n.md", E1)],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.notices).toEqual([]);
    },
  },
  {
    name: "restoring a skipped trash follows the kept note and merges later edits",
    base: { notes: { "n.md": BASE_TEXT } },
    remote: { notes: { "n.md": THEIRS_TEXT } },
    changeSet: [
      trashNote("n.md", E1),
      restoreTrash(E1, "moved.md", "note"),
      updateNote("moved.md", MINE_TEXT),
    ],
    check(result) {
      expect(result.changeSet).toEqual([updateNote("n.md", MERGED_TEXT)]);
      expect(result.notices).toEqual([
        { kind: "delete-skipped", path: ["n.md"], target: "note" },
      ]);
    },
  },
  {
    name: "re-encodes the entry id depth when the trashed note was redirected",
    base: { notes: { "a.md": "a" } },
    remote: { notes: { "a.md": "a", "d/a.md": "taken" } },
    changeSet: [renameNote("a.md", "d/a.md"), trashNote("d/a.md", E1_DEEP)],
    check(result) {
      expect(result.changeSet).toEqual([trashNote("a.md", E1)]);
    },
  },
  {
    name: "skips restoring an entry purged remotely and keeps later edits",
    base: { trash: { [E1]: { notes: { "n.md": "old" } } } },
    remote: {},
    changeSet: [
      restoreTrash(E1, "back.md", "note"),
      updateNote("back.md", "edited"),
    ],
    check(result) {
      expect(result.changeSet).toEqual([createNote("back.md", "edited")]);
      expect(result.notices).toEqual([
        { kind: "restore-skipped", path: ["n.md"], target: "note" },
        { kind: "edit-restored", path: ["back.md"] },
      ]);
    },
  },
  {
    name: "skips restoring a sub-item restored remotely but restores the rest",
    base: {
      trash: { [E1]: { notes: { "f/a.md": "a", "f/b.md": "b" } } },
    },
    remote: {
      notes: { "a.md": "a" },
      trash: { [E1]: { notes: { "f/b.md": "b" } } },
    },
    changeSet: [
      restoreTrash(E1, "mine-a.md", "note", "a.md"),
      restoreTrash(E1, "f", "folder"),
    ],
    check(result) {
      expect(result.changeSet).toEqual([restoreTrash(E1, "f", "folder")]);
      expect(result.notices).toEqual([
        { kind: "restore-skipped", path: ["f", "a.md"], target: "note" },
      ]);
    },
  },
  {
    name: "relocates a restore whose target is now taken remotely, and later edits follow",
    base: { trash: { [E1]: { notes: { "n.md": "old" } } } },
    remote: {
      notes: { "n.md": "theirs" },
      trash: { [E1]: { notes: { "n.md": "old" } } },
    },
    changeSet: [
      restoreTrash(E1, "n.md", "note"),
      updateNote("n.md", "mine"),
    ],
    check(result) {
      expect(result.changeSet).toEqual([
        restoreTrash(E1, "n.md (conflict)", "note"),
        updateNote("n.md (conflict)", "mine"),
      ]);
      expect(result.notices).toEqual([
        {
          kind: "relocated",
          from: ["n.md"],
          to: ["n.md (conflict)"],
          target: "note",
        },
      ]);
    },
  },
  {
    name: "recreates a restore target folder renamed remotely",
    base: {
      notes: { "f/x.md": "x" },
      trash: { [E1]: { notes: { "n.md": "old" } } },
    },
    remote: {
      notes: { "g/x.md": "x" },
      trash: { [E1]: { notes: { "n.md": "old" } } },
    },
    changeSet: [restoreTrash(E1, "f/n.md", "note"), updateNote("f/n.md", "new")],
    check(result) {
      expect(result.changeSet).toEqual([
        createFolder("f"),
        restoreTrash(E1, "f/n.md", "note"),
        updateNote("f/n.md", "new"),
      ]);
      expect(result.notices).toEqual([]);
    },
  },
  {
    name: "purges only entries still in the remote trash",
    base: {
      trash: {
        [E1]: { notes: { "a.md": "a" } },
        [E2]: { notes: { "b.md": "b" } },
      },
    },
    remote: { trash: { [E1]: { notes: { "a.md": "a" } } } },
    changeSet: [purgeTrash(E1, E2)],
    check(result) {
      expect(result.changeSet).toEqual([purgeTrash(E1)]);
      expect(result.notices).toEqual([]);
    },
  },
  {
    name: "emits no purge when no entry is left remotely",
    base: { trash: { [E2]: { notes: { "b.md": "b" } } } },
    remote: {},
    changeSet: [FILLER, purgeTrash(E2)],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.notices).toEqual([]);
    },
  },
  {
    name: "keeps the positions of items that are still there",
    base: { notes: { "a.md": "a", "f/b.md": "b" } },
    remote: { notes: { "a.md": "a2", "f/b.md": "b" } },
    changeSet: [setOrder("", ["f", "1"], ["a.md", "2"])],
    check(result) {
      expect(result.changeSet).toEqual(this.changeSet);
    },
  },
  {
    name: "drops the position of an item deleted remotely, without a notice",
    base: { notes: { "a.md": "a", "b.md": "b" } },
    remote: { notes: { "a.md": "a" } },
    changeSet: [setOrder("", ["b.md", "1"], ["a.md", "2"])],
    check(result) {
      expect(result.changeSet).toEqual([setOrder("", ["a.md", "2"])]);
      expect(result.notices).toEqual([]);
    },
  },
  {
    name: "keeps the moved item of a reorder that is still there",
    base: { notes: { "a.md": "a", "b.md": "b" } },
    remote: { notes: { "a.md": "a2", "b.md": "b" } },
    changeSet: [reorder("a.md", "", ["b.md", "1"], ["a.md", "2"])],
    check(result) {
      expect(result.changeSet).toEqual(this.changeSet);
    },
  },
  {
    name: "forgets the moved item of a reorder once it is deleted remotely",
    base: { notes: { "a.md": "a", "b.md": "b" } },
    remote: { notes: { "a.md": "a" } },
    changeSet: [reorder("b.md", "", ["b.md", "1"], ["a.md", "2"])],
    check(result) {
      expect(result.changeSet).toEqual([setOrder("", ["a.md", "2"])]);
    },
  },
  {
    name: "drops the positions in a folder deleted remotely, without a notice",
    base: { notes: { "f/x.md": "x" } },
    remote: {},
    changeSet: [FILLER, setOrder("f", ["x.md", "1"])],
    check(result) {
      expect(result.changeSet).toEqual([FILLER]);
      expect(result.notices).toEqual([]);
    },
  },
  {
    name: "positions items in their parent's new place when the parent was relocated",
    base: {},
    remote: { notes: { g: "remote note" } },
    changeSet: [
      createFolder("g"),
      createNote("g/a.md", "a"),
      setOrder("g", ["a.md", "1"]),
    ],
    check(result) {
      expect(result.changeSet).toEqual([
        createFolder("g (conflict)"),
        createNote("g (conflict)/a.md", "a"),
        setOrder("g (conflict)", ["a.md", "1"]),
      ]);
    },
  },
  {
    name: "passes a set-settings change through unchanged without a notice",
    base: { notes: { "n.md": BASE_TEXT } },
    remote: { notes: { "n.md": THEIRS_TEXT } },
    changeSet: [
      { kind: "set-settings", values: { theme: "dark", fontSize: 14 } },
      updateNote("n.md", MINE_TEXT),
    ],
    check(result) {
      expect(result.changeSet).toEqual([
        { kind: "set-settings", values: { theme: "dark", fontSize: 14 } },
        updateNote("n.md", MERGED_TEXT),
      ]);
      expect(result.notices).toEqual([]);
    },
  },
];

describe("mergeChangeSet", () => {
  for (const mergeCase of cases) {
    it(mergeCase.name, async () => {
      mergeCase.check(await runCase(mergeCase));
    });
  }

  it("is deterministic for the same input", async () => {
    for (const mergeCase of cases) {
      expect(await runCase(mergeCase)).toEqual(await runCase(mergeCase));
    }
  });

  it("never loses the final local content of a note", async () => {
    for (const mergeCase of cases) {
      const result = await runCase(mergeCase);
      const baseLines = new Set(
        Object.values(mergeCase.base.notes ?? {}).flatMap((text) =>
          text.split("\n"),
        ),
      );
      const outputs = [
        ...result.changeSet.flatMap((change) =>
          change.kind === "create-note" || change.kind === "update-note"
            ? [change.content]
            : [],
        ),
        ...result.conflicts.map((conflict) => conflict.mine),
      ];
      for (const content of finalLocalContents(mergeCase.changeSet)) {
        const ownLines = content
          .split("\n")
          .filter((line) => !baseLines.has(line));
        const preserved = outputs.some(
          (output) =>
            output === content ||
            ownLines.every((line) => output.split("\n").includes(line)),
        );
        expect(preserved, `${mergeCase.name}: ${content}`).toBe(true);
      }
    }
  });

  it("reports notices only as information alongside the output", async () => {
    const notices: MergeNotice[] = [];
    for (const mergeCase of cases) {
      notices.push(...(await runCase(mergeCase)).notices);
    }
    expect(new Set(notices.map((notice) => notice.kind))).toEqual(
      new Set([
        "edit-restored",
        "delete-skipped",
        "rename-skipped",
        "relocated",
        "restore-skipped",
      ]),
    );
  });
});

function finalLocalContents(changeSet: ChangeSet): string[] {
  const contents = new Map<string, string>();
  const key = (path: NotePath) => path.join("/");
  for (const change of changeSet) {
    switch (change.kind) {
      case "create-note":
      case "update-note":
        contents.set(key(change.path), change.content);
        break;
      case "delete-note":
        contents.delete(key(change.path));
        break;
      case "delete-folder":
        for (const path of [...contents.keys()]) {
          if (path.startsWith(`${key(change.path)}/`)) contents.delete(path);
        }
        break;
      case "rename-note": {
        const content = contents.get(key(change.from));
        contents.delete(key(change.from));
        if (content !== undefined) contents.set(key(change.to), content);
        break;
      }
      case "rename-folder": {
        const from = `${key(change.from)}/`;
        for (const [path, content] of [...contents]) {
          if (path.startsWith(from)) {
            contents.delete(path);
            contents.set(key(change.to) + path.slice(from.length - 1), content);
          }
        }
        break;
      }
      case "create-folder":
        break;
    }
  }
  return [...contents.values()];
}
