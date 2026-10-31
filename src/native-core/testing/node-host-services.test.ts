import { describe, expect, it } from "vitest";
import {
  readImageDimensions,
  sniffImageFormat,
} from "../../images/pipeline/image-format";
import { SAMPLE_IMAGE_WEBP_BASE64 } from "../../testing/sample-notes-repo/sample-image";
import { createNodeHostServices } from "./node-host-services";

const key = Uint8Array.from({ length: 32 }, (_, index) => index);
const iv = new Uint8Array(12).fill(7);
const aad = new Uint8Array([1, 2, 3]);
const plaintext = new TextEncoder().encode("hello");

function isPlainCopy(bytes: Uint8Array): boolean {
  return (
    Object.getPrototypeOf(bytes) === Uint8Array.prototype &&
    bytes.byteOffset === 0 &&
    bytes.buffer.byteLength === bytes.length
  );
}

describe("Node host services", () => {
  it("re-imports remembered session keys into fresh handles", async () => {
    const host = createNodeHostServices();
    const contentKey = host.crypto.importKey(key, "AES-GCM");
    const macKey = host.crypto.importKey(key, "HMAC-SHA-256");
    const sealed = host.crypto.aesGcmEncrypt(contentKey, iv, aad, plaintext);

    await host.rememberedSession.save({
      repoUrl: "https://github.com/owner/repo",
      coordinates: { forge: "github", owner: "owner", repo: "repo" },
      accessToken: "token",
      keys: {
        contentKey,
        nameKey: contentKey,
        nameIvKey: macKey,
        keyCheckKey: macKey,
      },
    });
    const loaded = await host.rememberedSession.load();

    expect(loaded?.keys.contentKey).not.toBe(contentKey);
    expect(
      host.crypto.aesGcmDecrypt(loaded!.keys.contentKey, iv, aad, sealed),
    ).toEqual(plaintext);
    expect(host.crypto.hmacSha256(loaded!.keys.keyCheckKey, aad)).toEqual(
      host.crypto.hmacSha256(macKey, aad),
    );
    await host.rememberedSession.clear();
    expect(await host.rememberedSession.load()).toBeNull();
  });

  it("returns plain Uint8Array copies and rejects mismatched key handles", () => {
    const host = createNodeHostServices();
    const contentKey = host.crypto.importKey(key, "AES-GCM");
    const sealed = host.crypto.aesGcmEncrypt(contentKey, iv, aad, plaintext);
    expect(isPlainCopy(sealed)).toBe(true);
    expect(isPlainCopy(host.crypto.digest("SHA-1", plaintext))).toBe(true);
    expect(isPlainCopy(host.random.randomBytes(8))).toBe(true);
    expect(() => host.crypto.hmacSha256(contentKey, plaintext)).toThrow();
    sealed[0] ^= 1;
    expect(host.crypto.aesGcmDecrypt(contentKey, iv, aad, sealed)).toBeNull();
  });

  it("hands out each staged image input once", () => {
    const host = createNodeHostServices();
    const bytes = Uint8Array.of(1, 2, 3);
    const input = host.stageInput(bytes, "image/png");
    bytes[0] = 9;
    expect(host.stagedInputs.take(input)).toEqual({
      bytes: Uint8Array.of(1, 2, 3),
      type: "image/png",
    });
    expect(host.stagedInputs.take(input)).toBeNull();
    expect(host.stagedInputs.take("unknown")).toBeNull();
  });

  it("decodes image headers and encodes header-valid, size-dependent lossy WebP", async () => {
    const { imageCodec } = createNodeHostServices();
    const sample = Uint8Array.from(atob(SAMPLE_IMAGE_WEBP_BASE64), (char) =>
      char.charCodeAt(0),
    );
    const decoded = await imageCodec.decode(sample);
    expect(decoded).toMatchObject({ width: 64, height: 48 });

    const small = await imageCodec.encodeWebp(decoded.handle, 20, 10, 0.5);
    expect(small.length).toBe(64);
    const large = await imageCodec.encodeWebp(decoded.handle, 1000, 700, 0.75);
    expect(large.length).toBe(65_625);
    expect(
      await imageCodec.encodeWebp(decoded.handle, 1000, 700, 0.75),
    ).toEqual(large);
    for (const [bytes, width, height] of [
      [small, 20, 10],
      [large, 1000, 700],
    ] as const) {
      expect(sniffImageFormat(bytes)).toBe("webp");
      expect(readImageDimensions(bytes, "webp")).toEqual({ width, height });
      expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(
        bytes.length - 8,
      );
    }

    imageCodec.release(decoded.handle);
    await expect(
      imageCodec.encodeWebp(decoded.handle, 40, 30, 0.5),
    ).rejects.toThrow();
    await expect(imageCodec.encodeWebp("unknown", 40, 30, 0.5)).rejects.toThrow();
    await expect(
      imageCodec.decode(new TextEncoder().encode("not an image")),
    ).rejects.toThrow();
  });
});
