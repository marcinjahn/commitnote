import { beforeAll, describe, expect, it } from "vitest";
import type { ImagePayload } from "../crypto/image-cipher";
import type { Keyring } from "../crypto/keyring";
import { testKeyring } from "../crypto/testing/test-keyring";
import { EMPTY_IMAGES, type ImageIndex } from "./image-index";
import {
  createImageResolver,
  type ImageResolverDeps,
} from "./image-resolver";
import { createPendingImage, type PendingImage } from "./pending-image";

let keyring: Keyring;
let otherKeyring: Keyring;

beforeAll(async () => {
  keyring = await testKeyring();
  otherKeyring = await testKeyring("another passphrase", 9);
});

function payload(size = 100): ImagePayload {
  return {
    type: "image/webp",
    width: 10,
    height: 10,
    bytes: Uint8Array.from({ length: size }, (_, i) => i & 0xff),
  };
}

interface Setup {
  resolver: ReturnType<typeof createImageResolver>;
  created: string[];
  revoked: string[];
  reads: string[];
  blobs: Map<string, Uint8Array | Error>;
  pending: Map<string, PendingImage>;
  restored: Map<string, string>;
  index: { value: ImageIndex };
}

function setup(limits: Partial<ImageResolverDeps> = {}): Setup {
  const created: string[] = [];
  const revoked: string[] = [];
  const reads: string[] = [];
  const blobs = new Map<string, Uint8Array | Error>();
  const pending = new Map<string, PendingImage>();
  const restored = new Map<string, string>();
  const index = { value: EMPTY_IMAGES as ImageIndex };
  const resolver = createImageResolver({
    keyring,
    adapter: {
      readBlobBytes: async (sha) => {
        reads.push(sha);
        await Promise.resolve();
        const blob = blobs.get(sha);
        if (blob === undefined) throw new Error("not found");
        if (blob instanceof Error) throw blob;
        return blob;
      },
    },
    engine: {
      getImageIndex: () => index.value,
      getPendingImage: (id) => pending.get(id),
      getRestoredImageSha: (id) => restored.get(id),
    },
    createObjectUrl: () => {
      const url = `blob:${created.length}`;
      created.push(url);
      return url;
    },
    revokeObjectUrl: (url) => revoked.push(url),
    ...limits,
  });
  return { resolver, created, revoked, reads, blobs, pending, restored, index };
}

function indexWith(
  key: "images" | "tombstones",
  image: PendingImage,
): ImageIndex {
  const entry =
    key === "images"
      ? { blobSha: image.blobSha, owners: [] }
      : { blobSha: image.blobSha, removedAt: 1 };
  return {
    ...EMPTY_IMAGES,
    [key]: new Map([[image.imageId, entry]]),
  } as ImageIndex;
}

async function stored(s: Setup, size = 100): Promise<PendingImage> {
  const image = await createPendingImage(keyring, payload(size));
  s.blobs.set(image.blobSha, image.envelope);
  s.index.value = {
    ...s.index.value,
    images: new Map([
      ...s.index.value.images,
      ...indexWith("images", image).images,
    ]),
  };
  return image;
}

