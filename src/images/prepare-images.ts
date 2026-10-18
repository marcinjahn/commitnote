import type { Keyring } from "../crypto/keyring";
import type { RandomSource } from "../crypto/random";
import { createPendingImage, type PendingImage } from "./pending-image";
import type {
  ImagePipelineResult,
  ImageRejection,
} from "./pipeline/image-pipeline";
import type { ImageProfile } from "./pipeline/image-profile";

export const MAX_IMAGES_PER_ACTION = 10;

export type ProcessImage = (
  input: Blob,
  profile?: ImageProfile,
) => Promise<ImagePipelineResult>;

export type PrepareImagesOutcome =
  | { readonly kind: "tooMany"; readonly count: number }
  | {
      readonly kind: "prepared";
      readonly images: readonly PendingImage[];
      readonly rejections: readonly ImageRejection[];
      readonly total: number;
    };

export interface PrepareImagesDeps {
  keyring: Keyring;
  process: () => Promise<ProcessImage>;
  profile?: ImageProfile;
  random?: RandomSource;
}

const UNSUPPORTED: ImageRejection = { kind: "unsupported" };

export async function prepareImages(
  files: readonly Blob[],
  deps: PrepareImagesDeps,
): Promise<PrepareImagesOutcome> {
  if (files.length > MAX_IMAGES_PER_ACTION) {
    return { kind: "tooMany", count: files.length };
  }
  const images: PendingImage[] = [];
  const rejections: ImageRejection[] = [];
  if (files.length > 0) {
    const process = await deps.process();
    for (const file of files) {
      try {
        const result = await process(file, deps.profile);
        if (result.ok) {
          images.push(
            await createPendingImage(deps.keyring, result.payload, deps.random),
          );
        } else {
          rejections.push(result.rejection);
        }
      } catch {
        rejections.push(UNSUPPORTED);
      }
    }
  }
  return { kind: "prepared", images, rejections, total: files.length };
}
