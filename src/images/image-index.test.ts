import { beforeAll, describe, expect, it } from "vitest";
import type { Change } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { encryptNote } from "../crypto/note-cipher";
import { testKeyring } from "../crypto/testing/test-keyring";
import type { TreeEntry } from "../forge/forge-adapter";
import { IMAGE_INDEX_PATH, TRASH_RETENTION_MS } from "../format/v1";
import { type ImageId, imageFilePath } from "./image-id";
import {
  type AvailableImage,
  applyChangeToImages,
  decryptImageIndex,
  EMPTY_IMAGES,
  encryptImageIndex,
  findImageIndexEntry,
  type ImageIndex,
  type ImageOwner,
  type ImageRecord,
  type ImageTombstone,
  parseImageIndex,
  planImageSweep,
  pruneExpiredTombstones,
  readImageIndex,
  reconcileNoteImages,
  serializeImageIndex,
} from "./image-index";

const A: ImageId = "a".repeat(26);
const B: ImageId = "b".repeat(26);
const C: ImageId = "c".repeat(26);
const NOW = 1_000_000;

function active(...path: string[]): ImageOwner {
  return { state: "active", path };
}

function trashed(entryId: string, ...path: string[]): ImageOwner {
  return { state: "trashed", entryId, path };
}

function record(blobSha: string, ...owners: ImageOwner[]): ImageRecord {
  return { blobSha, owners };
}

function indexOf(
  images: Record<string, ImageRecord>,
  tombstones: Record<string, ImageTombstone> = {},
): ImageIndex {
  return {
    writable: true,
    images: new Map(Object.entries(images)),
    tombstones: new Map(Object.entries(tombstones)),
  };
}

function owners(index: ImageIndex): Record<string, readonly ImageOwner[]> {
  return Object.fromEntries(
    [...index.images].map(([id, r]) => [id, [...r.owners]]),
  );
}

const unwritable: ImageIndex = {
  ...indexOf({ [A]: record("sa", active("n")) }),
  writable: false,
};

describe("serialization", () => {
  it("serializes deterministically regardless of key and owner order", () => {
    const one = indexOf(
      {
        [B]: record("sb", trashed("e1"), active("x", "y"), active("a")),
        [A]: record("sa", active("n")),
      },
      { [C]: { blobSha: "sc", removedAt: 5 } },
    );
    const two = indexOf(
      {
        [A]: record("sa", active("n")),
        [B]: record(
          "sb",
          active("a"),
          active("x", "y"),
          trashed("e1"),
          active("a"),
        ),
      },
      { [C]: { blobSha: "sc", removedAt: 5 } },
    );
    const text = serializeImageIndex(one);
    expect(serializeImageIndex(two)).toBe(text);
    expect(text).toBe(
      JSON.stringify({
        images: {
          [A]: { blobSha: "sa", owners: [{ path: ["n"], state: "active" }] },
          [B]: {
            blobSha: "sb",
            owners: [
              { entryId: "e1", path: [], state: "trashed" },
              { path: ["a"], state: "active" },
              { path: ["x", "y"], state: "active" },
            ],
          },
        },
        tombstones: { [C]: { blobSha: "sc", removedAt: 5 } },
        version: 1,
      }),
    );
  });

  it("round-trips through parse", () => {
    const index = indexOf(
      { [A]: record("sa", active("f", "n"), trashed("e", "sub", "n")) },
      { [B]: { blobSha: "sb", removedAt: 42 } },
    );
    const parsed = parseImageIndex(serializeImageIndex(index));
    expect(parsed.writable).toBe(true);
    expect(serializeImageIndex(parsed)).toBe(serializeImageIndex(index));
  });

  it.each([
    ["not json", "{"],
    [
      "wrong version",
      JSON.stringify({ images: {}, tombstones: {}, version: 2 }),
    ],
    ["missing images", JSON.stringify({ tombstones: {}, version: 1 })],
    [
      "array tombstones",
      JSON.stringify({ images: {}, tombstones: [], version: 1 }),
    ],
  ])("treats %s as unreadable", (_, text) => {
    const index = parseImageIndex(text);
    expect(index.writable).toBe(false);
    expect(index.images.size).toBe(0);
  });

  it("skips malformed records", () => {
    const good = { blobSha: "s", owners: [{ path: ["n"], state: "active" }] };
    const index = parseImageIndex(
      JSON.stringify({
        images: {
          [A]: good,
          "not-an-id": good,
          [B]: { blobSha: "s", owners: [] },
          [C]: { blobSha: "s", owners: [{ path: [], state: "active" }] },
          ["d".repeat(26)]: {
            blobSha: "s",
            owners: [{ path: [], state: "trashed" }],
          },
          ["e".repeat(26)]: { owners: good.owners },
        },
        tombstones: {
          [A]: { blobSha: "s", removedAt: 1 },
          [B]: { blobSha: "s", removedAt: "1" },
          [C]: { blobSha: "s", removedAt: null },
          bad: { blobSha: "s", removedAt: 1 },
        },
        version: 1,
      }),
    );
    expect(index.writable).toBe(true);
    expect([...index.images.keys()]).toEqual([A]);
    expect([...index.tombstones.keys()]).toEqual([A]);
  });
});

