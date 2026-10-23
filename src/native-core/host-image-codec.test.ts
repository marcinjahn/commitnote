import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NOTE_IMAGE_PROFILE,
  SHARE_IMAGE_PROFILE,
} from "../images/pipeline/image-profile";
import { createHostImageCodec, processHostImage } from "./host-image-codec";
import type { HostImageCodec } from "./host-services";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const ascii = (text: string) =>
  Uint8Array.from(text, (char) => char.charCodeAt(0));

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concat(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    Uint8Array.of(0, 0, 0, 13),
    ascii("IHDR"),
    ihdr,
  );
}

function gif(width: number, height: number): Uint8Array<ArrayBuffer> {
  const u16 = (value: number) => Uint8Array.of(value & 0xff, value >> 8);
  return concat(
    ascii("GIF89a"),
    u16(width),
    u16(height),
    Uint8Array.of(0, 0, 0),
    Uint8Array.of(0x2c, 0, 0, 0, 0),
    u16(width),
    u16(height),
    Uint8Array.of(0, 2, 2, 0x4c, 0x01, 0, 0x3b),
  );
}

function fakeHostCodec(
  options: {
    width?: number;
    height?: number;
    encode?: (width: number, height: number, quality: number) => Uint8Array;
  } = {},
) {
  const codec = {
    decode: vi.fn<HostImageCodec["decode"]>(async () => ({
      handle: "handle-1",
      width: options.width ?? 3000,
      height: options.height ?? 2000,
    })),
    encodeWebp: vi.fn<HostImageCodec["encodeWebp"]>(
      async (_handle, width, height, quality) =>
        (options.encode ?? (() => new Uint8Array(10)))(width, height, quality),
    ),
    release: vi.fn<HostImageCodec["release"]>(),
  };
  return codec;
}

describe("host image codec", () => {
  it("decodes through the host and releases the handle once", async () => {
    const host = fakeHostCodec();
    const codec = createHostImageCodec(host);
    const image = await codec.decode(new Blob([Uint8Array.of(1, 2, 3)]));
    expect(host.decode).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3));
    expect(image).toMatchObject({ width: 3000, height: 2000 });

    image.close();
    image.close();
    expect(host.release).toHaveBeenCalledTimes(1);
    expect(host.release).toHaveBeenCalledWith("handle-1");
    await expect(codec.encodeWebp(image, 10, 10, 0.5)).rejects.toThrow();
  });

  it("copies the encoded bytes and rejects images it did not decode", async () => {
    const encoded = Uint8Array.of(0, 1, 2, 3, 4).subarray(1, 4);
    const host = fakeHostCodec({ encode: () => encoded });
    const codec = createHostImageCodec(host);
    const image = await codec.decode(new Blob([Uint8Array.of(1)]));

    const bytes = await codec.encodeWebp(image, 30, 20, 0.7);
    expect(host.encodeWebp).toHaveBeenCalledWith("handle-1", 30, 20, 0.7);
    expect(bytes).toEqual(Uint8Array.of(1, 2, 3));
    expect(bytes.buffer).not.toBe(encoded.buffer);

    const foreign = { width: 30, height: 20, close: () => {} };
    await expect(codec.encodeWebp(foreign, 30, 20, 0.7)).rejects.toThrow();
    expect(host.encodeWebp).toHaveBeenCalledTimes(1);
  });

  it("releases a decoded handle with invalid dimensions", async () => {
    const host = fakeHostCodec({ width: 0 });
    await expect(
      createHostImageCodec(host).decode(new Blob([Uint8Array.of(1)])),
    ).rejects.toThrow();
    expect(host.release).toHaveBeenCalledWith("handle-1");
  });

  it("releases exactly once when encoding throws", async () => {
    const host = fakeHostCodec();
    host.encodeWebp.mockRejectedValue(new Error("encoder failed"));
    const result = await processHostImage(
      host,
      new Blob([pngHeader(3000, 2000)], { type: "image/png" }),
    );
    expect(result).toEqual({ ok: false, rejection: { kind: "unsupported" } });
    expect(host.release).toHaveBeenCalledTimes(1);
  });

  it("falls back down the encode ladder by size", async () => {
    const host = fakeHostCodec();
    host.encodeWebp.mockImplementation(
      async () =>
        new Uint8Array(
          host.encodeWebp.mock.calls.length < 3
            ? SHARE_IMAGE_PROFILE.maxBytes + 1
            : 100,
        ),
    );
    const result = await processHostImage(
      host,
      new Blob([pngHeader(3000, 2000)], { type: "image/png" }),
      SHARE_IMAGE_PROFILE,
    );
    expect(host.encodeWebp.mock.calls.map((call) => call.slice(1))).toEqual([
      [1600, 1067, 0.75],
      [1280, 853, 0.75],
      [1024, 683, 0.6],
    ]);
    expect(result).toMatchObject({
      ok: true,
      payload: { type: "image/webp", width: 1024, height: 683 },
    });
    expect(host.release).toHaveBeenCalledTimes(1);
  });

  it("rejects when every ladder step is too large", async () => {
    const host = fakeHostCodec({
      encode: () => new Uint8Array(NOTE_IMAGE_PROFILE.maxBytes + 1),
    });
    const result = await processHostImage(
      host,
      new Blob([pngHeader(3000, 2000)], { type: "image/png" }),
    );
    expect(result).toEqual({
      ok: false,
      rejection: { kind: "tooLargeAfterCompression" },
    });
    expect(host.encodeWebp).toHaveBeenCalledTimes(
      NOTE_IMAGE_PROFILE.attempts.length,
    );
    expect(host.release).toHaveBeenCalledTimes(1);
  });

  it("never sends a GIF to the host", async () => {
    const host = fakeHostCodec();
    const result = await processHostImage(
      host,
      new Blob([gif(4, 3)], { type: "image/gif" }),
    );
    expect(result).toMatchObject({
      ok: true,
      payload: { type: "image/gif", width: 4, height: 3 },
    });
    expect(host.decode).not.toHaveBeenCalled();
    expect(host.encodeWebp).not.toHaveBeenCalled();
  });
});

describe("sharing from the native core", () => {
  let ctx: CoreTestContext;

  afterEach(() => {
    ctx.dispose();
  });

  it("re-encodes the images of a shared note through the host image codec", async () => {
    ctx = await createCoreTestContext({
      extraCommands: (app) => ({
        "test.share": async (params): Promise<unknown> => {
          const { path } = params as { path: string[] };
          const result = await app
            .current()!
            .services.shareService.createShare({ path, password: "" });
          return result.ok ? { ok: true } : { ok: false, error: result.error };
        },
      }),
    });
    const encodeWebp = vi.spyOn(ctx.host.imageCodec, "encodeWebp");
    const release = vi.spyOn(ctx.host.imageCodec, "release");
    const core = ctx.startCore();
    await ctx.logIn(core);

    expect(
      await ctx.call(core, "test.share", {
        path: ["Journal", "2026", "Whiteboard"],
      }),
    ).toEqual({ ok: true });
    expect(encodeWebp).toHaveBeenCalledTimes(1);
    expect(encodeWebp.mock.calls[0].slice(1)).toEqual([64, 48, 0.75]);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
