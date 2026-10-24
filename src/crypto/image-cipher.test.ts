import { beforeAll, describe, expect, it } from "vitest";
import { IMAGE_AAD_PREFIX } from "../format/v1";
import { asBufferSource, utf8Encode } from "./base64";
import {
  ImageDecryptionError,
  type ImagePayload,
  decryptImage,
  encryptImage,
} from "./image-cipher";
import type { Keyring } from "./keyring";
import { padmeLength } from "./padme";
import { testKeyring } from "./testing/test-keyring";

const ID = "a".repeat(26);
const OTHER_ID = "b".repeat(26);

let keyring: Keyring;
let otherKeyring: Keyring;

beforeAll(async () => {
  keyring = await testKeyring();
  otherKeyring = await testKeyring("another passphrase", 9);
});

function payload(
  type: ImagePayload["type"],
  size: number,
): ImagePayload {
  return {
    type,
    width: 640,
    height: 480,
    bytes: Uint8Array.from({ length: size }, (_, i) => (i * 7) & 0xff),
  };
}

async function kindOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImageDecryptionError) return error.kind;
    throw error;
  }
  return undefined;
}

async function sealRaw(
  plaintext: Uint8Array,
  imageId = ID,
): Promise<Uint8Array> {
  const iv = new Uint8Array(12).fill(5);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(iv),
        additionalData: asBufferSource(utf8Encode(IMAGE_AAD_PREFIX + imageId)),
      },
      keyring.contentKey,
      asBufferSource(plaintext),
    ),
  );
  const envelope = new Uint8Array(4 + 12 + ciphertext.length);
  envelope.set([0x43, 0x4e, 0x49, 0x01], 0);
  envelope.set(iv, 4);
  envelope.set(ciphertext, 16);
  return envelope;
}

function plaintextWith(header: string, rest: Uint8Array): Uint8Array {
  const headerBytes = utf8Encode(header);
  const out = new Uint8Array(4 + headerBytes.length + rest.length);
  new DataView(out.buffer).setUint32(0, headerBytes.length, false);
  out.set(headerBytes, 4);
  out.set(rest, 4 + headerBytes.length);
  return out;
}

