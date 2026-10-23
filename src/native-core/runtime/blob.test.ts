import { describe, expect, it } from "vitest";
import { Blob } from "./blob";

async function bytesOf(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

describe("Blob", () => {
  it("concatenates Uint8Array, ArrayBuffer and UTF-8 string parts", async () => {
    const view = Uint8Array.of(9, 1, 2, 9).subarray(1, 3);
    const blob = new Blob([view, Uint8Array.of(3).buffer, "ż"]);
    expect(blob.size).toBe(5);
    expect(await bytesOf(blob)).toEqual([1, 2, 3, 0xc5, 0xbc]);
  });

  it("copies the parts and hands out a fresh buffer each time", async () => {
    const source = Uint8Array.of(1, 2);
    const blob = new Blob([source]);
    source[0] = 7;
    const first = new Uint8Array(await blob.arrayBuffer());
    first[1] = 7;
    expect(await bytesOf(blob)).toEqual([1, 2]);
  });

  it("lower-cases the type and drops one with characters outside printable ASCII", () => {
    expect(new Blob([], { type: "Image/WEBP" }).type).toBe("image/webp");
    expect(new Blob([]).type).toBe("");
    expect(new Blob([], { type: "image/é" }).type).toBe("");
    expect(new Blob([], { type: "image/png\n" }).type).toBe("");
  });

  it("slices with relative and clamped bounds and an optional type", async () => {
    const blob = new Blob([Uint8Array.of(0, 1, 2, 3, 4)], {
      type: "image/png",
    });
    expect(await bytesOf(blob.slice(1, 3))).toEqual([1, 2]);
    expect(await bytesOf(blob.slice(-2))).toEqual([3, 4]);
    expect(await bytesOf(blob.slice(-10, -3))).toEqual([0, 1]);
    expect(await bytesOf(blob.slice(3, 1))).toEqual([]);
    expect(await bytesOf(blob.slice(2, 99))).toEqual([2, 3, 4]);
    expect(await bytesOf(blob.slice())).toEqual([0, 1, 2, 3, 4]);
    expect(blob.slice().type).toBe("");
    expect(blob.slice(0, 1, "IMAGE/GIF").type).toBe("image/gif");
  });
});
