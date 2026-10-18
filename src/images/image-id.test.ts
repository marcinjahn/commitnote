import { describe, expect, it } from "vitest";
import {
  IMAGE_ID_LENGTH,
  createImageId,
  imageFilePath,
  imageIdOfPath,
  isImageId,
} from "./image-id";

const fixedRandom = (length: number) =>
  Uint8Array.from({ length }, (_, i) => i);

describe("createImageId", () => {
  it("produces a valid 26 character id", () => {
    const id = createImageId();
    expect(id).toHaveLength(IMAGE_ID_LENGTH);
    expect(isImageId(id)).toBe(true);
  });

  it("is deterministic for a fixed random source", () => {
    expect(createImageId(fixedRandom)).toBe(createImageId(fixedRandom));
    expect(createImageId(fixedRandom)).toBe("aaaqeayeaudaocajbifqydiob4");
  });

  it("differs between calls with the secure source", () => {
    expect(createImageId()).not.toBe(createImageId());
  });
});

describe("isImageId", () => {
  it("accepts only 26 lowercase base32 characters", () => {
    expect(isImageId("a".repeat(26))).toBe(true);
    expect(isImageId("a".repeat(25))).toBe(false);
    expect(isImageId("a".repeat(27))).toBe(false);
    expect(isImageId("A".repeat(26))).toBe(false);
    expect(isImageId("1".repeat(26))).toBe(false);
    expect(isImageId("8".repeat(26))).toBe(false);
  });
});

describe("image paths", () => {
  const id = "a".repeat(26);

  it("builds the file path", () => {
    expect(imageFilePath(id)).toBe(`.commitnote/images/${id}`);
  });

  it("recovers the id from its path", () => {
    expect(imageIdOfPath(imageFilePath(id))).toBe(id);
  });

  it.each([
    `.commitnote/images/${"a".repeat(25)}`,
    `.commitnote/images/${id}/x`,
    `.commitnote/images/${id}.webp`,
    `.commitnote/images/`,
    `.commitnote/image/${id}`,
    `x/.commitnote/images/${id}`,
    id,
  ])("rejects %s", (path) => {
    expect(imageIdOfPath(path)).toBeNull();
  });
});