describe("encryption", () => {
  let keyring: Keyring;
  beforeAll(async () => {
    keyring = await testKeyring();
  });

  it("round-trips through encryption", async () => {
    const index = indexOf({ [A]: record("sa", active("n")) });
    const stored = await encryptImageIndex(keyring, index);
    const decrypted = await decryptImageIndex(keyring, stored);
    expect(serializeImageIndex(decrypted)).toBe(serializeImageIndex(index));
  });

  it("is unwritable when it can't be decrypted", async () => {
    const other = await testKeyring("another passphrase");
    const stored = await encryptImageIndex(other, EMPTY_IMAGES);
    expect((await decryptImageIndex(keyring, stored)).writable).toBe(false);
  });

  it("reads the index from the listing", async () => {
    const stored = await encryptImageIndex(
      keyring,
      indexOf({ [A]: record("sa", active("n")) }),
    );
    const listing: TreeEntry[] = [
      { path: ".commitnote", type: "tree", sha: "t" },
      { path: IMAGE_INDEX_PATH, type: "blob", sha: "idx" },
    ];
    expect(findImageIndexEntry(listing)?.sha).toBe("idx");
    const index = await readImageIndex(listing, keyring, async (sha) => {
      expect(sha).toBe("idx");
      return stored;
    });
    expect(owners(index)).toEqual({ [A]: [active("n")] });
  });

  it("is empty when the listing has no index", async () => {
    const index = await readImageIndex([], keyring, () => {
      throw new Error("unexpected read");
    });
    expect(index).toBe(EMPTY_IMAGES);
  });

  it("is unwritable when the decrypted text isn't an index", async () => {
    const stored = await encryptNote(keyring, "nope");
    expect((await decryptImageIndex(keyring, stored)).writable).toBe(false);
  });
});

