import { describe, expect, it } from "vitest";
import { stripGifMetadata } from "./gif-metadata";

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

const subBlocks = (...blocks: Uint8Array[]) =>
  concat(...blocks.map((block) => concat(Uint8Array.of(block.length), block)), Uint8Array.of(0));

const header = concat(
  text("GIF89a"),
  Uint8Array.of(2, 0, 2, 0, 0x80, 0, 0),
  Uint8Array.of(0, 0, 0, 255, 255, 255),
);

const netscape = concat(
  Uint8Array.of(0x21, 0xff, 11),
  text("NETSCAPE2.0"),
  subBlocks(Uint8Array.of(1, 0, 0)).subarray(0),
);

const graphicControl = Uint8Array.of(0x21, 0xf9, 4, 0, 10, 0, 0, 0);

function frame(fill: number, localColours = false): Uint8Array {
  return concat(
    Uint8Array.of(0x2c, 0, 0, 0, 0, 2, 0, 2, 0, localColours ? 0x80 : 0),
    localColours ? Uint8Array.of(1, 2, 3, 4, 5, 6) : new Uint8Array(),
    Uint8Array.of(2),
    subBlocks(Uint8Array.of(fill, fill, fill)),
  );
}

const comment = concat(Uint8Array.of(0x21, 0xfe), subBlocks(text("hello")));
const xmp = concat(
  Uint8Array.of(0x21, 0xff, 11),
  text("XMP DataXMP"),
  subBlocks(text("<x:xmpmeta/>"), text("more")),
);
const trailer = Uint8Array.of(0x3b);

describe("stripGifMetadata", () => {
  it("drops comments and foreign application extensions but keeps the animation", () => {
    const kept = concat(
      header,
      netscape,
      graphicControl,
      frame(1),
      graphicControl,
      frame(2, true),
      trailer,
    );
    const input = concat(
      header,
      comment,
      xmp,
      netscape,
      graphicControl,
      comment,
      frame(1),
      xmp,
      graphicControl,
      frame(2, true),
      comment,
      trailer,
    );
    expect(stripGifMetadata(input)).toEqual(kept);
  });

  it("keeps ANIMEXTS1.0 and plain text extensions", () => {
    const anim = concat(
      Uint8Array.of(0x21, 0xff, 11),
      text("ANIMEXTS1.0"),
      subBlocks(Uint8Array.of(1, 0, 0)),
    );
    const plainText = concat(Uint8Array.of(0x21, 0x01, 12), new Uint8Array(12), subBlocks(text("hi")));
    const input = concat(header, anim, plainText, frame(1), trailer);
    expect(stripGifMetadata(input)).toEqual(input);
  });

  it("returns an identical copy for a gif without metadata", () => {
    const input = concat(header, frame(3), trailer);
    const output = stripGifMetadata(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });

  it("drops bytes after the trailer and does not modify the input", () => {
    const input = concat(header, comment, frame(1), trailer, text("garbage"));
    const snapshot = input.slice();
    expect(stripGifMetadata(input)).toEqual(concat(header, frame(1), trailer));
    expect(input).toEqual(snapshot);
  });

  it("returns null for a bad signature", () => {
    expect(stripGifMetadata(text("GIF90a"))).toBeNull();
    expect(stripGifMetadata(concat(text("PNG"), header.subarray(3)))).toBeNull();
    expect(stripGifMetadata(new Uint8Array())).toBeNull();
  });

  it("returns null for an unknown block introducer", () => {
    expect(stripGifMetadata(concat(header, Uint8Array.of(0x42), trailer))).toBeNull();
  });

  it("returns null when the stream has no trailer or is truncated", () => {
    const whole = concat(header, comment, frame(1, true), trailer);
    expect(stripGifMetadata(whole)).not.toBeNull();
    for (let length = 0; length < whole.length; length++) {
      expect(stripGifMetadata(whole.subarray(0, length))).toBeNull();
    }
  });
});
