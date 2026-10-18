import { beforeAll, describe, expect, it } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import type { CommitRequest } from "../forge/forge-adapter";
import { TRASH_RETENTION_MS } from "../format/v1";
import { findRestorableImages } from "../history/restorable-images";
import { type ImageId, imageFilePath } from "../images/image-id";
import { type ImageIndex, readImageIndex } from "../images/image-index";
import { formatImageReference } from "../images/image-reference";
import { createPendingImage, type PendingImage } from "../images/pending-image";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { IDEAS, mainContent, WELCOME, welcomeText } from "./testing/engine-harness";
import { createTestClock } from "./testing/test-clock";
import { createSyncEngine } from "./sync-engine";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

function newImage(seed: number): Promise<PendingImage> {
  return createPendingImage(keyring, {
    type: "image/webp",
    width: 4,
    height: 3,
    bytes: Uint8Array.from({ length: 64 }, (_, i) => i + seed),
  });
}

function withReference(text: string, imageId: ImageId): string {
  return `${text}\n\n${formatImageReference({ imageId, alt: "Diagram", width: 4, height: 3 })}\n`;
}

describe("restoring images through the sync engine", () => {
  it("revives an image whose tombstone has expired from the old version's tree", async () => {
    const fake: FakeForgeAdapter = await createSampleNotesRepoAdapter();
    const commits: CommitRequest[] = [];
    const clock = createTestClock(1_000_000);
    const engine = createSyncEngine({
      adapter: delegateAdapter(fake, {
        commit: (request) => {
          commits.push(request);
          return fake.commit(request);
        },
      }),
      keyring,
      clock,
    });
    await engine.refresh();
    const head = () => fake.repo.getRef("main")!;
    const indexAtHead = async (): Promise<ImageIndex> =>
      readImageIndex(await fake.listTree(head()), keyring, (sha) =>
        fake.readBlob(sha),
      );

    const original = await welcomeText(fake);
    const image = await newImage(0);
    const withImage = withReference(original, image.imageId);
    engine.addPendingImage(image);
    engine.editNote(WELCOME, withImage);
    expect(await engine.flush()).toEqual({ kind: "saved" });
    const versionWithImage = head();

    engine.editNote(WELCOME, original);
    expect(await engine.flush()).toEqual({ kind: "saved" });
    expect((await indexAtHead()).tombstones.has(image.imageId)).toBe(true);

    clock.advance(TRASH_RETENTION_MS + 60_000);
    const other = await newImage(100);
    engine.addPendingImage(other);
    engine.editNote(
      IDEAS,
      withReference((await mainContent(fake, IDEAS))!, other.imageId),
    );
    expect(await engine.flush()).toEqual({ kind: "saved" });
    const pruned = await indexAtHead();
    expect(pruned.tombstones.has(image.imageId)).toBe(false);
    expect(pruned.images.has(image.imageId)).toBe(false);

    const restorable = findRestorableImages({
      content: withImage,
      images: pruned,
      isPending: (id) => engine.getPendingImage(id) !== undefined,
      versionListing: await fake.listTree(versionWithImage),
    });
    expect(restorable).toEqual(new Map([[image.imageId, image.blobSha]]));

    engine.addRestoredImages(restorable);
    engine.editNote(WELCOME, withImage);
    expect(await engine.flush()).toEqual({ kind: "saved" });

    expect(commits.at(-1)!.changes).toContainEqual({
      kind: "upsert-blob",
      path: imageFilePath(image.imageId),
      blobSha: image.blobSha,
    });
    expect(
      fake.repo.fileAt(head(), imageFilePath(image.imageId)),
    ).toBe(image.blobSha);
    expect((await indexAtHead()).images.get(image.imageId)?.owners).toEqual([
      { state: "active", path: WELCOME },
    ]);
  });
});
