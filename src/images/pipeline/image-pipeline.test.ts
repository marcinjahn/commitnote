import { describe, expect, it, vi } from "vitest";
import {
  type DecodedImage,
  type ImageCodec,
  type ImageRejection,
  processImage,
} from "./image-pipeline";
import {
  MAX_IMAGE_INPUT_BYTES,
  NOTE_IMAGE_PROFILE,
  type ImageProfile,
} from "./image-profile";

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

const u32be = (value: number) =>
  Uint8Array.of(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
const u16le = (value: number) => Uint8Array.of(value & 0xff, value >> 8);

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

function gif(width: number, height: number, dataBlocks = 1): Uint8Array {
  const block = concat(Uint8Array.of(255), new Uint8Array(255));
  return concat(
    text("GIF89a"),
    u16le(width),
    u16le(height),
    Uint8Array.of(0, 0, 0),
    Uint8Array.of(0x21, 0xfe, 3, 0x61, 0x62, 0x63, 0),
    Uint8Array.of(0x2c, 0, 0, 0, 0),
    u16le(width),
    u16le(height),
    Uint8Array.of(0, 2),
    ...Array.from({ length: dataBlocks }, () => block),
    Uint8Array.of(0, 0x3b),
  );
}

const asBlob = (bytes: Uint8Array, type = "") =>
  new Blob([new Uint8Array(bytes)], { type });

interface FakeCodecOptions {
  width?: number;
  height?: number;
  encodedSizes?: number[];
  decodeError?: boolean;
  encodeError?: boolean;
}

function fakeCodec(options: FakeCodecOptions = {}) {
  const close = vi.fn();
  const decoded: DecodedImage = {
    width: options.width ?? 4000,
    height: options.height ?? 3000,
    close,
  };
  const sizes = [...(options.encodedSizes ?? [100])];
  const decode = vi.fn(async () => {
    if (options.decodeError) throw new Error("decode");
    return decoded;
  });
  const encodeWebp = vi.fn(
    async (_image: DecodedImage, _w: number, _h: number, _q: number) => {
      if (options.encodeError) throw new Error("encode");
      return new Uint8Array(sizes.shift() ?? 100);
    },
  );
  const codec: ImageCodec = { decode, encodeWebp };
  return { codec, decode, encodeWebp, close };
}

async function rejectionOf(
  input: Blob,
  codec: ImageCodec,
  profile?: ImageProfile,
): Promise<ImageRejection> {
  const result = await processImage(input, codec, profile);
  if (result.ok) throw new Error("expected a rejection");
  return result.rejection;
}

describe("processImage input checks", () => {
  it("rejects oversized input before reading any bytes", async () => {
    const { codec, decode } = fakeCodec();
    const input = new Blob([new Uint8Array(1)]);
    Object.defineProperty(input, "size", { value: MAX_IMAGE_INPUT_BYTES + 1 });
    const arrayBuffer = vi.spyOn(input, "arrayBuffer");
    expect(await rejectionOf(input, codec)).toEqual({ kind: "tooLarge", limit: "input" });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });

  it("distinguishes notImage from unsupported by MIME type", async () => {
    const { codec } = fakeCodec();
    const bytes = text("just some text");
    expect(await rejectionOf(asBlob(bytes, "text/plain"), codec)).toEqual({ kind: "notImage" });
    expect(await rejectionOf(asBlob(bytes), codec)).toEqual({ kind: "notImage" });
    expect(await rejectionOf(asBlob(bytes, "image/x-unknown"), codec)).toEqual({
      kind: "unsupported",
    });
  });

  it("rejects SVG as unsupported whatever its MIME type", async () => {
    const { codec, decode } = fakeCodec();
    const svg = text('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(await rejectionOf(asBlob(svg, "image/svg+xml"), codec)).toEqual({
      kind: "unsupported",
    });
    expect(await rejectionOf(asBlob(svg, "text/plain"), codec)).toEqual({
      kind: "unsupported",
    });
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects by header pixel count without decoding", async () => {
    const { codec, decode } = fakeCodec();
    expect(await rejectionOf(asBlob(png(10000, 6000), "image/png"), codec)).toEqual({
      kind: "tooManyPixels",
    });
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects by decoded pixel count", async () => {
    const { codec, encodeWebp, close } = fakeCodec({ width: 10000, height: 5001 });
    expect(await rejectionOf(asBlob(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), "image/jpeg"), codec)).toEqual({
      kind: "tooManyPixels",
    });
    expect(encodeWebp).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("processImage GIF", () => {
  it("passes GIFs through with metadata stripped and logical dimensions", async () => {
    const { codec, decode } = fakeCodec();
    const input = gif(7, 5);
    const result = await processImage(asBlob(input, "image/gif"), codec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.type).toBe("image/gif");
    expect(result.payload.width).toBe(7);
    expect(result.payload.height).toBe(5);
    expect(result.payload.bytes.length).toBe(input.length - 7);
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects GIFs without a trailer as unsupported", async () => {
    const { codec } = fakeCodec();
    const input = gif(2, 2);
    expect(
      await rejectionOf(asBlob(input.subarray(0, input.length - 1), "image/gif"), codec),
    ).toEqual({ kind: "unsupported" });
  });

  it("rejects stripped GIFs over the GIF limit", async () => {
    const { codec } = fakeCodec();
    const blocks = Math.ceil((5 * 1024 * 1024) / 256) + 1;
    expect(await rejectionOf(asBlob(gif(2, 2, blocks), "image/gif"), codec)).toEqual({
      kind: "tooLarge",
      limit: "gif",
    });
    const result = await processImage(asBlob(gif(2, 2, blocks - 2), "image/gif"), codec);
    expect(result.ok).toBe(true);
  });
});

describe("processImage WebP ladder", () => {
  const input = () => asBlob(png(4000, 3000), "image/png");
  const limit = NOTE_IMAGE_PROFILE.maxBytes;

  it("stops at the first attempt that fits", async () => {
    const { codec, encodeWebp, close } = fakeCodec({ encodedSizes: [limit] });
    const result = await processImage(input(), codec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({ type: "image/webp", width: 2560, height: 1920 });
    expect(result.payload.bytes.length).toBe(limit);
    expect(encodeWebp).toHaveBeenCalledTimes(1);
    expect(encodeWebp.mock.calls[0].slice(1)).toEqual([2560, 1920, 0.85]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("walks the ladder in order until a result fits", async () => {
    const { codec, encodeWebp } = fakeCodec({ encodedSizes: [limit + 1, limit + 1, 10] });
    const result = await processImage(input(), codec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({ width: 1920, height: 1440 });
    expect(encodeWebp.mock.calls.map((call) => call.slice(1))).toEqual([
      [2560, 1920, 0.85],
      [2560, 1920, 0.7],
      [1920, 1440, 0.7],
    ]);
  });

  it("never upscales small images", async () => {
    const { codec, encodeWebp } = fakeCodec({ width: 300, height: 200 });
    const result = await processImage(input(), codec);
    expect(result.ok).toBe(true);
    expect(encodeWebp.mock.calls[0].slice(1)).toEqual([300, 200, 0.85]);
  });

  it("rejects when no attempt fits", async () => {
    const { codec, encodeWebp, close } = fakeCodec({
      encodedSizes: [limit + 1, limit + 1, limit + 1],
    });
    expect(await rejectionOf(input(), codec)).toEqual({ kind: "tooLargeAfterCompression" });
    expect(encodeWebp).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledOnce();
  });

  it("honours a custom profile", async () => {
    const profile: ImageProfile = {
      attempts: [{ maxLongEdge: 1000, quality: 0.5 }],
      maxBytes: 50,
      maxGifBytes: 10,
    };
    const { codec, encodeWebp } = fakeCodec({ encodedSizes: [51] });
    expect(await rejectionOf(input(), codec, profile)).toEqual({
      kind: "tooLargeAfterCompression",
    });
    expect(encodeWebp).toHaveBeenCalledTimes(1);
    expect(encodeWebp.mock.calls[0].slice(1)).toEqual([1000, 750, 0.5]);

    const ok = fakeCodec({ encodedSizes: [50] });
    const result = await processImage(input(), ok.codec, profile);
    expect(result.ok).toBe(true);
    expect(await rejectionOf(asBlob(gif(2, 2), "image/gif"), ok.codec, profile)).toEqual({
      kind: "tooLarge",
      limit: "gif",
    });
  });

  it("maps decode failures to unsupported", async () => {
    const { codec, encodeWebp } = fakeCodec({ decodeError: true });
    expect(await rejectionOf(input(), codec)).toEqual({ kind: "unsupported" });
    expect(encodeWebp).not.toHaveBeenCalled();
  });

  it("maps encode failures to unsupported and still closes", async () => {
    const { codec, close } = fakeCodec({ encodeError: true });
    expect(await rejectionOf(input(), codec)).toEqual({ kind: "unsupported" });
    expect(close).toHaveBeenCalledOnce();
  });
});
