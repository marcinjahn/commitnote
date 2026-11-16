import type { RgbaImage } from "./png-codec";

const LOBES = 3;

function lanczos(x: number): number {
  if (x === 0) return 1;
  if (Math.abs(x) >= LOBES) return 0;
  const px = Math.PI * x;
  return (LOBES * Math.sin(px) * Math.sin(px / LOBES)) / (px * px);
}

interface Taps {
  readonly first: Int32Array;
  readonly count: Int32Array;
  readonly weights: Float64Array;
  readonly stride: number;
}

/** Normalised Lanczos-3 weights per output pixel, widened by the scale when shrinking. */
function taps(inSize: number, outSize: number): Taps {
  const scale = inSize / outSize;
  const filterScale = Math.max(scale, 1);
  const support = LOBES * filterScale;
  const stride = Math.ceil(support) * 2 + 1;
  const first = new Int32Array(outSize);
  const count = new Int32Array(outSize);
  const weights = new Float64Array(outSize * stride);
  for (let out = 0; out < outSize; out++) {
    const center = (out + 0.5) * scale;
    const start = Math.max(0, Math.floor(center - support));
    const end = Math.min(inSize, Math.ceil(center + support));
    let total = 0;
    for (let i = start; i < end; i++) {
      const weight = lanczos((i + 0.5 - center) / filterScale);
      weights[out * stride + i - start] = weight;
      total += weight;
    }
    for (let i = 0; i < end - start; i++) weights[out * stride + i] /= total;
    first[out] = start;
    count[out] = end - start;
  }
  return { first, count, weights, stride };
}

/**
 * Resizes to the given width, keeping the aspect ratio, with a separable Lanczos-3 filter.
 * Channels are filtered independently, so the source must be opaque for the edges to be exact.
 */
export function resampleToWidth(image: RgbaImage, width: number): RgbaImage {
  if (width === image.width) return image;
  const height = Math.round((image.height * width) / image.width);
  const horizontal = taps(image.width, width);
  const vertical = taps(image.height, height);

  const rows = new Float64Array(width * image.height * 4);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      const base = horizontal.first[x];
      for (let k = 0; k < horizontal.count[x]; k++) {
        const weight = horizontal.weights[x * horizontal.stride + k];
        const source = (y * image.width + base + k) * 4;
        for (let c = 0; c < 4; c++)
          rows[target + c] += weight * image.data[source + c];
      }
    }
  }

  const data = new Uint8Array(width * height * 4);
  const sum = new Float64Array(4);
  for (let y = 0; y < height; y++) {
    const base = vertical.first[y];
    for (let x = 0; x < width; x++) {
      sum.fill(0);
      for (let k = 0; k < vertical.count[y]; k++) {
        const weight = vertical.weights[y * vertical.stride + k];
        const source = ((base + k) * width + x) * 4;
        for (let c = 0; c < 4; c++) sum[c] += weight * rows[source + c];
      }
      const target = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        data[target + c] = Math.min(255, Math.max(0, Math.round(sum[c])));
      }
    }
  }
  return { width, height, data };
}
