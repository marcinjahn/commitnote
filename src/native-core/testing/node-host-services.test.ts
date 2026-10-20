import { describe, expect, it } from "vitest";
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
});
