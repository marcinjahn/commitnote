import { describe, expect, it } from "vitest";
import type { ImageRejection } from "../../images/pipeline/image-pipeline";
import {
  describeAddingImages,
  describeImageRejection,
  describeImageRejections,
  IMAGE_COUNT_LIMIT_MESSAGE,
} from "./image-messages";

describe("describeImageRejection", () => {
  it.each<[ImageRejection, string]>([
    [{ kind: "notImage" }, "This file is not an image."],
    [{ kind: "unsupported" }, "This image format is not supported."],
    [
      { kind: "tooLarge", limit: "input" },
      "This image is too large. The limit is 25 MB.",
    ],
    [
      { kind: "tooLarge", limit: "gif" },
      "This GIF is too large. The limit is 5 MB.",
    ],
    [
      { kind: "tooManyPixels" },
      "This image has too many pixels. The limit is 50 megapixels.",
    ],
    [
      { kind: "tooLargeAfterCompression" },
      "This image is still too large after compression.",
    ],
  ])("describes %j", (rejection, message) => {
    expect(describeImageRejection(rejection)).toBe(message);
  });
});

describe("describeImageRejections", () => {
  it("returns null without rejections", () => {
    expect(describeImageRejections([], 3)).toBeNull();
  });

  it("describes a single rejection by its reason", () => {
    expect(describeImageRejections([{ kind: "notImage" }], 3)).toBe(
      "This file is not an image.",
    );
  });

  it("summarizes several rejections", () => {
    const two = [{ kind: "notImage" }, { kind: "unsupported" }] as const;
    expect(describeImageRejections(two, 3)).toBe(
      "2 of 3 images could not be added.",
    );
    expect(describeImageRejections([...two, { kind: "tooManyPixels" }], 3)).toBe(
      "3 of 3 images could not be added.",
    );
  });
});

describe("other messages", () => {
  it("states the count limit", () => {
    expect(IMAGE_COUNT_LIMIT_MESSAGE).toBe(
      "You can add up to 10 images at a time.",
    );
  });

  it("describes adding images", () => {
    expect(describeAddingImages(1)).toBe("Adding image…");
    expect(describeAddingImages(2)).toBe("Adding images…");
  });
});
