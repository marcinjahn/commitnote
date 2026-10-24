import { describe, expect, it } from "vitest";
import type { TreeEntry } from "../forge/forge-adapter";
import { type ImageId, imageFilePath } from "../images/image-id";
import { EMPTY_IMAGES, type ImageIndex } from "../images/image-index";
import { formatImageReference } from "../images/image-reference";
import { findRestorableImages, needsImageLookup } from "./restorable-images";

const INDEXED: ImageId = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOMBSTONED: ImageId = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const PENDING: ImageId = "cccccccccccccccccccccccccc";
const FOUND: ImageId = "dddddddddddddddddddddddddd";
const ABSENT: ImageId = "eeeeeeeeeeeeeeeeeeeeeeeeee";

function reference(imageId: ImageId): string {
  return formatImageReference({ imageId, alt: "x", width: 4, height: 3 });
}

function textOf(...ids: ImageId[]): string {
  return ids.map(reference).join("\n");
}

const index: ImageIndex = {
  writable: true,
  images: new Map([
    [INDEXED, { blobSha: "sha-indexed", owners: [] }],
  ]),
  tombstones: new Map([[TOMBSTONED, { blobSha: "sha-tomb", removedAt: 1 }]]),
};

const listing: TreeEntry[] = [INDEXED, TOMBSTONED, PENDING, FOUND].map(
  (id) => ({ path: imageFilePath(id), type: "blob", sha: `sha-${id}` }),
);

const isPending = (id: ImageId) => id === PENDING;

describe("findRestorableImages", () => {
  it("maps only missing images that exist in the version tree", () => {
    const result = findRestorableImages({
      content: textOf(INDEXED, TOMBSTONED, PENDING, FOUND, ABSENT),
      images: index,
      isPending,
      versionListing: listing,
    });

    expect(result).toEqual(new Map([[FOUND, `sha-${FOUND}`]]));
  });

  it("ignores tree entries that are not blobs", () => {
    const result = findRestorableImages({
      content: textOf(FOUND),
      images: index,
      isPending,
      versionListing: [
        { path: imageFilePath(FOUND), type: "tree", sha: "tree-sha" },
      ],
    });

    expect(result.size).toBe(0);
  });

  it("finds nothing when the index is not writable", () => {
    const result = findRestorableImages({
      content: textOf(FOUND),
      images: { ...EMPTY_IMAGES, writable: false },
      isPending,
      versionListing: listing,
    });

    expect(result.size).toBe(0);
  });
});

describe("needsImageLookup", () => {
  it("is true when a referenced image is neither indexed, tombstoned nor pending", () => {
    expect(needsImageLookup(textOf(INDEXED, FOUND), index, isPending)).toBe(
      true,
    );
  });

  it("is false when every referenced image is known", () => {
    expect(
      needsImageLookup(textOf(INDEXED, TOMBSTONED, PENDING), index, isPending),
    ).toBe(false);
  });

  it("is false without references", () => {
    expect(needsImageLookup("plain", index, isPending)).toBe(false);
  });
});
