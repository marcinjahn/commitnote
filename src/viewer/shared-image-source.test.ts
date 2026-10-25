import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Argon2idFunction } from "../crypto/argon2";
import { ShareReadError } from "../forge/share-host";
import { openShare, sealShare, type OpenedShare } from "../share/share-envelope";
import { createSharedImageSource } from "./shared-image-source";

const stubArgon2: Argon2idFunction = async () => new Uint8Array(32);

const FIRST = { id: "a".repeat(26), type: "image/webp", bytes: new Uint8Array([1, 2, 3]) } as const;
const SECOND = { id: "b".repeat(26), type: "image/gif", bytes: new Uint8Array([9, 8, 7, 6]) } as const;

let opened: OpenedShare;
let contents: string[];

beforeAll(async () => {
  const sealed = await sealShare({
    name: "Plan",
    markdown: "# Plan\n",
    sharedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null,
    argon2id: stubArgon2,
    images: [FIRST, SECOND].map(({ id, type, bytes }) => ({
      imageId: id,
      payload: { type, width: 2, height: 2, bytes },
    })),
  });
  if (sealed.kind !== "sealed") throw new Error("expected sealed");
  contents = [...sealed.images];
  opened = await openShare(sealed.envelope, sealed.linkSecret, undefined, stubArgon2);
});

function setup(readImageFile?: (file: string) => Promise<string>) {
  const files = new Map(opened.note.images.map((image, i) => [image.file, contents[i]]));
  const read = vi.fn(readImageFile ?? (async (file: string) => files.get(file)!));
  const urls = new Map<string, Blob>();
  const source = createSharedImageSource({
    images: opened.note.images,
    hosted: { readImageFile: read },
    shareKey: opened.shareKey,
    createObjectUrl: (blob) => {
      const url = `blob:test/${urls.size}`;
      urls.set(url, blob);
      return url;
    },
  });
  return { source, read, urls, files };
}

async function blobOf(urls: Map<string, Blob>, result: { url: string } | { unavailable: true }) {
  if (!("url" in result)) throw new Error("expected url");
  const blob = urls.get(result.url)!;
  return { type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

describe("shared image source", () => {
  it("resolves both images to blobs with the right type and bytes", async () => {
    const { source, urls } = setup();
    expect(await blobOf(urls, await source(FIRST.id))).toEqual({ type: FIRST.type, bytes: FIRST.bytes });
    expect(await blobOf(urls, await source(SECOND.id))).toEqual({ type: SECOND.type, bytes: SECOND.bytes });
  });

  it("reports an unknown id as unavailable without fetching", async () => {
    const { source, read } = setup();
    expect(await source("c".repeat(26))).toEqual({ unavailable: true });
    expect(read).not.toHaveBeenCalled();
  });

  it("retries after a read failure", async () => {
    let calls = 0;
    const { files } = setup();
    const flaky = setup(async (file) => {
      if (calls++ === 0) throw new ShareReadError("network");
      return files.get(file)!;
    });
    expect(await flaky.source(FIRST.id)).toEqual({ unavailable: true });
    expect(await flaky.source(FIRST.id)).toEqual({ url: "blob:test/0" });
  });

  it("reports a swapped image file as unavailable", async () => {
    const { files } = setup();
    const [firstFile, secondFile] = opened.note.images.map((image) => image.file);
    const swapped = setup(async (file) => files.get(file === firstFile ? secondFile : firstFile)!);
    expect(await swapped.source(FIRST.id)).toEqual({ unavailable: true });
  });

  it("fetches once for concurrent requests", async () => {
    const { source, read } = setup();
    const [a, b] = await Promise.all([source(FIRST.id), source(FIRST.id)]);
    expect(a).toEqual(b);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not fetch a cached image again", async () => {
    const { source, read } = setup();
    const first = await source(FIRST.id);
    expect(await source(FIRST.id)).toEqual(first);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
