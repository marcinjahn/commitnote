import { beforeAll, describe, expect, it } from "vitest";
import { decryptImage, encryptImage } from "../crypto/image-cipher";
import type { Keyring } from "../crypto/keyring";
import { encryptPath } from "../crypto/name-cipher";
import { decryptNote, encryptNote } from "../crypto/note-cipher";
import { commitFiles } from "../forge/fake/in-memory-git-repo";
import type { CommitFileChange, TreeEntry } from "../forge/forge-adapter";
import { gitBlobShaOfBytes } from "../forge/git-blob-sha";
import {
  IMAGE_INDEX_PATH,
  IMAGES_DIR,
  MAIN_BRANCH,
  ORDER_PATH,
  REPO_CONFIG_PATH,
  SHARES_PATH,
  TAGS_PATH,
  TRASH_DIR,
} from "../format/v1";
import { imageFilePath } from "../images/image-id";
import { decryptImageIndex } from "../images/image-index";
import {
  decryptShareIndex,
  encryptShareIndex,
  type ShareEntry,
  type ShareIndex,
} from "../share/share-index";
import { colorTagOf, decryptTagIndex, encryptTagIndex, EMPTY_TAGS } from "../tags/tag-index";
import { planRekey, RekeyPlanError, type RekeyPlan } from "./plan-rekey";
import {
  createRekeyFixture,
  decryptTree,
  FIXTURE_NOTES,
  fixtureImages,
  FOREIGN_TRASH_ID,
  IMAGE_PAYLOAD,
  keyStateOf,
  NEW_PASSPHRASE,
  newRepoConfig,
  OWNED_IMAGE_ID,
  README_TEXT,
  TRASH_ID,
  TRASHED_NOTE,
  type RekeyFixture,
} from "./testing/rekey-fixture";
import { verifyRekey } from "./verify-rekey";

let next: { configText: string; keyring: Keyring };

beforeAll(async () => {
  next = await newRepoConfig(NEW_PASSPHRASE);
});

interface Loaded {
  readonly fixture: RekeyFixture;
  readonly listing: TreeEntry[];
  readonly contents: Map<string, string>;
  readonly imageContents: Map<string, Uint8Array>;
}

const isImageFile = (path: string) => path.startsWith(`${IMAGES_DIR}/`);

async function load(fixture: RekeyFixture): Promise<Loaded> {
  const listing = await fixture.adapter.listTree(fixture.head);
  const contents = new Map<string, string>();
  const imageContents = new Map<string, Uint8Array>();
  for (const entry of listing) {
    if (entry.type !== "blob") continue;
    if (isImageFile(entry.path)) {
      imageContents.set(
        entry.sha,
        await fixture.adapter.readBlobBytes(entry.sha),
      );
    } else {
      contents.set(entry.sha, await fixture.adapter.readBlob(entry.sha));
    }
  }
  return { fixture, listing, contents, imageContents };
}

function plan(loaded: Loaded): Promise<RekeyPlan> {
  return planRekey({
    listing: loaded.listing,
    contents: loaded.contents,
    imageContents: loaded.imageContents,
    oldKeyring: loaded.fixture.oldKeyring,
    newKeyring: next.keyring,
    newConfigText: next.configText,
  });
}

function verify(loaded: Loaded, changes: readonly CommitFileChange[]) {
  return verifyRekey({
    listing: loaded.listing,
    contents: loaded.contents,
    imageContents: loaded.imageContents,
    changes,
    oldKeyring: loaded.fixture.oldKeyring,
    newKeyring: next.keyring,
    newConfigText: next.configText,
  });
}

async function appliedTree(
  loaded: Loaded,
  changes: readonly CommitFileChange[],
): Promise<{
  readonly files: Map<string, string>;
  readonly images: Map<string, Uint8Array>;
  readonly shas: Map<string, string>;
}> {
  const { adapter } = loaded.fixture;
  const result = await adapter.commit({
    parent: loaded.fixture.head,
    changes,
    message: "rekey",
  });
  if (result.kind !== "ok") throw new Error("commit failed");
  const listing = await adapter.listTree(result.head);
  const files = new Map<string, string>();
  const images = new Map<string, Uint8Array>();
  const shas = new Map<string, string>();
  for (const entry of listing) {
    if (entry.type !== "blob") continue;
    shas.set(entry.path, entry.sha);
    if (isImageFile(entry.path)) {
      images.set(entry.path, await adapter.readBlobBytes(entry.sha));
    } else {
      files.set(entry.path, await adapter.readBlob(entry.sha));
    }
  }
  return { files, images, shas };
}

