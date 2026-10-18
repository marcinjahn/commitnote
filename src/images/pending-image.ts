import {
  decryptImage,
  encryptImage,
  type ImagePayload,
  type ImageType,
} from "../crypto/image-cipher";
import type { Keyring } from "../crypto/keyring";
import { type RandomSource, secureRandom } from "../crypto/random";
import { gitBlobShaOfBytes } from "../forge/git-blob-sha";
import { createImageId, type ImageId } from "./image-id";

export interface PendingImage {
  imageId: ImageId;
  envelope: Uint8Array;
  blobSha: string;
  type: ImageType;
  width: number;
  height: number;
}

export async function createPendingImage(
  keyring: Keyring,
  payload: ImagePayload,
  random: RandomSource = secureRandom,
): Promise<PendingImage> {
  const imageId = createImageId(random);
  const envelope = await encryptImage(keyring, imageId, payload, random);
  return {
    imageId,
    envelope,
    blobSha: await gitBlobShaOfBytes(envelope),
    type: payload.type,
    width: payload.width,
    height: payload.height,
  };
}

export async function cloneImage(
  keyring: Keyring,
  source: { imageId: ImageId; envelope: Uint8Array },
  random: RandomSource = secureRandom,
): Promise<PendingImage> {
  const payload = await decryptImage(keyring, source.imageId, source.envelope);
  return createPendingImage(keyring, payload, random);
}
