import { beforeAll, describe, expect, it } from "vitest";
import { encryptImage } from "../crypto/image-cipher";
import type { Keyring } from "../crypto/keyring";
import { encryptPath } from "../crypto/name-cipher";
import { testKeyring as sharedTestKeyring } from "../crypto/testing/test-keyring";
import type { CommitFileChange, TreeEntry } from "../forge/forge-adapter";
import { gitBlobShaOfBytes } from "../forge/git-blob-sha";
import {
  FOLDER_MARKER,
  IMAGE_INDEX_PATH,
  IMAGES_DIR,
  TRASH_RETENTION_MS,
} from "../format/v1";
import { type ImageId, imageFilePath } from "../images/image-id";
import {
  decryptImageIndex,
  EMPTY_IMAGES,
  type AvailableImage,
  type ImageIndex,
  type ImageOwner,
  type ImageTombstone,
} from "../images/image-index";
import { formatImageReference } from "../images/image-reference";
import { EMPTY_ORDER } from "../order/order-index";
import { EMPTY_SHARES } from "../share/share-index";
import { EMPTY_TAGS } from "../tags/tag-index";
import type { ChangeSet, NotePath } from "./change";
import {
  encodeChangeSet,
  InvalidChangeSetError,
  type EncodedChangeSet,
} from "./encode-change-set";

const ID_A: ImageId = "a".repeat(26);
const ID_B: ImageId = "b".repeat(26);
const ID_C: ImageId = "c".repeat(26);
const ID_D: ImageId = "d".repeat(26);
const ENTRY = "20260101T000000Z-1-aaaaaaaa";
const NOW = Date.UTC(2026, 5, 1);

let keyring: Keyring;
let envelope: Uint8Array;
let sha: string;

beforeAll(async () => {
  keyring = await sharedTestKeyring(undefined, 9);
  envelope = await encryptImage(keyring, ID_A, {
    type: "image/webp",
    width: 2,
    height: 2,
    bytes: Uint8Array.of(1, 2, 3),
  });
  sha = await gitBlobShaOfBytes(envelope);
});

function blob(path: string, blobSha: string): TreeEntry {
  return { path, type: "blob", sha: blobSha };
}

function ref(imageId: ImageId): string {
  return formatImageReference({ imageId, alt: "Cat", width: 2, height: 2 });
}

function active(...path: string[]): ImageOwner {
  return { state: "active", path };
}

function index(
  images: [ImageId, string, ImageOwner[]][],
  tombstones: [ImageId, ImageTombstone][] = [],
): ImageIndex {
  return {
    writable: true,
    images: new Map(
      images.map(([id, blobSha, owners]) => [id, { blobSha, owners }]),
    ),
    tombstones: new Map(tombstones),
  };
}

function encode(input: {
  listing: readonly TreeEntry[];
  changeSet: ChangeSet;
  images?: ImageIndex;
  available?: ReadonlyMap<ImageId, AvailableImage>;
  imageSweep?: { maxFiles: number };
  device?: string | null;
}): Promise<EncodedChangeSet> {
  return encodeChangeSet({
    order: EMPTY_ORDER,
    tags: EMPTY_TAGS,
    shares: EMPTY_SHARES,
    keyring,
    now: NOW,
    ...input,
    device: input.device ?? null,
  });
}

function imageChanges(result: EncodedChangeSet): CommitFileChange[] {
  return result.changes.filter(
    (change) =>
      change.path.startsWith(`${IMAGES_DIR}/`) ||
      change.path === IMAGE_INDEX_PATH,
  );
}

async function writtenIndex(result: EncodedChangeSet): Promise<ImageIndex> {
  const change = result.changes.find((c) => c.path === IMAGE_INDEX_PATH);
  if (change?.kind !== "upsert-text")
    throw new Error("expected an index write");
  return decryptImageIndex(keyring, change.text);
}

async function noteListing(path: NotePath): Promise<TreeEntry[]> {
  return [blob(await encryptPath(keyring, path), "sha-note")];
}

