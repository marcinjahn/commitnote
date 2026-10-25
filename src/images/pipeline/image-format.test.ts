import { describe, expect, it } from "vitest";
import {
  type ImageFormat,
  readImageDimensions,
  sniffImageFormat,
} from "./image-format";

const text = (value: string) =>
  Uint8Array.from(value, (char) => char.charCodeAt(0));

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const u16le = (value: number) => Uint8Array.of(value & 0xff, value >> 8);
const u16be = (value: number) => Uint8Array.of(value >> 8, value & 0xff);
const u32be = (value: number) =>
  Uint8Array.of(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
const u32le = (value: number) =>
  Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24);
const u24le = (value: number) =>
  Uint8Array.of(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff);

function png(width: number, height: number): Uint8Array {
  return concat(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    u32be(13),
    text("IHDR"),
    u32be(width),
    u32be(height),
    Uint8Array.of(8, 6, 0, 0, 0),
  );
}

function gif(width: number, height: number): Uint8Array {
  return concat(text("GIF89a"), u16le(width), u16le(height), Uint8Array.of(0, 0, 0), Uint8Array.of(0x3b));
}

function riff(...chunks: Uint8Array[]): Uint8Array {
  const body = concat(text("WEBP"), ...chunks);
  return concat(text("RIFF"), u32le(body.length), body);
}

function webpLossy(width: number, height: number): Uint8Array {
  const payload = concat(
    Uint8Array.of(0, 0, 0, 0x9d, 0x01, 0x2a),
    u16le(width | 0x4000),
    u16le(height | 0x8000),
  );
  return riff(text("VP8 "), u32le(payload.length), payload);
}

function webpLossless(width: number, height: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14);
  const payload = concat(Uint8Array.of(0x2f), u32le(bits), Uint8Array.of(0, 0));
  return riff(text("VP8L"), u32le(payload.length), payload);
}

function webpExtended(width: number, height: number): Uint8Array {
  const payload = concat(
    Uint8Array.of(0, 0, 0, 0),
    u24le(width - 1),
    u24le(height - 1),
  );
  return riff(text("VP8X"), u32le(payload.length), payload);
}

function segment(marker: number, body: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(0xff, marker), u16be(body.length + 2), body);
}

function jpeg(width: number, height: number, marker = 0xc0): Uint8Array {
  return concat(
    Uint8Array.of(0xff, 0xd8),
    segment(0xe1, text("Exif\0\0padding-bytes")),
    Uint8Array.of(0xff, 0xff),
    segment(0xc4, Uint8Array.of(1, 2, 3)),
    segment(marker, concat(Uint8Array.of(8), u16be(height), u16be(width), Uint8Array.of(3, 1, 0x22, 0))),
    Uint8Array.of(0xff, 0xd9),
  );
}

function bmp(width: number, height: number): Uint8Array {
  const header = new Uint8Array(54);
  header.set(text("BM"));
  header.set(u32le(40), 14);
  header.set(u32le(width >>> 0), 18);
  header.set(u32le(height >>> 0), 22);
  return header;
}

const isoBmff = (brand: string) =>
  concat(u32be(24), text("ftyp"), text(brand), u32be(0), text("mif1avif"));

