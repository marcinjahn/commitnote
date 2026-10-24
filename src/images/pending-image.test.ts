import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptImage,
  ImageDecryptionError,
  type ImagePayload,
} from "../crypto/image-cipher";
import type { Keyring } from "../crypto/keyring";
import { testKeyring } from "../crypto/testing/test-keyring";
import { gitBlobShaOfBytes } from "../forge/git-blob-sha";
import { isImageId } from "./image-id";
import { cloneImage, createPendingImage } from "./pending-image";

const PAYLOAD: ImagePayload = {
  type: "image/webp",
  width: 320,
  height: 200,
  bytes: Uint8Array.from({ length: 300 }, (_, i) => (i * 13) & 0xff),
};

let keyring: Keyring;
let otherKeyring: Keyring;

beforeAll(async () => {
  keyring = await testKeyring();
  otherKeyring = await testKeyring("another passphrase", 9);
});

describe("createPendingImage", () => {
  it("encrypts the payload under a fresh id that decrypts back", async () => {
    const image = await createPendingImage(keyring, PAYLOAD);

    expect(isImageId(image.imageId)).toBe(true);
    expect(image).toMatchObject({ type: "image/webp", width: 320, height: 200 });
    expect(await decryptImage(keyring, image.imageId, image.envelope)).toEqual(
      PAYLOAD,
    );
  });

  it("records the git blob sha of the envelope", async () => {
    const image = await createPendingImage(keyring, PAYLOAD);

    expect(image.blobSha).toBe(await gitBlobShaOfBytes(image.envelope));
  });
});

describe("cloneImage", () => {
  it("re-encrypts the same payload under a new id", async () => {
    const source = await createPendingImage(keyring, PAYLOAD);

    const clone = await cloneImage(keyring, source);

    expect(clone.imageId).not.toBe(source.imageId);
    expect(clone.envelope).not.toEqual(source.envelope);
    expect(clone.blobSha).toBe(await gitBlobShaOfBytes(clone.envelope));
    expect(await decryptImage(keyring, clone.imageId, clone.envelope)).toEqual(
      PAYLOAD,
    );
  });

  it("rejects an envelope it cannot decrypt", async () => {
    const source = await createPendingImage(otherKeyring, PAYLOAD);

    await expect(cloneImage(keyring, source)).rejects.toBeInstanceOf(
      ImageDecryptionError,
    );
  });
});
