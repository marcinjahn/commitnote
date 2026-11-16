import { crc32, deflateSync, inflateSync } from "node:zlib";

/** Straight (non-premultiplied) 8-bit RGBA pixels, row by row. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

function predict(
  filter: number,
  left: number,
  up: number,
  upLeft: number,
): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4:
      return paeth(left, up, upLeft);
    default:
      throw new Error(`Unsupported PNG filter type ${filter}`);
  }
}

function unfilter(
  scanlines: Buffer,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = scanlines[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const row = y * stride;
    const previous = row - stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? out[row + i - channels] : 0;
      const up = y > 0 ? out[previous + i] : 0;
      const upLeft = y > 0 && i >= channels ? out[previous + i - channels] : 0;
      const predictor = predict(filter, left, up, upLeft);
      out[row + i] = (scanlines[source + i] + predictor) & 0xff;
    }
  }
  return out;
}

/** Decodes a non-interlaced 8-bit RGB or RGBA PNG, the format screenshots come in. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error("Not a PNG: missing signature");
  }
  let header: Buffer | undefined;
  const data: Buffer[] = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = body;
    else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header) throw new Error("Not a PNG: missing IHDR");
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const [bitDepth, colorType, , , interlace] = header.subarray(8, 13);
  if (
    bitDepth !== 8 ||
    (colorType !== COLOR_TYPE_RGB && colorType !== COLOR_TYPE_RGBA) ||
    interlace !== 0
  ) {
    throw new Error(
      `Unsupported PNG: bit depth ${bitDepth}, color type ${colorType}, interlace ${interlace}`,
    );
  }
  const channels = colorType === COLOR_TYPE_RGBA ? 4 : 3;
  const scanlines = inflateSync(Buffer.concat(data));
  if (scanlines.length !== height * (width * channels + 1)) {
    throw new Error("Corrupt PNG: image data does not match its size");
  }
  const pixels = unfilter(scanlines, width, height, channels);
  if (channels === 4) return { width, height, data: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let source = 0, target = 0; source < pixels.length; source += 3) {
    rgba[target++] = pixels[source];
    rgba[target++] = pixels[source + 1];
    rgba[target++] = pixels[source + 2];
    rgba[target++] = 255;
  }
  return { width, height, data: rgba };
}

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  out.set(body, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** Picks the filter per row by the minimum sum of absolute differences, as libpng does. */
function filterRows(image: RgbaImage): Buffer {
  const channels = 4;
  const stride = image.width * channels;
  const out = Buffer.alloc((stride + 1) * image.height);
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  for (let y = 0; y < image.height; y++) {
    const row = y * stride;
    const previous = row - stride;
    let bestFilter = 0;
    let bestScore = Infinity;
    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const value = image.data[row + i];
        const left = i >= channels ? image.data[row + i - channels] : 0;
        const up = y > 0 ? image.data[previous + i] : 0;
        const upLeft =
          y > 0 && i >= channels ? image.data[previous + i - channels] : 0;
        const predictor = predict(filter, left, up, upLeft);
        const residual = (value - predictor) & 0xff;
        candidate[i] = residual;
        score += residual < 128 ? residual : 256 - residual;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        best.set(candidate);
      }
    }
    out[y * (stride + 1)] = bestFilter;
    out.set(best, y * (stride + 1) + 1);
  }
  return out;
}

/** Encodes an 8-bit RGBA PNG. */
export function encodePng(image: RgbaImage): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.set([8, COLOR_TYPE_RGBA, 0, 0, 0], 8);
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filterRows(image), { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