describe("createImageResolver", () => {
  it("resolves a pending image without reading the adapter", async () => {
    const s = setup();
    const image = await createPendingImage(keyring, payload());
    s.pending.set(image.imageId, image);

    expect(await s.resolver.resolve(image.imageId)).toEqual({ url: "blob:0" });
    expect(s.reads).toEqual([]);
  });

  it("reads an index image once for concurrent and later calls", async () => {
    const s = setup();
    const image = await stored(s);

    const [a, b] = await Promise.all([
      s.resolver.resolve(image.imageId),
      s.resolver.resolve(image.imageId),
    ]);
    const c = await s.resolver.resolve(image.imageId);

    expect([a, b, c]).toEqual([
      { url: "blob:0" },
      { url: "blob:0" },
      { url: "blob:0" },
    ]);
    expect(s.reads).toEqual([image.blobSha]);
  });

  it("resolves a tombstoned image", async () => {
    const s = setup();
    const image = await createPendingImage(keyring, payload());
    s.blobs.set(image.blobSha, image.envelope);
    s.index.value = indexWith("tombstones", image);

    expect(await s.resolver.resolve(image.imageId)).toEqual({ url: "blob:0" });
  });

  it("resolves a restored image", async () => {
    const s = setup();
    const image = await createPendingImage(keyring, payload());
    s.blobs.set(image.blobSha, image.envelope);
    s.restored.set(image.imageId, image.blobSha);

    expect(await s.resolver.resolve(image.imageId)).toEqual({ url: "blob:0" });
  });

  it("is unavailable for an invalid or unknown id", async () => {
    const s = setup();
    const unknown = await createPendingImage(keyring, payload());

    expect(await s.resolver.resolve("nope")).toEqual({ unavailable: true });
    expect(await s.resolver.resolve(unknown.imageId)).toEqual({
      unavailable: true,
    });
  });

  it("is unavailable when the read fails and retries later", async () => {
    const s = setup();
    const image = await stored(s);
    s.blobs.set(image.blobSha, new Error("network"));

    expect(await s.resolver.resolve(image.imageId)).toEqual({
      unavailable: true,
    });

    s.blobs.set(image.blobSha, image.envelope);
    expect(await s.resolver.resolve(image.imageId)).toEqual({ url: "blob:0" });
    expect(s.reads).toHaveLength(2);
  });

  it("is unavailable for a wrong-key envelope and retries later", async () => {
    const s = setup();
    const image = await stored(s);
    const foreign = await createPendingImage(otherKeyring, payload());
    s.blobs.set(image.blobSha, foreign.envelope);

    expect(await s.resolver.resolve(image.imageId)).toEqual({
      unavailable: true,
    });

    s.blobs.set(image.blobSha, image.envelope);
    expect(await s.resolver.resolve(image.imageId)).toEqual({ url: "blob:0" });
  });

  it("evicts the least recently used url past the entry limit", async () => {
    const s = setup({ maxEntries: 2 });
    const [a, b, c] = [await stored(s), await stored(s), await stored(s)];

    await s.resolver.resolve(a.imageId);
    await s.resolver.resolve(b.imageId);
    await s.resolver.resolve(a.imageId);
    await s.resolver.resolve(c.imageId);

    expect(s.revoked).toEqual(["blob:1"]);
  });

  it("evicts past the byte limit and keeps an oversized entry alone", async () => {
    const s = setup({ maxBytes: 250 });
    const [a, b, c] = [
      await stored(s, 100),
      await stored(s, 100),
      await stored(s, 100),
    ];
    const big = await stored(s, 1000);

    await s.resolver.resolve(a.imageId);
    await s.resolver.resolve(b.imageId);
    expect(s.revoked).toEqual([]);
    await s.resolver.resolve(c.imageId);
    expect(s.revoked).toEqual(["blob:0"]);

    await s.resolver.resolve(big.imageId);
    expect(s.revoked).toEqual(["blob:0", "blob:1", "blob:2"]);
    expect(await s.resolver.resolve(big.imageId)).toEqual({ url: "blob:3" });
    expect(s.reads).toHaveLength(4);
  });

  it("dispose revokes everything and later calls are unavailable", async () => {
    const s = setup();
    const a = await stored(s);
    const b = await stored(s);
    await s.resolver.resolve(a.imageId);
    await s.resolver.resolve(b.imageId);

    s.resolver.dispose();

    expect(s.revoked).toEqual(["blob:0", "blob:1"]);
    expect(await s.resolver.resolve(a.imageId)).toEqual({ unavailable: true });
  });

  it("revokes the url of a request finishing after dispose", async () => {
    const s = setup();
    const image = await stored(s);

    const request = s.resolver.resolve(image.imageId);
    s.resolver.dispose();

    expect(await request).toEqual({ unavailable: true });
    expect(s.revoked).toEqual(s.created);
    expect(s.created).toHaveLength(1);
  });

  it("exposes a bound resolve", async () => {
    const s = setup();
    const image = await stored(s);
    const { resolve } = s.resolver;

    expect(await resolve(image.imageId)).toEqual({ url: "blob:0" });
  });
});

describe("readPayload", () => {
  it("returns a pending image without reading the adapter", async () => {
    const s = setup();
    const image = await createPendingImage(keyring, payload());
    s.pending.set(image.imageId, image);

    expect(await s.resolver.readPayload(image.imageId)).toEqual(payload());
    expect(s.reads).toEqual([]);
  });

  it("returns an indexed image", async () => {
    const s = setup();
    const image = await stored(s);

    expect(await s.resolver.readPayload(image.imageId)).toEqual(payload());
    expect(s.reads).toEqual([image.blobSha]);
  });

  it("returns a tombstoned image", async () => {
    const s = setup();
    const image = await createPendingImage(keyring, payload());
    s.blobs.set(image.blobSha, image.envelope);
    s.index.value = indexWith("tombstones", image);

    expect(await s.resolver.readPayload(image.imageId)).toEqual(payload());
  });

  it("returns null for an unknown id", async () => {
    const s = setup();
    const unknown = await createPendingImage(keyring, payload());

    expect(await s.resolver.readPayload(unknown.imageId)).toBeNull();
  });

  it("returns null when decryption fails", async () => {
    const s = setup();
    const image = await stored(s);
    const foreign = await createPendingImage(otherKeyring, payload());
    s.blobs.set(image.blobSha, foreign.envelope);

    expect(await s.resolver.readPayload(image.imageId)).toBeNull();
  });

  it("rejects when the blob read fails", async () => {
    const s = setup();
    const image = await stored(s);
    const failure = new Error("network");
    s.blobs.set(image.blobSha, failure);

    await expect(s.resolver.readPayload(image.imageId)).rejects.toBe(failure);
  });

  it("shares one read with a concurrent resolve of the same id", async () => {
    const s = setup();
    const image = await stored(s);

    const [resolved, read] = await Promise.all([
      s.resolver.resolve(image.imageId),
      s.resolver.readPayload(image.imageId),
    ]);

    expect(resolved).toEqual({ url: "blob:0" });
    expect(read).toEqual(payload());
    expect(s.reads).toEqual([image.blobSha]);
  });

  it("does not fill the object url cache", async () => {
    const s = setup();
    const image = await stored(s);

    await s.resolver.readPayload(image.imageId);

    expect(s.created).toEqual([]);
  });
});

