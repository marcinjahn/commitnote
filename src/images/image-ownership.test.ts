import { describe, expect, it } from "vitest";
import type { ImageId } from "./image-id";
import type { ImageIndex } from "./image-index";
import { noteOwnsImage } from "./image-ownership";

const A: ImageId = "a".repeat(26);
const B: ImageId = "b".repeat(26);
const C: ImageId = "c".repeat(26);

const index: ImageIndex = {
  writable: true,
  images: new Map([
    [A, { blobSha: "1", owners: [{ state: "active", path: ["notes", "one.md"] }] }],
    [
      B,
      {
        blobSha: "2",
        owners: [
          { state: "trashed", entryId: "t1", path: ["notes", "one.md"] },
          { state: "active", path: ["other.md"] },
        ],
      },
    ],
  ]),
  tombstones: new Map(),
};

describe("noteOwnsImage", () => {
  it("is true for an active owner at the note path", () => {
    expect(noteOwnsImage(index, ["notes", "one.md"], A)).toBe(true);
  });

  it("is false for another note's path", () => {
    expect(noteOwnsImage(index, ["other.md"], A)).toBe(false);
  });

  it("ignores trashed owners", () => {
    expect(noteOwnsImage(index, ["notes", "one.md"], B)).toBe(false);
    expect(noteOwnsImage(index, ["other.md"], B)).toBe(true);
  });

  it("is false for an unknown image, a draft, or a missing index", () => {
    expect(noteOwnsImage(index, ["notes", "one.md"], C)).toBe(false);
    expect(noteOwnsImage(index, null, A)).toBe(false);
    expect(noteOwnsImage(null, ["notes", "one.md"], A)).toBe(false);
    expect(noteOwnsImage(undefined, ["notes", "one.md"], A)).toBe(false);
  });
});