describe("reconcileNoteImages", () => {
  const envelope = Uint8Array.of(1, 2, 3);
  const pending: AvailableImage = { kind: "envelope", envelope, blobSha: "pa" };

  it("adds a pending image as a write", () => {
    const update = reconcileNoteImages(
      EMPTY_IMAGES,
      ["n"],
      new Set([A]),
      new Map([[A, pending]]),
      NOW,
    );
    expect(owners(update.index)).toEqual({ [A]: [active("n")] });
    expect(update.index.images.get(A)?.blobSha).toBe("pa");
    expect(update.fileChanges).toEqual([
      { kind: "write", imageId: A, envelope },
    ]);
    expect(update.consumed).toEqual([A]);
  });

  it("adds the note as another owner of an existing image", () => {
    const index = indexOf({ [A]: record("sa", active("m")) });
    const update = reconcileNoteImages(
      index,
      ["n"],
      new Set([A]),
      new Map([[A, pending]]),
      NOW,
    );
    expect(owners(update.index)).toEqual({ [A]: [active("m"), active("n")] });
    expect(update.index.images.get(A)?.blobSha).toBe("sa");
    expect(update.fileChanges).toEqual([]);
    expect(update.consumed).toEqual([]);
  });

  it("returns the same index when nothing changes", () => {
    const index = indexOf({ [A]: record("sa", active("n")) });
    const update = reconcileNoteImages(
      index,
      ["n"],
      new Set([A]),
      new Map(),
      NOW,
    );
    expect(update.index).toBe(index);
    expect(update.fileChanges).toEqual([]);
  });

  it("deletes an image when its last owner stops referencing it", () => {
    const index = indexOf({ [A]: record("sa", active("n")) });
    const update = reconcileNoteImages(index, ["n"], new Set(), new Map(), NOW);
    expect(update.index.images.size).toBe(0);
    expect(update.index.tombstones.get(A)).toEqual({
      blobSha: "sa",
      removedAt: NOW,
    });
    expect(update.fileChanges).toEqual([{ kind: "delete", imageId: A }]);
  });

  it("only removes the owner when others remain", () => {
    const index = indexOf({ [A]: record("sa", active("m"), active("n")) });
    const update = reconcileNoteImages(index, ["n"], new Set(), new Map(), NOW);
    expect(owners(update.index)).toEqual({ [A]: [active("m")] });
    expect(update.index.tombstones.size).toBe(0);
    expect(update.fileChanges).toEqual([]);
  });

  it("keeps a trashed owner's claim when the active note at the same path drops the image", () => {
    const index = indexOf({ [A]: record("sa", trashed("e"), active("n")) });
    const update = reconcileNoteImages(index, ["n"], new Set(), new Map(), NOW);
    expect(owners(update.index)).toEqual({ [A]: [trashed("e")] });
    expect(update.fileChanges).toEqual([]);
  });

  it("revives a tombstoned image without an available entry", () => {
    const index = indexOf({}, { [A]: { blobSha: "old", removedAt: 1 } });
    const update = reconcileNoteImages(
      index,
      ["n"],
      new Set([A]),
      new Map(),
      NOW,
    );
    expect(update.index.images.get(A)).toEqual(record("old", active("n")));
    expect(update.index.tombstones.size).toBe(0);
    expect(update.fileChanges).toEqual([
      { kind: "revive", imageId: A, blobSha: "old" },
    ]);
    expect(update.consumed).toEqual([]);
  });

  it("revives a tombstoned image in preference to an available entry, consuming it", () => {
    const index = indexOf({}, { [A]: { blobSha: "old", removedAt: 1 } });
    const update = reconcileNoteImages(
      index,
      ["n"],
      new Set([A]),
      new Map([[A, pending]]),
      NOW,
    );
    expect(update.index.images.get(A)?.blobSha).toBe("old");
    expect(update.fileChanges).toEqual([
      { kind: "revive", imageId: A, blobSha: "old" },
    ]);
    expect(update.consumed).toEqual([A]);
  });

  it("revives an image from a history blob", () => {
    const update = reconcileNoteImages(
      EMPTY_IMAGES,
      ["n"],
      new Set([A]),
      new Map([[A, { kind: "sha", blobSha: "hist" }]]),
      NOW,
    );
    expect(update.index.images.get(A)).toEqual(record("hist", active("n")));
    expect(update.fileChanges).toEqual([
      { kind: "revive", imageId: A, blobSha: "hist" },
    ]);
    expect(update.consumed).toEqual([A]);
  });

  it("leaves an unknown image unresolved", () => {
    const update = reconcileNoteImages(
      EMPTY_IMAGES,
      ["n"],
      new Set([A]),
      new Map(),
      NOW,
    );
    expect(update.index).toBe(EMPTY_IMAGES);
    expect(update.fileChanges).toEqual([]);
    expect(update.consumed).toEqual([]);
  });

  it("counts an id referenced several times once", () => {
    const update = reconcileNoteImages(
      EMPTY_IMAGES,
      ["n"],
      new Set([A, A, B]),
      new Map<ImageId, AvailableImage>([
        [A, pending],
        [B, { kind: "sha", blobSha: "hb" }],
      ]),
      NOW,
    );
    expect(owners(update.index)).toEqual({
      [A]: [active("n")],
      [B]: [active("n")],
    });
    expect(update.fileChanges).toHaveLength(2);
    expect(update.consumed).toEqual([A, B]);
  });

  it("does nothing on an unwritable index", () => {
    const update = reconcileNoteImages(
      unwritable,
      ["n"],
      new Set([B]),
      new Map([[B, pending]]),
      NOW,
    );
    expect(update).toEqual({
      index: unwritable,
      fileChanges: [],
      consumed: [],
    });
  });
});

