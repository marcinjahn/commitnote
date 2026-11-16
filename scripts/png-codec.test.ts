import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng, encodePng, type RgbaImage } from "./png-codec";

function gradient(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data.set(
        [(x * 37) & 0xff, (y * 11) & 0xff, (x * y) & 0xff, (x + y) * 5],
        i,
      );
    }
  }
  return { width, height, data };
}

describe("png codec", () => {
  it("decodes what it encodes", () => {
    const image = gradient(17, 9);
    expect(decodePng(encodePng(image))).toEqual(image);
  });

  it("decodes an RGB PNG as opaque RGBA", () => {
    const encoded = encodePng(gradient(4, 3));
    const header = Buffer.from(encoded.subarray(16, 29));
    header[9] = 2;
    const scanlines = Buffer.from([
      ...[0, 10, 20, 30, 40, 50, 60],
      ...[2, 1, 1, 1, 1, 1, 1],
      ...[1, 5, 5, 5, 1, 1, 1],
    ]);
    const chunk = (type: string, body: Buffer) => {
      const out = Buffer.alloc(12 + body.length);
      out.writeUInt32BE(body.length, 0);
      out.write(type, 4, "latin1");
      body.copy(out, 8);
      return out;
    };
    header.writeUInt32BE(2, 0);
    header.writeUInt32BE(3, 4);
    const png = Buffer.concat([
      encoded.subarray(0, 8),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(scanlines)),
      chunk("IEND", Buffer.alloc(0)),
    ]);

    const image = decodePng(png);

    expect(image.width).toBe(2);
    expect(image.height).toBe(3);
    expect([...image.data]).toEqual([
      ...[10, 20, 30, 255, 40, 50, 60, 255],
      ...[11, 21, 31, 255, 41, 51, 61, 255],
      ...[5, 5, 5, 255, 6, 6, 6, 255],
    ]);
  });
});
