import { describe, expect, it } from "vitest";
import { imageFileExtension } from "./image-file-extension";

describe("imageFileExtension", () => {
  it("maps image types to file extensions", () => {
    expect(imageFileExtension("image/webp")).toBe("webp");
    expect(imageFileExtension("image/gif")).toBe("gif");
  });
});
