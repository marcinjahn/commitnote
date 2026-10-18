export type ImageFormat =
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "bmp"
  | "avif"
  | "heic"
  | "tiff"
  | "ico"
  | "svg";

export interface ImageDimensions {
  width: number;
  height: number;
}

const SVG_SNIFF_LENGTH = 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const AVIF_BRANDS = new Set(["avif", "avis"]);
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "mif1",
  "msf1",
]);

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, i) => bytes[offset + i] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  let text = "";
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[offset + i]);
  return text;
}

function isAsciiWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x0c;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, SVG_SNIFF_LENGTH);
  let start = startsWith(head, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (start < head.length && isAsciiWhitespace(head[start])) start++;
  const text = ascii(head, start, head.length - start).toLowerCase();
  if (text.startsWith("<svg")) return true;
  return (
    (text.startsWith("<?xml") || text.startsWith("<!doctype svg")) &&
    text.includes("<svg")
  );
}

export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  const gifSignature = ascii(bytes, 0, 6);
  if (gifSignature === "GIF87a" || gifSignature === "GIF89a") return "gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "webp";
  }
  if (ascii(bytes, 0, 2) === "BM") return "bmp";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (AVIF_BRANDS.has(brand)) return "avif";
    if (HEIC_BRANDS.has(brand)) return "heic";
    return null;
  }
  if (
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "tiff";
  }
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "ico";
  if (looksLikeSvg(bytes)) return "svg";
  return null;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function validDimensions(width: number, height: number): ImageDimensions | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function readPng(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return null;
  const data = view(bytes);
  return validDimensions(data.getUint32(16), data.getUint32(20));
}

function readGif(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10) return null;
  const data = view(bytes);
  return validDimensions(data.getUint16(6, true), data.getUint16(8, true));
}

function readWebp(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 16) return null;
  const chunk = ascii(bytes, 12, 4);
  const data = view(bytes);
  if (chunk === "VP8 ") {
    if (bytes.length < 30) return null;
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    return validDimensions(
      data.getUint16(26, true) & 0x3fff,
      data.getUint16(28, true) & 0x3fff,
    );
  }
  if (chunk === "VP8L") {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    const bits = data.getUint32(21, true);
    return validDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8X") {
    if (bytes.length < 30) return null;
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return validDimensions(width, height);
  }
  return null;
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function isStandaloneMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

function readJpeg(bytes: Uint8Array): ImageDimensions | null {
  const data = view(bytes);
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 0x00 || marker === 0xda) return null;
    if (isStandaloneMarker(marker)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = data.getUint16(offset);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      if (offset + 7 > bytes.length) return null;
      return validDimensions(
        data.getUint16(offset + 5),
        data.getUint16(offset + 3),
      );
    }
    offset += length;
  }
  return null;
}

function readBmp(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 26) return null;
  const data = view(bytes);
  const headerSize = data.getUint32(14, true);
  if (headerSize === 12) {
    return validDimensions(data.getUint16(18, true), data.getUint16(20, true));
  }
  if (headerSize < 40) return null;
  return validDimensions(
    Math.abs(data.getInt32(18, true)),
    Math.abs(data.getInt32(22, true)),
  );
}

export function readImageDimensions(
  bytes: Uint8Array,
  format: ImageFormat,
): ImageDimensions | null {
  try {
    switch (format) {
      case "png":
        return readPng(bytes);
      case "gif":
        return readGif(bytes);
      case "webp":
        return readWebp(bytes);
      case "jpeg":
        return readJpeg(bytes);
      case "bmp":
        return readBmp(bytes);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
