import { beforeAll, describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import { decryptImage } from "../crypto/image-cipher";
import type { Keyring } from "../crypto/keyring";
import { ForgeError } from "../forge/errors";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { IMAGES_DIR } from "../format/v1";
import { createImageId, type ImageId } from "../images/image-id";
import { type ImageIndex, readImageIndex } from "../images/image-index";
import {
  formatImageReference,
  referencedImageIds,
} from "../images/image-reference";
import { createPendingImage, type PendingImage } from "../images/pending-image";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { createTrashEntryId } from "../trash/trash-entry-id";
import {
  mainContent,
  pushRemote,
  WELCOME,
  welcomeText,
} from "./testing/engine-harness";
import { createTestClock } from "./testing/test-clock";
import { createSyncEngine, type SyncEngine } from "./sync-engine";

const COPY: NotePath = ["Welcome (conflict)"];
const PAYLOAD = {
  type: "image/webp",
  width: 4,
  height: 3,
  bytes: Uint8Array.from({ length: 64 }, (_, i) => i),
} as const;

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly engine: SyncEngine;
}

async function setup(): Promise<Harness> {
  const fake = await createSampleNotesRepoAdapter();
  const clock = createTestClock(1_000_000);
  const engine = createSyncEngine({ adapter: fake, keyring, clock });
  await engine.refresh();
  return { fake, clock, engine };
}

function newImage(): Promise<PendingImage> {
  return createPendingImage(keyring, PAYLOAD);
}

function withReference(text: string, imageId: ImageId): string {
  return `${text}\n\n${formatImageReference({ imageId, alt: "Diagram", width: 4, height: 3 })}\n`;
}

async function indexAtHead(h: Harness): Promise<ImageIndex> {
  return readImageIndex(
    await h.fake.listTree(await h.fake.getHead()),
    keyring,
    (sha) => h.fake.readBlob(sha),
  );
}

async function imageFilesAtHead(h: Harness): Promise<string[]> {
  return (await h.fake.listTree(await h.fake.getHead()))
    .map((entry) => entry.path)
    .filter((path) => path.startsWith(`${IMAGES_DIR}/`));
}

async function committedImage(h: Harness): Promise<PendingImage> {
  const image = await newImage();
  h.engine.addPendingImage(image);
  h.engine.editNote(
    WELCOME,
    withReference(await welcomeText(h.fake), image.imageId),
  );
  expect(await h.engine.flush()).toEqual({ kind: "saved" });
  return image;
}

async function turnWelcomeIntoFolder(h: Harness): Promise<void> {
  await pushRemote(
    h.fake,
    [
      {
        kind: "trash-note",
        path: WELCOME,
        entryId: createTrashEntryId(h.clock.now(), 1),
      },
      { kind: "create-folder", path: WELCOME },
      { kind: "create-note", path: [...WELCOME, "Child"], content: "child" },
    ],
    undefined,
    { now: h.clock.now() },
  );
}

async function decryptedBytes(
  h: Harness,
  imageId: ImageId,
  blobSha: string,
): Promise<Uint8Array> {
  const payload = await decryptImage(
    keyring,
    imageId,
    await h.fake.readBlobBytes(blobSha),
  );
  return payload.bytes;
}

describe("sync engine image clones", () => {
  it("the conflict copy of a relocated note references clones of the images owned remotely", async () => {
    const h = await setup();
    const image = await committedImage(h);
    const edited = `${await welcomeText(h.fake)}\nlocal`;
    await turnWelcomeIntoFolder(h);

    h.engine.editNote(WELCOME, edited);
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    const copy = (await mainContent(h.fake, COPY))!;
    const [cloneId] = referencedImageIds(copy);
    expect(cloneId).toBeDefined();
    expect(cloneId).not.toBe(image.imageId);
    expect(copy).toBe(edited.replace(image.imageId, cloneId!));
    expect((await imageFilesAtHead(h)).length).toBe(2);

    const index = await indexAtHead(h);
    const original = index.images.get(image.imageId)!;
    const clone = index.images.get(cloneId!)!;
    expect(original.owners).toHaveLength(1);
    expect(original.owners[0]).not.toEqual({ state: "active", path: COPY });
    expect(clone.owners).toEqual([{ state: "active", path: COPY }]);
    expect(await decryptedBytes(h, cloneId!, clone.blobSha)).toEqual(
      await decryptedBytes(h, image.imageId, original.blobSha),
    );
    expect(h.engine.getPendingImage(cloneId!)).toBeUndefined();
  });

  it("the conflict copy keeps a reference to an image unknown to the remote index", async () => {
    const h = await setup();
    const unknown = createImageId();
    const edited = withReference(await welcomeText(h.fake), unknown);
    await turnWelcomeIntoFolder(h);

    h.engine.editNote(WELCOME, edited);
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(await mainContent(h.fake, COPY)).toBe(edited);
    expect(await imageFilesAtHead(h)).toEqual([]);
  });

  it("clones a pending image under a new pending id", async () => {
    const h = await setup();
    const image = await newImage();
    h.engine.addPendingImage(image);

    const cloneId = await h.engine.cloneImage(image.imageId);

    expect(cloneId).not.toBeNull();
    expect(cloneId).not.toBe(image.imageId);
    const clone = h.engine.getPendingImage(cloneId!)!;
    expect(
      (await decryptImage(keyring, cloneId!, clone.envelope)).bytes,
    ).toEqual(PAYLOAD.bytes);
  });

  it("clones a committed image under a new pending id", async () => {
    const h = await setup();
    const image = await committedImage(h);

    const cloneId = await h.engine.cloneImage(image.imageId);

    expect(cloneId).not.toBeNull();
    expect(cloneId).not.toBe(image.imageId);
    const clone = h.engine.getPendingImage(cloneId!)!;
    expect(
      (await decryptImage(keyring, cloneId!, clone.envelope)).bytes,
    ).toEqual(PAYLOAD.bytes);
  });

  it("returns null for an unknown image and when the image cannot be read", async () => {
    const h = await setup();
    expect(await h.engine.cloneImage(createImageId())).toBeNull();

    const image = await committedImage(h);
    h.fake.failNext("readBlobBytes", new ForgeError("Server"));
    expect(await h.engine.cloneImage(image.imageId)).toBeNull();
  });
});