describe("applyChangeToImages", () => {
  function apply(index: ImageIndex, change: Change) {
    return applyChangeToImages(index, change, NOW);
  }

  it("follows a note rename", () => {
    const index = indexOf({ [A]: record("sa", active("f", "n"), active("g")) });
    const update = apply(index, {
      kind: "rename-note",
      from: ["f", "n"],
      to: ["h", "m"],
    });
    expect(owners(update.index)).toEqual({
      [A]: [active("g"), active("h", "m")],
    });
    expect(update.fileChanges).toEqual([]);
  });

  it("follows a folder rename or move", () => {
    const index = indexOf({
      [A]: record("sa", active("f", "n")),
      [B]: record("sb", active("f", "s", "n")),
      [C]: record("sc", active("fx")),
    });
    const update = apply(index, {
      kind: "rename-folder",
      from: ["f"],
      to: ["p", "g"],
    });
    expect(owners(update.index)).toEqual({
      [A]: [active("p", "g", "n")],
      [B]: [active("p", "g", "s", "n")],
      [C]: [active("fx")],
    });
  });

  it("moves owners to the trash and back", () => {
    const index = indexOf({
      [A]: record("sa", active("f", "n")),
      [B]: record("sb", active("f", "s", "m")),
      [C]: record("sc", active("n")),
    });
    const trashedNote = apply(index, {
      kind: "trash-note",
      path: ["n"],
      entryId: "e1",
    });
    const trashedFolder = apply(trashedNote.index, {
      kind: "trash-folder",
      path: ["f"],
      entryId: "e2",
    });
    expect(owners(trashedFolder.index)).toEqual({
      [A]: [trashed("e2", "n")],
      [B]: [trashed("e2", "s", "m")],
      [C]: [trashed("e1")],
    });
    expect(trashedFolder.fileChanges).toEqual([]);

    const restoredNote = apply(trashedFolder.index, {
      kind: "restore-trash",
      entryId: "e1",
      subPath: [],
      target: "note",
      to: ["back"],
    });
    expect(owners(restoredNote.index)[C]).toEqual([active("back")]);

    const restoredSub = apply(trashedFolder.index, {
      kind: "restore-trash",
      entryId: "e2",
      subPath: ["s"],
      target: "folder",
      to: ["other", "s"],
    });
    expect(owners(restoredSub.index)).toMatchObject({
      [A]: [trashed("e2", "n")],
      [B]: [active("other", "s", "m")],
    });
  });

  it("ignores a restore with no destination", () => {
    const index = indexOf({ [A]: record("sa", trashed("e")) });
    const update = apply(index, {
      kind: "restore-trash",
      entryId: "e",
      subPath: [],
      target: "note",
      to: [],
    });
    expect(update.index).toBe(index);
  });

  it("deletes an image with its only note", () => {
    const index = indexOf({
      [A]: record("sa", active("n")),
      [B]: record("sb", active("m")),
    });
    const update = apply(index, { kind: "delete-note", path: ["n"] });
    expect(owners(update.index)).toEqual({ [B]: [active("m")] });
    expect(update.index.tombstones.get(A)).toEqual({
      blobSha: "sa",
      removedAt: NOW,
    });
    expect(update.fileChanges).toEqual([{ kind: "delete", imageId: A }]);
  });

  it("deletes images whose owners were all in a deleted folder", () => {
    const index = indexOf({
      [A]: record("sa", active("f", "n"), active("f", "s", "m")),
      [B]: record("sb", active("f", "n"), active("g")),
    });
    const update = apply(index, { kind: "delete-folder", path: ["f"] });
    expect(owners(update.index)).toEqual({ [B]: [active("g")] });
    expect(update.fileChanges).toEqual([{ kind: "delete", imageId: A }]);
  });

  it("purges trashed owners", () => {
    const index = indexOf({
      [A]: record("sa", trashed("e1"), trashed("e2", "n")),
      [B]: record("sb", trashed("e1")),
    });
    const update = apply(index, { kind: "purge-trash", entryIds: ["e1"] });
    expect(owners(update.index)).toEqual({ [A]: [trashed("e2", "n")] });
    expect(update.index.tombstones.get(B)).toEqual({
      blobSha: "sb",
      removedAt: NOW,
    });
    expect(update.fileChanges).toEqual([{ kind: "delete", imageId: B }]);
  });

  it.each<Change>([
    { kind: "update-note", path: ["n"], content: "" },
    { kind: "create-folder", path: ["x"] },
    { kind: "rename-note", from: ["zz"], to: ["yy"] },
  ])("leaves the index alone for $kind with no affected owner", (change) => {
    const index = indexOf({ [A]: record("sa", active("n")) });
    const update = apply(index, change);
    expect(update.index).toBe(index);
    expect(update.fileChanges).toEqual([]);
  });

  it("does nothing on an unwritable index", () => {
    const update = apply(unwritable, { kind: "delete-note", path: ["n"] });
    expect(update).toEqual({
      index: unwritable,
      fileChanges: [],
      consumed: [],
    });
  });
});