describe("encodeChangeSet: images", () => {
  it("a note without references and no index changes no image files and writes no index", async () => {
    const result = await encode({
      listing: [],
      changeSet: [{ kind: "create-note", path: ["Note"], content: "plain" }],
    });

    expect(result.changes).toHaveLength(1);
    expect(result.consumedImages).toEqual([]);
  });

  it("a hand-typed reference to an unknown image changes nothing image-related", async () => {
    const result = await encode({
      listing: await noteListing(["Note"]),
      changeSet: [{ kind: "update-note", path: ["Note"], content: ref(ID_A) }],
    });

    expect(imageChanges(result)).toEqual([]);
    expect(result.changes).toHaveLength(1);
  });

  it("a new reference to a pending image writes its file and an encrypted index", async () => {
    const content = `Secret text ${ref(ID_A)}`;
    const result = await encode({
      listing: await noteListing(["Secret note"]),
      changeSet: [{ kind: "update-note", path: ["Secret note"], content }],
      available: new Map([
        [ID_A, { kind: "envelope", envelope, blobSha: sha }],
      ]),
      device: "Laptop",
    });

    expect(result.changes).toContainEqual({
      kind: "upsert-bytes",
      path: imageFilePath(ID_A),
      bytes: envelope,
    });
    const stored = result.changes.find((c) => c.path === IMAGE_INDEX_PATH);
    expect(stored?.kind).toBe("upsert-text");
    if (stored?.kind === "upsert-text") expect(stored.text).not.toContain(ID_A);
    expect(await writtenIndex(result)).toEqual(
      index([[ID_A, sha, [active("Secret note")]]]),
    );
    expect(result.consumedImages).toEqual([ID_A]);
    for (const secret of ["Secret", "Cat", ID_A, "Laptop"]) {
      expect(result.message).not.toContain(secret);
    }
  });

  it("removing the last reference deletes the file and leaves a tombstone", async () => {
    const result = await encode({
      listing: [
        ...(await noteListing(["Note"])),
        blob(imageFilePath(ID_A), sha),
        blob(IMAGE_INDEX_PATH, "sha-index"),
      ],
      changeSet: [{ kind: "update-note", path: ["Note"], content: "gone" }],
      images: index([[ID_A, sha, [active("Note")]]]),
    });

    expect(result.changes).toContainEqual({
      kind: "delete",
      path: imageFilePath(ID_A),
    });
    expect(await writtenIndex(result)).toEqual(
      index([], [[ID_A, { blobSha: sha, removedAt: NOW }]]),
    );
  });

  it("re-adding a tombstoned reference revives the file from the tombstone sha", async () => {
    const result = await encode({
      listing: [
        ...(await noteListing(["Note"])),
        blob(IMAGE_INDEX_PATH, "sha-index"),
      ],
      changeSet: [{ kind: "update-note", path: ["Note"], content: ref(ID_A) }],
      images: index([], [[ID_A, { blobSha: sha, removedAt: NOW - 1 }]]),
    });

    expect(result.changes).toContainEqual({
      kind: "upsert-blob",
      path: imageFilePath(ID_A),
      blobSha: sha,
    });
    expect(await writtenIndex(result)).toEqual(
      index([[ID_A, sha, [active("Note")]]]),
    );
    expect(result.consumedImages).toEqual([]);
  });

  it("an available sha revives a file no longer in the index", async () => {
    const result = await encode({
      listing: await noteListing(["Note"]),
      changeSet: [{ kind: "update-note", path: ["Note"], content: ref(ID_A) }],
      available: new Map([[ID_A, { kind: "sha", blobSha: sha }]]),
    });

    expect(result.changes).toContainEqual({
      kind: "upsert-blob",
      path: imageFilePath(ID_A),
      blobSha: sha,
    });
    expect(result.consumedImages).toEqual([ID_A]);
  });

  it("an image still referenced by another note keeps its file", async () => {
    const result = await encode({
      listing: [
        ...(await noteListing(["A"])),
        ...(await noteListing(["B"])),
        blob(imageFilePath(ID_A), sha),
        blob(IMAGE_INDEX_PATH, "sha-index"),
      ],
      changeSet: [{ kind: "update-note", path: ["A"], content: "gone" }],
      images: index([[ID_A, sha, [active("A"), active("B")]]]),
    });

    expect(
      result.changes.filter((c) => c.path.startsWith(`${IMAGES_DIR}/`)),
    ).toEqual([]);
    expect(await writtenIndex(result)).toEqual(
      index([[ID_A, sha, [active("B")]]]),
    );
  });

  describe("structural changes", () => {
    async function folderListing(): Promise<TreeEntry[]> {
      const folder = await encryptPath(keyring, ["F"]);
      return [
        blob(`${folder}/${FOLDER_MARKER}`, "sha-keep"),
        ...(await noteListing(["F", "N"])),
        blob(imageFilePath(ID_A), sha),
        blob(IMAGE_INDEX_PATH, "sha-index"),
      ];
    }
    const owned = () => index([[ID_A, sha, [active("F", "N")]]]);

    it("rename-folder keeps the file and follows the owner", async () => {
      const result = await encode({
        listing: await folderListing(),
        changeSet: [{ kind: "rename-folder", from: ["F"], to: ["G"] }],
        images: owned(),
      });

      expect(
        result.changes.filter((c) => c.path.startsWith(`${IMAGES_DIR}/`)),
      ).toEqual([]);
      expect(await writtenIndex(result)).toEqual(
        index([[ID_A, sha, [active("G", "N")]]]),
      );
    });

    it("moving the note keeps the file and follows the owner", async () => {
      const result = await encode({
        listing: await folderListing(),
        changeSet: [{ kind: "rename-note", from: ["F", "N"], to: ["N"] }],
        images: owned(),
      });

      expect(
        result.changes.filter((c) => c.path.startsWith(`${IMAGES_DIR}/`)),
      ).toEqual([]);
      expect(await writtenIndex(result)).toEqual(
        index([[ID_A, sha, [active("N")]]]),
      );
    });

    it("delete-folder deletes the file", async () => {
      const result = await encode({
        listing: await folderListing(),
        changeSet: [{ kind: "delete-folder", path: ["F"] }],
        images: owned(),
      });

      expect(result.changes).toContainEqual({
        kind: "delete",
        path: imageFilePath(ID_A),
      });
      expect(await writtenIndex(result)).toEqual(
        index([], [[ID_A, { blobSha: sha, removedAt: NOW }]]),
      );
    });
  });

  describe("trash", () => {
    const images = () => index([[ID_A, sha, [active("Note")]]]);
    const trashedIndex = () =>
      index([[ID_A, sha, [{ state: "trashed", entryId: ENTRY, path: [] }]]]);
    async function listing(): Promise<TreeEntry[]> {
      return [
        ...(await noteListing(["Note"])),
        blob(imageFilePath(ID_A), sha),
        blob(IMAGE_INDEX_PATH, "sha-index"),
      ];
    }

    it("trashing keeps the file and purging deletes it", async () => {
      const trashed = await encode({
        listing: await listing(),
        changeSet: [{ kind: "trash-note", path: ["Note"], entryId: ENTRY }],
        images: images(),
      });
      expect(
        trashed.changes.filter((c) => c.path.startsWith(`${IMAGES_DIR}/`)),
      ).toEqual([]);
      expect(await writtenIndex(trashed)).toEqual(trashedIndex());

      const stored = await encryptPath(keyring, ["Note"]);
      const purged = await encode({
        listing: [
          blob(`.commitnote/trash/${ENTRY}/${stored}`, "sha-note"),
          blob(imageFilePath(ID_A), sha),
          blob(IMAGE_INDEX_PATH, "sha-index"),
        ],
        changeSet: [{ kind: "purge-trash", entryIds: [ENTRY] }],
        images: trashedIndex(),
      });
      expect(purged.changes).toContainEqual({
        kind: "delete",
        path: imageFilePath(ID_A),
      });
      expect(await writtenIndex(purged)).toEqual(
        index([], [[ID_A, { blobSha: sha, removedAt: NOW }]]),
      );
    });

    it("trash then restore keeps the file and leaves the index untouched", async () => {
      const result = await encode({
        listing: await listing(),
        changeSet: [
          { kind: "trash-note", path: ["Note"], entryId: ENTRY },
          {
            kind: "restore-trash",
            entryId: ENTRY,
            subPath: [],
            target: "note",
            to: ["Note"],
          },
        ],
        images: images(),
      });

      expect(imageChanges(result)).toEqual([]);
    });
  });

  it("an unreadable index blocks every image change and is not overwritten", async () => {
    const unreadable = await decryptImageIndex(keyring, "garbage");
    expect(unreadable.writable).toBe(false);

    const result = await encode({
      listing: [
        ...(await noteListing(["Note"])),
        blob(imageFilePath(ID_B), "sha-b"),
        blob(IMAGE_INDEX_PATH, "sha-garbage"),
      ],
      changeSet: [{ kind: "update-note", path: ["Note"], content: ref(ID_A) }],
      images: unreadable,
      available: new Map([
        [ID_A, { kind: "envelope", envelope, blobSha: sha }],
      ]),
      imageSweep: { maxFiles: 10 },
    });

    expect(imageChanges(result)).toEqual([]);
    expect(result.consumedImages).toEqual([]);
  });

  it("does not write the index only because tombstones expired", async () => {
    const result = await encode({
      listing: await noteListing(["Note"]),
      changeSet: [{ kind: "update-note", path: ["Note"], content: "x" }],
      images: index(
        [],
        [[ID_B, { blobSha: "sha-b", removedAt: NOW - TRASH_RETENTION_MS }]],
      ),
    });

    expect(imageChanges(result)).toEqual([]);
  });

  it("prunes expired tombstones when the index changes anyway", async () => {
    const result = await encode({
      listing: await noteListing(["Note"]),
      changeSet: [{ kind: "update-note", path: ["Note"], content: ref(ID_A) }],
      images: index(
        [],
        [[ID_B, { blobSha: "sha-b", removedAt: NOW - TRASH_RETENTION_MS }]],
      ),
      available: new Map([[ID_A, { kind: "sha", blobSha: sha }]]),
    });

    expect(await writtenIndex(result)).toEqual(
      index([[ID_A, sha, [active("Note")]]]),
    );
  });

  describe("image sweep", () => {
    const sweepIndex = () =>
      index(
        [[ID_A, sha, [active("Note")]]],
        [
          [ID_B, { blobSha: "sha-b", removedAt: NOW - 1 }],
          [ID_C, { blobSha: "sha-c", removedAt: NOW - TRASH_RETENTION_MS }],
        ],
      );
    const listing = [
      blob(imageFilePath(ID_A), sha),
      blob(imageFilePath(ID_B), "sha-b"),
      blob(imageFilePath(ID_D), "sha-d"),
      blob(`${IMAGES_DIR}/not-an-id`, "sha-x"),
      blob(IMAGE_INDEX_PATH, "sha-index"),
    ];

    it("deletes orphan files, keeps indexed and tombstoned ones, and prunes expired tombstones", async () => {
      const result = await encode({
        listing,
        changeSet: [],
        images: sweepIndex(),
        imageSweep: { maxFiles: 10 },
        device: "Laptop",
      });

      expect(
        result.changes.filter((c) => c.path.startsWith(`${IMAGES_DIR}/`)),
      ).toEqual([
        { kind: "delete", path: imageFilePath(ID_D) },
        { kind: "delete", path: `${IMAGES_DIR}/not-an-id` },
      ]);
      expect(await writtenIndex(result)).toEqual(
        index(
          [[ID_A, sha, [active("Note")]]],
          [[ID_B, { blobSha: "sha-b", removedAt: NOW - 1 }]],
        ),
      );
      const trailers = result.message.split("\n\n")[1].split("\n");
      expect(trailers).toHaveLength(2);
      expect(trailers[0]).toBe("Commitnote-Format: 1");
      expect(trailers[1]).toMatch(/^Commitnote-Device: /);
    });

    it("respects maxFiles", async () => {
      const result = await encode({
        listing,
        changeSet: [],
        images: sweepIndex(),
        imageSweep: { maxFiles: 1 },
      });

      expect(
        result.changes.filter((c) => c.path.startsWith(`${IMAGES_DIR}/`)),
      ).toEqual([{ kind: "delete", path: imageFilePath(ID_D) }]);
    });

    it("produces no changes when there is nothing to sweep", async () => {
      const result = await encode({
        listing: [blob(imageFilePath(ID_A), sha)],
        changeSet: [],
        images: index([[ID_A, sha, [active("Note")]]]),
        imageSweep: { maxFiles: 10 },
      });

      expect(result.changes).toEqual([]);
      expect(result.message).toBe("commitnote: save\n\nCommitnote-Format: 1");
    });

    it("still rejects an empty change set without a sweep", async () => {
      await expect(
        encode({ listing: [], changeSet: [], images: EMPTY_IMAGES }),
      ).rejects.toBeInstanceOf(InvalidChangeSetError);
    });
  });
});
