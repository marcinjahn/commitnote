export const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;

export interface ImageEncodeAttempt {
  readonly maxLongEdge: number;
  readonly quality: number;
}

export interface ImageProfile {
  readonly attempts: readonly ImageEncodeAttempt[];
  readonly maxBytes: number;
  readonly maxGifBytes: number;
}

export const NOTE_IMAGE_PROFILE: ImageProfile = {
  attempts: [
    { maxLongEdge: 2560, quality: 0.85 },
    { maxLongEdge: 2560, quality: 0.7 },
    { maxLongEdge: 1920, quality: 0.7 },
  ],
  maxBytes: 2 * 1024 * 1024,
  maxGifBytes: 5 * 1024 * 1024,
};

export const SHARE_IMAGE_PROFILE: ImageProfile = {
  attempts: [
    { maxLongEdge: 1600, quality: 0.75 },
    { maxLongEdge: 1280, quality: 0.75 },
    { maxLongEdge: 1024, quality: 0.6 },
  ],
  maxBytes: 600 * 1024,
  maxGifBytes: 5 * 1024 * 1024,
};