async function applied(
  loaded: Loaded,
  changes: readonly CommitFileChange[],
): Promise<Map<string, string>> {
  return (await appliedTree(loaded, changes)).files;
}

function shareEntry(id: string, source: ShareEntry["source"]): ShareEntry {
  return {
    id,
    locator: { provider: "gitlab", snippetId: `snippet-${id}` },
    linkSecret: `secret-${id}`,
    password: id === "a" ? "pw" : null,
    name: `Note ${id}`,
    label: `Label ${id}`,
    sharedAt: "2026-02-01T00:00:00.000Z",
    note: { state: "active", path: ["Welcome"] },
    source,
    updatedAt: id === "b" ? "2026-03-01T00:00:00.000Z" : null,
  };
}

function shareIndexOf(...entries: ShareEntry[]): ShareIndex {
  return {
    writable: true,
    entries: new Map(entries.map((entry) => [entry.id, entry])),
  };
}

describe("planRekey", () => {
  it("re-encrypts every name and body so the tree reads the same with the new key only", async () => {
    const loaded = await load(await createRekeyFixture());
    const before = await decryptTree(
      new Map(
        loaded.listing
          .filter((entry) => entry.type === "blob")
          .map((entry) => [entry.path, loaded.contents.get(entry.sha)!]),
      ),
      loaded.fixture.oldKeyring,
    );

    const result = await plan(loaded);
    const after = await applied(loaded, result.changes);

    expect(await decryptTree(after, next.keyring)).toEqual(before);
    expect(
      await keyStateOf(after, loaded.fixture.oldKeyring, next.keyring),
    ).toBe("new");
    expect(after.get(REPO_CONFIG_PATH)).toBe(next.configText);
    expect(after.get("README.md")).toBe(README_TEXT);
  });

  it("summarizes what is re-encrypted and what is carried over", async () => {
    const loaded = await load(await createRekeyFixture());

    const { summary } = await plan(loaded);

    expect(summary).toEqual({
      notes: Object.keys(FIXTURE_NOTES).length,
      folders: 4,
      trashEntries: 1,
      carriedTrashEntries: 1,
      carriedFiles: 1,
      images: 0,
    });
  });

  it("plans nothing for images in a repo without any", async () => {
    const loaded = await load(await createRekeyFixture());

    const result = await plan(loaded);

    expect(result.changes.map((change) => change.kind)).not.toContain(
      "upsert-bytes",
    );
    expect(
      result.changes.filter(
        (change) =>
          change.path === IMAGE_INDEX_PATH || isImageFile(change.path),
      ),
    ).toEqual([]);
  });

  it("re-encrypts the note order file in place without counting it as a carried file", async () => {
    const orderText = JSON.stringify({
      version: 1,
      folders: { [JSON.stringify([])]: { Projects: "V" } },
    });
    const loaded = await load(
      await createRekeyFixture({
        extraFiles: async (keyring) => ({
          [ORDER_PATH]: await encryptNote(keyring, orderText),
        }),
      }),
    );

    const result = await plan(loaded);
    const after = await applied(loaded, result.changes);

    expect(result.files.find((file) => file.oldPath === ORDER_PATH)).toMatchObject({
      kind: "order",
      newPath: ORDER_PATH,
    });
    expect(result.summary.carriedFiles).toBe(1);
    expect(await decryptNote(next.keyring, after.get(ORDER_PATH)!)).toBe(orderText);
    expect((await verify(loaded, result.changes)).ok).toBe(true);
  });

  it("re-encrypts the tag index in place without counting it as a carried file", async () => {
    const index = {
      ...EMPTY_TAGS,
      notes: new Map([[JSON.stringify(["Welcome"]), { color: "red" as const }]]),
    };
    const loaded = await load(
      await createRekeyFixture({
        extraFiles: async (keyring) => ({
          [TAGS_PATH]: await encryptTagIndex(keyring, index),
        }),
      }),
    );

    const result = await plan(loaded);
    const after = await applied(loaded, result.changes);

    expect(result.files.find((file) => file.oldPath === TAGS_PATH)).toMatchObject({
      kind: "tags",
      newPath: TAGS_PATH,
    });
    expect(result.summary.carriedFiles).toBe(1);
    const restored = await decryptTagIndex(next.keyring, after.get(TAGS_PATH)!);
    expect(restored.writable).toBe(true);
    expect(colorTagOf(restored, ["Welcome"])).toBe("red");
    expect((await verify(loaded, result.changes)).ok).toBe(true);
  });

  it("carries over a tag index that does not decrypt under the old key", async () => {
    const foreign = (await newRepoConfig("someone else")).keyring;
    const stored = await encryptTagIndex(foreign, EMPTY_TAGS);
    const loaded = await load(
      await createRekeyFixture({
        extraFiles: async () => ({ [TAGS_PATH]: stored }),
      }),
    );

    const result = await plan(loaded);
    const after = await applied(loaded, result.changes);

    expect(result.files.find((file) => file.oldPath === TAGS_PATH)).toMatchObject({
      kind: "tags",
      content: { kind: "unchanged" },
    });
    expect(result.summary.carriedFiles).toBe(1);
    expect(after.get(TAGS_PATH)).toBe(stored);
  });

  it("re-encrypts the share index under the new key and clears every shared version", async () => {
    const index = shareIndexOf(
      shareEntry("a", { commit: "c1", storedPath: "p1", blobSha: "b1" }),
      shareEntry("b", { commit: "c2", storedPath: "p2", blobSha: "b2" }),
    );
    const loaded = await load(
      await createRekeyFixture({
        extraFiles: async (keyring) => ({
          [SHARES_PATH]: await encryptShareIndex(keyring, index),
        }),
      }),
    );

    const result = await plan(loaded);
    const after = await applied(loaded, result.changes);

    expect(result.files.find((file) => file.oldPath === SHARES_PATH)).toMatchObject({
      kind: "shares",
      newPath: SHARES_PATH,
      content: { kind: "text" },
    });
    const restored = await decryptShareIndex(next.keyring, after.get(SHARES_PATH)!);
    expect(restored.writable).toBe(true);
    expect([...restored.entries.values()]).toEqual(
      [...index.entries.values()].map((entry) => ({ ...entry, source: null })),
    );
    expect(restored.entries.get("b")?.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect((await verify(loaded, result.changes)).ok).toBe(true);
  });

  it("carries over a share index that does not decrypt under the old key", async () => {
    const foreign = (await newRepoConfig("someone else")).keyring;
    const stored = await encryptShareIndex(
      foreign,
      shareIndexOf(shareEntry("a", { commit: "c1", storedPath: "p1", blobSha: "b1" })),
    );
    const loaded = await load(
      await createRekeyFixture({
        extraFiles: async () => ({ [SHARES_PATH]: stored }),
      }),
    );

    const result = await plan(loaded);
    const after = await applied(loaded, result.changes);

    expect(result.files.find((file) => file.oldPath === SHARES_PATH)).toMatchObject({
      kind: "shares",
      content: { kind: "unchanged" },
    });
    expect(after.get(SHARES_PATH)).toBe(stored);
    expect((await verify(loaded, result.changes)).ok).toBe(true);
  });

  it("keeps an undecryptable trash entry byte for byte", async () => {
    const loaded = await load(await createRekeyFixture());

    const result = await plan(loaded);

    const foreign = result.files.filter(
      (file) => file.trashEntryId === FOREIGN_TRASH_ID,
    );
    expect(foreign).toHaveLength(1);
    expect(foreign[0].kind).toBe("other");
    expect(foreign[0].newPath).toBe(foreign[0].oldPath);
    expect(foreign[0].content.kind).toBe("unchanged");
    expect(
      result.changes.some((change) => change.path === foreign[0].oldPath),
    ).toBe(false);
  });

  it("re-encrypts a readable trash entry under its unchanged entry id", async () => {
    const loaded = await load(await createRekeyFixture());

    const result = await plan(loaded);
    const after = await decryptTree(
      await applied(loaded, result.changes),
      next.keyring,
    );

    expect(after.get(`${TRASH_DIR}/${TRASH_ID}/${TRASHED_NOTE.name}`)).toBe(
      TRASHED_NOTE.content,
    );
  });

  it("re-encrypts the readable folders above a file whose own name is plaintext", async () => {
    const fixture = await createRekeyFixture({
      extraFiles: async (keyring) => ({
        [`${await encryptPath(keyring, ["Projects"])}/image.png`]: "binary-ish",
      }),
    });
    const loaded = await load(fixture);

    const result = await plan(loaded);
    const after = await applied(loaded, result.changes);

    const decrypted = await decryptTree(after, next.keyring);
    expect(decrypted.get("Projects/image.png")).toBe("binary-ish");
    expect(await keyStateOf(after, fixture.oldKeyring, next.keyring)).toBe(
      "new",
    );
    expect(result.summary.carriedFiles).toBe(2);
  });

  it("refuses a note whose name decrypts but whose body does not", async () => {
    const fixture = await createRekeyFixture({
      extraFiles: async (keyring) => ({
        [await encryptPath(keyring, ["Broken"])]: "v1:not-a-ciphertext",
      }),
    });

    await expect(plan(await load(fixture))).rejects.toEqual(
      new RekeyPlanError("undecryptableNote"),
    );
  });

  it("carries a trashed note with an undecryptable body as an undecryptable entry, renamed to the new key", async () => {
    const fixture = await createRekeyFixture({
      extraFiles: async (keyring) => ({
        [`${TRASH_DIR}/20260903T000000Z-1-cccccccc/${await encryptPath(keyring, ["Broken"])}`]:
          "v1:not-a-ciphertext",
      }),
    });
    const loaded = await load(fixture);

    const result = await plan(loaded);
    const after = await applied(loaded, result.changes);

    expect(result.summary.carriedTrashEntries).toBe(2);
    expect(await keyStateOf(after, fixture.oldKeyring, next.keyring)).toBe(
      "new",
    );
    expect((await verify(loaded, result.changes)).ok).toBe(true);
  });

  it("names no note, path or content in its errors", async () => {
    const fixture = await createRekeyFixture({
      extraFiles: async (keyring) => ({
        [await encryptPath(keyring, ["Secret title"])]: "v1:broken",
      }),
    });

    const error = await plan(await load(fixture)).catch((e: unknown) => e);

    expect(String((error as Error).message)).not.toMatch(/Secret|v1:/);
  });
});

describe("planRekey with images", () => {
  const foreignKeyring = () =>
    newRepoConfig("someone else").then((config) => config.keyring);
  const STRAY_ID = "cccccccccccccccccccccccccc";

  it("re-encrypts every image under its id and records the new files in the index without tombstones", async () => {
    const loaded = await load(
      await createRekeyFixture({ extraFiles: fixtureImages }),
    );

    const result = await plan(loaded);
    const after = await appliedTree(loaded, result.changes);

    expect(result.summary.images).toBe(1);
    expect(result.summary.carriedFiles).toBe(1);
    const imagePath = imageFilePath(OWNED_IMAGE_ID);
    const envelope = after.images.get(imagePath)!;
    expect(await decryptImage(next.keyring, OWNED_IMAGE_ID, envelope)).toEqual(
      IMAGE_PAYLOAD,
    );
    await expect(
      decryptImage(loaded.fixture.oldKeyring, OWNED_IMAGE_ID, envelope),
    ).rejects.toThrow();
    const index = await decryptImageIndex(
      next.keyring,
      after.files.get(IMAGE_INDEX_PATH)!,
    );
    expect(index.writable).toBe(true);
    expect(index.tombstones.size).toBe(0);
    expect([...index.images.keys()]).toEqual([OWNED_IMAGE_ID]);
    expect(index.images.get(OWNED_IMAGE_ID)).toEqual({
      blobSha: after.shas.get(imagePath),
      owners: [{ state: "active", path: ["Welcome"] }],
    });
    expect(
      await keyStateOf(
        after.files,
        loaded.fixture.oldKeyring,
        next.keyring,
        after.images,
      ),
    ).toBe("new");
    expect(await verify(loaded, result.changes)).toEqual({ ok: true });
  });

  it("carries an image that does not decrypt under the old key", async () => {
    const foreign = await foreignKeyring();
    const loaded = await load(
      await createRekeyFixture({
        extraFiles: async (keyring) => ({
          ...(await fixtureImages(keyring)),
          [imageFilePath(STRAY_ID)]: await encryptImage(
            foreign,
            STRAY_ID,
            IMAGE_PAYLOAD,
          ),
        }),
      }),
    );
    const strayPath = imageFilePath(STRAY_ID);
    const straySha = loaded.listing.find(
      (entry) => entry.path === strayPath,
    )!.sha;

    const result = await plan(loaded);
    const after = await appliedTree(loaded, result.changes);

    expect(result.summary).toMatchObject({ images: 1, carriedFiles: 2 });
    expect(result.changes.some((change) => change.path === strayPath)).toBe(
      false,
    );
    expect(after.shas.get(strayPath)).toBe(straySha);
    expect(await verify(loaded, result.changes)).toEqual({ ok: true });
  });

  it("carries a file with an invalid name under the images directory as bytes", async () => {
    const path = `${IMAGES_DIR}/not-an-image-id`;
    const bytes = Uint8Array.of(0xff, 0xfe, 0x00, 0x80);
    const loaded = await load(
      await createRekeyFixture({ extraFiles: async () => ({ [path]: bytes }) }),
    );

    const result = await plan(loaded);
    const after = await appliedTree(loaded, result.changes);

    expect(result.summary).toMatchObject({ images: 0, carriedFiles: 2 });
    expect(result.changes.some((change) => change.path === path)).toBe(false);
    expect(after.images.get(path)).toEqual(bytes);
    expect(await verify(loaded, result.changes)).toEqual({ ok: true });
  });

  it("carries an image index that does not decrypt under the old key", async () => {
    const foreign = await foreignKeyring();
    const loaded = await load(
      await createRekeyFixture({
        extraFiles: async (keyring) => ({
          ...(await fixtureImages(keyring)),
          [IMAGE_INDEX_PATH]: (await fixtureImages(foreign))[
            IMAGE_INDEX_PATH
          ] as string,
        }),
      }),
    );

    const result = await plan(loaded);

    expect(result.summary).toMatchObject({ images: 1, carriedFiles: 2 });
    expect(
      result.changes.some((change) => change.path === IMAGE_INDEX_PATH),
    ).toBe(false);
    expect(await verify(loaded, result.changes)).toEqual({ ok: true });
  });

  it("rejects an image left on the old key", async () => {
    const loaded = await load(
      await createRekeyFixture({ extraFiles: fixtureImages }),
    );
    const result = await plan(loaded);
    const changes = result.changes.filter(
      (change) => change.path !== imageFilePath(OWNED_IMAGE_ID),
    );

    expect(await verify(loaded, changes)).toEqual({
      ok: false,
      failure: "content",
    });
  });

  it("rejects an image that decrypts to a different payload", async () => {
    const loaded = await load(
      await createRekeyFixture({ extraFiles: fixtureImages }),
    );
    const result = await plan(loaded);
    const tampered = await Promise.all(
      result.changes.map(async (change) =>
        change.kind === "upsert-bytes"
          ? {
              ...change,
              bytes: await encryptImage(next.keyring, OWNED_IMAGE_ID, {
                ...IMAGE_PAYLOAD,
                width: 4,
              }),
            }
          : change,
      ),
    );

    expect(await verify(loaded, tampered)).toEqual({
      ok: false,
      failure: "content",
    });
  });

  it("rejects an index whose record does not point at the re-encrypted file", async () => {
    const loaded = await load(
      await createRekeyFixture({ extraFiles: fixtureImages }),
    );
    const result = await plan(loaded);
    const reencrypted = await encryptImage(
      next.keyring,
      OWNED_IMAGE_ID,
      IMAGE_PAYLOAD,
    );
    expect(await gitBlobShaOfBytes(reencrypted)).not.toBe(
      await gitBlobShaOfBytes(
        (
          result.changes.find((change) => change.kind === "upsert-bytes") as {
            bytes: Uint8Array;
          }
        ).bytes,
      ),
    );
    const changes = result.changes.map((change) =>
      change.kind === "upsert-bytes" ? { ...change, bytes: reencrypted } : change,
    );

    expect(await verify(loaded, changes)).toEqual({
      ok: false,
      failure: "content",
    });
  });
});

describe("verifyRekey", () => {
  it("accepts the planned changes", async () => {
    const loaded = await load(await createRekeyFixture());
    const result = await plan(loaded);

    expect(await verify(loaded, result.changes)).toEqual({ ok: true });
  });

  it("rejects changes that leave a note on the old key", async () => {
    const loaded = await load(await createRekeyFixture());
    const result = await plan(loaded);
    const oldWelcome = await encryptPath(loaded.fixture.oldKeyring, ["Welcome"]);
    const newWelcome = await encryptPath(next.keyring, ["Welcome"]);
    const changes = result.changes.filter(
      (change) => change.path !== oldWelcome && change.path !== newWelcome,
    );

    expect(await verify(loaded, changes)).toEqual({
      ok: false,
      failure: "oldKeyName",
    });
  });

  it("rejects a body that does not decrypt to the original text", async () => {
    const loaded = await load(await createRekeyFixture());
    const result = await plan(loaded);
    const welcome = await encryptPath(next.keyring, ["Welcome"]);
    const tampered = await Promise.all(
      result.changes.map(async (change) =>
        change.path === welcome && change.kind === "upsert-text"
          ? {
              ...change,
              text: await encryptNote(next.keyring, "something else"),
            }
          : change,
      ),
    );

    expect(await verify(loaded, tampered)).toEqual({
      ok: false,
      failure: "content",
    });
  });

  it("rejects a dropped file", async () => {
    const loaded = await load(await createRekeyFixture());
    const result = await plan(loaded);
    const changes: CommitFileChange[] = [
      ...result.changes,
      { kind: "delete", path: "README.md" },
    ];

    expect(await verify(loaded, changes)).toEqual({
      ok: false,
      failure: "count",
    });
  });

  it("rejects a file added on top", async () => {
    const loaded = await load(await createRekeyFixture());
    const result = await plan(loaded);
    const changes: CommitFileChange[] = [
      ...result.changes,
      { kind: "upsert-text", path: "extra.md", text: "x" },
    ];

    expect(await verify(loaded, changes)).toEqual({
      ok: false,
      failure: "count",
    });
  });

  it("rejects a file standing where a folder is", async () => {
    const loaded = await load(await createRekeyFixture());
    const result = await plan(loaded);
    const projects = await encryptPath(next.keyring, ["Projects"]);
    const changes: CommitFileChange[] = [
      ...result.changes.filter((change) => change.path !== "README.md"),
      { kind: "delete", path: "README.md" },
      { kind: "upsert-text", path: projects, text: README_TEXT },
    ];

    expect(await verify(loaded, changes)).toEqual({
      ok: false,
      failure: "collision",
    });
  });

  it("rejects a config whose key check does not match the new key", async () => {
    const loaded = await load(await createRekeyFixture());
    const result = await plan(loaded);
    const other = await newRepoConfig("a third passphrase");
    const changes = result.changes.map((change) =>
      change.path === REPO_CONFIG_PATH && change.kind === "upsert-text"
        ? { ...change, text: other.configText }
        : change,
    );

    const outcome = await verifyRekey({
      listing: loaded.listing,
      contents: loaded.contents,
      imageContents: loaded.imageContents,
      changes,
      oldKeyring: loaded.fixture.oldKeyring,
      newKeyring: next.keyring,
      newConfigText: other.configText,
    });

    expect(outcome).toEqual({ ok: false, failure: "keyCheck" });
  });

  it("rejects a config that still matches the old key", async () => {
    const loaded = await load(await createRekeyFixture());

    const outcome = await verifyRekey({
      listing: loaded.listing,
      contents: loaded.contents,
      imageContents: loaded.imageContents,
      changes: [],
      oldKeyring: loaded.fixture.oldKeyring,
      newKeyring: loaded.fixture.oldKeyring,
      newConfigText: loaded.fixture.configText,
    });

    expect(outcome).toEqual({ ok: false, failure: "keyCheck" });
  });
});

describe("planRekey on a config-only repo", () => {
  it("handles a repo holding only the config", async () => {
    const fixture = await createRekeyFixture();
    const repo = fixture.adapter.repo;
    const head = await commitFiles(repo, {
      parent: null,
      files: { [REPO_CONFIG_PATH]: fixture.configText },
      message: "seed",
      branch: MAIN_BRANCH,
    });
    const loaded = await load({ ...fixture, head });

    const result = await plan(loaded);

    expect(result.changes).toEqual([
      { kind: "upsert-text", path: REPO_CONFIG_PATH, text: next.configText },
    ]);
    expect(await verify(loaded, result.changes)).toEqual({ ok: true });
  });
});
