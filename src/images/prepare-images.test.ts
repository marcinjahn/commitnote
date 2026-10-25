import { beforeAll, describe, expect, it, vi } from "vitest";
import { decryptImage, type ImagePayload } from "../crypto/image-cipher";
import type { Keyring } from "../crypto/keyring";
import { testKeyring } from "../crypto/testing/test-keyring";
import { MAX_IMAGES_PER_ACTION, prepareImages } from "./prepare-images";
import type { ImagePipelineResult } from "./pipeline/image-pipeline";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await testKeyring();
});

function payloadOf(n: number): ImagePayload {
  return {
    type: "image/webp",
    width: 10 + n,
    height: 20 + n,
    bytes: Uint8Array.from({ length: 50 }, (_, i) => (i + n) & 0xff),
  };
}

function fileOf(n: number): Blob {
  return new Blob([Uint8Array.of(n)]);
}

async function indexOf(file: Blob): Promise<number> {
  return new Uint8Array(await file.arrayBuffer())[0]!;
}

describe("prepareImages", () => {
  it("encrypts every image in input order", async () => {
    const process = vi.fn(
      async (file: Blob): Promise<ImagePipelineResult> => ({
        ok: true,
        payload: payloadOf(await indexOf(file)),
      }),
    );

    const outcome = await prepareImages([fileOf(1), fileOf(2), fileOf(3)], {
      keyring,
      process: async () => process,
    });

    expect(outcome.kind).toBe("prepared");
    if (outcome.kind !== "prepared") return;
    expect(outcome.total).toBe(3);
    expect(outcome.rejections).toEqual([]);
    const payloads = await Promise.all(
      outcome.images.map((image) =>
        decryptImage(keyring, image.imageId, image.envelope),
      ),
    );
    expect(payloads).toEqual([payloadOf(1), payloadOf(2), payloadOf(3)]);
  });

  it("skips rejected files and reports their rejections", async () => {
    const process = async (file: Blob): Promise<ImagePipelineResult> => {
      const n = await indexOf(file);
      if (n === 2) return { ok: false, rejection: { kind: "notImage" } };
      if (n === 4) {
        return { ok: false, rejection: { kind: "tooLarge", limit: "gif" } };
      }
      return { ok: true, payload: payloadOf(n) };
    };

    const outcome = await prepareImages(
      [fileOf(1), fileOf(2), fileOf(3), fileOf(4)],
      { keyring, process: async () => process },
    );

    if (outcome.kind !== "prepared") throw new Error("expected prepared");
    expect(outcome.total).toBe(4);
    expect(outcome.images.map((image) => image.width)).toEqual([11, 13]);
    expect(outcome.rejections).toEqual([
      { kind: "notImage" },
      { kind: "tooLarge", limit: "gif" },
    ]);
  });

  it("treats a throwing process as unsupported and continues", async () => {
    const process = async (file: Blob): Promise<ImagePipelineResult> => {
      const n = await indexOf(file);
      if (n === 1) throw new Error("boom");
      return { ok: true, payload: payloadOf(n) };
    };

    const outcome = await prepareImages([fileOf(1), fileOf(2)], {
      keyring,
      process: async () => process,
    });

    if (outcome.kind !== "prepared") throw new Error("expected prepared");
    expect(outcome.rejections).toEqual([{ kind: "unsupported" }]);
    expect(outcome.images).toHaveLength(1);
  });

  it("rejects more than the limit without processing", async () => {
    const loadProcess = vi.fn();
    const files = Array.from({ length: MAX_IMAGES_PER_ACTION + 1 }, (_, i) =>
      fileOf(i),
    );

    const outcome = await prepareImages(files, { keyring, process: loadProcess });

    expect(outcome).toEqual({ kind: "tooMany", count: 11 });
    expect(loadProcess).not.toHaveBeenCalled();
  });

  it("accepts exactly the limit", async () => {
    const files = Array.from({ length: MAX_IMAGES_PER_ACTION }, (_, i) =>
      fileOf(i),
    );

    const outcome = await prepareImages(files, {
      keyring,
      process: async () => async () => ({ ok: true, payload: payloadOf(0) }),
    });

    if (outcome.kind !== "prepared") throw new Error("expected prepared");
    expect(outcome.images).toHaveLength(MAX_IMAGES_PER_ACTION);
  });

  it("returns nothing for no files without loading the processor", async () => {
    const loadProcess = vi.fn();

    const outcome = await prepareImages([], { keyring, process: loadProcess });

    expect(outcome).toEqual({
      kind: "prepared",
      images: [],
      rejections: [],
      total: 0,
    });
    expect(loadProcess).not.toHaveBeenCalled();
  });

  it("passes the profile to the processor", async () => {
    const process = vi.fn(
      async (): Promise<ImagePipelineResult> => ({
        ok: true,
        payload: payloadOf(0),
      }),
    );
    const profile = { maxBytes: 1 } as never;

    await prepareImages([fileOf(0)], {
      keyring,
      process: async () => process,
      profile,
    });

    expect(process).toHaveBeenCalledWith(expect.any(Blob), profile);
  });
});
