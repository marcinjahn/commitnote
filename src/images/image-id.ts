import { encodeBase32 } from "../crypto/base32";
import { type RandomSource, secureRandom } from "../crypto/random";
import { IMAGES_DIR } from "../format/v1";

export type ImageId = string;

export const IMAGE_ID_LENGTH = 26;

const IMAGE_ID_PATTERN = /^[a-z2-7]{26}$/;
const IMAGE_ID_BYTES = 16;

export function isImageId(value: string): value is ImageId {
  return IMAGE_ID_PATTERN.test(value);
}

export function createImageId(random: RandomSource = secureRandom): ImageId {
  return encodeBase32(random(IMAGE_ID_BYTES));
}

export function imageFilePath(imageId: ImageId): string {
  return `${IMAGES_DIR}/${imageId}`;
}

export function imageIdOfPath(path: string): ImageId | null {
  const prefix = `${IMAGES_DIR}/`;
  if (!path.startsWith(prefix)) return null;
  const candidate = path.slice(prefix.length);
  return isImageId(candidate) ? candidate : null;
}