describe("sniffImageFormat", () => {
  const cases: [ImageFormat, Uint8Array][] = [
    ["png", png(1, 1)],
    ["jpeg", Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0)],
    ["gif", text("GIF87a\0\0\0\0")],
    ["gif", gif(1, 1)],
    ["webp", webpLossy(1, 1)],
    ["bmp", bmp(1, 1)],
    ["avif", isoBmff("avif")],
    ["avif", isoBmff("avis")],
    ["heic", isoBmff("heic")],
    ["heic", isoBmff("heix")],
    ["heic", isoBmff("heim")],
    ["heic", isoBmff("heis")],
    ["heic", isoBmff("hevc")],
    ["heic", isoBmff("mif1")],
    ["heic", isoBmff("msf1")],
    ["tiff", Uint8Array.of(0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0)],
    ["tiff", Uint8Array.of(0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8)],
    ["ico", Uint8Array.of(0, 0, 1, 0, 1, 0)],
    ["svg", text("<svg xmlns='http://www.w3.org/2000/svg'/>")],
  ];

  it.each(cases)("recognises %s", (format, bytes) => {
    expect(sniffImageFormat(bytes)).toBe(format);
  });

  it("recognises svg after a BOM and whitespace", () => {
    const bytes = concat(Uint8Array.of(0xef, 0xbb, 0xbf), text(" \n\t<SVG/>"));
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("recognises svg behind an xml prolog or doctype", () => {
    expect(sniffImageFormat(text('<?xml version="1.0"?>\n<!-- c -->\n<svg/>'))).toBe("svg");
    expect(sniffImageFormat(text("<!DOCTYPE svg PUBLIC><svg/>"))).toBe("svg");
  });

  it("does not treat xml without an svg element as svg", () => {
    expect(sniffImageFormat(text('<?xml version="1.0"?><html/>'))).toBeNull();
  });

  it("does not look for svg past the first kilobyte", () => {
    const bytes = text(`<?xml version="1.0"?>${" ".repeat(1100)}<svg/>`);
    expect(sniffImageFormat(bytes)).toBeNull();
  });

  it("returns null for text and unknown data", () => {
    expect(sniffImageFormat(text("just some notes"))).toBeNull();
    expect(sniffImageFormat(new Uint8Array())).toBeNull();
    expect(sniffImageFormat(isoBmff("isom"))).toBeNull();
    expect(sniffImageFormat(Uint8Array.of(0x89, 0x50))).toBeNull();
  });
});

describe("readImageDimensions", () => {
  it("reads png", () => {
    expect(readImageDimensions(png(640, 480), "png")).toEqual({ width: 640, height: 480 });
  });

  it("reads gif", () => {
    expect(readImageDimensions(gif(300, 200), "gif")).toEqual({ width: 300, height: 200 });
  });

  it("reads lossy, lossless and extended webp", () => {
    expect(readImageDimensions(webpLossy(321, 123), "webp")).toEqual({ width: 321, height: 123 });
    expect(readImageDimensions(webpLossless(1000, 16000), "webp")).toEqual({ width: 1000, height: 16000 });
    expect(readImageDimensions(webpExtended(70000, 5), "webp")).toEqual({ width: 70000, height: 5 });
  });

  it("reads jpeg past an APP1 segment, fill bytes and a DHT segment", () => {
    expect(readImageDimensions(jpeg(4000, 3000), "jpeg")).toEqual({ width: 4000, height: 3000 });
    expect(readImageDimensions(jpeg(800, 600, 0xc2), "jpeg")).toEqual({ width: 800, height: 600 });
  });

  it("reads bmp and uses the absolute height of top-down bitmaps", () => {
    expect(readImageDimensions(bmp(20, 10), "bmp")).toEqual({ width: 20, height: 10 });
    expect(readImageDimensions(bmp(20, -10), "bmp")).toEqual({ width: 20, height: 10 });
  });

  it("returns null for formats without header parsing", () => {
    expect(readImageDimensions(isoBmff("avif"), "avif")).toBeNull();
    expect(readImageDimensions(text("<svg/>"), "svg")).toBeNull();
    expect(readImageDimensions(Uint8Array.of(0, 0, 1, 0, 1, 0), "ico")).toBeNull();
  });

  it("returns null for zero dimensions", () => {
    expect(readImageDimensions(png(0, 10), "png")).toBeNull();
    expect(readImageDimensions(gif(10, 0), "gif")).toBeNull();
    expect(readImageDimensions(bmp(0, 5), "bmp")).toBeNull();
  });

  it("returns null for truncated input without throwing", () => {
    const samples: [ImageFormat, Uint8Array][] = [
      ["png", png(5, 5)],
      ["gif", gif(5, 5)],
      ["webp", webpLossy(5, 5)],
      ["webp", webpLossless(5, 5)],
      ["webp", webpExtended(5, 5)],
      ["jpeg", jpeg(5, 5)],
      ["bmp", bmp(5, 5)],
    ];
    for (const [format, bytes] of samples) {
      const minimal = readImageDimensions(bytes, format);
      expect(minimal).not.toBeNull();
      for (let length = 0; length < bytes.length; length++) {
        const result = readImageDimensions(bytes.subarray(0, length), format);
        if (result !== null) expect(result).toEqual(minimal);
      }
    }
    expect(readImageDimensions(png(5, 5).subarray(0, 20), "png")).toBeNull();
    expect(readImageDimensions(jpeg(5, 5).subarray(0, 30), "jpeg")).toBeNull();
    expect(readImageDimensions(webpLossy(5, 5).subarray(0, 28), "webp")).toBeNull();
  });

  it("returns null for a jpeg without a frame header", () => {
    const bytes = concat(Uint8Array.of(0xff, 0xd8), segment(0xe0, text("JFIF\0")), Uint8Array.of(0xff, 0xda, 0, 2));
    expect(readImageDimensions(bytes, "jpeg")).toBeNull();
  });
});
