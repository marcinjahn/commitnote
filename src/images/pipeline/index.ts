import { createBrowserImageCodec } from "./browser-image-codec";
import { processImage, type ImagePipelineResult } from "./image-pipeline";
import type { ImageProfile } from "./image-profile";

export type { ImagePipelineResult, ImageRejection } from "./image-pipeline";
export {
  NOTE_IMAGE_PROFILE,
  SHARE_IMAGE_PROFILE,
  type ImageProfile,
} from "./image-profile";

const codec = createBrowserImageCodec();

export function processImageInBrowser(
  input: Blob,
  profile?: ImageProfile,
): Promise<ImagePipelineResult> {
  return processImage(input, codec, profile);
}
