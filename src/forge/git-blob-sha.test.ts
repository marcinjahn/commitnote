import { describe, expect, it } from "vitest";
import { gitBlobSha, gitBlobShaOfBytes } from "./git-blob-sha";

describe("gitBlobShaOfBytes", () => {
  it("hashes empty content like git", async () => {
    expect(await gitBlobShaOfBytes(new Uint8Array())).toBe(
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
    );
  });

  it("matches gitBlobSha for UTF-8 text", async () => {
    const text = "héllo 世界 🎉";
    expect(await gitBlobShaOfBytes(new TextEncoder().encode(text))).toBe(
      await gitBlobSha(text),
    );
  });
});