describe("pruneExpiredTombstones", () => {
  it("drops tombstones once the retention has elapsed", () => {
    const index = indexOf(
      {},
      {
        [A]: { blobSha: "sa", removedAt: NOW - TRASH_RETENTION_MS },
        [B]: { blobSha: "sb", removedAt: NOW - TRASH_RETENTION_MS + 1 },
      },
    );
    const pruned = pruneExpiredTombstones(index, NOW);
    expect([...pruned.tombstones.keys()]).toEqual([B]);
  });

  it("returns the same index when nothing expired", () => {
    const index = indexOf({}, { [A]: { blobSha: "sa", removedAt: NOW } });
    expect(pruneExpiredTombstones(index, NOW)).toBe(index);
  });
});

describe("planImageSweep", () => {
  const index = indexOf(
    { [A]: record("sa", active("n")) },
    { [B]: { blobSha: "sb", removedAt: NOW - TRASH_RETENTION_MS } },
  );
  const orphan1 = imageFilePath(C);
  const orphan2 = imageFilePath("d".repeat(26));
  const invalid = imageFilePath("Not-An-Id");

  it("deletes orphans and invalid names, keeping referenced and tombstoned files", () => {
    const plan = planImageSweep(
      index,
      [orphan2, imageFilePath(A), invalid, imageFilePath(B), orphan1],
      NOW,
      10,
    );
    expect(plan.deletes).toEqual([invalid, orphan1, orphan2]);
    expect(plan.index.tombstones.size).toBe(0);
    expect(plan.index.images).toBe(index.images);
  });

  it("bounds the number of deletes", () => {
    const plan = planImageSweep(index, [orphan2, invalid, orphan1], NOW, 2);
    expect(plan.deletes).toEqual([invalid, orphan1]);
  });

  it("plans nothing for an unwritable index", () => {
    const plan = planImageSweep(unwritable, [orphan1], NOW, 10);
    expect(plan).toEqual({ index: unwritable, deletes: [] });
  });
});