describe("image envelope", () => {
  it.each(["image/webp", "image/gif"] as const)(
    "round-trips a %s payload",
    async (type) => {
      const original = payload(type, 3000);
      const envelope = await encryptImage(keyring, ID, original);
      expect(await decryptImage(keyring, ID, envelope)).toEqual(original);
    },
  );

  it("round-trips an empty byte payload", async () => {
    const original = payload("image/gif", 0);
    const envelope = await encryptImage(keyring, ID, original);
    expect(await decryptImage(keyring, ID, envelope)).toEqual(original);
  });

  it("pads the plaintext with Padmé", async () => {
    const original = payload("image/webp", 1000);
    const headerLength = utf8Encode(
      JSON.stringify({
        v: 1,
        type: original.type,
        width: original.width,
        height: original.height,
        length: 1000,
      }),
    ).length;
    const envelope = await encryptImage(keyring, ID, original);
    expect(envelope.length).toBe(
      4 + 12 + padmeLength(4 + headerLength + 1000) + 16,
    );
  });

  it("uses a fresh IV for every envelope", async () => {
    const original = payload("image/webp", 100);
    const first = await encryptImage(keyring, ID, original);
    const second = await encryptImage(keyring, ID, original);
    expect(first.slice(4, 16)).not.toEqual(second.slice(4, 16));
  });

  it("rejects a different image id", async () => {
    const envelope = await encryptImage(keyring, ID, payload("image/webp", 50));
    expect(await kindOf(decryptImage(keyring, OTHER_ID, envelope))).toBe("auth");
  });

  it("rejects a different keyring", async () => {
    const envelope = await encryptImage(keyring, ID, payload("image/webp", 50));
    expect(await kindOf(decryptImage(otherKeyring, ID, envelope))).toBe("auth");
  });

  it("rejects a flipped ciphertext byte", async () => {
    const envelope = await encryptImage(keyring, ID, payload("image/webp", 50));
    envelope[20] ^= 1;
    expect(await kindOf(decryptImage(keyring, ID, envelope))).toBe("auth");
  });

  it("rejects a flipped IV byte", async () => {
    const envelope = await encryptImage(keyring, ID, payload("image/webp", 50));
    envelope[5] ^= 1;
    expect(await kindOf(decryptImage(keyring, ID, envelope))).toBe("auth");
  });

  it("rejects the wrong magic", async () => {
    const envelope = await encryptImage(keyring, ID, payload("image/webp", 50));
    envelope[3] = 2;
    expect(await kindOf(decryptImage(keyring, ID, envelope))).toBe("magic");
  });

  it("rejects truncated input", async () => {
    const envelope = await encryptImage(keyring, ID, payload("image/webp", 50));
    expect(await kindOf(decryptImage(keyring, ID, envelope.slice(0, 31)))).toBe(
      "short",
    );
    expect(await kindOf(decryptImage(keyring, ID, new Uint8Array(0)))).toBe(
      "short",
    );
  });

  it("rejects a truncated ciphertext of sufficient length", async () => {
    const envelope = await encryptImage(keyring, ID, payload("image/webp", 50));
    expect(await kindOf(decryptImage(keyring, ID, envelope.slice(0, -1)))).toBe(
      "auth",
    );
  });

  it("keeps error messages free of ids", async () => {
    const envelope = await encryptImage(keyring, ID, payload("image/webp", 50));
    const error = await decryptImage(keyring, OTHER_ID, envelope).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ImageDecryptionError);
    expect((error as Error).message).not.toContain(OTHER_ID);
    expect((error as Error).name).toBe("ImageDecryptionError");
  });

  it("rejects invalid dimensions when encrypting", async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(
        encryptImage(keyring, ID, { ...payload("image/webp", 5), width: bad }),
      ).rejects.toThrow(Error);
      await expect(
        encryptImage(keyring, ID, { ...payload("image/webp", 5), height: bad }),
      ).rejects.toThrow(Error);
    }
  });

  describe("header validation", () => {
    const rest = new Uint8Array(8);
    const valid = {
      v: 1,
      type: "image/webp",
      width: 2,
      height: 3,
      length: 4,
    };

    async function headerKind(header: string, tail = rest) {
      return kindOf(
        decryptImage(keyring, ID, await sealRaw(plaintextWith(header, tail))),
      );
    }

    it("accepts a hand-built valid header", async () => {
      const envelope = await sealRaw(
        plaintextWith(JSON.stringify(valid), rest),
      );
      const result = await decryptImage(keyring, ID, envelope);
      expect(result.bytes).toHaveLength(4);
    });

    it.each([
      ["invalid json", "{nope"],
      ["not an object", "[1]"],
      ["null", "null"],
      ["wrong version", JSON.stringify({ ...valid, v: 2 })],
      ["unknown type", JSON.stringify({ ...valid, type: "image/png" })],
      ["zero width", JSON.stringify({ ...valid, width: 0 })],
      ["fractional height", JSON.stringify({ ...valid, height: 1.5 })],
      ["string width", JSON.stringify({ ...valid, width: "2" })],
      ["negative length", JSON.stringify({ ...valid, length: -1 })],
      ["fractional length", JSON.stringify({ ...valid, length: 1.5 })],
      ["missing length", JSON.stringify({ ...valid, length: undefined })],
      ["length past end", JSON.stringify({ ...valid, length: 9 })],
    ])("rejects %s", async (_label, header) => {
      expect(await headerKind(header)).toBe("header");
    });

    it("rejects a header length past the plaintext", async () => {
      const plaintext = plaintextWith(JSON.stringify(valid), rest);
      new DataView(plaintext.buffer).setUint32(0, plaintext.length, false);
      expect(await kindOf(decryptImage(keyring, ID, await sealRaw(plaintext)))).toBe(
        "header",
      );
    });

    it("rejects a plaintext shorter than the length prefix", async () => {
      expect(
        await kindOf(decryptImage(keyring, ID, await sealRaw(new Uint8Array(2)))),
      ).toBe("header");
    });
  });
});
